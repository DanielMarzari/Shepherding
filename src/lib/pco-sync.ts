import "server-only";
import { getDb } from "./db";
import { getDecryptedCreds, getSyncEntities } from "./pco";
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
  durationMs: number;
  startedAt: string;
}

export async function runSync(orgId: number, trigger: "manual" | "auto" = "manual"): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const details: SyncDetails = {
    people: { fetched: 0, upserted: 0 },
    forms: { fetched: 0, upserted: 0 },
    formFields: { fetched: 0, upserted: 0 },
    formSubmissions: { fetched: 0, upserted: 0 },
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
  const enabled = getSyncEntities(orgId);
  const client = new PCOClient({ appId: creds.appId, secret: creds.secret });

  // Track sync run as in-progress (not strictly required, but useful).
  const runId = insertSyncRunStart(orgId, trigger);

  let warning: string | undefined;
  try {
    // ── People (always synced; "people" toggle is required) ──────────────
    if (enabled.people !== false) {
      const cursor = readCursor(orgId, "people");
      const peopleCount = await syncPeople(client, orgId, cursor);
      details.people.fetched = peopleCount.fetched;
      details.people.upserted = peopleCount.upserted;
      writeCursor(orgId, "people", peopleCount.maxUpdatedAt);
    }

    // ── Forms (only if "forms" entity is enabled) ─────────────────────────
    if (enabled.forms) {
      for (const formId of TRACKED_FORM_IDS) {
        try {
          const form = await syncOneForm(client, orgId, formId);
          if (form.formUpserted) details.forms.upserted += 1;
          if (form.fetched) details.forms.fetched += 1;
          details.formFields.fetched += form.fields.fetched;
          details.formFields.upserted += form.fields.upserted;
          details.formSubmissions.fetched += form.subs.fetched;
          details.formSubmissions.upserted += form.subs.upserted;
        } catch (e) {
          warning = appendWarning(
            warning,
            `Form ${formId}: ${e instanceof Error ? e.message : "failed"}`,
          );
        }
      }
    }

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

// ─── People ─────────────────────────────────────────────────────────────

async function syncPeople(
  client: PCOClient,
  orgId: number,
  cursor: string | null,
): Promise<{ fetched: number; upserted: number; maxUpdatedAt: string | null }> {
  // Pull in updated_at order so we can incrementally checkpoint.
  // include addresses + marital_status to flesh out person rows.
  const params = new URLSearchParams({
    include: "addresses,marital_status",
    per_page: "100",
    order: "updated_at",
  });
  if (cursor) {
    // PCO supports filtering with where[updated_at][gt]=...
    params.set("where[updated_at][gt]", cursor);
  }
  const path = `/people/v2/people?${params.toString()}`;

  let fetched = 0;
  let upserted = 0;
  let maxUpdatedAt: string | null = cursor;

  // Address lookup table built per page from `included`.
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
      const primaryAddr = addrIds
        .map((id) => addressById.get(id))
        .find((a) => a && (a.attributes as Record<string, unknown>)?.primary === true)
        ?? addrIds.map((id) => addressById.get(id)).find(Boolean);
      const addressStr = primaryAddr ? formatAddress(primaryAddr.attributes) : null;

      const maritalRel = rels.marital_status?.data;
      const maritalId = !Array.isArray(maritalRel) && maritalRel ? maritalRel.id : null;
      const marital = maritalId ? maritalById.get(maritalId) : null;
      const maritalValue = marital
        ? ((marital.attributes as Record<string, unknown> | undefined)?.value as string | undefined) ?? null
        : null;

      const updatedAt = (attrs.updated_at as string | undefined) ?? null;
      if (updatedAt && (!maxUpdatedAt || updatedAt > maxUpdatedAt)) {
        maxUpdatedAt = updatedAt;
      }

      const birthdate = (attrs.birthdate as string | undefined) ?? null;
      const age = birthdate ? computeAge(birthdate) : null;

      upsertPerson(orgId, {
        pcoId: p.id,
        firstName: (attrs.first_name as string | undefined) ?? null,
        lastName: (attrs.last_name as string | undefined) ?? null,
        gender: (attrs.gender as string | undefined) ?? null,
        birthdate,
        age,
        address: addressStr,
        membershipType: (attrs.membership as string | undefined) ?? null,
        maritalStatus: maritalValue,
        status: (attrs.status as string | undefined) ?? null,
        pcoCreatedAt: (attrs.created_at as string | undefined) ?? null,
        pcoUpdatedAt: updatedAt,
        inactivatedAt: (attrs.inactivated_at as string | undefined) ?? null,
        rawJson: JSON.stringify({ data: p, addresses: addrIds.map((id) => addressById.get(id)).filter(Boolean) }),
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

function computeAge(birthdate: string): number | null {
  const d = new Date(birthdate);
  if (Number.isNaN(d.valueOf())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

function upsertPerson(
  orgId: number,
  p: {
    pcoId: string;
    firstName: string | null;
    lastName: string | null;
    gender: string | null;
    birthdate: string | null;
    age: number | null;
    address: string | null;
    membershipType: string | null;
    maritalStatus: string | null;
    status: string | null;
    pcoCreatedAt: string | null;
    pcoUpdatedAt: string | null;
    inactivatedAt: string | null;
    rawJson: string;
  },
) {
  getDb()
    .prepare(
      `INSERT INTO pco_people
        (org_id, pco_id, first_name, last_name, gender, birthdate, age, address,
         membership_type, marital_status, status, pco_created_at, pco_updated_at,
         inactivated_at, raw_json, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(org_id, pco_id) DO UPDATE SET
         first_name = excluded.first_name,
         last_name = excluded.last_name,
         gender = excluded.gender,
         birthdate = excluded.birthdate,
         age = excluded.age,
         address = excluded.address,
         membership_type = excluded.membership_type,
         marital_status = excluded.marital_status,
         status = excluded.status,
         pco_created_at = excluded.pco_created_at,
         pco_updated_at = excluded.pco_updated_at,
         inactivated_at = excluded.inactivated_at,
         raw_json = excluded.raw_json,
         synced_at = excluded.synced_at`,
    )
    .run(
      orgId,
      p.pcoId,
      p.firstName,
      p.lastName,
      p.gender,
      p.birthdate,
      p.age,
      p.address,
      p.membershipType,
      p.maritalStatus,
      p.status,
      p.pcoCreatedAt,
      p.pcoUpdatedAt,
      p.inactivatedAt,
      p.rawJson,
    );
}

// ─── Forms ──────────────────────────────────────────────────────────────

async function syncOneForm(
  client: PCOClient,
  orgId: number,
  formId: string,
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
    rawJson: JSON.stringify(formData),
  });
  result.formUpserted = true;

  // 2) Fields (one-time per form, but cheap to re-pull)
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
      rawJson: JSON.stringify(fld),
    });
    result.fields.upserted++;
  }

  // 3) Submissions, paginated, ordered by created_at desc, with cursor
  const cursor = readCursor(orgId, `form:${formId}:submissions`);
  const params = new URLSearchParams({
    per_page: "100",
    order: "created_at",
  });
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
      upsertFormSubmission(orgId, formId, {
        pcoId: sub.id,
        personId,
        verified: a.verified === true ? 1 : 0,
        requiresVerification: a.requires_verification === true ? 1 : 0,
        pcoCreatedAt: created,
        rawJson: JSON.stringify(sub),
      });
      result.subs.upserted++;
    }
  }

  writeCursor(orgId, `form:${formId}:submissions`, maxCreatedAt);
  return result;
}

function upsertForm(
  orgId: number,
  f: { pcoId: string; name: string | null; description: string | null; active: number; rawJson: string },
) {
  getDb()
    .prepare(
      `INSERT INTO pco_forms (org_id, pco_id, name, description, active, raw_json, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(org_id, pco_id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         active = excluded.active,
         raw_json = excluded.raw_json,
         synced_at = excluded.synced_at`,
    )
    .run(orgId, f.pcoId, f.name, f.description, f.active, f.rawJson);
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
    rawJson: string;
  },
) {
  getDb()
    .prepare(
      `INSERT INTO pco_form_fields (org_id, form_id, pco_id, label, field_type, position, required, raw_json, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(org_id, form_id, pco_id) DO UPDATE SET
         label = excluded.label,
         field_type = excluded.field_type,
         position = excluded.position,
         required = excluded.required,
         raw_json = excluded.raw_json,
         synced_at = excluded.synced_at`,
    )
    .run(orgId, formId, f.pcoId, f.label, f.fieldType, f.position, f.required, f.rawJson);
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
    rawJson: string;
  },
) {
  getDb()
    .prepare(
      `INSERT INTO pco_form_submissions
        (org_id, form_id, pco_id, person_id, verified, requires_verification, pco_created_at, raw_json, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(org_id, form_id, pco_id) DO UPDATE SET
         person_id = excluded.person_id,
         verified = excluded.verified,
         requires_verification = excluded.requires_verification,
         pco_created_at = excluded.pco_created_at,
         raw_json = excluded.raw_json,
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
      s.rawJson,
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

// ─── Run-row helpers ────────────────────────────────────────────────────

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

// ─── Read API ───────────────────────────────────────────────────────────

export interface SyncedDataCounts {
  people: number;
  forms: number;
  formFields: number;
  formSubmissions: number;
}

export function getSyncedCounts(orgId: number): SyncedDataCounts {
  const db = getDb();
  const r1 = db.prepare("SELECT COUNT(*) AS n FROM pco_people WHERE org_id = ?").get(orgId) as { n: number };
  const r2 = db.prepare("SELECT COUNT(*) AS n FROM pco_forms WHERE org_id = ?").get(orgId) as { n: number };
  const r3 = db.prepare("SELECT COUNT(*) AS n FROM pco_form_fields WHERE org_id = ?").get(orgId) as { n: number };
  const r4 = db.prepare("SELECT COUNT(*) AS n FROM pco_form_submissions WHERE org_id = ?").get(orgId) as { n: number };
  return { people: r1.n, forms: r2.n, formFields: r3.n, formSubmissions: r4.n };
}
