import "server-only";
import { getDb } from "./db";
import {
  getExcludedMembershipTypes,
  getInactiveAuditExcludedTypes,
} from "./pco";

/** The pulse check: who shows no sign of life at all.
 *
 *  Deliberately the opposite test to Known. Known asks for two categories
 *  each over a bar — a deliberately high bar, because it decides who the
 *  church believes it can see. This asks the lowest question there is:
 *  one of anything, ever, inside a year. A single gift, one email open,
 *  one check-in, one form. Anybody who cannot clear that has not been
 *  seen doing anything for twelve months, and is a candidate for being
 *  marked inactive in Planning Center.
 *
 *  A candidate, not a verdict. The church may know perfectly well that
 *  somebody is still around and simply does nothing that PCO records —
 *  which is why this produces a list to work through rather than a change
 *  to anybody's record.
 */

export interface InactiveCandidate {
  personId: string;
  name: string;
  membershipType: string | null;
  /** The five next-steps lanes. A candidate with one is a contradiction
   *  worth seeing: the lane comes from a roster, which needs no
   *  attendance, so they are connected on paper and absent in fact. */
  lanes: Record<"w" | "s" | "c" | "g" | "o", boolean>;
  laneCount: number;
  /** Their band. 'shepherded' here means somebody is formally responsible
   *  for them and has still not seen them in a year. */
  classification: string;
  /** The most recent trace of them anywhere, or null if there is none. */
  lastSeenAt: string | null;
  /** Which source that date came from. */
  lastSeenVia: string | null;
  daysSince: number | null;
}

export interface InactiveAudit {
  /** Active records considered — the pool this is drawn from. */
  considered: number;
  /** Already marked inactive in PCO, so not our problem. */
  alreadyInactive: number;
  candidates: InactiveCandidate[];
  /** Of the candidates, how many have no trace at all, ever. */
  neverSeen: number;
  /** Left out because of their membership type, and which types those are. */
  excludedByType: number;
  excludedTypes: string[];
  /** Membership types present on the list, for the filter chips. */
  typesPresent: { type: string; n: number }[];
  months: number;
}

const SOURCE_LABEL: Record<string, string> = {
  checkin: "Check-in",
  checkin_by: "Checked somebody in",
  form: "Form",
  attendance: "Group meeting",
  serving: "Served",
  giving: "Gift",
  email: "Email open",
  registration: "Registration",
};

/** Months of silence before somebody is a candidate. */
export const PULSE_MONTHS = 12;

export function getInactiveAudit(
  orgId: number,
  months: number = PULSE_MONTHS,
): InactiveAudit {
  const db = getDb();

  // One row per person per source, with that source's most recent date.
  // No minimums anywhere: this is the lowest bar the data can express.
  db.exec(`DROP TABLE IF EXISTS pulse;`);
  db.exec(`CREATE TEMP TABLE pulse (person_id TEXT NOT NULL, src TEXT NOT NULL, at TEXT);`);
  const add = (src: string, sql: string, params: unknown[]) =>
    db.prepare(`INSERT INTO pulse (person_id, src, at) SELECT person_id, '${src}', at FROM (${sql})`).run(...(params as []));

  add("checkin", `SELECT person_id, MAX(event_time_starts_at) AS at FROM pco_check_ins
                   WHERE org_id = ? AND person_id IS NOT NULL AND person_id <> '' GROUP BY person_id`, [orgId]);
  add("checkin_by", `SELECT checked_in_by_id AS person_id, MAX(event_time_starts_at) AS at FROM pco_check_ins
                      WHERE org_id = ? AND checked_in_by_id IS NOT NULL GROUP BY checked_in_by_id`, [orgId]);
  add("form", `SELECT person_id, MAX(pco_created_at) AS at FROM pco_form_submissions
                WHERE org_id = ? AND person_id IS NOT NULL AND person_id <> '' GROUP BY person_id`, [orgId]);
  add("attendance", `SELECT person_id, MAX(event_starts_at) AS at FROM pco_event_attendances
                      WHERE org_id = ? AND attended = 1 GROUP BY person_id`, [orgId]);
  add("serving", `SELECT person_id, MAX(pco_created_at) AS at FROM pco_plan_people
                   WHERE org_id = ? AND COALESCE(status,'') <> 'D' GROUP BY person_id`, [orgId]);
  add("giving", `SELECT person_id, MAX(last_gift_on) AS at FROM pushpay_payer_summary
                  WHERE org_id = ? AND person_id IS NOT NULL GROUP BY person_id`, [orgId]);
  add("email", `SELECT c.person_id AS person_id, MAX(a.occurred_at) AS at
                  FROM constant_contact_activity a
                  JOIN constant_contact_contacts c ON c.org_id = a.org_id AND c.contact_id = a.contact_id
                 WHERE a.org_id = ? AND a.activity_type IN ('open','click')
                   AND c.person_id IS NOT NULL AND c.person_id <> ''
                 GROUP BY c.person_id`, [orgId]);
  add("registration", `SELECT a.person_id AS person_id, MAX(s.pco_created_at) AS at
                         FROM pco_registration_attendees a
                         JOIN pco_registration_signups s ON s.org_id = a.org_id AND s.pco_id = a.signup_id
                        WHERE a.org_id = ? AND a.person_id IS NOT NULL AND a.person_id <> ''
                        GROUP BY a.person_id`, [orgId]);
  db.exec(`CREATE INDEX pulse_pid ON pulse(person_id);`);

  // Alive and not already written off: those are somebody else's problem,
  // and the point of this list is the records nobody has dealt with.
  const aliveSql = `
    p.inactivated_at IS NULL
    AND LOWER(COALESCE(p.status,'')) <> 'inactive'
    AND NOT EXISTS (
      SELECT 1 FROM pco_person_fields d
       WHERE d.org_id = p.org_id AND d.person_id = p.pco_id
         AND d.field_name = 'Date of Death' AND d.value_on IS NOT NULL)`;

  const cut = new Date(Date.now() - months * 30.44 * 86_400_000).toISOString();

  // Both lists: the org-wide one (SYSTEM USE, Non-Attendee Staff — people
  // the whole app already does not count) and the audit's own, which
  // holds the Outreach Partner types. A partner with no check-ins is a
  // partner, not a lapsed attender.
  const excludedTypes = Array.from(
    new Set([
      ...getExcludedMembershipTypes(orgId),
      ...getInactiveAuditExcludedTypes(orgId),
    ]),
  );
  const typePh = excludedTypes.length
    ? `AND COALESCE(p.membership_type,'') NOT IN (${excludedTypes.map(() => "?").join(",")})`
    : "";

  const rows = db
    .prepare(
      `SELECT p.pco_id AS id, p.first_name AS f, p.last_name AS l,
              p.membership_type AS mt,
              COALESCE(pa.classification,'unknown') AS cls,
              COALESCE(pa.in_worship_lane,0) AS lw,
              COALESCE(pa.in_serving_lane,0) AS ls,
              COALESCE(pa.in_community_lane,0) AS lc,
              COALESCE(pa.in_giving_lane,0) AS lg,
              COALESCE(pa.in_outreach_lane,0) AS lo,
              (SELECT MAX(at) FROM pulse WHERE person_id = p.pco_id) AS lastAt,
              (SELECT src FROM pulse WHERE person_id = p.pco_id
                ORDER BY at DESC LIMIT 1) AS lastSrc
         FROM pco_people p
         LEFT JOIN person_activity pa
           ON pa.org_id = p.org_id AND pa.person_id = p.pco_id
        WHERE p.org_id = ? AND ${aliveSql}
          ${typePh}
          AND COALESCE((SELECT MAX(at) FROM pulse WHERE person_id = p.pco_id), '') < ?
        ORDER BY p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE`,
    )
    .all(orgId, ...excludedTypes, cut) as Array<{
    id: string;
    f: string | null;
    l: string | null;
    mt: string | null;
    cls: string;
    lw: number;
    ls: number;
    lc: number;
    lg: number;
    lo: number;
    lastAt: string | null;
    lastSrc: string | null;
  }>;

  const one = (sql: string) =>
    (db.prepare(sql).get(orgId) as { n: number }).n;

  const now = Date.now();
  const candidates = rows.map((r) => {
    const t = r.lastAt ? Date.parse(r.lastAt) : NaN;
    const lanes = {
      w: r.lw === 1,
      s: r.ls === 1,
      c: r.lc === 1,
      g: r.lg === 1,
      o: r.lo === 1,
    };
    return {
      personId: r.id,
      name:
        [r.f?.trim(), r.l?.trim()].filter(Boolean).join(" ") ||
        `(unknown #${r.id})`,
      membershipType: r.mt,
      lanes,
      laneCount: Object.values(lanes).filter(Boolean).length,
      classification: r.cls,
      lastSeenAt: r.lastAt,
      lastSeenVia: r.lastSrc ? (SOURCE_LABEL[r.lastSrc] ?? r.lastSrc) : null,
      daysSince: Number.isNaN(t)
        ? null
        : Math.max(0, Math.floor((now - t) / 86_400_000)),
    };
  });

  db.exec(`DROP TABLE IF EXISTS pulse;`);

  return {
    considered: one(
      `SELECT COUNT(*) AS n FROM pco_people p WHERE p.org_id = ? AND ${aliveSql}`,
    ),
    alreadyInactive: one(
      `SELECT COUNT(*) AS n FROM pco_people p
        WHERE p.org_id = ?
          AND (p.inactivated_at IS NOT NULL
            OR LOWER(COALESCE(p.status,'')) = 'inactive')`,
    ),
    candidates,
    neverSeen: candidates.filter((c) => c.lastSeenAt === null).length,
    excludedByType: excludedTypes.length
      ? one(
          `SELECT COUNT(*) AS n FROM pco_people p
            WHERE p.org_id = ? AND ${aliveSql}
              AND COALESCE(p.membership_type,'') IN (${excludedTypes
                .map((t) => `'${t.replace(/'/g, "''")}'`)
                .join(",")})`,
        )
      : 0,
    excludedTypes,
    typesPresent: [
      ...candidates
        .reduce((m, c) => {
          const k = c.membershipType ?? "(unset)";
          return m.set(k, (m.get(k) ?? 0) + 1);
        }, new Map<string, number>())
        .entries(),
    ]
      .map(([type, n]) => ({ type, n }))
      .sort((a, b) => b.n - a.n),
    months,
  };
}
