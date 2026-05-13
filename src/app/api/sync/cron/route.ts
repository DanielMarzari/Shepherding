import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSyncSettings } from "@/lib/pco";
import { isSyncDue } from "@/lib/pco-schedule";
import { runSync } from "@/lib/pco-sync";

/**
 * Cron-tickable endpoint. The Oracle host runs a system crontab every
 * 15 minutes that hits this URL. For each org with `auto-sync enabled`,
 * we check whether the next-scheduled run has arrived since the last
 * sync and trigger a run if so.
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
  }> = [];

  for (const { id } of orgs) {
    const settings = getSyncSettings(id);
    if (!settings.enabled) {
      results.push({ orgId: id, skipped: true, reason: "auto-sync disabled" });
      continue;
    }
    if (!isSyncDue(id, settings)) {
      results.push({ orgId: id, skipped: true, reason: "not due yet" });
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
      });
    } catch (e) {
      results.push({
        orgId: id,
        ok: false,
        error: e instanceof Error ? e.message : "unknown error",
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
