"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import {
  type SyncFrequency,
  type SyncSettings,
  recordManualSync,
  saveCreds,
  saveSyncEntities,
  saveSyncSettings,
  testPcoConnection,
} from "@/lib/pco";

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
  const settings: SyncSettings = {
    enabled,
    frequency,
    runAtHour,
    runAtDow,
    runAtDom,
    emailOnFailure,
    autoResolveConflicts,
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
  status: "idle" | "ok" | "error";
  message?: string;
}

export async function syncNowAction(
  _prev: SyncNowState | null,
  _formData: FormData,
): Promise<SyncNowState> {
  const s = await requireOrg();
  if (s.role !== "admin") {
    return { status: "error", message: "Only admins can trigger a sync." };
  }
  // Stub for now — real PCO pull lands in a follow-up. Records the run.
  recordManualSync(s.orgId);
  revalidatePath("/pco");
  return { status: "ok", message: "Manual sync recorded. (Pull job stubbed for now.)" };
}

function clamp(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}
