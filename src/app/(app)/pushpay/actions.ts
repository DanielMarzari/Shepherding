"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import { importPushpay, importPushpayTransactions, isTransactionsExport, assignDonor, clearDonorMatch, rematchDonors, removePushpayUpload, type HandMatchCarryResult } from "@/lib/pushpay-import";

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
    // Two different PushPay exports land on this one button. All Donors is a
    // summary, one row per donor; Transactions is one row per gift. They are
    // told apart by their header rather than by asking, because an operator
    // should not have to know which upload slot to use.
    if (isTransactionsExport(text)) {
      const t = importPushpayTransactions(s.orgId, file.name, text);
      revalidatePath("/pushpay");
      revalidatePath("/audit");
      revalidatePath("/lanes/give");
      const span = t.firstDate && t.lastDate ? ` covering ${t.firstDate} to ${t.lastDate}` : "";
      return {
        status: "ok",
        message:
          `Imported ${t.total.toLocaleString()} gifts${span} — ` +
          `${t.byYourId.toLocaleString()} matched by PCO id, ` +
          (t.byDonorManual ? `${t.byDonorManual.toLocaleString()} by a hand match on the donor list, ` : "") +
          `${t.byDonorMatch.toLocaleString()} by name, ` +
          `${t.unmatched.toLocaleString()} unmatched. Gifts are added to the history, not replaced.`,
        result: { fileName: file.name, total: t.total, matched: t.byYourId + t.byDonorManual + t.byDonorMatch, ambiguous: 0, unmatched: t.unmatched },
      };
    }
    const r = importPushpay(s.orgId, file.name, text);
    revalidatePath("/pushpay");
    revalidatePath("/audit");
    revalidatePath("/audit/pushpay");
    revalidatePath("/lanes/give");
    return {
      status: "ok",
      message:
        `Imported ${r.total.toLocaleString()} donors — ${r.matched.toLocaleString()} matched, ${r.ambiguous.toLocaleString()} to review, ${r.unmatched.toLocaleString()} unmatched.` +
        handMatchSummary(r.handMatches),
      result: { fileName: file.name, total: r.total, matched: r.matched, ambiguous: r.ambiguous, unmatched: r.unmatched },
    };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Import failed. Check the file format.",
    };
  }
}

/** What became of the hand matches on the upload this one replaced, in plain
 *  words. Nothing to say when there were none. */
function handMatchSummary(h: HandMatchCarryResult): string {
  if (h.before === 0) return "";
  const n = (x: number, one: string, many: string) => `${x.toLocaleString()} ${x === 1 ? one : many}`;
  const parts = [`${n(h.kept, "was", "were")} kept`];
  if (h.toReview) parts.push(`${n(h.toReview, "is", "are")} back in Needs review, because the new file can't say for sure which row is theirs`);
  if (h.notFound) parts.push(`${n(h.notFound, "has", "have")} no row in the new file (the donor left the export or changed their name)`);
  return ` Of the ${n(h.before, "donor", "donors")} matched by hand, ${parts.join("; ")}.`;
}

export interface RemoveUploadState {
  status: "ok" | "error";
  message: string;
}

/** Take one upload back out: the gifts no other upload supplies, or — for an
 *  All Donors upload — the whole donor set it replaced. What survives, and
 *  why, is spelled out in the confirmation the UI shows and repeated here,
 *  including the one irreversible part: a gift that stays holding the values
 *  this file wrote cannot be given its earlier ones back. */
export async function removePushpayUploadAction(uploadId: number): Promise<RemoveUploadState> {
  const s = await requireOrg();
  if (s.role !== "admin") return { status: "error", message: "Only admins can remove a dataset." };
  if (!Number.isInteger(uploadId)) return { status: "error", message: "Missing which upload to remove." };
  try {
    const r = removePushpayUpload(s.orgId, uploadId);
    revalidatePath("/pushpay");
    revalidatePath("/audit");
    revalidatePath("/audit/pushpay");
    revalidatePath("/lanes/give");
    const name = r.fileName ?? "that upload";
    if (r.kind === "donors") {
      return {
        status: "ok",
        message: r.supersededDonors
          ? `Removed the record of ${name}. Its donors had already been replaced by a later All Donors upload, so no donor rows were in it.`
          : `Removed ${name} and the ${r.donorsRemoved.toLocaleString()} donor${r.donorsRemoved === 1 ? "" : "s"} it loaded.`,
      };
    }
    const g = (x: number) => `${x.toLocaleString()} gift${x === 1 ? "" : "s"}`;
    const kept = r.giftsKept
      ? ` ${g(r.giftsKept)} stayed, because another upload carried ${r.giftsKept === 1 ? "it" : "them"} too.`
      : "";
    const mine = r.giftsKeepingValues
      ? ` ${g(r.giftsKeepingValues)} of those still hold the fund, source and person this file wrote; we keep no earlier version of a gift, so that cannot be undone.`
      : "";
    return {
      status: "ok",
      message: `Removed ${name}: ${g(r.giftsRemoved)} deleted.${kept}${mine}`,
    };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "Could not remove that upload." };
  }
}

/** Re-run matching on the imported donors with the latest rules (no re-upload).
 *  Preserves manual assignments. Returns a short summary for the UI. */
export async function rematchDonorsAction(): Promise<{ ok: boolean; message: string }> {
  const s = await requireOrg();
  if (s.role !== "admin") return { ok: false, message: "Admin only." };
  const r = rematchDonors(s.orgId);
  revalidatePath("/audit/pushpay");
  revalidatePath("/pushpay");
  revalidatePath("/lanes/give");
  return {
    ok: true,
    message: `Re-matched ${r.total.toLocaleString()} donors — ${r.matched.toLocaleString()} matched, ${r.ambiguous.toLocaleString()} to review, ${r.unmatched.toLocaleString()} unmatched (${r.changed.toLocaleString()} changed).`,
  };
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
