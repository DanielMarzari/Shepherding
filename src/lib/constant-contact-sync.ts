import "server-only";
import { getDb } from "./db";
import { hmac } from "./encryption";
import { getCcAccessToken } from "./constant-contact";

// Constant Contact data sync. Mirrors the PCO model: a deep sync the first time
// (no cursor → pull everything), then a rolling 3-month `updated_after` lookback
// so only recent changes are re-pulled; a full refresh resets the cursor and the
// per-campaign activity marks. Paced under CC's 4 req/sec, with a per-run request
// budget so we never blow the 10k/day cap.

const CC_HOST = "https://api.cc.email";
const LOOKBACK_MS = 3 * 30 * 24 * 60 * 60 * 1000; // ~3 months
const REQUEST_BUDGET = 8000; // headroom under 10k/day
const PACE_MS = 260; // ~3.8 req/sec

/* eslint-disable @typescript-eslint/no-explicit-any */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
class HttpError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

interface Budget { count: number; capped: boolean }

async function ccGet(orgId: number, pathOrUrl: string): Promise<any> {
  const token = await getCcAccessToken(orgId);
  if (!token) throw new HttpError(401, "Not connected to Constant Contact.");
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${CC_HOST}${pathOrUrl}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store" });
  if (res.status === 429) {
    const ra = Number(res.headers.get("retry-after") ?? "1");
    await sleep((Number.isFinite(ra) ? ra : 1) * 1000 + 500);
    return ccGet(orgId, pathOrUrl);
  }
  if (!res.ok) throw new HttpError(res.status, (await res.text().catch(() => "")).slice(0, 300) || res.statusText);
  return res.json().catch(() => ({}));
}

/** Yields each page, following CC's `_links.next`, paced and budget-capped. */
async function* ccPages(orgId: number, startPath: string, budget: Budget): AsyncGenerator<any> {
  let path: string | null = startPath;
  while (path) {
    if (budget.count >= REQUEST_BUDGET) { budget.capped = true; return; }
    budget.count++;
    const json: any = await ccGet(orgId, path);
    yield json;
    await sleep(PACE_MS);
    const next = json?._links?.next?.href;
    path = typeof next === "string" && next ? next : null;
  }
}

const firstArray = (obj: any): any[] => {
  if (obj && typeof obj === "object") for (const v of Object.values(obj)) if (Array.isArray(v)) return v;
  return [];
};
const s = (v: any): string | null => (v == null ? null : String(v));
const n = (v: any): number | null => { const x = Number(v); return Number.isFinite(x) ? x : null; };

// ── cursor + run bookkeeping ─────────────────────────────────────────
function readCursor(orgId: number, resource: string): string | null {
  const row = getDb().prepare("SELECT last_updated_at FROM cc_sync_cursor WHERE org_id = ? AND resource = ?").get(orgId, resource) as { last_updated_at: string | null } | undefined;
  return row?.last_updated_at ?? null;
}
function writeCursor(orgId: number, resource: string, lastUpdatedAt: string | null): void {
  getDb().prepare(
    `INSERT INTO cc_sync_cursor (org_id, resource, last_updated_at, last_synced_at)
     VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, resource) DO UPDATE SET last_updated_at = excluded.last_updated_at, last_synced_at = excluded.last_synced_at`,
  ).run(orgId, resource, lastUpdatedAt);
}
/** Cutoff for `updated_after`: null on a deep/full sync, else the earlier of the
 *  stored cursor and (now − 3 months). */
function cutoff(orgId: number, resource: string, full: boolean): string | null {
  if (full) return null;
  const stored = readCursor(orgId, resource);
  if (!stored) return null;
  const lookback = new Date(Date.now() - LOOKBACK_MS).toISOString();
  return stored < lookback ? stored : lookback;
}

// ── resource syncs ───────────────────────────────────────────────────
async function syncLists(orgId: number, budget: Budget): Promise<number> {
  const up = getDb().prepare(
    `INSERT INTO cc_lists (org_id, list_id, name, membership_count, favorite, created_at, updated_at, synced_at)
     VALUES (@org, @id, @name, @count, @fav, @created, @updated, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, list_id) DO UPDATE SET name=excluded.name, membership_count=excluded.membership_count,
       favorite=excluded.favorite, updated_at=excluded.updated_at, synced_at=excluded.synced_at`,
  );
  let count = 0;
  for await (const page of ccPages(orgId, "/v3/contact_lists?include_count=true&limit=1000", budget)) {
    for (const l of firstArray(page)) {
      up.run({ org: orgId, id: s(l.list_id), name: s(l.name), count: n(l.membership_count), fav: l.favorite ? 1 : 0, created: s(l.created_at), updated: s(l.updated_at) });
      count++;
    }
  }
  return count;
}

async function syncContacts(orgId: number, budget: Budget, full: boolean): Promise<number> {
  const db = getDb();
  const resolvePerson = db.prepare("SELECT person_id FROM pco_person_emails WHERE org_id = ? AND email_hash = ? LIMIT 1");
  const up = db.prepare(
    `INSERT INTO cc_contacts (org_id, contact_id, email_hash, person_id, permission_to_send, opt_in_source, opted_in_at, opted_out_at, create_source, created_at, updated_at, synced_at)
     VALUES (@org, @id, @hash, @person, @perm, @optinSrc, @optedInAt, @optedOutAt, @createSrc, @created, @updated, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, contact_id) DO UPDATE SET email_hash=excluded.email_hash, person_id=excluded.person_id,
       permission_to_send=excluded.permission_to_send, opt_in_source=excluded.opt_in_source, opted_in_at=excluded.opted_in_at,
       opted_out_at=excluded.opted_out_at, create_source=excluded.create_source, updated_at=excluded.updated_at, synced_at=excluded.synced_at`,
  );
  const delLists = db.prepare("DELETE FROM cc_contact_lists WHERE org_id = ? AND contact_id = ?");
  const insList = db.prepare("INSERT OR IGNORE INTO cc_contact_lists (org_id, contact_id, list_id) VALUES (?, ?, ?)");

  const after = cutoff(orgId, "contacts", full);
  const params = new URLSearchParams({ limit: "500", status: "all", include: "list_memberships" });
  if (after) params.set("updated_after", after);
  let maxUpdated = after;
  let count = 0;

  for await (const page of ccPages(orgId, `/v3/contacts?${params.toString()}`, budget)) {
    for (const c of firstArray(page)) {
      const email = c.email_address?.address ?? (typeof c.email_address === "string" ? c.email_address : null);
      const hash = typeof email === "string" && email.includes("@") ? hmac(email.trim().toLowerCase()) : null;
      const person = hash ? (resolvePerson.get(orgId, hash) as { person_id: string } | undefined)?.person_id ?? null : null;
      const ea = c.email_address ?? {};
      up.run({
        org: orgId, id: s(c.contact_id), hash, person,
        perm: s(ea.permission_to_send), optinSrc: s(ea.opt_in_source), optedInAt: s(ea.opt_in_date),
        optedOutAt: s(ea.opt_out_date), createSrc: s(c.create_source), created: s(c.created_at), updated: s(c.updated_at),
      });
      const lists: any[] = Array.isArray(c.list_memberships) ? c.list_memberships : [];
      delLists.run(orgId, s(c.contact_id));
      for (const lid of lists) insList.run(orgId, s(c.contact_id), s(typeof lid === "string" ? lid : lid?.list_id));
      if (c.updated_at && (!maxUpdated || c.updated_at > maxUpdated)) maxUpdated = c.updated_at;
      count++;
    }
  }
  if (!budget.capped && maxUpdated) writeCursor(orgId, "contacts", maxUpdated);
  return count;
}

async function syncCampaigns(orgId: number, budget: Budget): Promise<number> {
  const up = getDb().prepare(
    `INSERT INTO cc_campaigns (org_id, campaign_id, campaign_activity_id, name, current_status, type, created_at, updated_at, synced_at)
     VALUES (@org, @id, @actId, @name, @status, @type, @created, @updated, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, campaign_id) DO UPDATE SET name=excluded.name,
       current_status=excluded.current_status, type=excluded.type, updated_at=excluded.updated_at, synced_at=excluded.synced_at`,
  );
  // The /emails list endpoint doesn't include activities — the campaign_activity_id
  // is resolved later in syncCampaignActivity via /emails/{campaign_id}.
  let count = 0;
  for await (const page of ccPages(orgId, "/v3/emails?limit=500", budget)) {
    for (const c of firstArray(page)) {
      up.run({ org: orgId, id: s(c.campaign_id), actId: null, name: s(c.name), status: s(c.current_status), type: s(c.type), created: s(c.created_at), updated: s(c.updated_at) });
      count++;
    }
  }
  return count;
}

/** Per-campaign summary stats. CC keys these by campaign_id (not activity id)
 *  with counts under `unique_counts`, so we fold them into cc_campaigns. */
async function syncCampaignStats(orgId: number, budget: Budget): Promise<number> {
  const up = getDb().prepare(
    `UPDATE cc_campaigns SET
        stat_sends = @sends, stat_opens = @opens, stat_clicks = @clicks, stat_bounces = @bounces,
        stat_optouts = @optouts, stat_forwards = @fwd, stat_abuse = @abuse, stat_not_opened = @dno,
        last_sent_at = COALESCE(@lastSentAt, last_sent_at), stats_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE org_id = @org AND campaign_id = @id`,
  );
  let count = 0;
  for await (const page of ccPages(orgId, "/v3/reports/summary_reports/email_campaign_summaries?limit=500", budget)) {
    for (const r of firstArray(page)) {
      const id = s(r.campaign_id);
      if (!id) continue;
      const u = r.unique_counts && typeof r.unique_counts === "object" ? r.unique_counts : {};
      const info = up.run({
        org: orgId, id, lastSentAt: s(r.last_sent_date),
        sends: n(u.sends), opens: n(u.opens), clicks: n(u.clicks), bounces: n(u.bounces),
        optouts: n(u.optouts), fwd: n(u.forwards), abuse: n(u.abuse), dno: n(u.not_opened),
      });
      if (info.changes) count++;
    }
  }
  return count;
}

const TRACK: Array<[string, string]> = [["opens", "open"], ["clicks", "click"], ["bounces", "bounce"], ["optouts", "optout"]];

/** Per-contact tracking for recently-sent campaigns we haven't pulled yet.
 *  For each: resolve the primary_email activity id, its target lists, then the
 *  open/click/bounce/optout tracking. Budget-capped; converges over runs. */
async function syncCampaignActivity(orgId: number, budget: Budget, full: boolean): Promise<{ campaigns: number; rows: number; errors: number }> {
  const db = getDb();
  const window = new Date(Date.now() - LOOKBACK_MS * 4).toISOString(); // ~12 months of sent campaigns
  const candidates = db.prepare(
    `SELECT campaign_id FROM cc_campaigns
      WHERE org_id = ? AND last_sent_at IS NOT NULL AND last_sent_at > ?
        AND (activity_synced_at IS NULL ${full ? "OR 1 = 1" : "OR last_sent_at > activity_synced_at"})
      ORDER BY last_sent_at DESC`,
  ).all(orgId, window) as Array<{ campaign_id: string }>;

  const setActId = db.prepare("UPDATE cc_campaigns SET campaign_activity_id = ? WHERE org_id = ? AND campaign_id = ?");
  const insCampList = db.prepare("INSERT OR IGNORE INTO cc_campaign_lists (org_id, campaign_activity_id, list_id) VALUES (?,?,?)");
  const insAct = db.prepare("INSERT OR IGNORE INTO cc_contact_activity (org_id, campaign_activity_id, contact_id, activity_type, occurred_at, link_url) VALUES (?,?,?,?,?,?)");
  const markDone = db.prepare("UPDATE cc_campaigns SET activity_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE org_id = ? AND campaign_id = ?");

  let campaigns = 0, rowCount = 0, errors = 0;
  for (const c of candidates) {
    if (budget.count >= REQUEST_BUDGET) { budget.capped = true; break; }
    try {
      budget.count++;
      const email = await ccGet(orgId, `/v3/emails/${c.campaign_id}`);
      await sleep(PACE_MS);
      const acts: any[] = Array.isArray(email?.campaign_activities) ? email.campaign_activities : [];
      const actId = s((acts.find((a) => String(a.role ?? "").includes("primary")) ?? acts[0])?.campaign_activity_id);
      if (!actId) { markDone.run(orgId, c.campaign_id); continue; }
      setActId.run(actId, orgId, c.campaign_id);

      budget.count++;
      const detail = await ccGet(orgId, `/v3/emails/activities/${actId}`).catch(() => null);
      await sleep(PACE_MS);
      for (const lid of (detail?.contact_list_ids ?? []) as any[]) insCampList.run(orgId, actId, s(lid));

      for (const [path, type] of TRACK) {
        for await (const page of ccPages(orgId, `/v3/reports/email_reports/${actId}/tracking/${path}?limit=500`, budget)) {
          for (const a of firstArray(page)) {
            // CC's activity_time (or its fallbacks) is stored as occurred_at.
            insAct.run(orgId, actId, s(a.contact_id), type, s(a.activity_time ?? a.created_time ?? a.tracking_activity_time), s(a.url ?? a.link_url) ?? "");
            rowCount++;
          }
          if (budget.capped) break;
        }
        if (budget.capped) break;
      }
      if (!budget.capped) { markDone.run(orgId, c.campaign_id); campaigns++; }
    } catch {
      errors++;
    }
  }
  return { campaigns, rows: rowCount, errors };
}

/** Re-resolve person_id for any contacts that matched a PCO email hash added
 *  after the contact was synced. Cheap, keeps the join current. */
function relinkContacts(orgId: number): number {
  return getDb().prepare(
    `UPDATE cc_contacts
        SET person_id = (SELECT pe.person_id FROM pco_person_emails pe WHERE pe.org_id = cc_contacts.org_id AND pe.email_hash = cc_contacts.email_hash LIMIT 1)
      WHERE org_id = ? AND email_hash IS NOT NULL`,
  ).run(orgId).changes;
}

// ── engagement rollups ───────────────────────────────────────────────
// Schema and rationale: db/migrations/0091_constant_contact_engagement.sql,
// whose populate step is this same SQL for every org at once — keep them in step
// (its activity_time is occurred_at here: 0093 renamed the column).

/** Rebuild the org's engagement rollups (cc_contact_engagement, cc_link_clicks,
 *  cc_engagement_snapshot) from cc_contact_activity, from scratch, in one
 *  transaction: readers see the old rollup or the new one, never half of each.
 *  The watermark (the table-wide MAX(rowid)) is read inside the same
 *  transaction, so every row at or below it was counted. */
export function refreshCcEngagement(orgId: number): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM cc_contact_engagement WHERE org_id = ?").run(orgId);
    db.prepare("DELETE FROM cc_link_clicks WHERE org_id = ?").run(orgId);
    db.prepare("DELETE FROM cc_engagement_snapshot WHERE org_id = ?").run(orgId);
    // Walks the (org_id, contact_id, activity_type) index in order: no sort,
    // and no table reads, since every column it needs is in the index.
    db.prepare(
      `INSERT INTO cc_contact_engagement (org_id, contact_id, opens, clicks, bounces, optouts)
       SELECT org_id, contact_id,
              SUM(activity_type = 'open'), SUM(activity_type = 'click'),
              SUM(activity_type = 'bounce'), SUM(activity_type = 'optout')
         FROM cc_contact_activity WHERE org_id = ?
        GROUP BY contact_id`,
    ).run(orgId);
    db.prepare(
      `INSERT INTO cc_link_clicks (org_id, link_url, clicks)
       SELECT org_id, link_url, COUNT(*) FROM cc_contact_activity
        WHERE org_id = ? AND activity_type = 'click' AND link_url <> ''
        GROUP BY link_url`,
    ).run(orgId);
    // One row even when the org has no activity yet, so "built, and empty" is
    // distinguishable from "never built".
    db.prepare(
      `INSERT INTO cc_engagement_snapshot
         (org_id, activity_rows, activity_watermark_rowid,
          opens_sun, opens_mon, opens_tue, opens_wed, opens_thu, opens_fri, opens_sat)
       SELECT @org, t.n, (SELECT COALESCE(MAX(rowid), 0) FROM cc_contact_activity),
              COALESCE(d.sun, 0), COALESCE(d.mon, 0), COALESCE(d.tue, 0), COALESCE(d.wed, 0),
              COALESCE(d.thu, 0), COALESCE(d.fri, 0), COALESCE(d.sat, 0)
         FROM (SELECT COUNT(*) AS n FROM cc_contact_activity WHERE org_id = @org) t
         LEFT JOIN (
               SELECT SUM(CASE WHEN dow = 0 THEN n END) AS sun, SUM(CASE WHEN dow = 1 THEN n END) AS mon,
                      SUM(CASE WHEN dow = 2 THEN n END) AS tue, SUM(CASE WHEN dow = 3 THEN n END) AS wed,
                      SUM(CASE WHEN dow = 4 THEN n END) AS thu, SUM(CASE WHEN dow = 5 THEN n END) AS fri,
                      SUM(CASE WHEN dow = 6 THEN n END) AS sat
                 FROM (SELECT CAST(strftime('%w', occurred_at) AS INTEGER) AS dow, COUNT(*) AS n
                         FROM cc_contact_activity
                        WHERE org_id = @org AND activity_type = 'open' AND occurred_at IS NOT NULL
                        GROUP BY dow)) d`,
    ).run({ org: orgId });
  })();
}

/** True when cc_contact_activity has moved past the watermark the rollups were
 *  built from, e.g. a sync that was killed before its own rebuild, or the old
 *  code syncing during a deploy. The cron tick calls this every 15 minutes, so
 *  it compares the table-wide MAX(rowid), which is one seek on the rowid
 *  b-tree (0.003-0.007 ms, +0.2 MB RSS on the production copy). A per-org
 *  COUNT(*) walked a 13 MB index instead: 7-8 ms warm, up to 229 ms cold,
 *  +14-15 MB RSS. Table-wide means another org's sync also marks this org
 *  stale. The cost is one unneeded rebuild. */
export function isCcEngagementStale(orgId: number): boolean {
  const db = getDb();
  const built = db.prepare(
    "SELECT activity_watermark_rowid AS w FROM cc_engagement_snapshot WHERE org_id = ?",
  ).get(orgId) as { w: number } | undefined;
  // Never built: stale only if the org has activity to count. One index seek.
  if (!built) return db.prepare("SELECT 1 FROM cc_contact_activity WHERE org_id = ? LIMIT 1").get(orgId) !== undefined;
  const live = db.prepare("SELECT COALESCE(MAX(rowid), 0) AS w FROM cc_contact_activity").get() as { w: number };
  // !== rather than >: a lower max means rows were deleted, which is stale too.
  return live.w !== built.w;
}

// ── orchestration ────────────────────────────────────────────────────
export interface CcSyncResult {
  ok: boolean;
  requests: number;
  capped: boolean;
  details: Record<string, unknown>;
  error?: string;
}

export async function runCcSync(orgId: number, trigger: "manual" | "auto" = "manual", opts: { fullRefresh?: boolean } = {}): Promise<CcSyncResult> {
  const db = getDb();
  const full = !!opts.fullRefresh;
  if (full) {
    db.prepare("DELETE FROM cc_sync_cursor WHERE org_id = ?").run(orgId);
    db.prepare("UPDATE cc_campaigns SET activity_synced_at = NULL WHERE org_id = ?").run(orgId);
  }
  const runId = Number(
    db.prepare("INSERT INTO cc_sync_runs (org_id, started_at, trigger, status, full_refresh) VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?, 'running', ?)")
      .run(orgId, trigger, full ? 1 : 0).lastInsertRowid,
  );
  const budget: Budget = { count: 0, capped: false };
  const details: Record<string, unknown> = {};
  try {
    details.lists = await syncLists(orgId, budget);
    details.contacts = await syncContacts(orgId, budget, full);
    details.campaigns = await syncCampaigns(orgId, budget);
    details.campaignStats = await syncCampaignStats(orgId, budget);
    details.activity = await syncCampaignActivity(orgId, budget, full);
    details.relinked = relinkContacts(orgId);
    details.capped = budget.capped;
    db.prepare("UPDATE cc_sync_runs SET finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), status = ?, requests = ?, details = ? WHERE id = ?")
      .run(budget.capped ? "partial" : "ok", budget.count, JSON.stringify(details), runId);
    return { ok: true, requests: budget.count, capped: budget.capped, details };
  } catch (e) {
    const error = e instanceof Error ? e.message : "sync failed";
    db.prepare("UPDATE cc_sync_runs SET finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), status = 'error', requests = ?, details = ?, error = ? WHERE id = ?")
      .run(budget.count, JSON.stringify(details), error, runId);
    return { ok: false, requests: budget.count, capped: budget.capped, details, error };
  } finally {
    // Every attempt, not just a successful one: a failed or capped run can
    // still have written activity rows, and a success-only rebuild is how
    // another dashboard in this app sat 11 days stale. Never let it throw out
    // of here — it would replace the sync's own result.
    try {
      refreshCcEngagement(orgId);
    } catch (e) {
      console.error("refreshCcEngagement failed", orgId, e);
    }
  }
}

export function getLastCcSyncRun(orgId: number): { startedAt: string; finishedAt: string | null; status: string; requests: number; details: string | null } | null {
  const r = getDb().prepare("SELECT started_at AS startedAt, finished_at AS finishedAt, status, requests, details FROM cc_sync_runs WHERE org_id = ? ORDER BY id DESC LIMIT 1").get(orgId) as any;
  return r ?? null;
}
