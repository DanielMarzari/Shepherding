"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import { deletePushpayCreds, savePushpayCreds } from "@/lib/pushpay";
import { importPushpay, assignDonor, clearDonorMatch } from "@/lib/pushpay-import";

export interface SaveState {
  status: "idle" | "saved" | "error";
  message?: string;
}

export interface ImportCsvState {
  status: "idle" | "ok" | "error";
  message?: string;
  result?: { fileName: string; total: number; matched: number; ambiguous: number; unmatched: number };
}

export async function importPushpayCsvAction(
  _prev: ImportCsvState | null,
  formData: FormData,
): Promise<ImportCsvState> {
  const s = await requireOrg();
  if (s.role !== "admin") {
    return { status: "error", message: "Only admins can import giving." };
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Pick a PushPay CSV export to import." };
  }
  if (!/\.csv$/i.test(file.name)) {
    return { status: "error", message: "That doesn't look like a .csv file." };
  }
  try {
    const text = await file.text();
    const r = importPushpay(s.orgId, file.name, text);
    revalidatePath("/pushpay");
    revalidatePath("/audit");
    revalidatePath("/audit/pushpay");
    revalidatePath("/lanes/give");
    return {
      status: "ok",
      message: `Imported ${r.total.toLocaleString()} donors — ${r.matched.toLocaleString()} matched, ${r.ambiguous.toLocaleString()} to review, ${r.unmatched.toLocaleString()} unmatched.`,
      result: { fileName: file.name, ...r },
    };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Import failed. Check the file format.",
    };
  }
}

/** Reconcile a donor → assign it to a person (used on the audit PushPay connections page). */
export async function assignDonorAction(formData: FormData) {
  const s = await requireOrg();
  if (s.role !== "admin") throw new Error("Admin only");
  const donorKey = String(formData.get("donorKey") ?? "");
  const personId = String(formData.get("personId") ?? "");
  if (!donorKey || !personId) return;
  assignDonor(s.orgId, donorKey, personId);
  revalidatePath("/audit/pushpay");
  revalidatePath("/lanes/give");
}

/** Undo a match → back to ambiguous / unmatched. */
export async function clearDonorMatchAction(formData: FormData) {
  const s = await requireOrg();
  if (s.role !== "admin") throw new Error("Admin only");
  const donorKey = String(formData.get("donorKey") ?? "");
  if (!donorKey) return;
  clearDonorMatch(s.orgId, donorKey);
  revalidatePath("/audit/pushpay");
  revalidatePath("/lanes/give");
}

export async function savePushpayCredentialsAction(
  _prev: SaveState | null,
  formData: FormData,
): Promise<SaveState> {
  const s = await requireOrg();
  if (s.role !== "admin") {
    return { status: "error", message: "Only admins can change PushPay credentials." };
  }
  const clientId = String(formData.get("clientId") ?? "").trim();
  const clientSecret = String(formData.get("clientSecret") ?? "").trim();
  const orgKeyRaw = String(formData.get("orgKey") ?? "").trim();
  const orgKey = orgKeyRaw === "" ? null : orgKeyRaw;

  if (!clientId || !clientSecret) {
    return { status: "error", message: "Client ID and Client Secret are required." };
  }

  // No PushPay API call yet — we just store the credentials securely.
  savePushpayCreds(s.orgId, clientId, clientSecret, orgKey);
  revalidatePath("/pushpay");
  return {
    status: "saved",
    message: "Credentials stored securely. Sync will be wired up next.",
  };
}

export async function removePushpayCredentialsAction() {
  const s = await requireOrg();
  if (s.role !== "admin") throw new Error("Admin only");
  deletePushpayCreds(s.orgId);
  revalidatePath("/pushpay");
}
