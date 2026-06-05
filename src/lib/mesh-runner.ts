import "server-only";
import { buildMeshPending, countPendingMesh, isMeshConfigured } from "./road-mesh";

// Background runner that folds homes into the road mesh in batches,
// self-continuing until every geocoded home is meshed.

interface RunState {
  running: boolean;
  processed: number;
  total: number;
  startedAt: string;
  error?: string;
}
const runs = new Map<number, RunState>();

export interface MeshRunStatus {
  configured: boolean;
  running: boolean;
  processed: number;
  total: number;
  remaining: number;
  error?: string;
}

export function getMeshStatus(orgId: number): MeshRunStatus {
  const s = runs.get(orgId);
  return {
    configured: isMeshConfigured(),
    running: s?.running ?? false,
    processed: s?.processed ?? 0,
    total: s?.total ?? 0,
    remaining: countPendingMesh(orgId),
    error: s?.error,
  };
}

export function startMeshRun(orgId: number): MeshRunStatus {
  if (!isMeshConfigured()) return getMeshStatus(orgId);
  const existing = runs.get(orgId);
  if (existing?.running) return getMeshStatus(orgId);

  const total = countPendingMesh(orgId);
  const state: RunState = {
    running: total > 0,
    processed: 0,
    total,
    startedAt: new Date().toISOString(),
  };
  runs.set(orgId, state);
  if (total === 0) return getMeshStatus(orgId);

  void (async () => {
    try {
      while (state.running) {
        const r = await buildMeshPending(orgId, 60);
        state.processed += r.processed;
        if (r.processed === 0 || r.remaining === 0) break;
      }
    } catch (e) {
      state.error = e instanceof Error ? e.message : "mesh error";
    } finally {
      state.running = false;
    }
  })();

  return getMeshStatus(orgId);
}
