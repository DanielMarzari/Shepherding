import "server-only";
import { shrinkReadOnlyMemory } from "./builder";
import {
  getRefreshRunStatus,
  getSnapshotFreshness,
  launchRefresh,
  reapStaleRefreshRuns,
  refreshDashboardSnapshots,
} from "./dashboard-refresh";
import { decryptJson, encryptJson, hmac } from "./encryption";
import { getDb, optimizeDb, prepareCached, shrinkDbMemory } from "./db";
import { normPhone } from "./phone";
import {
  getAdultCheckinEvents,
  getDecryptedCreds,
  getKidCheckinEvents,
  getSyncEntities,
  getSyncSettings,
} from "./pco";
import { PCOClient, PCOError, type PCOResource } from "./pco-client";
import { refreshLastCheckIn, syncCheckinsAll } from "./pco-sync-checkins";
import { refreshLastAttended, syncGroupsAll } from "./pco-sync-groups";
import { syncCalendarAll } from "./pco-sync-calendar";
import { syncRegistrationsAll } from "./pco-sync-registrations";
import { refreshIsParent, syncHouseholdsAll } from "./pco-sync-households";
import { syncListsAll } from "./pco-sync-lists";
import { refreshLastServed, syncServicesAll } from "./pco-sync-services";

// Forms the user explicitly asked to track (from the prompt).
// Becomes user-configurable later; for now this is the canonical list.
const TRACKED_FORM_IDS = ["308672", "144568", "70538"];

export interface SyncResult {
  ok: boolean;
  changes: number;
  details: SyncDetails;
  warning?: string;
  error?: string;
}

export interface SyncDetails {
  people: { fetched: number; upserted: number };
  households: { fetched: number; upserted: number };
  householdMemberships: { fetched: number; upserted: number };
  lists: { fetched: number; upserted: number };
  listMemberships: { fetched: number; upserted: number };
  forms: { fetched: number; upserted: number };
  formFields: { fetched: number; upserted: number };
  formSubmissions: { fetched: number; upserted: number };
  groups: { fetched: number; upserted: number };
  groupTypes: { fetched: number; upserted: number };
  groupMemberships: { fetched: number; upserted: number };
  groupApplications: { fetched: number; upserted: number };
  groupEvents: { fetched: number; upserted: number };
  checkinEvents: { fetched: number; upserted: number };
  checkinLocations: { fetched: number; upserted: number };
  checkIns: { fetched: number; upserted: number };
  serviceTypes: { fetched: number; upserted: number };
  teams: { fetched: number; upserted: number };
  teamPositions: { fetched: number; upserted: number };
  teamMemberships: { fetched: number; upserted: number };
  plans: { fetched: number; upserted: number };
  planPeople: { fetched: number; upserted: number };
  planItems: { fetched: number; upserted: number };
  personFields: { fetched: number; upserted: number };
  registrationSignups: { fetched: number; upserted: number };
  registrationAttendees: { fetched: number; upserted: number };
  calendarEvents: { fetched: number; upserted: number };
  calendarEventInstances: { fetched: number; upserted: number };
  calendarResources: { fetched: number; upserted: number };
  calendarResourceRequests: { fetched: number; upserted: number };
  calendarResourceBookings: { fetched: number; upserted: number };
  cutoff: string | null;
  durationMs: number;
  startedAt: string;
}

/** Stalled runs older than this are auto-marked as error on the next
 *  sync. A real full sync should comfortably finish in well under an
 *  hour for this scale of org. */
const STALE_RUN_MINUTES = 65;

/** Mark any leftover "running" rows older than STALE_RUN_MINUTES as
 *  failed. Catches processes killed mid-sync by a deploy/restart so the
 *  UI doesn't show "running" forever.
 *
 *  Exported because the scheduler has to call it BEFORE deciding whether a run
 *  is due. isSyncDue reads the last run with status 'ok' OR 'running', so a row
 *  left running by a killed process reads as "we synced at that time" and
 *  suppresses every tick until the next scheduled window comes round. Running
 *  the cleanup only inside runSync — which the due check gates — meant the one
 *  thing that clears the jam sat behind the jam. */
export function cleanupStaleSyncRuns(orgId: number) {
  const cutoff = new Date(
    Date.now() - STALE_RUN_MINUTES * 60 * 1000,
  ).toISOString();
  getDb()
    .prepare(
      `UPDATE pco_sync_runs
          SET status = 'error',
              finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              warning = COALESCE(warning || ' | ', '') ||
                        'Stalled — auto-cleaned (likely killed by deploy/restart mid-sync)'
        WHERE org_id = ?
          AND status = 'running'
          AND started_at < ?`,
    )
    .run(orgId, cutoff);
}

/** Is there a currently-running sync for this org (started within the
 *  stale window)? Returns its row if so. Used to short-circuit duplicate
 *  manual + scheduled triggers. */
function findActiveSyncRun(orgId: number): { id: number; startedAt: string } | null {
  const row = getDb()
    .prepare(
      `SELECT id, started_at AS startedAt
         FROM pco_sync_runs
        WHERE org_id = ? AND status = 'running'
        ORDER BY id DESC LIMIT 1`,
    )
    .get(orgId) as { id: number; startedAt: string } | undefined;
  return row ?? null;
}

export async function runSync(
  orgId: number,
  trigger: "manual" | "auto" = "manual",
): Promise<SyncResult> {
  cleanupStaleSyncRuns(orgId);
  const inFlight = findActiveSyncRun(orgId);
  if (inFlight) {
    return {
      ok: false,
      changes: 0,
      details: {} as SyncDetails,
      error: `Another sync is already running for this org (started ${inFlight.startedAt}). Auto-cleans after ${STALE_RUN_MINUTES} minutes.`,
    };
  }
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const details: SyncDetails = {
    people: { fetched: 0, upserted: 0 },
    households: { fetched: 0, upserted: 0 },
    householdMemberships: { fetched: 0, upserted: 0 },
    lists: { fetched: 0, upserted: 0 },
    listMemberships: { fetched: 0, upserted: 0 },
    forms: { fetched: 0, upserted: 0 },
    formFields: { fetched: 0, upserted: 0 },
    formSubmissions: { fetched: 0, upserted: 0 },
    groups: { fetched: 0, upserted: 0 },
    groupTypes: { fetched: 0, upserted: 0 },
    groupMemberships: { fetched: 0, upserted: 0 },
    groupApplications: { fetched: 0, upserted: 0 },
    groupEvents: { fetched: 0, upserted: 0 },
    checkinEvents: { fetched: 0, upserted: 0 },
    checkinLocations: { fetched: 0, upserted: 0 },
    checkIns: { fetched: 0, upserted: 0 },
    serviceTypes: { fetched: 0, upserted: 0 },
    teams: { fetched: 0, upserted: 0 },
    teamPositions: { fetched: 0, upserted: 0 },
    teamMemberships: { fetched: 0, upserted: 0 },
    plans: { fetched: 0, upserted: 0 },
    planPeople: { fetched: 0, upserted: 0 },
    planItems: { fetched: 0, upserted: 0 },
    personFields: { fetched: 0, upserted: 0 },
    registrationSignups: { fetched: 0, upserted: 0 },
    registrationAttendees: { fetched: 0, upserted: 0 },
    calendarEvents: { fetched: 0, upserted: 0 },
    calendarEventInstances: { fetched: 0, upserted: 0 },
    calendarResources: { fetched: 0, upserted: 0 },
    calendarResourceRequests: { fetched: 0, upserted: 0 },
    calendarResourceBookings: { fetched: 0, upserted: 0 },
    cutoff: null,
    durationMs: 0,
    startedAt,
  };

  const creds = getDecryptedCreds(orgId);
  if (!creds) {
    return {
      ok: false,
      changes: 0,
      details: { ...details, durationMs: Date.now() - startedMs },
      error: "No PCO credentials saved.",
    };
  }
  const settings = getSyncSettings(orgId);
  const enabled = getSyncEntities(orgId);
  const client = new PCOClient({ appId: creds.appId, secret: creds.secret });
  const runId = insertSyncRunStart(orgId, trigger);

  let warning: string | undefined;
  try {
    // ── People ────────────────────────────────────────────────────────────
    if (enabled.people !== false) {
      const cursor = effectiveCursor(orgId, "people", settings.syncThresholdMonths);
      details.cutoff = cursor;
      const peopleCount = await syncPeople(client, orgId, cursor);
      details.people.fetched = peopleCount.fetched;
      details.people.upserted = peopleCount.upserted;
      writeCursor(orgId, "people", peopleCount.maxUpdatedAt);

      // Households piggyback on the People product — pulled whenever
      // people sync is on. Drives the is_parent flag for demographics.
      try {
        const h = await syncHouseholdsAll(client, orgId);
        details.households = h.households;
        details.householdMemberships = h.householdMemberships;
      } catch (e) {
        warning = appendWarning(
          warning,
          `Households: ${e instanceof Error ? e.message : "failed"}`,
        );
      }

      // PCO Lists (REFERENCE-prefixed only). Lightweight — usually a few
      // lists. Surfaces staff / deacons / elders / shepherd team for use
      // elsewhere in the app.
      try {
        const l = await syncListsAll(client, orgId);
        details.lists = l.lists;
        details.listMemberships = l.listMemberships;
      } catch (e) {
        warning = appendWarning(
          warning,
          `Lists: ${e instanceof Error ? e.message : "failed"}`,
        );
      }

      // Person custom fields. Faith Church records Baptism as a date on the
      // "Membership and Assimilation" tab; nothing read it until now, so the
      // Adult Discipleship report's "# of baptisms" had no source. Only the
      // allowlisted fields are stored — the same tab holds Date of Death and
      // Date Widowed, which nothing needs.
      try {
        const f = await syncPersonFields(client, orgId);
        details.personFields = f;
      } catch (e) {
        warning = appendWarning(
          warning,
          `Person fields: ${e instanceof Error ? e.message : "failed"}`,
        );
      }
    }

    // ── Registrations (signups + attendees) ─────────────────────────────
    if (enabled.registrations) {
      try {
        const r = await syncRegistrationsAll(client, orgId, settings.syncThresholdMonths);
        details.registrationSignups = r.signups;
        details.registrationAttendees = r.attendees;
      } catch (e) {
        warning = appendWarning(
          warning,
          `Registrations: ${e instanceof Error ? e.message : "failed"}`,
        );
      }
    }

    // ── Calendar (events, occurrences, rooms, setup requests, bookings) ─
    // The only record of what the building is asked to do. Windowed to the
    // last three years and the next eighteen months; a first run needs
    // scripts/backfill-calendar.mjs to reach further back.
    if (enabled.calendar) {
      try {
        const c = await syncCalendarAll(client, orgId);
        details.calendarEvents = c.events;
        details.calendarEventInstances = c.eventInstances;
        details.calendarResources = c.resources;
        details.calendarResourceRequests = c.resourceRequests;
        details.calendarResourceBookings = c.resourceBookings;
      } catch (e) {
        warning = appendWarning(
          warning,
          `Calendar: ${e instanceof Error ? e.message : "failed"}`,
        );
      }
    }

    // ── Groups (types, groups, memberships, applications, events) ───────
    if (enabled.groups) {
      try {
        const g = await syncGroupsAll(
          client,
          orgId,
          settings.syncThresholdMonths,
        );
        details.groupTypes = g.groupTypes;
        details.groups = g.groups;
        details.groupMemberships = g.memberships;
        details.groupApplications = g.applications;
        details.groupEvents = g.events;
        // Recompute last-attended cache once attendance rows are in.
        refreshLastAttended(orgId);
      } catch (e) {
        warning = appendWarning(
          warning,
          `Groups: ${e instanceof Error ? e.message : "failed"}`,
        );
      }
    }

    // ── Check-ins (events, locations, individual check-in records) ──────
    if (enabled.check_ins) {
      try {
        const c = await syncCheckinsAll(
          client,
          orgId,
          settings.syncThresholdMonths,
        );
        details.checkinEvents = c.events;
        details.checkinLocations = c.locations;
        details.checkIns = c.checkIns;
        refreshLastCheckIn(orgId);
      } catch (e) {
        warning = appendWarning(
          warning,
          `Check-ins: ${e instanceof Error ? e.message : "failed"}`,
        );
      }
    }

    // ── Services / Teams (service_types, teams, positions, plans, etc.) ─
    if (enabled.teams) {
      try {
        const t = await syncServicesAll(
          client,
          orgId,
          settings.syncThresholdMonths,
        );
        details.serviceTypes = t.serviceTypes;
        details.teams = t.teams;
        details.teamPositions = t.teamPositions;
        details.teamMemberships = t.teamMemberships;
        details.plans = t.plans;
        details.planPeople = t.planPeople;
        details.planItems = t.planItems;
        refreshLastServed(orgId);
      } catch (e) {
        warning = appendWarning(
          warning,
          `Teams: ${e instanceof Error ? e.message : "failed"}`,
        );
      }
    }

    // ── Forms (only if "forms" entity is enabled) ────────────────────────
    if (enabled.forms) {
      for (const formId of TRACKED_FORM_IDS) {
        try {
          const formResult = await syncOneForm(
            client,
            orgId,
            formId,
            settings.syncThresholdMonths,
          );
          if (formResult.formUpserted) details.forms.upserted += 1;
          if (formResult.fetched) details.forms.fetched += 1;
          details.formFields.fetched += formResult.fields.fetched;
          details.formFields.upserted += formResult.fields.upserted;
          details.formSubmissions.fetched += formResult.subs.fetched;
          details.formSubmissions.upserted += formResult.subs.upserted;
        } catch (e) {
          warning = appendWarning(
            warning,
            `Form ${formId}: ${e instanceof Error ? e.message : "failed"}`,
          );
        }
      }
    }

    // ── Compute last_activity_at for affected people ─────────────────────
    refreshLastActivity(orgId);
    // Update minors flag from decrypted birthdate; gates the kids-checked-
    // in-to-shepherded-event rule.
    const junkKept = refreshIsMinor(orgId);
    if (junkKept) warning = appendWarning(warning, junkKept);
    // is_parent depends on is_minor + households, so it must run AFTER both.
    refreshIsParent(orgId);

    const changes =
      details.people.upserted +
      details.households.upserted +
      details.householdMemberships.upserted +
      details.lists.upserted +
      details.listMemberships.upserted +
      details.forms.upserted +
      details.formFields.upserted +
      details.formSubmissions.upserted +
      details.groups.upserted +
      details.groupTypes.upserted +
      details.groupMemberships.upserted +
      details.groupApplications.upserted +
      details.groupEvents.upserted +
      details.checkinEvents.upserted +
      details.checkinLocations.upserted +
      details.checkIns.upserted +
      details.serviceTypes.upserted +
      details.teams.upserted +
      details.teamPositions.upserted +
      details.teamMemberships.upserted +
      details.plans.upserted +
      details.planPeople.upserted +
      details.planItems.upserted;

    // Refresh dashboard snapshots before marking the run as ok so the
    // next page render sees fresh totals. Wrapped defensively — a
    // failure here shouldn't undo the sync (data already landed).
    const refreshError = tryRefreshSnapshots(orgId, "sync");
    if (refreshError) {
      warning =
        (warning ? warning + " · " : "") +
        `dashboard refresh failed: ${refreshError}`;
    }
    details.durationMs = Date.now() - startedMs;
    finishSyncRun(runId, "ok", changes, warning, details);
    optimizeDb();
    releaseSyncMemory();
    return { ok: true, changes, details, warning };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    // Rebuild the snapshots anyway. Whatever landed before the failure is in
    // the source tables, and every dashboard, map, intake form and graph reads
    // the snapshots, not the source. On 2026-09-16 syncs had been dying for
    // eleven days and production was serving eleven-day-old dashboards, with
    // 111 active people missing from them, because this rebuild only ran on
    // success. (A sync that is KILLED runs no JS at all; the cron tick's
    // healStaleSnapshots covers that case.)
    //
    // Only when something landed, though. A failed sync is retried on every
    // 15-minute tick (isSyncDue ignores error runs), and one that fails on its
    // first request — revoked credentials, PCO down — would otherwise block
    // the event loop for a full synchronous rebuild (2.2-4.1 s on a
    // production copy) every time. A stage that finished counts in details;
    // people upserted before a mid-people failure show in the watermark.
    // "unknown" (no watermark recorded yet) rebuilds once, which records one.
    const landed =
      anyUpserted(details) || getSnapshotFreshness(orgId).state !== "fresh";
    const refreshError = landed
      ? tryRefreshSnapshots(orgId, "sync-error")
      : null;
    details.durationMs = Date.now() - startedMs;
    finishSyncRun(
      runId,
      "error",
      0,
      refreshError ? `${msg} · dashboard refresh failed: ${refreshError}` : msg,
      details,
    );
    optimizeDb();
    releaseSyncMemory();
    return { ok: false, changes: 0, details, error: msg };
  }
}

function anyUpserted(details: SyncDetails): boolean {
  return Object.values(details).some(
    (v) => typeof v === "object" && v !== null && v.upserted > 0,
  );
}

/** Rebuild the dashboard snapshots after a sync attempt. Returns the error
 *  message instead of throwing: a refresh failure must never turn into a sync
 *  failure, since the synced rows are already committed. */
function tryRefreshSnapshots(
  orgId: number,
  trigger: "sync" | "sync-error",
): string | null {
  try {
    refreshDashboardSnapshots(orgId, trigger);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** When this process started, in pco_sync_runs.started_at's format (both come
 *  from the system clock). Derived from uptime rather than captured at module
 *  load so every copy of this module Next bundles (route handler, server
 *  action) agrees on it. */
const PROCESS_STARTED_AT = new Date(
  Date.now() - process.uptime() * 1000,
).toISOString();

/** The cron's backstop for a sync that died without running any JS — killed
 *  by a deploy's pm2 restart or by the memory cap — so neither refresh path in
 *  runSync ran. Rebuilds the snapshots when their source has moved on since
 *  the last successful rebuild, unless a sync is still running (it will
 *  rebuild them itself when it finishes).
 *
 *  "Still running" means started by THIS process. A killed sync's row stays
 *  'running' until cleanupStaleSyncRuns reaps it 65 minutes on, and waiting
 *  for that left the dashboards behind for over an hour after every kill. Only
 *  runSync writes these rows and it runs in the app process, so a row started
 *  before this process booted belongs to one that is gone. (If the app ever
 *  ran as several pm2 instances, a sibling's sync started before this one
 *  booted would be misread as dead. The cost is one extra rebuild on this
 *  instance's own connection while it runs; that sync still rebuilds at its
 *  end.) The row itself is left for cleanupStaleSyncRuns. Reaping it here
 *  would also make the next sync due at once, and a sync that keeps getting
 *  killed would then restart every 15 minutes instead of every 75.
 *
 *  Cheap enough for every 15-minute tick when there is nothing to do: an
 *  UPDATE that matches no rows and two indexed single-row lookups, 0.02 ms
 *  per call measured on a production copy. */
export async function healStaleSnapshots(orgId: number): Promise<string> {
  reapStaleRefreshRuns(orgId);
  const freshness = getSnapshotFreshness(orgId);
  if (freshness.state !== "stale") return freshness.state;
  const active = findActiveSyncRun(orgId);
  if (active && active.startedAt >= PROCESS_STARTED_AT) {
    return `stale; sync ${active.id} still running`;
  }
  const orphan = active ? `sync ${active.id} died with a previous process; ` : "";
  const { runId, joined, done } = launchRefresh(orgId, "self-heal");
  await done;
  const run = getRefreshRunStatus(runId);
  const how = joined ? "joined in-flight refresh" : "rebuilt";
  return `stale; ${orphan}${how} (refresh ${runId}: ${run?.status ?? "unknown"}${run?.error ? ` — ${run.error}` : ""})`;
}

/** A sync is where this process's memory peaks — it is the one operation that
 *  touches every table. SQLite holds its page cache at the high-water mark for
 *  the life of the process, which on this host is the difference between
 *  running and being restarted by pm2, so hand it back explicitly. Runs on the
 *  failure path too: a sync that died halfway still filled the cache. */
function releaseSyncMemory() {
  shrinkDbMemory();
  shrinkReadOnlyMemory();
}

// ─── People ────────────────────────────────────────────────────────────

async function syncPeople(
  client: PCOClient,
  orgId: number,
  cutoff: string | null,
): Promise<{ fetched: number; upserted: number; maxUpdatedAt: string | null }> {
  const params = new URLSearchParams({
    include: "addresses,marital_status,emails,phone_numbers",
    per_page: "100",
    order: "updated_at",
  });
  if (cutoff) params.set("where[updated_at][gt]", cutoff);
  const path = `/people/v2/people?${params.toString()}`;

  let fetched = 0;
  let upserted = 0;
  let maxUpdatedAt: string | null = cutoff;

  for await (const { page } of client.paginate(path)) {
    const records = Array.isArray(page.data) ? page.data : [page.data];
    const included = page.included ?? [];
    const addressById = new Map<string, PCOResource>();
    const maritalById = new Map<string, PCOResource>();
    const emailById = new Map<string, PCOResource>();
    const phoneById = new Map<string, PCOResource>();
    for (const inc of included) {
      if (inc.type === "Address") addressById.set(inc.id, inc);
      if (inc.type === "MaritalStatus") maritalById.set(inc.id, inc);
      if (inc.type === "Email") emailById.set(inc.id, inc);
      if (inc.type === "PhoneNumber") phoneById.set(inc.id, inc);
    }

    for (const p of records) {
      fetched++;
      const attrs = (p.attributes ?? {}) as Record<string, unknown>;
      const rels = p.relationships ?? {};

      const addrRel = rels.addresses?.data;
      const addrIds: string[] = Array.isArray(addrRel)
        ? addrRel.map((r) => r.id)
        : addrRel
          ? [addrRel.id]
          : [];
      const primaryAddr =
        addrIds
          .map((id) => addressById.get(id))
          .find(
            (a) => a && (a.attributes as Record<string, unknown>)?.primary === true,
          ) ?? addrIds.map((id) => addressById.get(id)).find(Boolean);
      const addressStr = primaryAddr ? formatAddress(primaryAddr.attributes) : null;

      const maritalRel = rels.marital_status?.data;
      const maritalId = !Array.isArray(maritalRel) && maritalRel ? maritalRel.id : null;
      const marital = maritalId ? maritalById.get(maritalId) : null;
      const maritalValue = marital
        ? ((marital.attributes as Record<string, unknown> | undefined)?.value as
            | string
            | undefined) ?? null
        : null;

      const updatedAt = (attrs.updated_at as string | undefined) ?? null;
      if (updatedAt && (!maxUpdatedAt || updatedAt > maxUpdatedAt)) {
        maxUpdatedAt = updatedAt;
      }

      const nickname = (attrs.nickname as string | undefined) ?? null;
      // PCO's given_name is the legal first name (first_name is the name they
      // go by: first_name "Tom", given_name "Thomas").
      const legalFirstName = (attrs.given_name as string | undefined) ?? null;
      const pii = {
        first_name: (attrs.first_name as string | undefined) ?? null,
        last_name: (attrs.last_name as string | undefined) ?? null,
        birthdate: (attrs.birthdate as string | undefined) ?? null,
        address: addressStr,
      };

      // Skip non-person rows admins create for rooms, computers, "DO
      // NOT USE" placeholders, etc. See looksLikeNonPerson docs.
      if (looksLikeNonPerson(pii.first_name, pii.last_name)) {
        continue;
      }

      upsertPerson(orgId, {
        pcoId: p.id,
        encPii: encryptJson(pii),
        firstName: pii.first_name,
        lastName: pii.last_name,
        nickname,
        legalFirstName,
        gender: (attrs.gender as string | undefined) ?? null,
        membershipType: (attrs.membership as string | undefined) ?? null,
        maritalStatus: maritalValue,
        status: (attrs.status as string | undefined) ?? null,
        pcoCreatedAt: (attrs.created_at as string | undefined) ?? null,
        pcoUpdatedAt: updatedAt,
        inactivatedAt: (attrs.inactivated_at as string | undefined) ?? null,
      });
      upserted++;

      // Email-hash lookup for the public shepherd-intake page. We
      // store only the keyed HMAC of each lowercased address — never
      // the plaintext — so a shepherd can identify by email without us
      // holding raw addresses at rest.
      const emailRel = rels.emails?.data;
      const emailIds: string[] = Array.isArray(emailRel)
        ? emailRel.map((r) => r.id)
        : emailRel
          ? [emailRel.id]
          : [];
      const hashes = new Set<string>();
      for (const id of emailIds) {
        const e = emailById.get(id);
        const addr = (e?.attributes as Record<string, unknown> | undefined)
          ?.address;
        if (typeof addr === "string" && addr.includes("@")) {
          hashes.add(hmac(addr.trim().toLowerCase()));
        }
      }
      replacePersonEmails(orgId, p.id, [...hashes]);

      // Phone-hash lookup — same one-way-token approach as emails, so
      // integrations (PushPay giving) can match a person by phone without
      // us storing a plaintext number. Normalized to US 10-digit first so
      // both sides hash identically.
      const phoneRel = rels.phone_numbers?.data;
      const phoneIds: string[] = Array.isArray(phoneRel)
        ? phoneRel.map((r) => r.id)
        : phoneRel
          ? [phoneRel.id]
          : [];
      const phoneHashes = new Set<string>();
      for (const id of phoneIds) {
        const ph = phoneById.get(id);
        const num = (ph?.attributes as Record<string, unknown> | undefined)
          ?.number;
        const norm = normPhone(typeof num === "string" ? num : null);
        if (norm) phoneHashes.add(hmac(norm));
      }
      replacePersonPhones(orgId, p.id, [...phoneHashes]);
    }
  }

  // Backfill plaintext names for anyone synced before 0074 (idempotent).
  backfillPersonNames(orgId);

  return { fetched, upserted, maxUpdatedAt };
}

/** Replace the stored email hashes for one person. Cheap delete+insert
 *  so a removed PCO email drops out of the lookup. */
function replacePersonEmails(
  orgId: number,
  personId: string,
  hashes: string[],
): void {
  prepareCached(
    `DELETE FROM pco_person_emails WHERE org_id = ? AND person_id = ?`,
  ).run(orgId, personId);
  if (hashes.length === 0) return;
  const stmt = prepareCached(
    `INSERT OR IGNORE INTO pco_person_emails (org_id, person_id, email_hash)
     VALUES (?, ?, ?)`,
  );
  for (const h of hashes) stmt.run(orgId, personId, h);
}

/** Replace the stored phone hashes for one person (delete+insert, so a
 *  removed number drops out of the lookup). Mirrors replacePersonEmails. */
function replacePersonPhones(
  orgId: number,
  personId: string,
  hashes: string[],
): void {
  prepareCached(
    `DELETE FROM pco_person_phones WHERE org_id = ? AND person_id = ?`,
  ).run(orgId, personId);
  if (hashes.length === 0) return;
  const stmt = prepareCached(
    `INSERT OR IGNORE INTO pco_person_phones (org_id, person_id, phone_hash)
     VALUES (?, ?, ?)`,
  );
  for (const h of hashes) stmt.run(orgId, personId, h);
}

/** First names that mean "we didn't get a name", not a name. Only ever
 *  consulted when the last name has no letters either. */
const PLACEHOLDER_FIRST_NAMES = new Set([
  "guest", "test", "testing", "visitor", "unknown", "tbd", "none", "na", "n/a",
]);

const hasLetter = (s: string) => /\p{L}/u.test(s);

/** True when a row carries no real name at all — used at sync time and in the
 *  post-sync cleanup pass, which DELETES what this rejects.
 *
 *  This used to reject any field that didn't start with a letter, on the
 *  theory that admins prefix non-person rows to sort them to the top. That
 *  swept up two populations that belong here, and dropped 149 of PCO's 34,461
 *  records on the floor:
 *
 *    - **Organizations.** PCO files them as "_" plus the org name — "_" /
 *      "Way of Life Mission Church Inc". 102 of them, and they give, so PushPay
 *      donors had nothing to match against (see decideMatch in
 *      pushpay-import.ts, which matches organizations on the org name).
 *    - **People with no surname**, recorded as "-" — "Paw Pah" / "-". This is
 *      how the Karen and Burmese families are entered; they were invisible to
 *      attendance, care, groups and every audit.
 *
 *  One letterless field is a filing convention, not junk. Actual junk is a row
 *  with no letters anywhere ("-" / "-") or a numbered walk-in placeholder
 *  ("Guest" / "1", "Test" / "#!"). */
function looksLikeNonPerson(
  firstName: string | null,
  lastName: string | null,
): boolean {
  const f = firstName?.trim() ?? "";
  const l = lastName?.trim() ?? "";
  if (!hasLetter(f) && !hasLetter(l)) return true;
  if (!hasLetter(l) && PLACEHOLDER_FIRST_NAMES.has(f.toLowerCase())) return true;
  return false;
}

function formatAddress(a: unknown): string | null {
  const x = (a ?? {}) as Record<string, unknown>;
  const parts = [
    x.street_line_1 as string | undefined,
    x.street_line_2 as string | undefined,
    x.city as string | undefined,
    x.state as string | undefined,
    x.zip as string | undefined,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

function upsertPerson(
  orgId: number,
  p: {
    pcoId: string;
    encPii: string;
    firstName: string | null;
    lastName: string | null;
    nickname: string | null;
    legalFirstName: string | null;
    gender: string | null;
    membershipType: string | null;
    maritalStatus: string | null;
    status: string | null;
    pcoCreatedAt: string | null;
    pcoUpdatedAt: string | null;
    inactivatedAt: string | null;
  },
) {
  prepareCached(
    `INSERT INTO pco_people
      (org_id, pco_id, enc_pii, first_name, last_name, nickname, legal_first_name, gender, membership_type,
       marital_status, status, pco_created_at, pco_updated_at, inactivated_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, pco_id) DO UPDATE SET
       enc_pii = excluded.enc_pii,
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       nickname = excluded.nickname,
       legal_first_name = excluded.legal_first_name,
       gender = excluded.gender,
       membership_type = excluded.membership_type,
       marital_status = excluded.marital_status,
       status = excluded.status,
       pco_created_at = excluded.pco_created_at,
       pco_updated_at = excluded.pco_updated_at,
       inactivated_at = excluded.inactivated_at,
       synced_at = excluded.synced_at`,
  ).run(
    orgId,
    p.pcoId,
    p.encPii,
    p.firstName,
    p.lastName,
    p.nickname,
    p.legalFirstName,
    p.gender,
    p.membershipType,
    p.maritalStatus,
    p.status,
    p.pcoCreatedAt,
    p.pcoUpdatedAt,
    p.inactivatedAt,
  );
}

/** One-time (idempotent) backfill of the plaintext name columns for people
 *  synced before 0074 — only touches rows where first_name is still NULL, so
 *  it's ~free after the first pass. Called at the end of the people sync. */
function backfillPersonNames(orgId: number): void {
  const db = getDb();
  const rows = db
    .prepare(`SELECT pco_id, enc_pii FROM pco_people WHERE org_id = ? AND first_name IS NULL AND enc_pii IS NOT NULL`)
    .all(orgId) as Array<{ pco_id: string; enc_pii: string }>;
  if (rows.length === 0) return;
  const upd = db.prepare(`UPDATE pco_people SET first_name = ?, last_name = ? WHERE org_id = ? AND pco_id = ?`);
  const run = db.transaction(() => {
    for (const r of rows) {
      const pii = decryptJson<{ first_name?: string | null; last_name?: string | null }>(r.enc_pii);
      upd.run(pii?.first_name ?? null, pii?.last_name ?? null, orgId, r.pco_id);
    }
  });
  run();
}

// ─── Forms ──────────────────────────────────────────────────────────────

async function syncOneForm(
  client: PCOClient,
  orgId: number,
  formId: string,
  thresholdMonths: number,
): Promise<{
  fetched: boolean;
  formUpserted: boolean;
  fields: { fetched: number; upserted: number };
  subs: { fetched: number; upserted: number };
}> {
  const result = {
    fetched: false,
    formUpserted: false,
    fields: { fetched: 0, upserted: 0 },
    subs: { fetched: 0, upserted: 0 },
  };

  // 1) Form metadata
  let formData: PCOResource;
  try {
    const res = await client.get<PCOResource>(`/people/v2/forms/${formId}`);
    formData = Array.isArray(res.data) ? res.data[0] : res.data;
    result.fetched = true;
  } catch (e) {
    if (e instanceof PCOError && e.status === 404) {
      throw new Error(`Form ${formId} not found in PCO`);
    }
    throw e;
  }
  const fAttrs = (formData.attributes ?? {}) as Record<string, unknown>;
  upsertForm(orgId, {
    pcoId: formData.id,
    name: (fAttrs.name as string | undefined) ?? null,
    description: (fAttrs.description as string | undefined) ?? null,
    active: fAttrs.active === true ? 1 : 0,
  });
  result.formUpserted = true;

  // 2) Fields (cheap to re-pull)
  const fields = await client.getAll<PCOResource>(
    `/people/v2/forms/${formId}/fields?per_page=100`,
  );
  for (const fld of fields.data) {
    result.fields.fetched++;
    const a = (fld.attributes ?? {}) as Record<string, unknown>;
    upsertFormField(orgId, formId, {
      pcoId: fld.id,
      label: (a.label as string | undefined) ?? null,
      fieldType: (a.field_type as string | undefined) ?? null,
      position: (a.sequence as number | undefined) ?? null,
      required: a.required === true ? 1 : 0,
    });
    result.fields.upserted++;
  }

  // 3) Submissions, paginated, ordered by created_at, with combined cursor
  //    (max of stored cursor and "threshold months ago"). The submission
  //    payload is encrypted on disk because it contains PII (responses).
  const cursor = effectiveCursor(orgId, `form:${formId}:submissions`, thresholdMonths);
  const params = new URLSearchParams({ per_page: "100", order: "created_at" });
  if (cursor) params.set("where[created_at][gt]", cursor);
  let maxCreatedAt: string | null = cursor;

  for await (const { page } of client.paginate<PCOResource>(
    `/people/v2/forms/${formId}/form_submissions?${params.toString()}`,
  )) {
    const records = Array.isArray(page.data) ? page.data : [page.data];
    for (const sub of records) {
      result.subs.fetched++;
      const a = (sub.attributes ?? {}) as Record<string, unknown>;
      const rels = sub.relationships ?? {};
      const personRel = rels.person?.data;
      const personId = !Array.isArray(personRel) && personRel ? personRel.id : null;
      const created = (a.created_at as string | undefined) ?? null;
      if (created && (!maxCreatedAt || created > maxCreatedAt)) maxCreatedAt = created;

      // Encrypt the form payload — it contains member-submitted PII.
      const encPayload = encryptJson({
        attributes: a,
        relationships: rels,
      });

      upsertFormSubmission(orgId, formId, {
        pcoId: sub.id,
        personId,
        verified: a.verified === true ? 1 : 0,
        requiresVerification: a.requires_verification === true ? 1 : 0,
        pcoCreatedAt: created,
        encData: encPayload,
      });
      result.subs.upserted++;
    }
  }

  writeCursor(orgId, `form:${formId}:submissions`, maxCreatedAt);
  return result;
}

function upsertForm(
  orgId: number,
  f: {
    pcoId: string;
    name: string | null;
    description: string | null;
    active: number;
  },
) {
  prepareCached(
    `INSERT INTO pco_forms (org_id, pco_id, name, description, active, synced_at)
     VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, pco_id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       active = excluded.active,
       synced_at = excluded.synced_at`,
  ).run(orgId, f.pcoId, f.name, f.description, f.active);
}

function upsertFormField(
  orgId: number,
  formId: string,
  f: {
    pcoId: string;
    label: string | null;
    fieldType: string | null;
    position: number | null;
    required: number;
  },
) {
  prepareCached(
    `INSERT INTO pco_form_fields (org_id, form_id, pco_id, label, field_type, position, required, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, form_id, pco_id) DO UPDATE SET
       label = excluded.label,
       field_type = excluded.field_type,
       position = excluded.position,
       required = excluded.required,
       synced_at = excluded.synced_at`,
  ).run(orgId, formId, f.pcoId, f.label, f.fieldType, f.position, f.required);
}

function upsertFormSubmission(
  orgId: number,
  formId: string,
  s: {
    pcoId: string;
    personId: string | null;
    verified: number;
    requiresVerification: number;
    pcoCreatedAt: string | null;
    encData: string;
  },
) {
  prepareCached(
    `INSERT INTO pco_form_submissions
      (org_id, form_id, pco_id, person_id, verified, requires_verification, pco_created_at, enc_data, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, form_id, pco_id) DO UPDATE SET
       person_id = excluded.person_id,
       verified = excluded.verified,
       requires_verification = excluded.requires_verification,
       pco_created_at = excluded.pco_created_at,
       enc_data = excluded.enc_data,
       synced_at = excluded.synced_at`,
  ).run(
    orgId,
    formId,
    s.pcoId,
    s.personId,
    s.verified,
    s.requiresVerification,
    s.pcoCreatedAt,
    s.encData,
  );
}

// ─── Cursors ────────────────────────────────────────────────────────────

function readCursor(orgId: number, resource: string): string | null {
  const row = prepareCached(
    "SELECT last_updated_at FROM pco_sync_cursor WHERE org_id = ? AND resource = ?",
  ).get(orgId, resource) as { last_updated_at: string | null } | undefined;
  return row?.last_updated_at ?? null;
}

function writeCursor(orgId: number, resource: string, updatedAt: string | null) {
  if (!updatedAt) return;
  prepareCached(
    `INSERT INTO pco_sync_cursor (org_id, resource, last_updated_at, last_synced_at)
     VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, resource) DO UPDATE SET
       last_updated_at = excluded.last_updated_at,
       last_synced_at = excluded.last_synced_at`,
  ).run(orgId, resource, updatedAt);
}

/** Clear a resource's sync cursor so the next sync re-fetches EVERYTHING for
 *  it (a full / deep sync). Resetting "people" re-pulls every person — the way
 *  to backfill phone numbers for the whole roster, since phones only arrive
 *  from the PCO API per person. */
export function resetSyncCursor(orgId: number, resource = "people"): void {
  getDb().prepare(`DELETE FROM pco_sync_cursor WHERE org_id = ? AND resource = ?`).run(orgId, resource);
}

/** Returns the `where[updated_at][gt]` cutoff. We always want at LEAST
 *  thresholdMonths of look-back, even if the cursor is more recent —
 *  catches PCO edits that were retroactively dated.
 *
 *  Cutoff = the EARLIER of (stored cursor, now − threshold):
 *    - Recent cursor (e.g. 1 day ago) + threshold 3mo → look back 3mo.
 *    - Old cursor (e.g. 9 months ago) + threshold 3mo → look back 9mo.
 *    - First sync (no cursor) → null = pull everything.
 */
function effectiveCursor(
  orgId: number,
  resource: string,
  thresholdMonths: number,
): string | null {
  const stored = readCursor(orgId, resource);
  if (!stored) return null;
  const lookbackMs = thresholdMonths * 30 * 24 * 60 * 60 * 1000;
  const lookbackIso = new Date(Date.now() - lookbackMs).toISOString();
  return stored < lookbackIso ? stored : lookbackIso;
}

// ─── Activity computation ──────────────────────────────────────────────

/** Sets last_form_submission_at = max(pco_created_at) per person across
 *  pco_form_submissions. Used by the "Active" classification — someone
 *  with a recent form submission is Active even if their PCO record
 *  hasn't been touched in a while. */
function refreshLastActivity(orgId: number) {
  const db = getDb();
  db.prepare(
    `UPDATE pco_people
       SET last_form_submission_at = (
         SELECT MAX(pco_created_at)
           FROM pco_form_submissions
           WHERE pco_form_submissions.org_id = pco_people.org_id
             AND pco_form_submissions.person_id = pco_people.pco_id
       )
     WHERE org_id = ?`,
  ).run(orgId);
}

/** A junk-named person with any of these is kept, not deleted: they are typed
 *  in by people (care rosters and notes, "I know them" marks, shepherd links,
 *  whole-org access) or attribute gifts to them (PushPay: a manual match is a
 *  human decision, and a giver is not junk). No sync can bring these back.
 *  (The first Ministry Impact Reports' leads and teams were here too, until
 *  0096 dropped those empty tables.) The first four tables also carry
 *  foreign keys to pco_people ON DELETE RESTRICT (0094), so deleting such a
 *  person would fail the whole pass rather than lose them. */
const HAS_OWNED_DATA_SQL = `SELECT
     EXISTS (SELECT 1 FROM care_assignments WHERE org_id = @org AND person_id = @id)
  OR EXISTS (SELECT 1 FROM care_assignments WHERE org_id = @org AND shepherd_person_id = @id)
  OR EXISTS (SELECT 1 FROM shepherd_known_people WHERE org_id = @org AND person_id = @id)
  OR EXISTS (SELECT 1 FROM shepherd_known_people WHERE org_id = @org AND shepherd_person_id = @id)
  OR EXISTS (SELECT 1 FROM shepherd_assignments WHERE org_id = @org AND shepherd_person_id = @id)
  OR EXISTS (SELECT 1 FROM shepherd_assignments WHERE org_id = @org AND target_kind = 'person' AND target_id = @id)
  OR EXISTS (SELECT 1 FROM org_wide_access WHERE org_id = @org AND person_id = @id)
  OR EXISTS (SELECT 1 FROM pushpay_donors WHERE org_id = @org AND person_id = @id)
  OR EXISTS (SELECT 1 FROM pushpay_transactions WHERE org_id = @org AND person_id = @id) AS owned`;

/** The person's own rows mirrored from PCO, the per-person rows computed from
 *  them (activity snapshot, geocode, drive time, road network, retention), and
 *  the duplicate-name pairs naming them. A deleted person's rows go with them
 *  in the same transaction, so they can never outlive the person. All but
 *  duplicate_pairs (7k rows) are indexed on (org_id, person_id).
 *
 *  Rows that only point AT the person from someone else's record are left
 *  alone: pco_check_ins.checked_in_by_id / checked_out_by_id,
 *  pco_households.primary_contact_id, pco_calendar_events.owner_id. They
 *  belong to that other record, and the next sync rewrites them from PCO.
 *
 *  There is deliberately no sweep of rows whose person is already missing.
 *  On 2026-09-21 ~567 mirror rows named people absent from pco_people, and
 *  they were not junk: 146 real people were missing because the 2026-09-03
 *  filter fix never re-fetched them (a cursor reset restored them). Sweeping
 *  "orphans" would have deleted real people's history, e.g. 174 check-ins of
 *  "Lah Ler Paw" / "-". Only a person this filter deletes takes rows along. */
const PERSON_ROW_DELETES = [
  "DELETE FROM pco_check_ins WHERE org_id = ? AND person_id = ?",
  "DELETE FROM pco_event_attendances WHERE org_id = ? AND person_id = ?",
  "DELETE FROM pco_form_submissions WHERE org_id = ? AND person_id = ?",
  "DELETE FROM pco_group_applications WHERE org_id = ? AND person_id = ?",
  "DELETE FROM pco_group_memberships WHERE org_id = ? AND person_id = ?",
  "DELETE FROM pco_household_memberships WHERE org_id = ? AND person_id = ?",
  "DELETE FROM pco_list_memberships WHERE org_id = ? AND person_id = ?",
  "DELETE FROM pco_person_emails WHERE org_id = ? AND person_id = ?",
  "DELETE FROM pco_person_fields WHERE org_id = ? AND person_id = ?",
  "DELETE FROM pco_person_phones WHERE org_id = ? AND person_id = ?",
  "DELETE FROM pco_plan_people WHERE org_id = ? AND person_id = ?",
  "DELETE FROM pco_registration_attendees WHERE org_id = ? AND person_id = ?",
  "DELETE FROM pco_team_memberships WHERE org_id = ? AND person_id = ?",
  "DELETE FROM person_activity WHERE org_id = ? AND person_id = ?",
  "DELETE FROM person_drive_from_church WHERE org_id = ? AND person_id = ?",
  "DELETE FROM person_geo WHERE org_id = ? AND person_id = ?",
  "DELETE FROM road_network_routed_people WHERE org_id = ? AND person_id = ?",
  "DELETE FROM retention_engagement WHERE org_id = ? AND person_id = ?",
  "DELETE FROM duplicate_pairs WHERE org_id = ? AND ? IN (person_a, person_b)",
] as const;

/** Refresh the is_minor + birth_year denormalized columns by decrypting
 *  each person's birthdate from enc_pii. is_minor gates the kids-checked-
 *  in-to-shepherded-event rule; birth_year drives the demographic charts.
 *  Also deletes rows that carry no real name at all (see
 *  looksLikeNonPerson) — they clutter every list — together with their rows
 *  in PERSON_ROW_DELETES. Organizations ("_" / "Acme LLC") and people with no
 *  surname ("Paw Pah" / "-") are NOT that, and are kept. So is anyone with
 *  data in HAS_OWNED_DATA_SQL; the return value is the sync warning naming
 *  them, or null. Exported for the write-path tests. */
export function refreshIsMinor(orgId: number): string | null {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT pco_id, first_name, last_name, enc_pii FROM pco_people WHERE org_id = ?`,
    )
    .all(orgId) as Array<{ pco_id: string; first_name: string | null; last_name: string | null; enc_pii: string | null }>;
  const now = Date.now();
  const update = db.prepare(
    `UPDATE pco_people SET is_minor = ?, birth_year = ? WHERE org_id = ? AND pco_id = ?`,
  );
  const del = db.prepare(`DELETE FROM pco_people WHERE org_id = ? AND pco_id = ?`);
  const hasOwned = db.prepare(HAS_OWNED_DATA_SQL).pluck();
  const delRows = PERSON_ROW_DELETES.map((sql) => db.prepare(sql));
  // What relinkContacts (constant-contact-sync.ts) would set once the
  // person's email hashes are gone: another person with that address, or none.
  const relinkCc = db.prepare(
    `UPDATE constant_contact_contacts
        SET person_id = (SELECT pe.person_id FROM pco_person_emails pe WHERE pe.org_id = constant_contact_contacts.org_id AND pe.email_hash = constant_contact_contacts.email_hash LIMIT 1)
      WHERE org_id = ? AND person_id = ?`,
  );
  const kept: string[] = [];
  const tx = db.transaction(
    (
      items: Array<{
        pcoId: string;
        minor: number;
        birthYear: number | null;
        junk: boolean;
      }>,
    ) => {
      for (const it of items) {
        if (it.junk && hasOwned.get({ org: orgId, id: it.pcoId }) === 1) {
          kept.push(it.pcoId);
        } else if (it.junk) {
          for (const d of delRows) d.run(orgId, it.pcoId);
          relinkCc.run(orgId, it.pcoId);
          del.run(orgId, it.pcoId);
          continue;
        }
        update.run(it.minor, it.birthYear, orgId, it.pcoId);
      }
    },
  );
  const batch: Array<{
    pcoId: string;
    minor: number;
    birthYear: number | null;
    junk: boolean;
  }> = [];
  for (const r of rows) {
    const pii = r.enc_pii
      ? decryptJson<{
          birthdate?: string | null;
          first_name?: string | null;
          last_name?: string | null;
        }>(r.enc_pii)
      : null;
    // Names live in the plaintext columns; enc_pii is only a fallback for
    // rows predating that move. Reading enc_pii alone would see no name at
    // all for a plaintext-only row and DELETE a real person.
    const junk = looksLikeNonPerson(
      r.first_name ?? pii?.first_name ?? null,
      r.last_name ?? pii?.last_name ?? null,
    );
    const b = pii?.birthdate ?? null;
    let birthYear: number | null = null;
    if (b) {
      const d = new Date(b);
      if (!isNaN(d.getTime())) birthYear = d.getUTCFullYear();
    }
    const minor = b && isUnder18(b, now) ? 1 : 0;
    batch.push({ pcoId: r.pco_id, minor, birthYear, junk });
  }
  // IMMEDIATE: the owned-data check reads before the deletes write, and a
  // deferred transaction would fail at once (no busy wait) if another
  // connection wrote in between.
  tx.immediate(batch);

  // Overlay pass: flip a no-birthday person to is_minor=1 ONLY when
  // they have a DEPENDENT check-in (done BY SOMEONE ELSE — a parent /
  // guardian) to an event the admin has explicitly marked as a KIDS
  // program. The default for an unknown birthday is ADULT; being
  // checked into an uncategorized event is NOT enough — adults get
  // checked into greeter stations, serving sign-ins, etc. by others
  // all the time. With no kid events configured, nothing flips
  // (everyone unknown stays adult). The birth_year IS NULL guard
  // keeps PCO-known ages safe.
  const kidEvents = getKidCheckinEvents(orgId);
  if (kidEvents.length > 0) {
    const placeholders = kidEvents.map(() => "?").join(",");
    db.prepare(
      `UPDATE pco_people
          SET is_minor = 1
        WHERE org_id = ?
          AND birth_year IS NULL
          AND pco_id IN (
            SELECT DISTINCT person_id
              FROM pco_check_ins
             WHERE org_id = ?
               AND person_id IS NOT NULL
               AND checked_in_by_id IS NOT NULL
               AND checked_in_by_id != person_id
               AND event_id IN (${placeholders})
          )`,
    ).run(orgId, orgId, ...kidEvents);
  }

  // Second overlay: the ADULT-event list. Runs AFTER the kid-event
  // overlay so the adult signal wins for ambiguous people (e.g. someone
  // who's checked into both an Office Visitors station AND a kids event
  // as a volunteer). Still gated on birth_year IS NULL.
  const adultEvents = getAdultCheckinEvents(orgId);
  if (adultEvents.length > 0) {
    const placeholders = adultEvents.map(() => "?").join(",");
    db.prepare(
      `UPDATE pco_people
          SET is_minor = 0
        WHERE org_id = ?
          AND birth_year IS NULL
          AND pco_id IN (
            SELECT DISTINCT person_id
              FROM pco_check_ins
             WHERE org_id = ?
               AND person_id IS NOT NULL
               AND event_id IN (${placeholders})
          )`,
    ).run(orgId, orgId, ...adultEvents);
  }

  if (kept.length === 0) return null;
  const ids = kept.slice(0, 5).join(", ") + (kept.length > 5 ? ", …" : "");
  return (
    `Name filter kept ${kept.length} placeholder-named ${kept.length === 1 ? "person" : "people"} ` +
    `(PCO ${ids}) because care, shepherd, report or giving records name them. ` +
    `If they are real, fix the name in PCO; if not, remove those records and the next sync deletes them.`
  );
}

function isUnder18(birthdateIso: string, nowMs: number): boolean {
  const dob = new Date(birthdateIso);
  if (isNaN(dob.getTime())) return false;
  const now = new Date(nowMs);
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
  const dayDiff = now.getUTCDate() - dob.getUTCDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age--;
  return age < 18;
}

// ─── Run-row helpers ───────────────────────────────────────────────────

function insertSyncRunStart(orgId: number, trigger: string): number {
  const result = getDb()
    .prepare(
      `INSERT INTO pco_sync_runs (org_id, started_at, trigger, status, changes)
       VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?, 'running', 0)`,
    )
    .run(orgId, trigger);
  return Number(result.lastInsertRowid);
}

function finishSyncRun(
  runId: number,
  status: "ok" | "error",
  changes: number,
  warning: string | undefined,
  details: SyncDetails,
) {
  getDb()
    .prepare(
      `UPDATE pco_sync_runs SET
         finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
         status = ?, changes = ?, warning = ?, details = ?
       WHERE id = ?`,
    )
    .run(status, changes, warning ?? null, JSON.stringify(details), runId);
}

function appendWarning(prev: string | undefined, msg: string): string {
  return prev ? `${prev} | ${msg}` : msg;
}

// ─── Read API ──────────────────────────────────────────────────────────

export interface SyncedDataCounts {
  people: number;
  households: number;
  householdMemberships: number;
  lists: number;
  listMemberships: number;
  forms: number;
  formFields: number;
  formSubmissions: number;
  groups: number;
  groupMemberships: number;
  groupApplications: number;
  groupEvents: number;
  checkinEvents: number;
  checkinLocations: number;
  checkIns: number;
  serviceTypes: number;
  teams: number;
  teamPositions: number;
  teamMemberships: number;
  plans: number;
  planPeople: number;
}

export function getSyncedCounts(orgId: number): SyncedDataCounts {
  const db = getDb();
  const one = (sql: string) =>
    (db.prepare(sql).get(orgId) as { n: number }).n;
  return {
    people: one("SELECT COUNT(*) AS n FROM pco_people WHERE org_id = ?"),
    households: one("SELECT COUNT(*) AS n FROM pco_households WHERE org_id = ?"),
    householdMemberships: one(
      "SELECT COUNT(*) AS n FROM pco_household_memberships WHERE org_id = ?",
    ),
    lists: one("SELECT COUNT(*) AS n FROM pco_lists WHERE org_id = ?"),
    listMemberships: one(
      "SELECT COUNT(*) AS n FROM pco_list_memberships WHERE org_id = ?",
    ),
    forms: one("SELECT COUNT(*) AS n FROM pco_forms WHERE org_id = ?"),
    formFields: one("SELECT COUNT(*) AS n FROM pco_form_fields WHERE org_id = ?"),
    formSubmissions: one(
      "SELECT COUNT(*) AS n FROM pco_form_submissions WHERE org_id = ?",
    ),
    groups: one("SELECT COUNT(*) AS n FROM pco_groups WHERE org_id = ?"),
    groupMemberships: one(
      "SELECT COUNT(*) AS n FROM pco_group_memberships WHERE org_id = ?",
    ),
    groupApplications: one(
      "SELECT COUNT(*) AS n FROM pco_group_applications WHERE org_id = ?",
    ),
    groupEvents: one(
      "SELECT COUNT(*) AS n FROM pco_group_events WHERE org_id = ?",
    ),
    checkinEvents: one(
      "SELECT COUNT(*) AS n FROM pco_check_in_events WHERE org_id = ?",
    ),
    checkinLocations: one(
      "SELECT COUNT(*) AS n FROM pco_check_in_locations WHERE org_id = ?",
    ),
    checkIns: one(
      "SELECT COUNT(*) AS n FROM pco_check_ins WHERE org_id = ?",
    ),
    serviceTypes: one(
      "SELECT COUNT(*) AS n FROM pco_service_types WHERE org_id = ?",
    ),
    teams: one("SELECT COUNT(*) AS n FROM pco_teams WHERE org_id = ?"),
    teamPositions: one(
      "SELECT COUNT(*) AS n FROM pco_team_positions WHERE org_id = ?",
    ),
    teamMemberships: one(
      "SELECT COUNT(*) AS n FROM pco_team_memberships WHERE org_id = ?",
    ),
    plans: one("SELECT COUNT(*) AS n FROM pco_plans WHERE org_id = ?"),
    planPeople: one(
      "SELECT COUNT(*) AS n FROM pco_plan_people WHERE org_id = ?",
    ),
  };
}
// ─── Person custom fields ───────────────────────────────────────────────

/** The custom fields worth storing, by their PCO name. Deliberately an
 *  allowlist, not "every date field": the Membership and Assimilation tab also
 *  holds Date of Death and Date Widowed, and a table nobody asked for is a
 *  liability. Add a name here when something in the app needs it. */
const PERSON_FIELD_ALLOWLIST = new Set(["Baptism"]);

/** PCO returns a date field as the admin typed it — "06/29/2003" — which sorts
 *  and groups as nonsense. Normalize once, here, so every query downstream can
 *  just use substr(value_on,1,4). Returns null for anything unparseable
 *  rather than guessing. */
function toIsoDate(raw: string | null): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (m) {
    const mo = Number(m[1]);
    const d = Number(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${m[3]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

/** Sync the allowlisted person custom fields. One request per field definition
 *  page — Baptism alone is ~1,000 rows, ten pages. */
async function syncPersonFields(
  client: PCOClient,
  orgId: number,
): Promise<{ fetched: number; upserted: number }> {
  const out = { fetched: 0, upserted: 0 };
  const defs = await client.getAll<PCOResource>(
    "/people/v2/field_definitions?per_page=100",
  );
  const wanted = (defs.data ?? []).filter((d) => {
    const a = (d.attributes ?? {}) as Record<string, unknown>;
    return (
      !a.deleted_at &&
      typeof a.name === "string" &&
      PERSON_FIELD_ALLOWLIST.has(a.name as string)
    );
  });
  if (!wanted.length) return out;

  const db = getDb();
  const ins = db.prepare(
    `INSERT INTO pco_person_fields
      (org_id, person_id, field_id, field_name, value, value_on, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, person_id, field_id) DO UPDATE SET
       field_name = excluded.field_name,
       value = excluded.value,
       value_on = excluded.value_on,
       synced_at = excluded.synced_at`,
  );

  for (const def of wanted) {
    const name = ((def.attributes ?? {}) as Record<string, unknown>).name as string;
    const rows: Array<[string, string, string, string | null, string | null]> = [];
    for await (const { page } of client.paginate<PCOResource>(
      `/people/v2/field_data?where[field_definition_id]=${def.id}&per_page=100`,
    )) {
      const arr = Array.isArray(page.data) ? page.data : [page.data];
      for (const fd of arr) {
        out.fetched++;
        const a = (fd.attributes ?? {}) as Record<string, unknown>;
        // The owning person is the "customizable" relationship, not "person".
        const rel = fd.relationships?.customizable?.data;
        const personId = !Array.isArray(rel) && rel ? rel.id : null;
        if (!personId) continue;
        const value = typeof a.value === "string" ? a.value : a.value == null ? null : String(a.value);
        rows.push([personId, def.id, name, value, toIsoDate(value)]);
      }
    }
    // A field cleared in PCO leaves no field_data row, so replace the whole
    // set for this definition rather than upserting over a stale value.
    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM pco_person_fields WHERE org_id = ? AND field_id = ?`).run(orgId, def.id);
      for (const r of rows) ins.run(orgId, r[0], r[1], r[2], r[3], r[4]);
    });
    tx();
    out.upserted += rows.length;
  }
  return out;
}
