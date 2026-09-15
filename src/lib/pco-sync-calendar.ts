import "server-only";
import { getDb } from "./db";
import { PCOClient, type PCOResource } from "./pco-client";

/** PCO Calendar sync — events, their occurrences, rooms, setup requests and
 *  room bookings.
 *
 *  Nothing in the app read PCO Calendar before this. The Facilities report was
 *  answering "events to support" out of `pco_plans`, which is PCO *Services* —
 *  Sunday services and rehearsals only. A funeral, a wedding, the Preschool
 *  open house and every outside group renting the Center were all invisible,
 *  and those are precisely the events the building has to be opened, set up and
 *  cleaned for.
 *
 *  Three things are worth knowing about the shape of this data:
 *
 *  1. An **Event** carries no date. The dated thing is an **EventInstance**,
 *     one per occurrence, so a weekly rehearsal is 1 event and ~52 instances.
 *     The instance is the unit of "an event the building served".
 *  2. An event's **owner** is the staff member who requested it. PCO sends
 *     `{"type":"Person","id":"null_person"}` when there isn't one; that
 *     sentinel is stored as NULL rather than as a literal id.
 *  3. A **ResourceRequest** is event-level and holds the setup instructions
 *     ("5 round tables 8 chairs per table…"); a **ResourceBooking** is that
 *     request materialised against one occurrence with real clock times
 *     including setup and teardown buffer. Requests answer "did this need a
 *     setup"; bookings answer "how much was this room used".
 *
 *  Volume: ~6.3k events, ~38.6k instances, 90 resources, ~29.6k requests,
 *  ~115k bookings across 2014-2028. Events and resources are pulled whole every
 *  time (cheap, and keeps names and owners current). Instances and bookings are
 *  windowed — there is no point re-reading 2016 every night. Requests page
 *  newest-updated-first and stop at the newest one already held. */

/** The sentinel PCO returns for an event with no owner. */
const NULL_PERSON = "null_person";

export interface CalendarSyncResult {
  events: { fetched: number; upserted: number };
  eventInstances: { fetched: number; upserted: number };
  resources: { fetched: number; upserted: number };
  resourceRequests: { fetched: number; upserted: number };
  resourceBookings: { fetched: number; upserted: number };
  window: { from: string; to: string };
}

export interface CalendarSyncOptions {
  /** ISO date. Instances and bookings starting before this are not fetched. */
  from?: string;
  /** ISO date. Instances and bookings starting on or after this are not fetched. */
  to?: string;
  /** Re-read every resource request rather than stopping at the newest held. */
  fullRequests?: boolean;
}

/** Years back / forward the recurring sync keeps current. Three years back
 *  covers a year-over-year comparison with a full prior year; eighteen months
 *  forward covers everything already booked. */
const DEFAULT_YEARS_BACK = 3;
const DEFAULT_MONTHS_FORWARD = 18;

function defaultWindow(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now);
  from.setUTCFullYear(from.getUTCFullYear() - DEFAULT_YEARS_BACK);
  const to = new Date(now);
  to.setUTCMonth(to.getUTCMonth() + DEFAULT_MONTHS_FORWARD);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" ? Math.trunc(v) : null);

/** The id of a to-one relationship, or null. PCO hands back arrays for to-many
 *  and the `null_person` sentinel for an unowned event; both read as "none". */
function relId(res: PCOResource, name: string): string | null {
  const rel = res.relationships?.[name]?.data;
  if (!rel || Array.isArray(rel)) return null;
  return rel.id && rel.id !== NULL_PERSON ? rel.id : null;
}

export async function syncCalendarAll(
  client: PCOClient,
  orgId: number,
  opts: CalendarSyncOptions = {},
): Promise<CalendarSyncResult> {
  const win = defaultWindow();
  const from = opts.from ?? win.from;
  const to = opts.to ?? win.to;
  const result: CalendarSyncResult = {
    events: { fetched: 0, upserted: 0 },
    eventInstances: { fetched: 0, upserted: 0 },
    resources: { fetched: 0, upserted: 0 },
    resourceRequests: { fetched: 0, upserted: 0 },
    resourceBookings: { fetched: 0, upserted: 0 },
    window: { from, to },
  };
  const db = getDb();

  // ── Events ───────────────────────────────────────────────────────────────
  // include=owner is not for the included payload, which is discarded — it is
  // to guarantee PCO returns the owner linkage at all.
  const upsertEvent = db.prepare(
    `INSERT INTO pco_calendar_events
       (org_id, pco_id, name, approval_status, percent_approved,
        visible_in_church_center, owner_id, pco_created_at, pco_updated_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, pco_id) DO UPDATE SET
       name = excluded.name,
       approval_status = excluded.approval_status,
       percent_approved = excluded.percent_approved,
       visible_in_church_center = excluded.visible_in_church_center,
       owner_id = excluded.owner_id,
       pco_created_at = excluded.pco_created_at,
       pco_updated_at = excluded.pco_updated_at,
       synced_at = excluded.synced_at`,
  );
  for await (const { page } of client.paginate<PCOResource>(
    "/calendar/v2/events?per_page=100&include=owner",
  )) {
    const arr = Array.isArray(page.data) ? page.data : [page.data];
    const tx = db.transaction(() => {
      for (const e of arr) {
        const a = (e.attributes ?? {}) as Record<string, unknown>;
        upsertEvent.run(
          orgId,
          e.id,
          str(a.name),
          str(a.approval_status),
          int(a.percent_approved),
          a.visible_in_church_center === true ? 1 : 0,
          relId(e, "owner"),
          str(a.created_at),
          str(a.updated_at),
        );
        result.events.upserted++;
      }
    });
    tx();
    result.events.fetched += arr.length;
  }

  // ── Resources (rooms and equipment) ──────────────────────────────────────
  const upsertResource = db.prepare(
    `INSERT INTO pco_calendar_resources
       (org_id, pco_id, name, kind, path_name, quantity, expires_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, pco_id) DO UPDATE SET
       name = excluded.name, kind = excluded.kind, path_name = excluded.path_name,
       quantity = excluded.quantity, expires_at = excluded.expires_at,
       synced_at = excluded.synced_at`,
  );
  for await (const { page } of client.paginate<PCOResource>(
    "/calendar/v2/resources?per_page=100",
  )) {
    const arr = Array.isArray(page.data) ? page.data : [page.data];
    const tx = db.transaction(() => {
      for (const r of arr) {
        const a = (r.attributes ?? {}) as Record<string, unknown>;
        upsertResource.run(
          orgId, r.id, str(a.name), str(a.kind), str(a.path_name),
          int(a.quantity), str(a.expires_at),
        );
        result.resources.upserted++;
      }
    });
    tx();
    result.resources.fetched += arr.length;
  }

  // ── Event instances (the dated occurrences) ──────────────────────────────
  const upsertInstance = db.prepare(
    `INSERT INTO pco_calendar_event_instances
       (org_id, pco_id, event_id, name, location, starts_at, ends_at,
        all_day, recurrence, pco_created_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, pco_id) DO UPDATE SET
       event_id = excluded.event_id, name = excluded.name, location = excluded.location,
       starts_at = excluded.starts_at, ends_at = excluded.ends_at,
       all_day = excluded.all_day, recurrence = excluded.recurrence,
       pco_created_at = excluded.pco_created_at, synced_at = excluded.synced_at`,
  );
  for await (const { page } of client.paginate<PCOResource>(
    `/calendar/v2/event_instances?per_page=100` +
      `&where[starts_at][gte]=${from}T00:00:00Z&where[starts_at][lt]=${to}T00:00:00Z`,
  )) {
    const arr = Array.isArray(page.data) ? page.data : [page.data];
    const tx = db.transaction(() => {
      for (const i of arr) {
        const a = (i.attributes ?? {}) as Record<string, unknown>;
        const eventId = relId(i, "event");
        // An instance with no event is unusable — it cannot be attributed to
        // an owner or a setup request — and event_id is NOT NULL.
        if (!eventId) continue;
        upsertInstance.run(
          orgId, i.id, eventId, str(a.name), str(a.location),
          str(a.starts_at), str(a.ends_at),
          a.all_day_event === true ? 1 : 0, str(a.recurrence), str(a.created_at),
        );
        result.eventInstances.upserted++;
      }
    });
    tx();
    result.eventInstances.fetched += arr.length;
  }

  // ── Resource requests (the setup asks) ───────────────────────────────────
  // Event-level and undated, so they cannot be windowed by date. Page
  // newest-updated-first and stop at the newest one already held; a first run
  // holds none and therefore pulls everything.
  const seenCursor = opts.fullRequests
    ? null
    : ((
        db
          .prepare(
            `SELECT MAX(pco_updated_at) AS m FROM pco_calendar_resource_requests WHERE org_id = ?`,
          )
          .get(orgId) as { m: string | null } | undefined
      )?.m ?? null);
  const upsertRequest = db.prepare(
    `INSERT INTO pco_calendar_resource_requests
       (org_id, pco_id, event_id, resource_id, quantity, notes, approval_status,
        room_setup_id, pco_created_at, pco_updated_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, pco_id) DO UPDATE SET
       event_id = excluded.event_id, resource_id = excluded.resource_id,
       quantity = excluded.quantity, notes = excluded.notes,
       approval_status = excluded.approval_status, room_setup_id = excluded.room_setup_id,
       pco_created_at = excluded.pco_created_at, pco_updated_at = excluded.pco_updated_at,
       synced_at = excluded.synced_at`,
  );
  let caughtUp = false;
  for await (const { page } of client.paginate<PCOResource>(
    "/calendar/v2/event_resource_requests?per_page=100&order=-updated_at",
  )) {
    const arr = Array.isArray(page.data) ? page.data : [page.data];
    const tx = db.transaction(() => {
      for (const r of arr) {
        const a = (r.attributes ?? {}) as Record<string, unknown>;
        const updated = str(a.updated_at);
        if (seenCursor && updated && updated <= seenCursor) {
          caughtUp = true;
          return;
        }
        upsertRequest.run(
          orgId, r.id, relId(r, "event"), relId(r, "resource"), int(a.quantity),
          str(a.notes), str(a.approval_status), relId(r, "room_setup"),
          str(a.created_at), updated,
        );
        result.resourceRequests.upserted++;
      }
    });
    tx();
    result.resourceRequests.fetched += arr.length;
    if (caughtUp) break;
  }

  // ── Resource bookings (room usage, with setup/teardown buffer) ───────────
  const upsertBooking = db.prepare(
    `INSERT INTO pco_calendar_resource_bookings
       (org_id, pco_id, event_id, event_instance_id, resource_id,
        starts_at, ends_at, quantity, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, pco_id) DO UPDATE SET
       event_id = excluded.event_id, event_instance_id = excluded.event_instance_id,
       resource_id = excluded.resource_id, starts_at = excluded.starts_at,
       ends_at = excluded.ends_at, quantity = excluded.quantity,
       synced_at = excluded.synced_at`,
  );
  for await (const { page } of client.paginate<PCOResource>(
    `/calendar/v2/resource_bookings?per_page=100` +
      `&where[starts_at][gte]=${from}T00:00:00Z&where[starts_at][lt]=${to}T00:00:00Z`,
  )) {
    const arr = Array.isArray(page.data) ? page.data : [page.data];
    const tx = db.transaction(() => {
      for (const b of arr) {
        const a = (b.attributes ?? {}) as Record<string, unknown>;
        upsertBooking.run(
          orgId, b.id, relId(b, "event"), relId(b, "event_instance"),
          relId(b, "resource"), str(a.starts_at), str(a.ends_at), int(a.quantity),
        );
        result.resourceBookings.upserted++;
      }
    });
    tx();
    result.resourceBookings.fetched += arr.length;
  }

  return result;
}
