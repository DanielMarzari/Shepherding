"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import {
  type SyncFrequency,
  type SyncSettings,
  saveCreds,
  saveSyncSettings,
  testPcoConnection,
} from "@/lib/pco";

const VALID_FREQ: SyncFrequency[] = ["15m", "30m", "hourly", "daily", "weekly", "monthly"];

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

  // Test once more before saving — ensure creds still work.
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
  const runAtHour = Number.isFinite(runAtHourRaw)
    ? Math.max(0, Math.min(23, Math.floor(runAtHourRaw)))
    : 0;
  const emailOnFailure = formData.get("emailOnFailure") === "on";
  const autoResolveConflicts = formData.get("autoResolveConflicts") === "on";
  const settings: SyncSettings = {
    enabled,
    frequency,
    runAtHour,
    emailOnFailure,
    autoResolveConflicts,
  };
  saveSyncSettings(s.orgId, settings);
  revalidatePath("/pco");
  return { status: "saved", message: "Sync settings saved." };
}
