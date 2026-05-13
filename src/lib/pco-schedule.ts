import "server-only";
import { getDb } from "./db";
import type { SyncSettings } from "./pco";

/** Compute the next scheduled run after the given reference instant.
 *  Hours are interpreted in the server's local timezone (the Oracle
 *  host runs UTC by default — document this for users).
 *
 *  Behaviour:
 *    - daily   → today @ runAtHour, or tomorrow if already past
 *    - weekly  → next runAtDow @ runAtHour after the reference
 *    - monthly → runAtDom @ runAtHour, this month if pending, else next
 */
export function nextScheduledRun(
  settings: SyncSettings,
  referenceMs: number,
): Date {
  const ref = new Date(referenceMs);
  const next = new Date(ref);
  next.setHours(settings.runAtHour, 0, 0, 0);

  switch (settings.frequency) {
    case "daily": {
      if (next <= ref) next.setDate(next.getDate() + 1);
      return next;
    }
    case "weekly": {
      const targetDow = settings.runAtDow;
      const dayDiff = (targetDow - next.getDay() + 7) % 7;
      next.setDate(next.getDate() + dayDiff);
      if (next <= ref) next.setDate(next.getDate() + 7);
      return next;
    }
    case "monthly": {
      next.setDate(settings.runAtDom);
      if (next <= ref) next.setMonth(next.getMonth() + 1);
      return next;
    }
    default:
      // Fall back to "+1 day" if frequency is unrecognized.
      next.setDate(next.getDate() + 1);
      return next;
  }
}

/** Has the next-scheduled run already arrived since the last successful
 *  sync (or since now-7-days if there's never been one)? */
export function isSyncDue(orgId: number, settings: SyncSettings): boolean {
  if (!settings.enabled) return false;
  const lastRunIso = readLastStartedAt(orgId);
  // If we've never synced, pretend the last reference was a week ago so
  // the next-scheduled point lies in the past → due.
  const referenceMs = lastRunIso
    ? new Date(lastRunIso).getTime()
    : Date.now() - 7 * 24 * 60 * 60 * 1000;
  const next = nextScheduledRun(settings, referenceMs);
  return Date.now() >= next.getTime();
}

function readLastStartedAt(orgId: number): string | null {
  const row = getDb()
    .prepare(
      `SELECT started_at
         FROM pco_sync_runs
        WHERE org_id = ? AND status IN ('ok', 'running')
        ORDER BY id DESC LIMIT 1`,
    )
    .get(orgId) as { started_at: string } | undefined;
  return row?.started_at ?? null;
}
