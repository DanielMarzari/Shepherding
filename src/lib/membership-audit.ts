import "server-only";
import { cache } from "react";
import { getDb } from "./db";
import { getSyncSettings } from "./pco";
import {
  LANE_KEYS,
  type AuditPersonRow,
  type LaneKey,
  type MembershipAudit,
} from "./membership-audit-shared";

export * from "./membership-audit-shared";

/** The membership audit, read entirely from the nightly snapshot.
 *
 *  The page this replaced ran a per-person aggregate over every activity
 *  source at request time: 3.6 s on 1,078 members, and it got slower as the
 *  check-in table grew. person_activity already holds the five lane flags
 *  and a classification, so the whole page is one indexed join — measured
 *  at ~25 ms for the same roster.
 *
 *  The cost of that trade is staleness: everything here is as of the last
 *  refresh, which is why `refreshedAt` is returned and shown. A number that
 *  is five minutes stale and labelled is more useful than one that is live
 *  and takes four seconds to arrive.
 */

interface RawRow {
  pcoId: string;
  firstName: string | null;
  lastName: string | null;
  status: string | null;
  inactivatedAt: string | null;
  w: number;
  s: number;
  c: number;
  g: number;
  o: number;
  lastActivityAt: string | null;
  classification: string | null;
  dupPairs: number;
}

const PLACEHOLDER_NAMES = new Set([
  "test", "tester", "testing", "unknown", "na", "n/a", "none", "tbd", "xxx",
]);

/** Same rule as the name audit: a name is junk when it has no letters, does
 *  not start with one, or is entirely a placeholder word. */
function isJunkName(name: string | null): boolean {
  if (!name) return false;
  const t = name.trim();
  if (t.length === 0) return false;
  if (!/\p{L}/u.test(t)) return true;
  if (!/^\p{L}/u.test(t)) return true;
  return PLACEHOLDER_NAMES.has(t.toLowerCase());
}

const MS_PER_DAY = 86_400_000;

export const getMembershipAudit = cache(getMembershipAuditImpl);

function getMembershipAuditImpl(
  orgId: number,
  membershipType: string,
): MembershipAudit {
  const db = getDb();

  // The duplicate flag comes from a CTE, not a correlated subquery. A pair
  // can name the person in either column, and `WHERE person_a = ? OR
  // person_b = ?` cannot use either index — on real data that scanned 7,293
  // pairs per member and took 5.3 s, slower than the aggregate this page
  // replaced. Flattening both columns once first is 56 ms for the same rows.
  //
  // Only high-confidence pairs count. The low tier holds 6,979 pairs and
  // touches 480 of 1,078 members, which would make "Worth a look" useless;
  // high touches 29.
  const raw = db
    .prepare(
      `WITH dups AS (
         SELECT person_a AS pid FROM duplicate_pairs
          WHERE org_id = ? AND confidence = 'high'
         UNION
         SELECT person_b FROM duplicate_pairs
          WHERE org_id = ? AND confidence = 'high'
       )
       SELECT
         p.pco_id              AS pcoId,
         p.first_name          AS firstName,
         p.last_name           AS lastName,
         p.status              AS status,
         p.inactivated_at      AS inactivatedAt,
         COALESCE(pa.in_worship_lane, 0)   AS w,
         COALESCE(pa.in_serving_lane, 0)   AS s,
         COALESCE(pa.in_community_lane, 0) AS c,
         COALESCE(pa.in_giving_lane, 0)    AS g,
         COALESCE(pa.in_outreach_lane, 0)  AS o,
         pa.last_activity_at   AS lastActivityAt,
         pa.classification     AS classification,
         (d.pid IS NOT NULL) AS dupPairs
       FROM pco_people p
       LEFT JOIN person_activity pa
         ON pa.org_id = p.org_id AND pa.person_id = p.pco_id
       LEFT JOIN dups d ON d.pid = p.pco_id
      WHERE p.org_id = ? AND p.membership_type = ?`,
    )
    .all(orgId, orgId, orgId, membershipType) as RawRow[];

  // Who each person pairs with, resolved to names in one pass. The column
  // showing "Possible duplicate" without saying duplicate of WHOM made the
  // flag unactionable: you had to go to /audit/duplicates to find out.
  const pairRows = db
    .prepare(
      `SELECT dp.person_a AS a, dp.person_b AS b,
              pa.first_name AS aFirst, pa.last_name AS aLast,
              pb.first_name AS bFirst, pb.last_name AS bLast
         FROM duplicate_pairs dp
         LEFT JOIN pco_people pa ON pa.org_id = dp.org_id AND pa.pco_id = dp.person_a
         LEFT JOIN pco_people pb ON pb.org_id = dp.org_id AND pb.pco_id = dp.person_b
        WHERE dp.org_id = ? AND dp.confidence = 'high'`,
    )
    .all(orgId) as Array<{
    a: string;
    b: string;
    aFirst: string | null;
    aLast: string | null;
    bFirst: string | null;
    bLast: string | null;
  }>;

  const partners = new Map<string, { pcoId: string; name: string }[]>();
  const nameOf = (f: string | null, l: string | null, id: string) =>
    [f?.trim(), l?.trim()].filter(Boolean).join(" ") || `(unknown #${id})`;
  for (const pr of pairRows) {
    const aName = nameOf(pr.aFirst, pr.aLast, pr.a);
    const bName = nameOf(pr.bFirst, pr.bLast, pr.b);
    if (!partners.has(pr.a)) partners.set(pr.a, []);
    if (!partners.has(pr.b)) partners.set(pr.b, []);
    partners.get(pr.a)!.push({ pcoId: pr.b, name: bName });
    partners.get(pr.b)!.push({ pcoId: pr.a, name: aName });
  }

  const refreshed = db
    .prepare(
      `SELECT MAX(refreshed_at) AS at FROM person_activity WHERE org_id = ?`,
    )
    .get(orgId) as { at: string | null } | undefined;

  const now = Date.now();
  const laneTotals: Record<LaneKey, number> = { w: 0, s: 0, c: 0, g: 0, o: 0 };
  const bandTotals = [0, 0, 0, 0, 0, 0];
  const comboCounts = new Map<string, number>();
  const connectionTotals: Record<string, number> = {};
  let flaggedTotal = 0;

  const rows: AuditPersonRow[] = raw.map((r) => {
    const lanes: Record<LaneKey, boolean> = {
      w: r.w === 1,
      s: r.s === 1,
      c: r.c === 1,
      g: r.g === 1,
      o: r.o === 1,
    };
    let laneCount = 0;
    let comboKey = "";
    for (const k of LANE_KEYS) {
      if (lanes[k]) {
        laneTotals[k]++;
        laneCount++;
        comboKey += k;
      }
    }
    bandTotals[laneCount]++;
    comboCounts.set(comboKey, (comboCounts.get(comboKey) ?? 0) + 1);

    const cls = r.classification;
    if (cls) connectionTotals[cls] = (connectionTotals[cls] ?? 0) + 1;

    const first = r.firstName?.trim() || null;
    const last = r.lastName?.trim() || null;
    const fullName = [first, last].filter(Boolean).join(" ") || `(unknown #${r.pcoId})`;

    const flags: string[] = [];
    const statusLower = (r.status ?? "").toLowerCase();
    const nameLower = `${first ?? ""} ${last ?? ""}`.toLowerCase();
    if (statusLower.includes("deceased") || nameLower.includes("deceased")) {
      flags.push("Deceased");
    }
    if (statusLower === "inactive" || r.inactivatedAt) flags.push("Inactive in PCO");
    if (!first && !last) flags.push("No name on record");
    else if (isJunkName(first) || isJunkName(last)) flags.push("Name looks wrong");
    const duplicateOf = partners.get(r.pcoId) ?? [];
    if (duplicateOf.length > 0) flags.push("Possible duplicate");
    if (flags.length) flaggedTotal++;

    const daysSince = r.lastActivityAt
      ? Math.max(0, Math.floor((now - Date.parse(r.lastActivityAt)) / MS_PER_DAY))
      : null;

    return {
      pcoId: r.pcoId,
      fullName,
      initials:
        ((first?.[0] ?? "") + (last?.[0] ?? "")).toUpperCase() || "??",
      lanes,
      laneCount,
      lastActivityAt: r.lastActivityAt,
      daysSince,
      connection: cls,
      flags,
      duplicateOf,
    };
  });

  const combos = [...comboCounts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.length - b.key.length);

  return {
    membershipType,
    total: rows.length,
    rows,
    laneTotals,
    bandTotals,
    combos,
    connectionTotals,
    flaggedTotal,
    refreshedAt: refreshed?.at ?? null,
    activityMonths: getSyncSettings(orgId).activityMonths,
  };
}
