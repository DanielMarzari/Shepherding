import "server-only";
import { encryptJson } from "./encryption";
import { getDb } from "./db";
import { getDecryptedCreds, getSyncEntities, getSyncSettings } from "./pco";
import { PCOClient, PCOError, type PCOResource } from "./pco-client";

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
  cutoff: string | null;
  durationMs: number;
  startedAt: string;
}

export async function runSync(
  orgId: number,
  trigger: "manual" | "auto" = "manual",
): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const details: SyncDetails = {
    people: { fetched: 0, upserted: 0 },
    forms: { fetched: 0, upserted: 0 },
    formFields: { fetched: 0, upserted: 0 },
    formSubmissions: { fetched: 0, upserted: 0 },
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

    const changes =
      details.people.upserted +
      details.forms.upserted +
      details.formFields.upserted +
      details.formSubmissions.upserted;

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
}

export function getSyncedCounts(orgId: number): SyncedDataCounts {
  const db = getDb();
  const r1 = db
    .prepare("SELECT COUNT(*) AS n FROM pco_people WHERE org_id = ?")
    .get(orgId) as { n: number };
  const r2 = db
    .prepare("SELECT COUNT(*) AS n FROM pco_forms WHERE org_id = ?")
    .get(orgId) as { n: number };
  const r3 = db
    .prepare("SELECT COUNT(*) AS n FROM pco_form_fields WHERE org_id = ?")
    .get(orgId) as { n: number };
  const r4 = db
    .prepare("SELECT COUNT(*) AS n FROM pco_form_submissions WHERE org_id = ?")
    .get(orgId) as { n: number };
  return { people: r1.n, forms: r2.n, formFields: r3.n, formSubmissions: r4.n };
}