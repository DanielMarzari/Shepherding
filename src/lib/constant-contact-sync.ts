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
    `INSERT INTO cc_contacts (org_id, contact_id, email_hash, person_id, permission_to_send, opt_in_source, opt_in_date, opt_out_date, create_source, created_at, updated_at, synced_at)
     VALUES (@org, @id, @hash, @person, @perm, @optinSrc, @optinDate, @optoutDate, @createSrc, @created, @updated, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, contact_id) DO UPDATE SET email_hash=excluded.email_hash, person_id=excluded.person_id,
       permission_to_send=excluded.permission_to_send, opt_in_source=excluded.opt_in_source, opt_in_date=excluded.opt_in_date,
       opt_out_date=excluded.opt_out_date, create_source=excluded.create_source, updated_at=excluded.updated_at, synced_at=excluded.synced_at`,
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
        perm: s(ea.permission_to_send), optinSrc: s(ea.opt_in_source), optinDate: s(ea.opt_in_date),
        optoutDate: s(ea.opt_out_date), createSrc: s(c.create_source), created: s(c.created_at), updated: s(c.updated_at),
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

const statVal = (row: any, ...keys: string[]): number | null => {
  const src = row?.stats && typeof row.stats === "object" ? { ...row, ...row.stats } : row;
  for (const k of keys) if (src[k] != null) return n(src[k]);
  return null;
};

async function syncCampaigns(orgId: number, budget: Budget): Promise<number> {
  const up = getDb().prepare(
    `INSERT INTO cc_campaigns (org_id, campaign_id, campaign_activity_id, name, current_status, type, created_at, updated_at, synced_at)
     VALUES (@org, @id, @actId, @name, @status, @type, @created, @updated, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, campaign_id) DO UPDATE SET campaign_activity_id=excluded.campaign_activity_id, name=excluded.name,
       current_status=excluded.current_status, type=excluded.type, updated_at=excluded.updated_at, synced_at=excluded.synced_at`,
  );
  let count = 0;
  for await (const page of ccPages(orgId, "/v3/emails?limit=500", budget)) {
    for (const c of firstArray(page)) {
      const acts: any[] = Array.isArray(c.campaign_activities) ? c.campaign_activities : [];
      const primary = acts.find((a) => String(a.role ?? "").includes("primary")) ?? acts[0];
      up.run({ org: orgId, id: s(c.campaign_id), actId: s(primary?.campaign_activity_id), name: s(c.name), status: s(c.current_status), type: s(c.type), created: s(c.created_at), updated: s(c.updated_at) });
      count++;
    }
  }
  return count;
}

async function syncCampaignStats(orgId: number, budget: Budget): Promise<number> {
  const up = getDb().prepare(
    `INSERT INTO cc_campaign_stats (org_id, campaign_activity_id, sends, opens, unique_opens, clicks, unique_clicks, bounces, opt_outs, abuse, did_not_open, forwards, updated_at)
     VALUES (@org, @id, @sends, @opens, @uopens, @clicks, @uclicks, @bounces, @optouts, @abuse, @dno, @fwd, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, campaign_activity_id) DO UPDATE SET sends=excluded.sends, opens=excluded.opens, unique_opens=excluded.unique_opens,
       clicks=excluded.clicks, unique_clicks=excluded.unique_clicks, bounces=excluded.bounces, opt_outs=excluded.opt_outs,
       abuse=excluded.abuse, did_not_open=excluded.did_not_open, forwards=excluded.forwards, updated_at=excluded.updated_at`,
  );
  let count = 0;
  for await (const page of ccPages(orgId, "/v3/reports/summary_reports/email_campaign_summaries?limit=500", budget)) {
    for (const r of firstArray(page)) {
      const id = s(r.campaign_activity_id);
      if (!id) continue;
      up.run({
        org: orgId, id,
        sends: statVal(r, "em_sends", "sends", "sent"),
        opens: statVal(r, "em_opens", "opens"),
        uopens: statVal(r, "em_unique_opens", "unique_opens"),
        clicks: statVal(r, "em_clicks", "clicks"),
        uclicks: statVal(r, "em_unique_clicks", "unique_clicks"),
        bounces: statVal(r, "em_bounces", "bounces"),
        optouts: statVal(r, "em_optouts", "opt_outs", "optouts"),
        abuse: statVal(r, "em_abuse", "abuse"),
        dno: statVal(r, "em_not_opened", "did_not_open"),
        fwd: statVal(r, "em_forwards", "forwards"),
      });
      count++;
    }
  }
  return count;
}

const ACTIVITY_TYPES: Array<{ path: string; type: string }> = [
  { path: "opens", type: "open" },
  { path: "clicks", type: "click" },
  { path: "bounces", type: "bounce" },
  { path: "optouts", type: "optout" },
];

/** Per-contact tracking for campaigns whose activity we haven't pulled yet (or
 *  that changed inside the lookback window). Best-effort + budget-capped. */
async function syncContactActivity(orgId: number, budget: Budget, full: boolean): Promise<{ campaigns: number; rows: number; errors: number }> {
  const db = getDb();
  const after = cutoff(orgId, "activity", full);
  const rows = db.prepare(
    `SELECT campaign_id, campaign_activity_id, updated_at FROM cc_campaigns
      WHERE org_id = ? AND campaign_activity_id IS NOT NULL
        AND (activity_synced_at IS NULL ${after ? "OR updated_at > ?" : ""} ${full ? "OR 1=1" : ""})
      ORDER BY updated_at DESC`,
  ).all(...(after ? [orgId, after] : [orgId])) as Array<{ campaign_id: string; campaign_activity_id: string; updated_at: string | null }>;

  const insAct = db.prepare("INSERT OR IGNORE INTO cc_contact_activity (org_id, campaign_activity_id, contact_id, activity_type, activity_time, link_url) VALUES (?,?,?,?,?,?)");
  const insCampList = db.prepare("INSERT OR IGNORE INTO cc_campaign_lists (org_id, campaign_activity_id, list_id) VALUES (?,?,?)");
  const markDone = db.prepare("UPDATE cc_campaigns SET activity_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE org_id = ? AND campaign_id = ?");

  let campaigns = 0, rowCount = 0, errors = 0;
  for (const c of rows) {
    if (budget.count >= REQUEST_BUDGET) { budget.capped = true; break; }
    const actId = c.campaign_activity_id;
    try {
      // Which lists/segments this campaign was sent to.
      budget.count++;
      const detail = await ccGet(orgId, `/v3/emails/activities/${actId}`).catch(() => null);
      await sleep(PACE_MS);
      for (const lid of (detail?.contact_list_ids ?? []) as any[]) insCampList.run(orgId, actId, s(lid));

      for (const at of ACTIVITY_TYPES) {
        for await (const page of ccPages(orgId, `/v3/emails/activities/${actId}/tracking/${at.path}?limit=500`, budget)) {
          for (const a of firstArray(page)) {
            insAct.run(orgId, actId, s(a.contact_id), at.type, s(a.activity_time ?? a.created_time), s(a.url ?? a.link_url) ?? "");
            rowCount++;
          }
          if (budget.capped) break;
        }
        if (budget.capped) break;
      }
      markDone.run(orgId, c.campaign_id);
      campaigns++;
    } catch {
      errors++;
    }
  }
  if (!budget.capped) writeCursor(orgId, "activity", new Date().toISOString());
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
    details.activity = await syncContactActivity(orgId, budget, full);
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
  }
}

export function getLastCcSyncRun(orgId: number): { startedAt: string; finishedAt: string | null; status: string; requests: number; details: string | null } | null {
  const r = getDb().prepare("SELECT started_at AS startedAt, finished_at AS finishedAt, status, requests, details FROM cc_sync_runs WHERE org_id = ? ORDER BY id DESC LIMIT 1").get(orgId) as any;
  return r ?? null;
}
