import "server-only";
import { getDb } from "./db";
import { PCOClient, PCOError, type PCOResource } from "./pco-client";

/** PCO Check-Ins sync — events, locations, individual check-in records.
 *  Drives the Care lane (kids/student check-ins → shepherded) and the
 *  Active classification (any check-in role bumps last_check_in_at). */

export interface CheckinsSyncResult {
  events:    { fetched: number; upserted: number };
  locations: { fetched: number; upserted: number };
  checkIns:  { fetched: number; upserted: number };
}

export async function syncCheckinsAll(
  client: PCOClient,
  orgId: number,
  thresholdMonths: number,
): Promise<CheckinsSyncResult> {
  const result: CheckinsSyncResult = {
    events:    { fetched: 0, upserted: 0 },
    locations: { fetched: 0, upserted: 0 },
    checkIns:  { fetched: 0, upserted: 0 },
  };

  // 1) Events — small set; full pull each time.
  for await (const { page } of client.paginate<PCOResource>(
    "/check-ins/v2/events?per_page=100",
  )) {
    const arr = Array.isArray(page.data) ? page.data : [page.data];
    for (const e of arr) {
      result.events.fetched++;
      const a = (e.attributes ?? {}) as Record<string, unknown>;
      upsertEvent(orgId, {
        pcoId: e.id,
        name:          (a.name as string | undefined) ?? null,
        frequency:     (a.frequency as string | undefined) ?? null,
        archivedAt:    (a.archived_at as string | undefined) ?? null,
        pcoCreatedAt:  (a.created_at as string | undefined) ?? null,
        pcoUpdatedAt:  (a.updated_at as string | undefined) ?? null,
      });
      result.events.upserted++;
    }
  }

  // 2) Locations — also small. Folders nest via parent.
  for await (const { page } of client.paginate<PCOResource>(
    "/check-ins/v2/locations?per_page=100&include=parent",
  )) {
    const arr = Array.isArray(page.data) ? page.data : [page.data];
    for (const l of arr) {
      result.locations.fetched++;
      const a = (l.attributes ?? {}) as Record<string, unknown>;
      const rels = l.relationships ?? {};
      const parentRel = rels.parent?.data;
      const parentId =
        !Array.isArray(parentRel) && parentRel ? parentRel.id : null;
      upsertLocation(orgId, {
        pcoId: l.id,
        name:       (a.name as string | undefined) ?? null,
        kind:       (a.kind as string | undefined) ?? null,
        parentId,
        archivedAt: (a.archived_at as string | undefined) ?? null,
      });
      result.locations.upserted++;
    }
  }

  // 3) Check-ins — incremental on created_at. Each row may link a person,
  //    an event, an event_time, locations, and checked-in/out-by people.
  const cursor = readCursor(orgId, "checkins:check_ins", thresholdMonths);
  const params = new URLSearchParams({
    per_page: "100",
    order:    "created_at",
    include:  "person,event,event_times,locations,checked_in_by,checked_out_by",
  });
  if (cursor) params.set("where[created_at][gt]", cursor);
  let maxCreatedAt: string | null = cursor;

  try {
    for await (const { page } of client.paginate<PCOResource>(
      `/check-ins/v2/check_ins?${params.toString()}`,
    )) {
      const records = Array.isArray(page.data) ? page.data : [page.data];
      const included = page.included ?? [];

      // Build an event_time lookup so we can denormalize starts_at.
      const eventTimeStartsAt = new Map<string, string | null>();
      for (const inc of included) {
        if (inc.type === "EventTime") {
          const a = (inc.attributes ?? {}) as Record<string, unknown>;
          eventTimeStartsAt.set(
            inc.id,
            (a.starts_at as string | undefined) ?? null,
          );
        }
      }

      for (const ci of records) {
        result.checkIns.fetched++;
        const a = (ci.attributes ?? {}) as Record<string, unknown>;
        const rels = ci.relationships ?? {};
        const personRel       = rels.person?.data;
        const eventRel        = rels.event?.data;
        const checkedInByRel  = rels.checked_in_by?.data;
        const checkedOutByRel = rels.checked_out_by?.data;
        const eventTimesRel   = rels.event_times?.data;
        const locationsRel    = rels.locations?.data;

        const firstEventTimeId = Array.isArray(eventTimesRel)
          ? eventTimesRel[0]?.id
          : eventTimesRel?.id;
        const eventTimeAt = firstEventTimeId
          ? eventTimeStartsAt.get(firstEventTimeId) ?? null
          : null;

        const firstLocationId = Array.isArray(locationsRel)
          ? locationsRel[0]?.id
          : locationsRel?.id;

        const createdAt = (a.created_at as string | undefined) ?? null;
        if (createdAt && (!maxCreatedAt || createdAt > maxCreatedAt)) {
          maxCreatedAt = createdAt;
        }

        upsertCheckIn(orgId, {
          pcoId: ci.id,
          personId:        firstId(personRel),
          eventId:         firstId(eventRel),
          eventTimeAt,
          locationId:      firstLocationId ?? null,
          checkedInById:   firstId(checkedInByRel),
          checkedOutById:  firstId(checkedOutByRel),
          kind:            (a.kind as string | undefined) ?? null,
          checkedOutAt:    (a.checked_out_at as string | undefined) ?? null,
          pcoCreatedAt:    createdAt,
        });
        result.checkIns.upserted++;
      }
    }
  } catch (e) {
    // /check-ins/v2/check_ins requires the Check-Ins product to be enabled
    // on the PCO org. 404 means it's not available — skip rather than fail.
    if (!(e instanceof PCOError && e.status === 404)) throw e;
  }
  writeCursor(orgId, "checkins:check_ins", maxCreatedAt);

  return result;
}

/** Set pco_people.last_check_in_at = MAX(pco_created_at) across every
 *  check-in this person touched — being checked in, doing the check-in,
 *  or doing the checkout. Any role counts as activity. */
export function refreshLastCheckIn(orgId: number) {
  getDb()
    .prepare(
      `UPDATE pco_people
         SET last_check_in_at = (
           SELECT MAX(pco_created_at)
             FROM pco_check_ins ci
             WHERE ci.org_id = pco_people.org_id
               AND (
                 ci.person_id        = pco_people.pco_id
                 OR ci.checked_in_by_id  = pco_people.pco_id
                 OR ci.checked_out_by_id = pco_people.pco_id
               )
         )
       WHERE org_id = ?`,
    )
    .run(orgId);
}

// ─── Helpers ──────────────────────────────────────────────────────────

function firstId(rel: unknown): string | null {
  if (!rel) return null;
  if (Array.isArray(rel)) {
    const first = rel[0] as { id?: string } | undefined;
    return first?.id ?? null;
  }
  return (rel as { id?: string }).id ?? null;
}

function upsertEvent(
  orgId: number,
  e: {
    pcoId: string;
    name: string | null;
    frequency: string | null;
    archivedAt: string | null;
    pcoCreatedAt: string | null;
    pcoUpdatedAt: string | null;
  },
) {
  getDb()
    .prepare(
      `INSERT INTO pco_checkin_events
        (org_id, pco_id, name, frequency, archived_at, pco_created_at, pco_updated_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(org_id, pco_id) DO UPDATE SET
         name = excluded.name,
         frequency = excluded.frequency,
         archived_at = excluded.archived_at,
         pco_created_at = excluded.pco_created_at,
         pco_updated_at = excluded.pco_updated_at,
         synced_at = excluded.synced_at`,
    )
    .run(orgId, e.pcoId, e.name, e.frequency, e.archivedAt, e.pcoCreatedAt, e.pcoUpdatedAt);
}

function upsertLocation(
  orgId: number,
  l: {
    pcoId: string;
    name: string | null;
    kind: string | null;
    parentId: string | null;
    archivedAt: string | null;
  },
) {
  getDb()
    .prepare(
      `INSERT INTO pco_checkin_locations
        (org_id, pco_id, name, kind, parent_id, archived_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(org_id, pco_id) DO UPDATE SET
         name = excluded.name,
         kind = excluded.kind,
         parent_id = excluded.parent_id,
         archived_at = excluded.archived_at,
         synced_at = excluded.synced_at`,
    )
    .run(orgId, l.pcoId, l.name, l.kind, l.parentId, l.archivedAt);
}

function upsertCheckIn(
  orgId: number,
  c: {
    pcoId: string;
    personId: string | null;
    eventId: string | null;
    eventTimeAt: string | null;
    locationId: string | null;
    checkedInById: string | null;
    checkedOutById: string | null;
    kind: string | null;
    checkedOutAt: string | null;
    pcoCreatedAt: string | null;
  },
) {
  getDb()
    .prepare(
      `INSERT INTO pco_check_ins
        (org_id, pco_id, person_id, event_id, event_time_at, location_id,
         checked_in_by_id, checked_out_by_id, kind, checked_out_at,
         pco_created_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(org_id, pco_id) DO UPDATE SET
         person_id = excluded.person_id,
         event_id = excluded.event_id,
         event_time_at = excluded.event_time_at,
         location_id = excluded.location_id,
         checked_in_by_id = excluded.checked_in_by_id,
         checked_out_by_id = excluded.checked_out_by_id,
         kind = excluded.kind,
         checked_out_at = excluded.checked_out_at,
         pco_created_at = excluded.pco_created_at,
         synced_at = excluded.synced_at`,
    )
    .run(
      orgId,
      c.pcoId,
      c.personId,
      c.eventId,
      c.eventTimeAt,
      c.locationId,
      c.checkedInById,
      c.checkedOutById,
      c.kind,
      c.checkedOutAt,
      c.pcoCreatedAt,
    );
}

// ─── Cursor helpers ────────────────────────────────────────────────────

function readStoredCursor(orgId: number, resource: string): string | null {
  const row = getDb()
    .prepare(
      "SELECT last_updated_at FROM pco_sync_cursor WHERE org_id = ? AND resource = ?",
    )
    .get(orgId, resource) as { last_updated_at: string | null } | undefined;
  return row?.last_updated_at ?? null;
}

function readCursor(
  orgId: number,
  resource: string,
  thresholdMonths: number,
): string | null {
  const stored = readStoredCursor(orgId, resource);
  if (!stored) return null;
  const lookbackMs = thresholdMonths * 30 * 24 * 60 * 60 * 1000;
  const lookbackIso = new Date(Date.now() - lookbackMs).toISOString();
  return stored < lookbackIso ? stored : lookbackIso;
}

function writeCursor(orgId: number, resource: string, updatedAt: string | null) {
  if (!updatedAt) return;
  getDb()
    .prepare(
      `INSERT INTO pco_sync_cursor (org_id, resource, last_updated_at, last_synced_at)
       VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(org_id, resource) DO UPDATE SET
         last_updated_at = excluded.last_updated_at,
         last_synced_at = excluded.last_synced_at`,
    )
    .run(orgId, resource, updatedAt);
}
