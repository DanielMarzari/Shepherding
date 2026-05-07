import "server-only";
import { getDb } from "./db";
import { PCOClient, type PCOResource } from "./pco-client";

/** PCO Groups data sync — group_types, groups, memberships, applications,
 *  events. All five share the "groups" entity toggle. Called from runSync()
 *  when the toggle is on. */

export interface GroupSyncResult {
  groupTypes: { fetched: number; upserted: number };
  groups: { fetched: number; upserted: number };
  memberships: { fetched: number; upserted: number };
  applications: { fetched: number; upserted: number };
  events: { fetched: number; upserted: number };
  attendances: { fetched: number; upserted: number };
}

export async function syncGroupsAll(
  client: PCOClient,
  orgId: number,
  thresholdMonths: number,
): Promise<GroupSyncResult> {
  const result: GroupSyncResult = {
    groupTypes: { fetched: 0, upserted: 0 },
    groups: { fetched: 0, upserted: 0 },
    memberships: { fetched: 0, upserted: 0 },
    applications: { fetched: 0, upserted: 0 },
    events: { fetched: 0, upserted: 0 },
    attendances: { fetched: 0, upserted: 0 },
  };

  // 1) Group types — usually a handful of rows.
  const types = await client.getAll<PCOResource>("/groups/v2/group_types?per_page=100");
  for (const t of types.data) {
    result.groupTypes.fetched++;
    const a = (t.attributes ?? {}) as Record<string, unknown>;
    upsertGroupType(orgId, {
      pcoId: t.id,
      name: (a.name as string | undefined) ?? null,
    });
    result.groupTypes.upserted++;
  }

  // 2) Groups (metadata).
  const groupRecords: PCOResource[] = [];
  for await (const { page } of client.paginate<PCOResource>("/groups/v2/groups?per_page=100")) {
    const arr = Array.isArray(page.data) ? page.data : [page.data];
    groupRecords.push(...arr);
  }
  for (const g of groupRecords) {
    result.groups.fetched++;
    const a = (g.attributes ?? {}) as Record<string, unknown>;
    const rels = g.relationships ?? {};
    const groupTypeRel = rels.group_type?.data;
    const groupTypeId =
      !Array.isArray(groupTypeRel) && groupTypeRel ? groupTypeRel.id : null;
    upsertGroup(orgId, {
      pcoId: g.id,
      name: (a.name as string | undefined) ?? null,
      schedule: (a.schedule as string | undefined) ?? null,
      groupTypeId,
      pcoCreatedAt: (a.created_at as string | undefined) ?? null,
      archivedAt: (a.archived_at as string | undefined) ?? null,
    });
    result.groups.upserted++;
  }

  // 3) Memberships — per group, replace each group's set in a transaction
  //    so dropped memberships actually disappear. Tracks who joined when.
  const replaceMemberships = getDb().transaction(
    (groupId: string, rows: ReturnType<typeof toMembershipRow>[]) => {
      getDb()
        .prepare("DELETE FROM pco_group_memberships WHERE org_id = ? AND group_id = ?")
        .run(orgId, groupId);
      const stmt = getDb().prepare(
        `INSERT INTO pco_group_memberships
          (org_id, pco_id, group_id, person_id, role, joined_at, archived_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(org_id, pco_id) DO UPDATE SET
           group_id = excluded.group_id,
           person_id = excluded.person_id,
           role = excluded.role,
           joined_at = excluded.joined_at,
           archived_at = excluded.archived_at,
           synced_at = excluded.synced_at`,
      );
      for (const r of rows) {
        stmt.run(orgId, r.pcoId, r.groupId, r.personId, r.role, r.joinedAt, r.archivedAt);
      }
    },
  );

  for (const g of groupRecords) {
    const memberships: ReturnType<typeof toMembershipRow>[] = [];
    for await (const { page } of client.paginate<PCOResource>(
      `/groups/v2/groups/${g.id}/memberships?per_page=100`,
    )) {
      const arr = Array.isArray(page.data) ? page.data : [page.data];
      for (const m of arr) {
        result.memberships.fetched++;
        memberships.push(toMembershipRow(g.id, m));
      }
    }
    replaceMemberships(g.id, memberships);
    result.memberships.upserted += memberships.length;
  }

  // 4) Group applications — incremental on applied_at.
  const appCursor = readCursor(orgId, "groups:applications", thresholdMonths);
  const appParams = new URLSearchParams({ per_page: "100", order: "applied_at" });
  if (appCursor) appParams.set("where[applied_at][gt]", appCursor);
  let maxAppliedAt: string | null = appCursor;
  for await (const { page } of client.paginate<PCOResource>(
    `/groups/v2/group_applications?${appParams.toString()}`,
  )) {
    const arr = Array.isArray(page.data) ? page.data : [page.data];
    for (const ap of arr) {
      result.applications.fetched++;
      const a = (ap.attributes ?? {}) as Record<string, unknown>;
      const rels = ap.relationships ?? {};
      const groupRel = rels.group?.data;
      const personRel = rels.person?.data;
      const appliedAt = (a.applied_at as string | undefined) ?? null;
      if (appliedAt && (!maxAppliedAt || appliedAt > maxAppliedAt)) {
        maxAppliedAt = appliedAt;
      }
      upsertGroupApplication(orgId, {
        pcoId: ap.id,
        groupId: !Array.isArray(groupRel) && groupRel ? groupRel.id : null,
        personId: !Array.isArray(personRel) && personRel ? personRel.id : null,
        appliedAt,
        status: (a.status as string | undefined) ?? null,
        hasMessage:
          typeof a.message === "string" && (a.message as string).trim() !== "" ? 1 : 0,
      });
      result.applications.upserted++;
    }
  }
  writeCursor(orgId, "groups:applications", maxAppliedAt);

  // 5) Group events — incremental on starts_at. Track event ids that
  //    have attendance enabled so we can fetch attendances for them.
  const eventCursor = readCursor(orgId, "groups:events", thresholdMonths);
  const eventParams = new URLSearchParams({ per_page: "100", order: "starts_at" });
  if (eventCursor) eventParams.set("where[starts_at][gt]", eventCursor);
  let maxStartsAt: string | null = eventCursor;
  const attendanceTargetIds: { id: string; startsAt: string | null; groupId: string | null }[] =
    [];
  for await (const { page } of client.paginate<PCOResource>(
    `/groups/v2/events?${eventParams.toString()}`,
  )) {
    const arr = Array.isArray(page.data) ? page.data : [page.data];
    for (const ev of arr) {
      result.events.fetched++;
      const a = (ev.attributes ?? {}) as Record<string, unknown>;
      const rels = ev.relationships ?? {};
      const groupRel = rels.group?.data;
      const startsAt = (a.starts_at as string | undefined) ?? null;
      if (startsAt && (!maxStartsAt || startsAt > maxStartsAt)) {
        maxStartsAt = startsAt;
      }
      const groupId = !Array.isArray(groupRel) && groupRel ? groupRel.id : null;
      const attendanceRequestsEnabled = a.attendance_requests_enabled === true;
      const canceled = a.canceled === true;
      upsertGroupEvent(orgId, {
        pcoId: ev.id,
        groupId,
        startsAt,
        attendanceRequestsEnabled: attendanceRequestsEnabled ? 1 : 0,
        automatedReminderEnabled: a.automated_reminder_enabled === true ? 1 : 0,
        canceled: canceled ? 1 : 0,
        canceledAt: (a.canceled_at as string | undefined) ?? null,
        remindersSent: a.reminders_sent === true ? 1 : 0,
        remindersSentAt: (a.reminders_sent_at as string | undefined) ?? null,
      });
      result.events.upserted++;
      if (attendanceRequestsEnabled && !canceled && startsAt) {
        attendanceTargetIds.push({ id: ev.id, startsAt, groupId });
      }
    }
  }
  writeCursor(orgId, "groups:events", maxStartsAt);

  // 6) Attendance per event (only events with attendance_requests_enabled
  //    that we just synced). PCO has /groups/v2/events/{id}/attendances.
  for (const ev of attendanceTargetIds) {
    try {
      for await (const { page } of client.paginate<PCOResource>(
        `/groups/v2/events/${ev.id}/attendances?per_page=100`,
      )) {
        const arr = Array.isArray(page.data) ? page.data : [page.data];
        for (const att of arr) {
          result.attendances.fetched++;
          const a = (att.attributes ?? {}) as Record<string, unknown>;
          const rels = att.relationships ?? {};
          const personRel = rels.person?.data;
          const personId =
            !Array.isArray(personRel) && personRel ? personRel.id : null;
          if (!personId) continue;
          upsertEventAttendance(orgId, {
            eventId: ev.id,
            personId,
            groupId: ev.groupId,
            attended: a.attended === true ? 1 : 0,
            pcoCreatedAt: (a.created_at as string | undefined) ?? null,
            eventStartsAt: ev.startsAt,
          });
          result.attendances.upserted++;
        }
      }
    } catch {
      // PCO sometimes 404s for events whose attendance lookup is gated;
      // skip and keep going so one bad event doesn't break the rest.
    }
  }

  return result;
}

function upsertEventAttendance(
  orgId: number,
  a: {
    eventId: string;
    personId: string;
    groupId: string | null;
    attended: number;
    pcoCreatedAt: string | null;
    eventStartsAt: string | null;
  },
) {
  getDb()
    .prepare(
      `INSERT INTO pco_event_attendances
        (org_id, event_id, person_id, group_id, attended, pco_created_at, event_starts_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(org_id, event_id, person_id) DO UPDATE SET
         group_id = excluded.group_id,
         attended = excluded.attended,
         pco_created_at = excluded.pco_created_at,
         event_starts_at = excluded.event_starts_at,
         synced_at = excluded.synced_at`,
    )
    .run(
      orgId,
      a.eventId,
      a.personId,
      a.groupId,
      a.attended,
      a.pcoCreatedAt,
      a.eventStartsAt,
    );
}

/** Recompute last_attended_at on every membership from attendance records. */
export function refreshLastAttended(orgId: number) {
  getDb()
    .prepare(
      `UPDATE pco_group_memberships
         SET last_attended_at = (
           SELECT MAX(a.event_starts_at)
             FROM pco_event_attendances a
             WHERE a.org_id = pco_group_memberships.org_id
               AND a.person_id = pco_group_memberships.person_id
               AND a.group_id = pco_group_memberships.group_id
               AND a.attended = 1
         )
       WHERE org_id = ?`,
    )
    .run(orgId);
}

// ─── Helpers ──────────────────────────────────────────────────────────

function toMembershipRow(groupId: string, m: PCOResource) {
  const a = (m.attributes ?? {}) as Record<string, unknown>;
  const rels = m.relationships ?? {};
  const personRel = rels.person?.data;
  return {
    pcoId: m.id,
    groupId,
    personId: !Array.isArray(personRel) && personRel ? personRel.id : "",
    role: (a.role as string | undefined) ?? null,
    joinedAt: (a.joined_at as string | undefined) ?? null,
    archivedAt: (a.archived_at as string | undefined) ?? null,
  };
}

function upsertGroupType(orgId: number, t: { pcoId: string; name: string | null }) {
  getDb()
    .prepare(
      `INSERT INTO pco_group_types (org_id, pco_id, name, synced_at)
       VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(org_id, pco_id) DO UPDATE SET
         name = excluded.name,
         synced_at = excluded.synced_at`,
    )
    .run(orgId, t.pcoId, t.name);
}

function upsertGroup(
  orgId: number,
  g: {
    pcoId: string;
    name: string | null;
    schedule: string | null;
    groupTypeId: string | null;
    pcoCreatedAt: string | null;
    archivedAt: string | null;
  },
) {
  getDb()
    .prepare(
      `INSERT INTO pco_groups
        (org_id, pco_id, name, schedule, group_type_id, pco_created_at, archived_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(org_id, pco_id) DO UPDATE SET
         name = excluded.name,
         schedule = excluded.schedule,
         group_type_id = excluded.group_type_id,
         pco_created_at = excluded.pco_created_at,
         archived_at = excluded.archived_at,
         synced_at = excluded.synced_at`,
    )
    .run(
      orgId,
      g.pcoId,
      g.name,
      g.schedule,
      g.groupTypeId,
      g.pcoCreatedAt,
      g.archivedAt,
    );
}

function upsertGroupApplication(
  orgId: number,
  ap: {
    pcoId: string;
    groupId: string | null;
    personId: string | null;
    appliedAt: string | null;
    status: string | null;
    hasMessage: number;
  },
) {
  getDb()
    .prepare(
      `INSERT INTO pco_group_applications
        (org_id, pco_id, group_id, person_id, applied_at, status, has_message, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(org_id, pco_id) DO UPDATE SET
         group_id = excluded.group_id,
         person_id = excluded.person_id,
         applied_at = excluded.applied_at,
         status = excluded.status,
         has_message = excluded.has_message,
         synced_at = excluded.synced_at`,
    )
    .run(
      orgId,
      ap.pcoId,
      ap.groupId,
      ap.personId,
      ap.appliedAt,
      ap.status,
      ap.hasMessage,
    );
}

function upsertGroupEvent(
  orgId: number,
  e: {
    pcoId: string;
    groupId: string | null;
    startsAt: string | null;
    attendanceRequestsEnabled: number;
    automatedReminderEnabled: number;
    canceled: number;
    canceledAt: string | null;
    remindersSent: number;
    remindersSentAt: string | null;
  },
) {
  getDb()
    .prepare(
      `INSERT INTO pco_group_events
        (org_id, pco_id, group_id, starts_at,
         attendance_requests_enabled, automated_reminder_enabled,
         canceled, canceled_at, reminders_sent, reminders_sent_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(org_id, pco_id) DO UPDATE SET
         group_id = excluded.group_id,
         starts_at = excluded.starts_at,
         attendance_requests_enabled = excluded.attendance_requests_enabled,
         automated_reminder_enabled = excluded.automated_reminder_enabled,
         canceled = excluded.canceled,
         canceled_at = excluded.canceled_at,
         reminders_sent = excluded.reminders_sent,
         reminders_sent_at = excluded.reminders_sent_at,
         synced_at = excluded.synced_at`,
    )
    .run(
      orgId,
      e.pcoId,
      e.groupId,
      e.startsAt,
      e.attendanceRequestsEnabled,
      e.automatedReminderEnabled,
      e.canceled,
      e.canceledAt,
      e.remindersSent,
      e.remindersSentAt,
    );
}

// Cursor logic mirrors lib/pco-sync.ts but kept local to avoid a circular import.
function readStoredCursor(orgId: number, resource: string): string | null {
  const row = getDb()
    .prepare(
      "SELECT last_updated_at FROM pco_sync_cursor WHERE org_id = ? AND resource = ?",
    )
    .get(orgId, resource) as { last_updated_at: string | null } | undefined;
  return row?.last_updated_at ?? null;
}

function readCursor(orgId: number, resource: string, thresholdMonths: number): string | null {
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
