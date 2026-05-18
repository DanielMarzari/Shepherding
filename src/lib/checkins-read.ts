import "server-only";
import { getDb } from "./db";
import { getExcludedCheckinEvents, getSyncSettings } from "./pco";

export interface CheckinSummary {
  totalCheckins: number;
  totalPeopleEver: number;
  checkinsLastWeek: number;
  checkinsLastMonth: number;
  peopleLastWeek: number;
  peopleLastMonth: number;
  totalEvents: number;
  activeEvents: number;
  /** Active events the admin has flagged to IGNORE (Office Visitors,
   *  Volunteer sign-ups, etc.). Everything else counts as a kid event
   *  and feeds the shepherded set. */
  excludedEvents: number;
}

export interface CheckinEventRow {
  eventId: string;
  name: string | null;
  frequency: string | null;
  archivedAt: string | null;
  totalCheckins: number;
  distinctPeople: number;
  checkinsLast30: number;
  peopleLast30: number;
  lastCheckinAt: string | null;
  shepherded: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function getCheckinSummary(orgId: number): CheckinSummary {
  const db = getDb();
  const weekAgo = new Date(Date.now() - 7 * MS_PER_DAY).toISOString();
  const monthAgo = new Date(Date.now() - 30 * MS_PER_DAY).toISOString();
  const excludedEvents = new Set(getExcludedCheckinEvents(orgId));

  // Single scan with 4 conditional aggregates. The COUNT(DISTINCT person_id)
  // is the costly piece on 265k rows; SQLite has to materialise the
  // distinct set, but it's still one pass.
  const overall = db
    .prepare(
      `SELECT
         COUNT(*) AS totalCheckins,
         COUNT(DISTINCT person_id) AS totalPeopleEver,
         SUM(CASE WHEN pco_created_at >= ? THEN 1 ELSE 0 END) AS checkinsLastWeek,
         SUM(CASE WHEN pco_created_at >= ? THEN 1 ELSE 0 END) AS checkinsLastMonth,
         COUNT(DISTINCT CASE WHEN pco_created_at >= ? THEN person_id END) AS peopleLastWeek,
         COUNT(DISTINCT CASE WHEN pco_created_at >= ? THEN person_id END) AS peopleLastMonth
       FROM pco_check_ins
       WHERE org_id = ?`,
    )
    .get(weekAgo, monthAgo, weekAgo, monthAgo, orgId) as {
    totalCheckins: number;
    totalPeopleEver: number;
    checkinsLastWeek: number | null;
    checkinsLastMonth: number | null;
    peopleLastWeek: number;
    peopleLastMonth: number;
  };

  const events = db
    .prepare(
      `SELECT
         COUNT(*) AS totalEvents,
         SUM(CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END) AS activeEvents
       FROM pco_checkin_events WHERE org_id = ?`,
    )
    .get(orgId) as { totalEvents: number; activeEvents: number | null };

  return {
    totalCheckins: overall.totalCheckins,
    totalPeopleEver: overall.totalPeopleEver,
    checkinsLastWeek: overall.checkinsLastWeek ?? 0,
    checkinsLastMonth: overall.checkinsLastMonth ?? 0,
    peopleLastWeek: overall.peopleLastWeek,
    peopleLastMonth: overall.peopleLastMonth,
    totalEvents: events.totalEvents,
    activeEvents: events.activeEvents ?? 0,
    excludedEvents: excludedEvents.size,
  };
}

export function listCheckinEvents(orgId: number): CheckinEventRow[] {
  const db = getDb();
  const monthAgo = new Date(Date.now() - 30 * MS_PER_DAY).toISOString();
  const excludedEvents = new Set(getExcludedCheckinEvents(orgId));

  // Pre-aggregate pco_check_ins per event in a CTE — one pass over the
  // big table — then LEFT JOIN that small per-event summary against
  // pco_checkin_events. Previously the LEFT JOIN + GROUP BY ran across
  // the full 265k-row check-in table with a sort on every page hit.
  const rows = db
    .prepare(
      `WITH event_stats AS (
         SELECT
           event_id,
           COUNT(*) AS totalCheckins,
           COUNT(DISTINCT person_id) AS distinctPeople,
           SUM(CASE WHEN pco_created_at >= ? THEN 1 ELSE 0 END) AS checkinsLast30,
           COUNT(DISTINCT CASE WHEN pco_created_at >= ? THEN person_id END) AS peopleLast30,
           MAX(pco_created_at) AS lastCheckinAt
         FROM pco_check_ins
         WHERE org_id = ? AND event_id IS NOT NULL
         GROUP BY event_id
       )
       SELECT
         e.pco_id        AS eventId,
         e.name          AS name,
         e.frequency     AS frequency,
         e.archived_at   AS archivedAt,
         COALESCE(s.totalCheckins, 0)   AS totalCheckins,
         COALESCE(s.distinctPeople, 0)  AS distinctPeople,
         COALESCE(s.checkinsLast30, 0)  AS checkinsLast30,
         COALESCE(s.peopleLast30, 0)    AS peopleLast30,
         s.lastCheckinAt                AS lastCheckinAt
       FROM pco_checkin_events e
       LEFT JOIN event_stats s ON s.event_id = e.pco_id
       WHERE e.org_id = ?
         AND e.archived_at IS NULL
       ORDER BY totalCheckins DESC, e.name ASC`,
    )
    .all(monthAgo, monthAgo, orgId, orgId) as Array<{
    eventId: string;
    name: string | null;
    frequency: string | null;
    archivedAt: string | null;
    totalCheckins: number;
    distinctPeople: number;
    checkinsLast30: number;
    peopleLast30: number;
    lastCheckinAt: string | null;
  }>;

  return rows.map((r) => ({
    eventId: r.eventId,
    name: r.name,
    frequency: r.frequency,
    archivedAt: r.archivedAt,
    totalCheckins: r.totalCheckins,
    distinctPeople: r.distinctPeople,
    checkinsLast30: r.checkinsLast30,
    peopleLast30: r.peopleLast30,
    lastCheckinAt: r.lastCheckinAt,
    shepherded: !excludedEvents.has(r.eventId),
  }));
}

// ─── Per-person check-in breakdown (for /people/[slug]) ───────────────

export interface PersonCheckinRow {
  eventId: string;
  eventName: string | null;
  eventArchived: boolean;
  shepherdedEvent: boolean;
  /** All-time check-ins for this person at this event. */
  total: number;
  /** Check-ins inside the configured shepherded-check-in window. */
  inWindow: number;
  /** Check-ins where someone else did the check-in — strong signal
   *  the person is a dependent (kid / special-needs adult). */
  byOther: number;
  /** Last check-in to this event. */
  lastAt: string | null;
}

export interface PersonCheckinSummary {
  windowMonths: number;
  rows: PersonCheckinRow[];
  /** Total check-ins where they were CHECKED IN (regardless of event). */
  totalAsCheckin: number;
  /** Total check-ins where THEY did the checking-in for someone else. */
  totalAsChecker: number;
}

export function listPersonCheckins(
  orgId: number,
  personId: string,
): PersonCheckinSummary {
  const db = getDb();
  const settings = getSyncSettings(orgId);
  const excludedEvents = new Set(getExcludedCheckinEvents(orgId));
  const windowMonths = settings.shepherdedCheckinWindowMonths;
  const windowCutoff = new Date(
    Date.now() - windowMonths * 30 * MS_PER_DAY,
  ).toISOString();

  const rows = db
    .prepare(
      `SELECT
         e.pco_id        AS eventId,
         e.name          AS eventName,
         e.archived_at   AS archivedAt,
         COUNT(*)        AS total,
         SUM(CASE WHEN ci.pco_created_at >= ? THEN 1 ELSE 0 END) AS inWindow,
         SUM(CASE
               WHEN ci.checked_in_by_id IS NOT NULL
                AND ci.checked_in_by_id != ci.person_id
               THEN 1 ELSE 0 END) AS byOther,
         MAX(ci.pco_created_at) AS lastAt
       FROM pco_check_ins ci
       JOIN pco_checkin_events e
         ON e.org_id = ci.org_id AND e.pco_id = ci.event_id
       WHERE ci.org_id = ?
         AND ci.person_id = ?
       GROUP BY e.pco_id, e.name, e.archived_at
       ORDER BY total DESC, e.name ASC`,
    )
    .all(windowCutoff, orgId, personId) as Array<{
    eventId: string;
    eventName: string | null;
    archivedAt: string | null;
    total: number;
    inWindow: number | null;
    byOther: number | null;
    lastAt: string | null;
  }>;

  const checkerRow = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM pco_check_ins
            WHERE org_id = ? AND person_id = ?) AS asCheckin,
         (SELECT COUNT(*) FROM pco_check_ins
            WHERE org_id = ?
              AND (checked_in_by_id = ? OR checked_out_by_id = ?)
              AND (person_id IS NULL OR person_id != ?)) AS asChecker`,
    )
    .get(orgId, personId, orgId, personId, personId, personId) as {
    asCheckin: number;
    asChecker: number;
  };

  return {
    windowMonths,
    rows: rows.map((r) => ({
      eventId: r.eventId,
      eventName: r.eventName,
      eventArchived: !!r.archivedAt,
      shepherdedEvent: !excludedEvents.has(r.eventId),
      total: r.total,
      inWindow: r.inWindow ?? 0,
      byOther: r.byOther ?? 0,
      lastAt: r.lastAt,
    })),
    totalAsCheckin: checkerRow.asCheckin,
    totalAsChecker: checkerRow.asChecker,
  };
}
