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

  const rows = db
    .prepare(
      `SELECT
         e.pco_id          AS eventId,
         e.name            AS name,
         e.frequency       AS frequency,
         e.archived_at     AS archivedAt,
         COUNT(ci.pco_id)                                AS totalCheckins,
         COUNT(DISTINCT ci.person_id)                    AS distinctPeople,
         SUM(CASE WHEN ci.pco_created_at >= ? THEN 1 ELSE 0 END)
                                                         AS checkinsLast30,
         COUNT(DISTINCT CASE WHEN ci.pco_created_at >= ? THEN ci.person_id END)
                                                         AS peopleLast30,
         MAX(ci.pco_created_at)                          AS lastCheckinAt
       FROM pco_checkin_events e
       LEFT JOIN pco_check_ins ci
         ON ci.org_id = e.org_id AND ci.event_id = e.pco_id
       WHERE e.org_id = ?
       GROUP BY e.pco_id, e.name, e.frequency, e.archived_at
       ORDER BY
         CASE WHEN e.archived_at IS NULL THEN 0 ELSE 1 END,
         totalCheckins DESC,
         e.name ASC`,
    )
    .all(monthAgo, monthAgo, orgId) as Array<{
    eventId: string;
    name: string | null;
    frequency: string | null;
    archivedAt: string | null;
    totalCheckins: number;
    distinctPeople: number;
    checkinsLast30: number | null;
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
    checkinsLast30: r.checkinsLast30 ?? 0,
    peopleLast30: r.peopleLast30,
    lastCheckinAt: r.lastCheckinAt,
    shepherded: shepherdedEvents.has(r.eventId),
  }));
}
