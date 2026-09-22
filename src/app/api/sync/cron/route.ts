import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSyncSettings } from "@/lib/pco";
import { isSyncDue } from "@/lib/pco-schedule";
import { cleanupStaleSyncRuns, healStaleSnapshots, runSync } from "@/lib/pco-sync";
import { startGeocodeRun } from "@/lib/geocode-runner";
import { startDriveRun } from "@/lib/drive-runner";
import { startMeshRun } from "@/lib/mesh-runner";
import { refreshRetentionReturns } from "@/lib/retention-read";
import { refreshGeoAssignments } from "@/lib/census-analysis";
import { getCcSyncSettings, getStoredConstantContactCreds, isCcSyncDue } from "@/lib/constant-contact";
import { isCcEngagementStale, refreshCcEngagement, runCcSync } from "@/lib/constant-contact-sync";

/**
 * Cron-tickable endpoint. For each org with `auto-sync enabled`, we check
 * whether the next-scheduled run has arrived since the last sync and trigger a
 * run if so.
 *
 * The heartbeat is the ubuntu crontab on the Oracle host, every 15 minutes:
 *
 *   every 15 min -> /usr/bin/flock -n /tmp/shepherdly-sync.lock \
 *                     /home/ubuntu/bin/shepherdly-sync-cron.sh
 *
 * flock because a full sync takes ~20 minutes and this fires every 15; the log
 * is /home/ubuntu/logs/shepherdly-sync-cron.log. This comment used to claim
 * that crontab existed. It did not — there was no schedule on the host at all,
 * and the last automatic sync had been 2026-07-28, seven weeks before anyone
 * noticed. Installed 2026-09-14. If data looks stale, check that log first.
 *
 * Auth: requires localhost origin OR a Bearer token matching CRON_SECRET.
 * Caddy adds an X-Forwarded-For header on any externally-proxied request,
 * so the absence of that header is a strong signal of a direct loopback
 * hit from the cron daemon.
 */
export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // List all organizations with PCO settings on file. (One row per org.)
  const orgs = getDb()
    .prepare(
      "SELECT DISTINCT org_id AS id FROM pco_sync_settings",
    )
    .all() as { id: number }[];

  const results: Array<{
    orgId: number;
    ok?: boolean;
    skipped?: boolean;
    reason?: string;
    changes?: number;
    error?: string;
    warning?: string;
    /** Snapshot freshness, and what the self-heal did about it. */
    snapshots?: string;
  }> = [];

  for (const { id } of orgs) {
    // Keep each home's cached census tract / county current (incremental — a
    // no-op once assigned). Runs every tick regardless of sync schedule so the
    // analysis pages never have to point-in-polygon on the request path.
    try {
      refreshGeoAssignments(id);
    } catch (e) {
      console.error("refreshGeoAssignments failed", id, e);
    }

    // Constant Contact runs on its own schedule, independent of the PCO sync.
    // Deep sync once, then a rolling 3-month window; never let it break the cron.
    try {
      if (getStoredConstantContactCreds(id).connected && isCcSyncDue(id, getCcSyncSettings(id))) {
        await runCcSync(id, "auto");
      }
    } catch (e) {
      console.error("runCcSync failed", id, e);
    }

    // Backstop for a Constant Contact sync killed before its own rebuild ran
    // (deploy restart, pm2 memory cap), or run by the old code during a
    // deploy: rebuild the email-engagement rollups whenever
    // constant_contact_activity has moved past their watermark. ~0.02 ms when
    // fresh. Synchronous, and never allowed to break the tick.
    try {
      if (isCcEngagementStale(id)) refreshCcEngagement(id);
    } catch (e) {
      console.error("refreshCcEngagement failed", id, e);
    }

    // Clear any run left "running" by a process that died — a deploy restart
    // mid-sync is the usual cause. Has to happen before the due check, because
    // isSyncDue counts a running row as a completed sync at that timestamp and
    // would otherwise skip every tick until the next scheduled window. And
    // before the snapshot self-heal below, which waits while a sync is
    // running — so it runs for every org, auto-sync on or off: a MANUAL sync
    // killed mid-run leaves the same stuck row and the same stale snapshots.
    cleanupStaleSyncRuns(id);

    // Heal the snapshots now, BEFORE deciding whether to sync. The tick that
    // reaps a killed sync is the tick that finds the next one due, and that
    // one may be killed too, so a heal placed after runSync never runs. That
    // was 2026-09-14..17 on production: sync runs 94-152, 59 in a row, each
    // killed and reaped 75 minutes later by the tick that started the next.
    // Replayed through this handler with the heal after runSync, five ticks
    // wrote no refresh row; heal-first rebuilds on the reap tick at the
    // latest (sooner after a restart; see healStaleSnapshots). ~0.02 ms when
    // nothing is stale.
    const snapshots = await healSnapshots(id);
    const settings = getSyncSettings(id);
    if (!settings.enabled) {
      results.push({
        orgId: id,
        skipped: true,
        reason: "auto-sync disabled",
        snapshots,
      });
      continue;
    }
    if (!isSyncDue(id, settings)) {
      results.push({
        orgId: id,
        skipped: true,
        reason: "not due yet",
        snapshots,
      });
      continue;
    }
    try {
      const r = await runSync(id, "auto");
      results.push({
        orgId: id,
        ok: r.ok,
        changes: r.changes,
        warning: r.warning,
        error: r.error,
        // runSync rebuilt the snapshots on its way out, ok or not, so the
        // second check is normally "fresh". It is the backstop for a runSync
        // that returned early or whose rebuild failed.
        snapshots: `${snapshots}; after sync: ${await healSnapshots(id)}`,
      });
      // Hands-off top-up: geocode any newly-added addresses, then compute
      // driving distances for geocoded homes — both background, both
      // no-op if already running / nothing pending / not configured.
      if (r.ok) {
        startGeocodeRun(id);
        startDriveRun(id);
        startMeshRun(id);
        // Recompute the retention "Returns" table (heavy activity-gap scan).
        // Nightly only — never on a live request. Never let it break the cron.
        try {
          await refreshRetentionReturns(id);
        } catch (e) {
          console.error("refreshRetentionReturns failed", id, e);
        }
      }
    } catch (e) {
      results.push({
        orgId: id,
        ok: false,
        error: e instanceof Error ? e.message : "unknown error",
        snapshots: `${snapshots}; after sync: ${await healSnapshots(id)}`,
      });
    }
  }

  return NextResponse.json({
    ran: results.filter((r) => r.ok === true).length,
    skipped: results.filter((r) => r.skipped).length,
    failed: results.filter((r) => r.ok === false).length,
    results,
  });
}

/** Rebuild the dashboard snapshots if they have fallen behind their source —
 *  the case runSync cannot cover, because a sync killed by a deploy or the
 *  memory cap runs no JS on its way out. Runs on every tick, before any sync
 *  starts; when nothing is stale it costs ~0.02 ms (see pco-sync). The
 *  result string goes in the tick's JSON response. Never lets a failure break
 *  the tick. */
async function healSnapshots(orgId: number): Promise<string> {
  try {
    return await healStaleSnapshots(orgId);
  } catch (e) {
    console.error("healStaleSnapshots failed", orgId, e);
    return `check failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

function isAuthorized(req: Request): boolean {
  // Next.js 16 auto-populates X-Forwarded-For even on direct loopback
  // connections, so we can't rely on its absence. Instead, check that
  // the LEFTMOST entry (the original client IP per the XFF convention)
  // is a loopback address. A request coming through Caddy from the open
  // internet will have a real public IP here.
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const firstHop = xff.split(",")[0]?.trim().toLowerCase() ?? "";
  const host = req.headers.get("host") ?? "";
  const hostIsLoopback =
    host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const remoteIsLoopback =
    firstHop === "" ||
    firstHop === "127.0.0.1" ||
    firstHop === "::1" ||
    firstHop.startsWith("::ffff:127.");
  if (hostIsLoopback && remoteIsLoopback) return true;

  // Off-host hit: only allowed with a shared secret. Lets us trigger the
  // cron from an external scheduler if/when we drop the local crontab.
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}
