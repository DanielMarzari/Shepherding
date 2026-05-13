import "server-only";
import { decryptJson, encryptJson } from "./encryption";
import { getDb } from "./db";
import { getDecryptedCreds, getSyncEntities, getSyncSettings } from "./pco";
import { PCOClient, PCOError, type PCOResource } from "./pco-client";
import { refreshLastCheckIn, syncCheckinsAll } from "./pco-sync-checkins";
import { refreshLastAttended, syncGroupsAll } from "./pco-sync-groups";
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
 *  UI doesn't show "running" forever. */
function cleanupStaleSyncRuns(orgId: number) {
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
    refreshIsMinor(orgId);

    const changes =
      details.people.upserted +
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
      details.planPeople.upserted;

    details.durationMs = Date.now() - startedMs;
    finishSyncRun(runId, "ok", changes, warning, details);
    return { ok: true, changes, details, warning };
  } catch (e) {
    details.durationMs = Date.now() - startedMs;
    const msg = e instanceof Error ? e.message : "Unknown error";
    finishSyncRun(runId, "error", 0, msg, details);
    return { ok: false, changes: 0, details, error: msg };
  }
}

// ─── People ────────────────────────────────────────────────────────────

async function syncPeople(
  client: PCOClient,
  orgId: number,
  cutoff: string | null,
): Promise<{ fetched: number; upserted: number; maxUpdatedAt: string | null }> {
  const params = new URLSearchParams({
    include: "addresses,marital_status",
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
    for (const inc of included) {
      if (inc.type === "Address") addressById.set(inc.id, inc);
      if (inc.type === "MaritalStatus") maritalById.set(inc.id, inc);
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

      const pii = {
        first_name: (attrs.first_name as string | undefined) ?? null,
        last_name: (attrs.last_name as string | undefined) ?? null,
        birthdate: (attrs.birthdate as string | undefined) ?? null,
        address: addressStr,
      };

      upsertPerson(orgId, {
        pcoId: p.id,
        encPii: encryptJson(pii),
        gender: (attrs.gender as string | undefined) ?? null,
        membershipType: (attrs.membership as string | undefined) ?? null,
        maritalStatus: maritalValue,
        status: (attrs.status as string | undefined) ?? null,
        pcoCreatedAt: (attrs.created_at as string | undefined) ?? null,
        pcoUpdatedAt: updatedAt,
        inactivatedAt: (attrs.inactivated_at as string | undefined) ?? null,
      });
      upserted++;
    }
  }

  return { fetched, upserted, maxUpdatedAt };
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
    gender: string | null;
    membershipType: string | null;
    maritalStatus: string | null;
    status: string | null;
    pcoCreatedAt: string | null;
    pcoUpdatedAt: string | null;
    inactivatedAt: string | null;
  },
) {
  getDb()
    .prepare(
      `INSERT INTO pco_people
        (org_id, pco_id, enc_pii, gender, membership_type, marital_status,
         status, pco_created_at, pco_updated_at, inactivated_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(org_id, pco_id) DO UPDATE SET
         enc_pii = excluded.enc_pii,
         gender = excluded.gender,
         membership_type = excluded.membership_type,
         marital_status = excluded.marital_status,
         status = excluded.status,
         pco_created_at = excluded.pco_created_at,
         pco_updated_at = excluded.pco_updated_at,
         inactivated_at = excluded.inactivated_at,
         synced_at = excluded.synced_at`,
    )
    .run(
      orgId,
      p.pcoId,
      p.encPii,
      p.gender,
      p.membershipType,
      p.maritalStatus,
      p.status,
      p.pcoCreatedAt,
      p.pcoUpdatedAt,
      p.inactivatedAt,
    );
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
  getDb()
    .prepare(
      `INSERT INTO pco_forms (org_id, pco_id, name, description, active, synced_at)
       VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(org_id, pco_id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         active = excluded.active,
         synced_at = excluded.synced_at`,
    )
    .run(orgId, f.pcoId, f.name, f.description, f.active);
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
  getDb()
    .prepare(
      `INSERT INTO pco_form_fields (org_id, form_id, pco_id, label, field_type, position, required, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(org_id, form_id, pco_id) DO UPDATE SET
         label = excluded.label,
         field_type = excluded.field_type,
         position = excluded.position,
         required = excluded.required,
         synced_at = excluded.synced_at`,
    )
    .run(orgId, formId, f.pcoId, f.label, f.fieldType, f.position, f.required);
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
  getDb()
    .prepare(
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
    )
    .run(
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
  const row = getDb()
    .prepare(
      "SELECT last_updated_at FROM pco_sync_cursor WHERE org_id = ? AND resource = ?",
    )
    .get(orgId, resource) as { last_updated_at: string | null } | undefined;
  return row?.last_updated_at ?? null;
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

/** Refresh the is_minor + birth_year denormalized columns by decrypting
 *  each person's birthdate from enc_pii. is_minor gates the kids-checked-
 *  in-to-shepherded-event rule; birth_year drives the demographic charts
 *  on /people, /groups, and /teams (so age buckets can be computed in
 *  SQL without a per-page decrypt pass). */
function refreshIsMinor(orgId: number) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT pco_id, enc_pii FROM pco_people WHERE org_id = ?`,
    )
    .all(orgId) as Array<{ pco_id: string; enc_pii: string | null }>;
  const now = Date.now();
  const update = db.prepare(
    `UPDATE pco_people SET is_minor = ?, birth_year = ? WHERE org_id = ? AND pco_id = ?`,
  );
  const tx = db.transaction(
    (items: Array<{ pcoId: string; minor: number; birthYear: number | null }>) => {
      for (const it of items) update.run(it.minor, it.birthYear, orgId, it.pcoId);
    },
  );
  const batch: Array<{
    pcoId: string;
    minor: number;
    birthYear: number | null;
  }> = [];
  for (const r of rows) {
    const pii = r.enc_pii
      ? decryptJson<{ birthdate?: string | null }>(r.enc_pii)
      : null;
    const b = pii?.birthdate ?? null;
    let birthYear: number | null = null;
    if (b) {
      const d = new Date(b);
      if (!isNaN(d.getTime())) birthYear = d.getUTCFullYear();
    }
    const minor = b && isUnder18(b, now) ? 1 : 0;
    batch.push({ pcoId: r.pco_id, minor, birthYear });
  }
  tx(batch);
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
      "SELECT COUNT(*) AS n FROM pco_checkin_events WHERE org_id = ?",
    ),
    checkinLocations: one(
      "SELECT COUNT(*) AS n FROM pco_checkin_locations WHERE org_id = ?",
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