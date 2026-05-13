import "server-only";
import { getDb } from "./db";
import { getShepherdedCheckinEvents } from "./pco";

export interface CheckinSummary {
  totalCheckins: number;
  totalPeopleEver: number;
  checkinsLastWeek: number;
  checkinsLastMonth: number;
  peopleLastWeek: number;
  peopleLastMonth: number;
  totalEvents: number;
  activeEvents: number;
  shepherdedEvents: number;
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
  const shepherdedEvents = new Set(getShepherdedCheckinEvents(orgId));

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
    shepherdedEvents: shepherdedEvents.size,
  };
}

export function listCheckinEvents(orgId: number): CheckinEventRow[] {
  const db = getDb();
  const monthAgo = new Date(Date.now() - 30 * MS_PER_DAY).toISOString();
  const shepherdedEvents = new Set(getShepherdedCheckinEvents(orgId));

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
       ORDER BY
         CASE WHEN e.archived_at IS NULL THEN 0 ELSE 1 END,
         totalCheckins DESC,
         e.name ASC`,
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
    shepherded: shepherdedEvents.has(r.eventId),
  }));
}
