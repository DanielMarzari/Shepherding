import "server-only";
import { countPendingGeo, geocodePending } from "./geocode";

// In-process, self-continuing geocode runner. Started once (admin button
// or after a sync); it then chews through the whole directory in
// rate-limited batches in the background — no need to re-trigger each
// batch. State lives in the Node process (persists across requests under
// PM2); a restart just means re-starting, which resumes from whatever's
// still pending.

interface RunState {
  running: boolean;
  processed: number;
  matched: number;
  total: number;
  startedAt: string;
  error?: string;
}
const runs = new Map<number, RunState>();

export interface GeocodeStatus {
  running: boolean;
  processed: number;
  matched: number;
  total: number;
  remaining: number;
  error?: string;
}

export function getGeocodeStatus(orgId: number): GeocodeStatus {
  const s = runs.get(orgId);
  return {
    running: s?.running ?? false,
    processed: s?.processed ?? 0,
    matched: s?.matched ?? 0,
    total: s?.total ?? 0,
    remaining: countPendingGeo(orgId),
    error: s?.error,
  };
}

/** Start (or no-op if already running) a background run that geocodes
 *  every pending person. Returns immediately. */
export function startGeocodeRun(orgId: number): GeocodeStatus {
  const existing = runs.get(orgId);
  if (existing?.running) return getGeocodeStatus(orgId);

  const total = countPendingGeo(orgId);
  const state: RunState = {
    running: total > 0,
    processed: 0,
    matched: 0,
    total,
    startedAt: new Date().toISOString(),
  };
  runs.set(orgId, state);
  if (total === 0) return getGeocodeStatus(orgId);

  void (async () => {
    try {
      while (state.running) {
        const r = await geocodePending(orgId, 50);
        state.processed += r.processed;
        state.matched += r.matched;
        if (r.processed === 0 || r.remaining === 0) break;
      }
    } catch (e) {
      state.error = e instanceof Error ? e.message : "geocode error";
    } finally {
      state.running = false;
    }
  })();

  return getGeocodeStatus(orgId);
}
