"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  type SyncFrequency,
  type SyncSettings,
  getSyncSettings,
  saveCreds,
  saveSyncEntities,
  saveSyncSettings,
  testPcoConnection,
} from "@/lib/pco";
import { runSync, type SyncDetails } from "@/lib/pco-sync";

const VALID_FREQ: SyncFrequency[] = ["daily", "weekly", "monthly"];

export interface TestState {
  status: "idle" | "ok" | "error";
  organizationName?: string;
  error?: string;
  appId?: string;
  secret?: string;
  webhookSecret?: string;
}

export async function testConnectionAction(
  _prev: TestState | null,
  formData: FormData,
): Promise<TestState> {
  await requireOrg();
  const appId = String(formData.get("appId") ?? "").trim();
  const secret = String(formData.get("secret") ?? "").trim();
  const webhookSecret = String(formData.get("webhookSecret") ?? "").trim();
  const result = await testPcoConnection(appId, secret);
  if (!result.ok) {
    return { status: "error", error: result.error, appId, secret, webhookSecret };
  }
  return {
    status: "ok",
    organizationName: result.organizationName,
    appId,
    secret,
    webhookSecret,
  };
}

export interface SaveState {
  status: "idle" | "saved" | "error";
  message?: string;
}

export async function saveCredentialsAction(
  _prev: SaveState | null,
  formData: FormData,
): Promise<SaveState> {
  const s = await requireOrg();
  if (s.role !== "admin") {
    return { status: "error", message: "Only admins can change PCO credentials." };
  }
  const appId = String(formData.get("appId") ?? "").trim();
  const secret = String(formData.get("secret") ?? "").trim();
  const webhookSecretRaw = String(formData.get("webhookSecret") ?? "").trim();
  const webhookSecret = webhookSecretRaw === "" ? null : webhookSecretRaw;

  if (!appId || !secret) {
    return { status: "error", message: "App ID and Secret are required." };
  }

  const test = await testPcoConnection(appId, secret);
  if (!test.ok) {
    return {
      status: "error",
      message: test.error ?? "Connection failed; not saving.",
    };
  }
  saveCreds(s.orgId, appId, secret, webhookSecret, test.organizationName ?? "Connected");
  revalidatePath("/pco");
  return { status: "saved", message: "Credentials saved & verified." };
}

export interface SyncSaveState {
  status: "idle" | "saved" | "error";
  message?: string;
}

export async function saveSyncSettingsAction(
  _prev: SyncSaveState | null,
  formData: FormData,
): Promise<SyncSaveState> {
  const s = await requireOrg();
  if (s.role !== "admin") {
    return { status: "error", message: "Only admins can change sync settings." };
  }
  const enabled = formData.get("enabled") === "on";
  const frequencyInput = String(formData.get("frequency") ?? "daily");
  const frequency: SyncFrequency = (VALID_FREQ as string[]).includes(frequencyInput)
    ? (frequencyInput as SyncFrequency)
    : "daily";
  const runAtHourRaw = Number(formData.get("runAtHour") ?? 0);
  const runAtHour = clamp(runAtHourRaw, 0, 23);
  const runAtDowRaw = Number(formData.get("runAtDow") ?? 0);
  const runAtDow = clamp(runAtDowRaw, 0, 6);
  const runAtDomRaw = Number(formData.get("runAtDom") ?? 1);
  const runAtDom = clamp(runAtDomRaw, 1, 28);
  const emailOnFailure = formData.get("emailOnFailure") === "on";
  const autoResolveConflicts = formData.get("autoResolveConflicts") === "on";
  // Preserve values managed on Metrics + Attendance.
  const current = getSyncSettings(s.orgId);
  const settings: SyncSettings = {
    enabled,
    frequency,
    runAtHour,
    runAtDow,
    runAtDom,
    emailOnFailure,
    autoResolveConflicts,
    activityMonths: current.activityMonths,
    syncThresholdMonths: current.syncThresholdMonths,
    activityTrackingMonths: current.activityTrackingMonths,
    weeklyAttendance: current.weeklyAttendance,
    lapsedWeeks: current.lapsedWeeks,
    lapsedFromTeamMonths: current.lapsedFromTeamMonths,
  };
  saveSyncSettings(s.orgId, settings);
  revalidatePath("/pco");
  return { status: "saved", message: "Sync settings saved." };
}

export interface SyncEntitiesSaveState {
  status: "idle" | "saved" | "error";
  message?: string;
}

export async function saveSyncEntitiesAction(
  _prev: SyncEntitiesSaveState | null,
  formData: FormData,
): Promise<SyncEntitiesSaveState> {
  const s = await requireOrg();
  if (s.role !== "admin") {
    return { status: "error", message: "Only admins can change sync entities." };
  }
  const toggles: Record<string, boolean> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("entity_")) {
      toggles[key.slice(7)] = value === "on";
    }
  }
  saveSyncEntities(s.orgId, toggles);
  revalidatePath("/pco");
  return { status: "saved", message: "Entity selection saved." };
}

export interface SyncNowState {
  status: "idle" | "started" | "already-running" | "error";
  message?: string;
}

// Module-level Set holds promises in-flight so V8 doesn't GC them while
// the user is on another page. We're on a persistent PM2-managed Node
// process, so fire-and-forget is safe — no serverless cold-stop.
const inFlight = new Set<Promise<unknown>>();

export async function syncNowAction(
  _prev: SyncNowState | null,
  _formData: FormData,
): Promise<SyncNowState> {
  const s = await requireOrg();
  if (s.role !== "admin") {
    return { status: "error", message: "Only admins can trigger a sync." };
  }
  if (isSyncRunningInDb(s.orgId)) {
    return {
      status: "already-running",
      message: "A sync is already in progress for this org.",
    };
  }
  const promise = runSync(s.orgId, "manual").catch(() => {
    // runSync records errors in the DB itself via finishSyncRun; we just
    // swallow here so the unhandled-rejection handler doesn't fire.
  });
  inFlight.add(promise);
  promise.finally(() => inFlight.delete(promise));
  return {
    status: "started",
    message: "Sync started in the background. Safe to navigate away.",
  };
}

export interface SyncStatusState {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  status: "running" | "ok" | "error" | null;
  changes: number;
  warning: string | null;
  details: SyncDetails | null;
}

/** Polled by the Sync now button while a background sync is in flight. */
export async function getSyncStatusAction(): Promise<SyncStatusState> {
  const s = await requireOrg();
  return readLatestStatus(s.orgId);
}

function isSyncRunningInDb(orgId: number): boolean {
  const row = getDb()
    .prepare(
      `SELECT started_at FROM pco_sync_runs
        WHERE org_id = ? AND status = 'running'
        ORDER BY started_at DESC LIMIT 1`,
    )
    .get(orgId) as { started_at: string } | undefined;
  if (!row) return false;
  // Anything older than 10 minutes we assume crashed/abandoned.
  const ageMs = Date.now() - new Date(row.started_at).valueOf();
  return ageMs < 10 * 60 * 1000;
}

function readLatestStatus(orgId: number): SyncStatusState {
  const row = getDb()
    .prepare(
      `SELECT started_at, finished_at, status, changes, warning, details
         FROM pco_sync_runs
         WHERE org_id = ?
         ORDER BY started_at DESC LIMIT 1`,
    )
    .get(orgId) as
    | {
        started_at: string;
        finished_at: string | null;
        status: string;
        changes: number;
        warning: string | null;
        details: string | null;
      }
    | undefined;
  if (!row) {
    return {
      running: false,
      startedAt: null,
      finishedAt: null,
      status: null,
      changes: 0,
      warning: null,
      details: null,
    };
  }
  let parsedDetails: SyncDetails | null = null;
  if (row.details) {
    try {
      parsedDetails = JSON.parse(row.details);
    } catch {
      parsedDetails = null;
    }
  }
  const running =
    row.status === "running" &&
    Date.now() - new Date(row.started_at).valueOf() < 10 * 60 * 1000;
  return {
    running,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status as "running" | "ok" | "error",
    changes: row.changes,
    warning: row.warning,
    details: parsedDetails,
  };
}

function clamp(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}
