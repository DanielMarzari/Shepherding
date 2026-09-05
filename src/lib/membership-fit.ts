import "server-only";
import { cache } from "react";
import { getDb } from "./db";
import {
  type FitFlag,
  MS_PER_DAY,
  type PersonSignals,
  RECENT_DAYS,
  type SignalKey,
  type TypePolicy,
  activeSignals,
  evaluate,
  policyFor,
  suggestType,
} from "./membership-policies";

export * from "./membership-policies";

// Membership-fit audit. Distinct from `audit-read.ts`, which is *data hygiene*
// (junk names, duplicates, deceased). This module asks a different question:
// given everything we now know a person actually does — giving, groups, teams,
// serving, check-ins, events, forms — is their PCO membership type still the
// right one?
//
// Two directions of error, both real in the current data:
//   • "outgrew the label" — a Contributor Only who joined a group, a 1st Time
//     Visitor on their 40th check-in, a Former Member still on a serving team.
//   • "never met the label" — a Contributor Only with no giving on record, a
//     Member with no group / team / attendance / giving at all.
//
// Read-only. Nothing here writes to PCO; the output is a worklist an admin
// works through upstream, same contract as the rest of /audit.

// ─── Data loading ─────────────────────────────────────────────────────

interface RawSignalRow {
  pcoId: string;
  membershipType: string | null;
  status: string | null;
  isMinor: number;
  pcoCreatedAt: string | null;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  checkinCount: number;
  lastCheckinAt: string | null;
  hasDonor: number;
  lastGiftDate: string | null;
  donorStage: string | null;
  givingChannel: string | null;
  hasGroup: number;
  hasTeam: number;
  hasServed: number;
  hasEvent: number;
  hasForm: number;
  hasHouseholdCheckin: number;
}

/** One person-level aggregate query over every activity source, for the whole
 *  org. Written as a single statement with CTEs rather than correlated
 *  subqueries — at 34k people and 275k check-ins the subquery form is an order
 *  of magnitude slower.
 *
 *  Deliberately org-wide rather than per-type: every CTE here aggregates the
 *  whole org regardless of which type is being viewed, so filtering in SQL
 *  saved nothing and made the page run this twice (once for the tab counts,
 *  once for the roster). Callers go through `loadOrgRows`, which is
 *  request-cached, and filter in JS.
 */
function loadSignalRows(orgId: number): RawSignalRow[] {
  return getDb()
    .prepare(
      `WITH
         -- Through pco_groups, not just the membership: PCO's archived groups
         -- are synced now, and a membership row survives its group. Without the
         -- join, 1,091 people whose only group wound up years ago read as being
         -- in a group today.
         g AS (SELECT gm.person_id AS pid FROM pco_group_memberships gm
                JOIN pco_groups gr ON gr.org_id = gm.org_id AND gr.pco_id = gm.group_id
               WHERE gm.org_id = @orgId AND gm.archived_at IS NULL
                 AND gr.archived_at IS NULL
               GROUP BY gm.person_id),
         t AS (SELECT person_id AS pid FROM pco_team_memberships
                WHERE org_id = @orgId AND archived_at IS NULL AND person_id != ''
                GROUP BY person_id),
         sv AS (SELECT person_id AS pid FROM pco_plan_people
                 WHERE org_id = @orgId AND person_id != '' GROUP BY person_id),
         -- COUNT only, deliberately. Adding MAX(pco_created_at) here costs a
         -- table lookup per check-in row and takes this CTE from 0.8s to 36s
         -- over 275k rows; the covering index (org_id, person_id) carries the
         -- count alone. The last-check-in date comes from the denormalized
         -- pco_people.last_check_in_at instead.
         ci AS (SELECT person_id AS pid, COUNT(*) AS n
                  FROM pco_check_ins
                 WHERE org_id = @orgId AND person_id IS NOT NULL
                 GROUP BY person_id),
         -- Anyone with evidence of ever checking in, from either source: PCO
         -- reports last_check_in_at for ~12.8k people but we've only synced
         -- check-in rows for ~8.7k, so neither source alone is complete.
         ever AS (SELECT pid FROM ci
                  UNION
                  SELECT pco_id AS pid FROM pco_people
                   WHERE org_id = @orgId AND last_check_in_at IS NOT NULL),
         ev AS (SELECT person_id AS pid FROM pco_event_attendances
                 WHERE org_id = @orgId AND attended = 1 GROUP BY person_id),
         fm AS (SELECT person_id AS pid FROM pco_form_submissions
                 WHERE org_id = @orgId AND person_id IS NOT NULL GROUP BY person_id),
         dn AS (SELECT person_id AS pid, MAX(last_gift_date) AS lastGift,
                       MIN(donor_stage) AS stage, MIN(giving_channel) AS chan
                  FROM pushpay_donors
                 WHERE org_id = @orgId AND person_id IS NOT NULL
                 GROUP BY person_id),
         -- Households containing at least one person who checks in, then the
         -- members of those households. Drives the "Parent Only" check: the
         -- parent's warrant for being in the system is the child's attendance.
         hhci AS (SELECT DISTINCT hm.household_id AS hid
                    FROM pco_household_memberships hm
                    JOIN ever ON ever.pid = hm.person_id
                   WHERE hm.org_id = @orgId),
         hh AS (SELECT DISTINCT hm.person_id AS pid
                  FROM pco_household_memberships hm
                  JOIN hhci ON hhci.hid = hm.household_id
                 WHERE hm.org_id = @orgId)
       SELECT
         p.pco_id                        AS pcoId,
         p.membership_type               AS membershipType,
         p.status                        AS status,
         p.is_minor                      AS isMinor,
         p.pco_created_at                AS pcoCreatedAt,
         p.first_name                    AS firstName,
         p.last_name                     AS lastName,
         p.nickname                      AS nickname,
         COALESCE(ci.n, 0)               AS checkinCount,
         p.last_check_in_at              AS lastCheckinAt,
         (dn.pid IS NOT NULL)            AS hasDonor,
         dn.lastGift                     AS lastGiftDate,
         dn.stage                        AS donorStage,
         dn.chan                         AS givingChannel,
         (g.pid  IS NOT NULL)            AS hasGroup,
         (t.pid  IS NOT NULL)            AS hasTeam,
         (sv.pid IS NOT NULL)            AS hasServed,
         (ev.pid IS NOT NULL)            AS hasEvent,
         (fm.pid IS NOT NULL)            AS hasForm,
         (hh.pid IS NOT NULL)            AS hasHouseholdCheckin
       FROM pco_people p
       LEFT JOIN g  ON g.pid  = p.pco_id
       LEFT JOIN t  ON t.pid  = p.pco_id
       LEFT JOIN sv ON sv.pid = p.pco_id
       LEFT JOIN ci ON ci.pid = p.pco_id
       LEFT JOIN ev ON ev.pid = p.pco_id
       LEFT JOIN fm ON fm.pid = p.pco_id
       LEFT JOIN dn ON dn.pid = p.pco_id
       LEFT JOIN hh ON hh.pid = p.pco_id
       WHERE p.org_id = @orgId`,
    )
    .all({ orgId }) as unknown as RawSignalRow[];
}

function toSignals(r: RawSignalRow, recentCutoff: string): PersonSignals {
  return {
    giving: r.hasDonor === 1,
    givingRecent:
      r.lastGiftDate !== null && r.lastGiftDate >= recentCutoff.slice(0, 10),
    group: r.hasGroup === 1,
    team: r.hasTeam === 1,
    served: r.hasServed === 1,
    // Either source counts as evidence of attending — see the `ever` CTE.
    checkin: r.checkinCount > 0 || r.lastCheckinAt !== null,
    checkinRecent: r.lastCheckinAt !== null && r.lastCheckinAt >= recentCutoff,
    // Only synced check-in rows can prove a *repeat* visit, so this is
    // deliberately conservative: someone with a last_check_in_at but no synced
    // rows is left unflagged rather than accused of returning.
    repeatCheckin: r.checkinCount > 1,
    event: r.hasEvent === 1,
    form: r.hasForm === 1,
    householdCheckin: r.hasHouseholdCheckin === 1,
  };
}

/** Request-scoped. The tab strip and the selected roster both need this, and
 *  it's the single most expensive thing on the page (~2s warm) — React's cache
 *  collapses them into one execution per request. */
const loadOrgRows = cache(loadSignalRows);

// ─── Public read models ───────────────────────────────────────────────

export interface FitRow {
  pcoId: string;
  fullName: string;
  initials: string;
  status: string | null;
  isMinor: boolean;
  inactive: boolean;
  signals: PersonSignals;
  present: SignalKey[];
  flags: FitFlag[];
  suggested: string | null;
  lastGiftDate: string | null;
  donorStage: string | null;
  givingChannel: string | null;
  checkinCount: number;
  lastCheckinAt: string | null;
}

export interface TypeAudit {
  membershipType: string | null;
  policy: TypePolicy;
  rows: FitRow[];
  total: number;
  flaggedCount: number;
  /** Violation count per requirement id, for the filter chips. */
  flagCounts: Record<string, number>;
  /** How many people have each signal — the "what this group actually does"
   *  strip above the table. */
  signalCounts: Record<SignalKey, number>;
}

function displayName(r: RawSignalRow): string {
  const first = r.nickname?.trim() || r.firstName?.trim() || "";
  const last = r.lastName?.trim() || "";
  return [first, last].filter(Boolean).join(" ") || `(unknown #${r.pcoId})`;
}

function initialsOf(r: RawSignalRow): string {
  const first = (r.nickname?.trim() || r.firstName?.trim() || "")[0] ?? "";
  const last = (r.lastName?.trim() || "")[0] ?? "";
  return (first + last).toUpperCase() || "??";
}

/** Full audit of one membership type. Pass `null` for the people whose
 *  membership type is unset in PCO. */
export const auditType = cache(auditTypeImpl);
function auditTypeImpl(orgId: number, membershipType: string | null): TypeAudit {
  const recentCutoff = new Date(
    Date.now() - RECENT_DAYS * MS_PER_DAY,
  ).toISOString();
  const policy = policyFor(membershipType);
  // One org-wide load (request-cached), filtered here. See `loadSignalRows`.
  const raw = loadOrgRows(orgId).filter((r) =>
    membershipType === null
      ? r.membershipType === null || r.membershipType.trim() === ""
      : r.membershipType === membershipType,
  );

  const rows: FitRow[] = [];
  const flagCounts: Record<string, number> = {};
  const signalCounts = emptySignalCounts();

  for (const r of raw) {
    const signals = toSignals(r, recentCutoff);
    const ageDays =
      r.pcoCreatedAt !== null
        ? (Date.now() - new Date(r.pcoCreatedAt).getTime()) / MS_PER_DAY
        : null;
    const flags = evaluate(policy, signals, ageDays);
    for (const f of flags) flagCounts[f.id] = (flagCounts[f.id] ?? 0) + 1;
    for (const k of Object.keys(signalCounts) as SignalKey[]) {
      if (signals[k]) signalCounts[k]++;
    }
    rows.push({
      pcoId: r.pcoId,
      fullName: displayName(r),
      initials: initialsOf(r),
      status: r.status,
      isMinor: r.isMinor === 1,
      inactive: (r.status ?? "").toLowerCase() === "inactive",
      signals,
      present: activeSignals(signals),
      flags,
      suggested: flags.length > 0 ? suggestType(signals, membershipType) : null,
      lastGiftDate: r.lastGiftDate,
      donorStage: r.donorStage,
      givingChannel: r.givingChannel,
      checkinCount: r.checkinCount,
      lastCheckinAt: r.lastCheckinAt,
    });
  }

  // Flagged first, most flags first, then alphabetical — the worklist order.
  rows.sort((a, b) => {
    if (a.flags.length !== b.flags.length) return b.flags.length - a.flags.length;
    return a.fullName.localeCompare(b.fullName);
  });

  return {
    membershipType,
    policy,
    rows,
    total: rows.length,
    flaggedCount: rows.filter((r) => r.flags.length > 0).length,
    flagCounts,
    signalCounts,
  };
}

function emptySignalCounts(): Record<SignalKey, number> {
  return {
    giving: 0,
    givingRecent: 0,
    group: 0,
    team: 0,
    served: 0,
    checkin: 0,
    checkinRecent: 0,
    repeatCheckin: 0,
    event: 0,
    form: 0,
    householdCheckin: 0,
  };
}

export interface TypeSummary {
  membershipType: string | null;
  label: string;
  total: number;
  flagged: number;
  /** Percentage of the type that looks misfiled, 0–100. */
  misfitPct: number;
  audited: boolean;
}

/** One pass over the whole org, evaluating every person against their own
 *  type's policy. Powers the overview tab and the tab counts. */
export const summarizeOrg = cache(summarizeOrgImpl);
function summarizeOrgImpl(orgId: number): TypeSummary[] {
  const recentCutoff = new Date(
    Date.now() - RECENT_DAYS * MS_PER_DAY,
  ).toISOString();
  const raw = loadOrgRows(orgId);
  const byType = new Map<string, { type: string | null; total: number; flagged: number }>();

  for (const r of raw) {
    const type =
      r.membershipType === null || r.membershipType.trim() === ""
        ? null
        : r.membershipType;
    const key = type ?? " unset";
    const entry = byType.get(key) ?? { type, total: 0, flagged: 0 };
    entry.total++;
    const policy = policyFor(type);
    const signals = toSignals(r, recentCutoff);
    const ageDays =
      r.pcoCreatedAt !== null
        ? (Date.now() - new Date(r.pcoCreatedAt).getTime()) / MS_PER_DAY
        : null;
    if (evaluate(policy, signals, ageDays).length > 0) entry.flagged++;
    byType.set(key, entry);
  }

  const out: TypeSummary[] = [];
  for (const entry of byType.values()) {
    const policy = policyFor(entry.type);
    out.push({
      membershipType: entry.type,
      label: entry.type ?? "(no type set)",
      total: entry.total,
      flagged: entry.flagged,
      misfitPct: entry.total > 0 ? (entry.flagged / entry.total) * 100 : 0,
      audited: !policy.systemOnly && policy.requirements.some((r) => r.kind !== "note"),
    });
  }
  out.sort((a, b) => b.total - a.total);
  return out;
}
