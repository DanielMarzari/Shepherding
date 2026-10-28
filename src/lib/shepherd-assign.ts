import "server-only";
import { cache } from "react";
import { getDb } from "./db";
import { getListByName } from "./lists-read";
import { getShepherdTeamBreakdown } from "./shepherd-team-read";

/** Assigning everyone in Known to somebody on the shepherd team.
 *
 *  Three populations, and which one a person is in depends entirely on
 *  shepherd_known_people — the names shepherds gave us when asked who they
 *  already know:
 *
 *    uncontested  exactly one shepherd named them     → assign in bulk
 *    contested    two or more named them              → somebody must choose
 *    pool         nobody named them                   → 87% of the list
 *
 *  Everything here reads person_activity for the Known band, so it is as of
 *  the last snapshot refresh like every other page.
 */

export const SHEPHERD_TEAM_LIST = "REFERENCE - Shepherd Team";

/** What a shepherd carries until somebody says otherwise.
 *
 *  Bandwidth used to start unset, on the reasoning that a number nobody
 *  agreed to should not count toward the team's capacity. In practice that
 *  left every page reading zero and the allocator refusing to place
 *  anyone, so the first real question — is the team big enough — could not
 *  be asked until 25 conversations had happened. A visible starting figure
 *  everyone can argue with beats a blank that stops the page working.
 *
 *  It is a default, not a judgment: `bandwidthSet` says whether a shepherd
 *  has one of their own, so the pages can still show who has actually been
 *  asked. Clearing the field returns them to this number.
 */
export const DEFAULT_BANDWIDTH = 50;

export interface ShepherdRow {
  personId: string;
  name: string;
  initials: string;
  /** People they already oversee through a group or team. */
  byRole: number;
  /** People handed to them on this page. */
  assigned: number;
  /** Never null: DEFAULT_BANDWIDTH when they have none of their own. */
  bandwidth: number;
  /** True when this is their own figure rather than the default. */
  bandwidthSet: boolean;
}

export interface AssignCapacity {
  knownAdults: number;
  shepherds: number;
  /** knownAdults / shepherds, rounded — the "if you split it evenly" line. */
  evenSplit: number;
  /** Sum across the whole team, defaults included. */
  totalBandwidth: number;
  /** How many have a figure of their own rather than the default. */
  bandwidthsSet: number;
  byRole: number;
  assigned: number;
  /** Known adults with no shepherd yet. */
  unassigned: number;
  /** Places left, counted per shepherd and never below nought.
   *
   *  Bandwidth is not a pool. Somebody carrying 150 against a bandwidth of
   *  50 does not use up anybody else's room — the 50 free beside a
   *  shepherd with nobody are still 50 people who can be assigned today.
   *  Summing the team and subtracting what it carries nets one person's
   *  overload against another's free places and reports no room when there
   *  is plenty, which is the opposite of what this page is for. */
  freeRoom: number;
  /** People sitting above somebody's own bandwidth, summed. A question
   *  about how that one ministry is structured, not about the team's room
   *  to take anybody else on. */
  overCommitted: number;
  /** How many shepherds that is. */
  shepherdsOver: number;
  /** Known adults who would still have nobody once every free place is
   *  used. 0 when the team can reach everyone. */
  uncovered: number;
  /** What the average bandwidth would have to be to cover everyone. */
  neededAverage: number;
}

export interface AssignBuckets {
  uncontested: number;
  contested: number;
  pool: number;
}

export interface CandidatePerson {
  personId: string;
  name: string;
  /** "In a group · gives monthly · opened 11 emails" — assembled from the
   *  same signals that made them Known in the first place. */
  context: string;
  /** Shepherds who named them. Empty for the pool. */
  claimedBy: string[];
}

const nameOf = (f: string | null, l: string | null, id: string) =>
  [f?.trim(), l?.trim()].filter(Boolean).join(" ") || `(unknown #${id})`;

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "??";

/** Known adults — the population this page exists to place. Minors are out:
 *  a child is shepherded through their family and their kids ministry, not
 *  by being handed to an adult on this roster. */
function knownAdultsSql(alias = "pa") {
  return `${alias}.classification = 'known' AND p.is_minor = 0`;
}

export const getAssignShepherds = cache(getAssignShepherdsImpl);

function getAssignShepherdsImpl(orgId: number): ShepherdRow[] {
  const list = getListByName(orgId, SHEPHERD_TEAM_LIST);
  if (!list || list.members.length === 0) return [];
  const ids = list.members.map((m) => m.personId).filter(Boolean);
  if (ids.length === 0) return [];

  const db = getDb();
  const ph = ids.map(() => "?").join(",");

  const names = db
    .prepare(
      `SELECT pco_id, first_name, last_name FROM pco_people
        WHERE org_id = ? AND pco_id IN (${ph})`,
    )
    .all(orgId, ...ids) as Array<{
    pco_id: string;
    first_name: string | null;
    last_name: string | null;
  }>;
  const nameById = new Map(
    names.map((r) => [r.pco_id, nameOf(r.first_name, r.last_name, r.pco_id)]),
  );

  const bandwidth = new Map(
    (
      db
        .prepare(
          `SELECT shepherd_person_id AS id, max_people AS n
             FROM shepherd_bandwidth WHERE org_id = ?`,
        )
        .all(orgId) as Array<{ id: string; n: number }>
    ).map((r) => [r.id, r.n]),
  );

  const assigned = new Map(
    (
      db
        .prepare(
          `SELECT shepherd_person_id AS id, COUNT(*) AS n
             FROM shepherd_person_assignments WHERE org_id = ?
            GROUP BY shepherd_person_id`,
        )
        .all(orgId) as Array<{ id: string; n: number }>
    ).map((r) => [r.id, r.n]),
  );

  // totalReach already answers "how many does this person oversee through
  // their groups, teams and the shepherd map" — no need to recompute it.
  const breakdown = getShepherdTeamBreakdown(orgId, ids);

  return ids
    .map((id) => {
      const name = nameById.get(id) ?? `(unknown #${id})`;
      return {
        personId: id,
        name,
        initials: initialsOf(name),
        byRole: breakdown.get(id)?.totalReach ?? 0,
        assigned: assigned.get(id) ?? 0,
        bandwidth: bandwidth.get(id) ?? DEFAULT_BANDWIDTH,
        bandwidthSet: bandwidth.has(id),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const getAssignCapacity = cache(getAssignCapacityImpl);

function getAssignCapacityImpl(orgId: number): AssignCapacity {
  const db = getDb();
  const shepherds = getAssignShepherds(orgId);

  const knownAdults =
    (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM person_activity pa
             JOIN pco_people p ON p.org_id = pa.org_id AND p.pco_id = pa.person_id
            WHERE pa.org_id = ? AND ${knownAdultsSql()}`,
        )
        .get(orgId) as { n: number }
    ).n ?? 0;

  const assigned =
    (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM shepherd_person_assignments a
             JOIN person_activity pa
               ON pa.org_id = a.org_id AND pa.person_id = a.person_id
             JOIN pco_people p ON p.org_id = pa.org_id AND p.pco_id = pa.person_id
            WHERE a.org_id = ? AND ${knownAdultsSql()}`,
        )
        .get(orgId) as { n: number }
    ).n ?? 0;

  const byRole = shepherds.reduce((s, r) => s + r.byRole, 0);
  const totalBandwidth = shepherds.reduce((s, r) => s + r.bandwidth, 0);
  const ownBandwidth = shepherds.filter((s) => s.bandwidthSet);

  // Per shepherd, and the two directions kept apart. See freeRoom above
  // for why they are never netted off against each other.
  let freeRoom = 0;
  let overCommitted = 0;
  let shepherdsOver = 0;
  for (const r of shepherds) {
    const slack = r.bandwidth - r.byRole - r.assigned;
    if (slack > 0) freeRoom += slack;
    else if (slack < 0) {
      overCommitted += -slack;
      shepherdsOver++;
    }
  }

  const unassigned = Math.max(0, knownAdults - assigned);

  return {
    knownAdults,
    shepherds: shepherds.length,
    evenSplit: shepherds.length
      ? Math.round(knownAdults / shepherds.length)
      : 0,
    totalBandwidth,
    bandwidthsSet: ownBandwidth.length,
    byRole,
    assigned,
    unassigned,
    freeRoom,
    overCommitted,
    shepherdsOver,
    uncovered: Math.max(0, unassigned - freeRoom),
    neededAverage: shepherds.length
      ? Math.ceil(knownAdults / shepherds.length)
      : 0,
  };
}

/** The three populations, counted. Unassigned only — once somebody has a
 *  shepherd they drop out of every bucket, which is why the pool page never
 *  shows a person twice. */
export const getAssignBuckets = cache(getAssignBucketsImpl);

function getAssignBucketsImpl(orgId: number): AssignBuckets {
  const row = getDb()
    .prepare(
      `WITH claims AS (
         SELECT k.person_id AS pid, COUNT(DISTINCT k.shepherd_person_id) AS n
           FROM shepherd_known_people k
          WHERE k.org_id = ?
          GROUP BY k.person_id
       )
       SELECT
         SUM(CASE WHEN c.n = 1 THEN 1 ELSE 0 END) AS uncontested,
         SUM(CASE WHEN c.n > 1 THEN 1 ELSE 0 END) AS contested,
         SUM(CASE WHEN c.n IS NULL THEN 1 ELSE 0 END) AS pool
         FROM person_activity pa
         JOIN pco_people p ON p.org_id = pa.org_id AND p.pco_id = pa.person_id
         LEFT JOIN claims c ON c.pid = pa.person_id
        WHERE pa.org_id = ? AND ${knownAdultsSql()}
          AND NOT EXISTS (
            SELECT 1 FROM shepherd_person_assignments a
             WHERE a.org_id = pa.org_id AND a.person_id = pa.person_id)`,
    )
    .get(orgId, orgId) as {
    uncontested: number | null;
    contested: number | null;
    pool: number | null;
  };
  return {
    uncontested: row.uncontested ?? 0,
    contested: row.contested ?? 0,
    pool: row.pool ?? 0,
  };
}

/** One line of context per person, from the signals that made them Known.
 *  Never an amount — the giving import has none. */
function contextFor(r: {
  inGroup: number;
  serves: number;
  gave: number;
  lastActivity: string | null;
}): string {
  const bits: string[] = [];
  if (r.inGroup) bits.push("in a group");
  if (r.serves) bits.push("serves");
  if (r.gave) bits.push("gives");
  if (r.lastActivity) {
    bits.push(
      `last seen ${new Date(r.lastActivity).toLocaleDateString(undefined, {
        month: "short",
        year: "numeric",
      })}`,
    );
  }
  if (!bits.length) bits.push("no activity on record");
  return bits.join(" · ");
}

/** The next people to decide about. `kind` picks the population; the page
 *  asks for a handful and works through them. */
export function getCandidates(
  orgId: number,
  kind: "contested" | "pool",
  limit = 25,
): CandidatePerson[] {
  const db = getDb();
  const join = kind === "contested" ? "JOIN" : "LEFT JOIN";
  const rows = db
    .prepare(
      `WITH claims AS (
         SELECT person_id AS pid, COUNT(DISTINCT shepherd_person_id) AS n
           FROM shepherd_known_people WHERE org_id = ? GROUP BY person_id
       ),
       giv AS (
         SELECT DISTINCT person_id AS pid FROM pushpay_payer_summary
          WHERE org_id = ? AND person_id IS NOT NULL
       )
       SELECT p.pco_id AS personId, p.first_name AS f, p.last_name AS l,
              pa.last_activity_at AS lastActivity,
              (pa.in_community_lane = 1) AS inGroup,
              (pa.in_serving_lane = 1) AS serves,
              (giv.pid IS NOT NULL) AS gave
         FROM person_activity pa
         JOIN pco_people p ON p.org_id = pa.org_id AND p.pco_id = pa.person_id
         ${join} claims c ON c.pid = pa.person_id
         LEFT JOIN giv ON giv.pid = pa.person_id
        WHERE pa.org_id = ? AND ${knownAdultsSql()}
          AND ${kind === "contested" ? "c.n > 1" : "c.n IS NULL"}
          AND NOT EXISTS (
            SELECT 1 FROM shepherd_person_assignments a
             WHERE a.org_id = pa.org_id AND a.person_id = pa.person_id)
        ORDER BY p.last_name, p.first_name
        LIMIT ?`,
    )
    .all(orgId, orgId, orgId, limit) as Array<{
    personId: string;
    f: string | null;
    l: string | null;
    lastActivity: string | null;
    inGroup: number;
    serves: number;
    gave: number;
  }>;
  if (rows.length === 0) return [];

  // Claimant names, one query for the whole page rather than per person.
  const ids = rows.map((r) => r.personId);
  const ph = ids.map(() => "?").join(",");
  const claims =
    kind === "contested"
      ? (db
          .prepare(
            `SELECT k.person_id AS pid, s.first_name AS f, s.last_name AS l
               FROM shepherd_known_people k
               JOIN pco_people s
                 ON s.org_id = k.org_id AND s.pco_id = k.shepherd_person_id
              WHERE k.org_id = ? AND k.person_id IN (${ph})`,
          )
          .all(orgId, ...ids) as Array<{
          pid: string;
          f: string | null;
          l: string | null;
        }>)
      : [];
  const byPerson = new Map<string, string[]>();
  for (const c of claims) {
    const arr = byPerson.get(c.pid) ?? [];
    arr.push(nameOf(c.f, c.l, c.pid));
    byPerson.set(c.pid, arr);
  }

  return rows.map((r) => ({
    personId: r.personId,
    name: nameOf(r.f, r.l, r.personId),
    context: contextFor(r),
    claimedBy: (byPerson.get(r.personId) ?? []).sort((a, b) =>
      a.localeCompare(b),
    ),
  }));
}

// ─── Writes ───────────────────────────────────────────────────────────

export type AssignSource = "bulk" | "contested" | "manual" | "auto";

export function assignPerson(
  orgId: number,
  personId: string,
  shepherdPersonId: string,
  source: AssignSource,
): void {
  getDb()
    .prepare(
      `INSERT INTO shepherd_person_assignments
         (org_id, person_id, shepherd_person_id, source)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(org_id, person_id) DO UPDATE SET
         shepherd_person_id = excluded.shepherd_person_id,
         source = excluded.source,
         assigned_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    )
    .run(orgId, personId, shepherdPersonId, source);
}

export function unassignPerson(orgId: number, personId: string): void {
  getDb()
    .prepare(
      `DELETE FROM shepherd_person_assignments WHERE org_id = ? AND person_id = ?`,
    )
    .run(orgId, personId);
}

export function saveBandwidth(
  orgId: number,
  shepherdPersonId: string,
  maxPeople: number | null,
): void {
  const db = getDb();
  if (maxPeople === null) {
    db.prepare(
      `DELETE FROM shepherd_bandwidth WHERE org_id = ? AND shepherd_person_id = ?`,
    ).run(orgId, shepherdPersonId);
    return;
  }
  db.prepare(
    `INSERT INTO shepherd_bandwidth (org_id, shepherd_person_id, max_people)
     VALUES (?, ?, ?)
     ON CONFLICT(org_id, shepherd_person_id) DO UPDATE SET
       max_people = excluded.max_people,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  ).run(orgId, shepherdPersonId, Math.max(0, Math.round(maxPeople)));
}

/** Assign every uncontested person to the one shepherd who named them.
 *  Nobody has to choose, because nobody disagreed. Returns how many moved. */
export function bulkAssignUncontested(orgId: number): number {
  const db = getDb();
  const res = db
    .prepare(
      `INSERT INTO shepherd_person_assignments
         (org_id, person_id, shepherd_person_id, source)
       SELECT ?, pa.person_id, MIN(k.shepherd_person_id), 'bulk'
         FROM person_activity pa
         JOIN pco_people p ON p.org_id = pa.org_id AND p.pco_id = pa.person_id
         JOIN shepherd_known_people k
           ON k.org_id = pa.org_id AND k.person_id = pa.person_id
        WHERE pa.org_id = ? AND ${knownAdultsSql()}
          AND NOT EXISTS (
            SELECT 1 FROM shepherd_person_assignments a
             WHERE a.org_id = pa.org_id AND a.person_id = pa.person_id)
        GROUP BY pa.person_id
       HAVING COUNT(DISTINCT k.shepherd_person_id) = 1
       ON CONFLICT(org_id, person_id) DO NOTHING`,
    )
    .run(orgId, orgId);
  return res.changes;
}

/** Spread the unclaimed pool across whoever still has room.
 *
 *  Respects every bandwidth and STOPS when the team is full rather than
 *  overfilling — a bandwidth nobody enforces is decoration. Everyone has a
 *  bandwidth now, their own or DEFAULT_BANDWIDTH, so nobody is skipped;
 *  what stops this filling someone past what they agreed to is the figure
 *  itself, which is why it is worth setting properly.
 *
 *  Fills the emptiest shepherd first, so the result is level rather than
 *  alphabetical. Returns how many were placed and how many were left.
 */
export function autoAssignPool(orgId: number): {
  assigned: number;
  remaining: number;
} {
  const db = getDb();
  const shepherds = getAssignShepherds(orgId)
    .map((s) => ({
      id: s.personId,
      room: s.bandwidth - s.byRole - s.assigned,
    }))
    .filter((s) => s.room > 0);

  const people = getDb()
    .prepare(
      `SELECT pa.person_id AS pid
         FROM person_activity pa
         JOIN pco_people p ON p.org_id = pa.org_id AND p.pco_id = pa.person_id
        WHERE pa.org_id = ? AND ${knownAdultsSql()}
          AND NOT EXISTS (
            SELECT 1 FROM shepherd_known_people k
             WHERE k.org_id = pa.org_id AND k.person_id = pa.person_id)
          AND NOT EXISTS (
            SELECT 1 FROM shepherd_person_assignments a
             WHERE a.org_id = pa.org_id AND a.person_id = pa.person_id)`,
    )
    .all(orgId) as Array<{ pid: string }>;

  if (shepherds.length === 0) {
    return { assigned: 0, remaining: people.length };
  }

  const ins = db.prepare(
    `INSERT INTO shepherd_person_assignments
       (org_id, person_id, shepherd_person_id, source)
     VALUES (?, ?, ?, 'auto')
     ON CONFLICT(org_id, person_id) DO NOTHING`,
  );

  let placed = 0;
  db.transaction(() => {
    for (const person of people) {
      // Emptiest first. A heap would be faster; at this size the sort is
      // not what anyone will notice.
      shepherds.sort((a, b) => b.room - a.room);
      const target = shepherds[0];
      if (!target || target.room <= 0) break;
      ins.run(orgId, person.pid, target.id);
      target.room--;
      placed++;
    }
  })();

  return { assigned: placed, remaining: people.length - placed };
}
