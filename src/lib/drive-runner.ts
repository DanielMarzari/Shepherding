import "server-only";
import {
  computeDrivesPending,
  countPendingDrive,
  isRoutingConfigured,
} from "./drive-routing";

// Self-continuing background runner for driving-distance computation.
// Same shape as the geocode runner: start once, it works through all
// pending homes in batches and stops when done.

interface RunState {
  running: boolean;
  processed: number;
  ok: number;
  total: number;
  startedAt: string;
  error?: string;
}
const runs = new Map<number, RunState>();

export interface DriveRunStatus {
  configured: boolean;
  running: boolean;
  processed: number;
  ok: number;
  total: number;
  remaining: number;
  error?: string;
}

export function getDriveStatus(orgId: number): DriveRunStatus {
  const s = runs.get(orgId);
  return {
    configured: isRoutingConfigured(),
    running: s?.running ?? false,
    processed: s?.processed ?? 0,
    ok: s?.ok ?? 0,
    total: s?.total ?? 0,
    remaining: countPendingDrive(orgId),
    error: s?.error,
  };
}

export function startDriveRun(orgId: number): DriveRunStatus {
  if (!isRoutingConfigured()) return getDriveStatus(orgId);
  const existing = runs.get(orgId);
  if (existing?.running) return getDriveStatus(orgId);

  const total = countPendingDrive(orgId);
  const state: RunState = {
    running: total > 0,
    processed: 0,
    ok: 0,
    total,
    startedAt: new Date().toISOString(),
  };
  runs.set(orgId, state);
  if (total === 0) return getDriveStatus(orgId);

  void (async () => {
    try {
      while (state.running) {
        const r = await computeDrivesPending(orgId, 270);
        state.processed += r.processed;
        state.ok += r.ok;
        if (r.processed === 0 || r.remaining === 0) break;
      }
    } catch (e) {
      state.error = e instanceof Error ? e.message : "routing error";
    } finally {
      state.running = false;
    }
  })();

  return getDriveStatus(orgId);
}
