"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import {
  assignPayer,
  clearPayerMatch,
  importPushpay,
  importPushpayTransactions,
  isTransactionsExport,
  rematchPayers,
  removePushpayUpload,
  type HandMatchCarryResult,
} from "@/lib/pushpay-import";

export interface ImportCsvState {
  status: "idle" | "ok" | "error";
  message?: string;
  /** `total`, `matched`, `ambiguous` and `unmatched` count DONORS for an All
   *  Donors upload and GIFTS for a Transactions one, which is why `kind` is
   *  here: the panel that shows them has to label them correctly. `toPlace` is
   *  a count of GIVERS, and only a Transactions upload has one. */
  result?: {
    fileName: string;
    kind: "donors" | "transactions";
    total: number;
    matched: number;
    ambiguous: number;
    unmatched: number;
    toPlace?: number;
  };
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
      revalidatePath("/audit/pushpay");
      revalidatePath("/giving");
      const span = t.firstDate && t.lastDate ? ` covering ${t.firstDate} to ${t.lastDate}` : "";
      const place = t.payersToPlace
        ? ` ${t.payersStored.toLocaleString()} givers have a name on file now; ${t.payersToPlace.toLocaleString()} still need a person — place them on PushPay connections.`
        : ` All ${t.payersStored.toLocaleString()} givers in the file are tied to a person.`;
      // An import decides who a GIVER is, and every one of that giver's gifts
      // follows — including gifts from windows this file does not contain. That
      // is what keeps the queue, the rollups and the Give lane agreeing, but it
      // means a narrow upload can move giving nobody was looking at. Say so.
      const earlier =
        t.earlierGiftsRelinked || t.earlierGiftsUnlinked
          ? ` Outside this file's dates, ${(t.earlierGiftsRelinked + t.earlierGiftsUnlinked).toLocaleString()} earlier gifts followed their giver` +
            (t.earlierGiftsUnlinked
              ? ` — ${t.earlierGiftsUnlinked.toLocaleString()} of them now have no person, because this file could not place the giver they belong to.`
              : " to the person this file names.")
          : "";
      return {
        status: "ok",
        message:
          `Imported ${t.total.toLocaleString()} gifts${span} — ` +
          `${t.byYourId.toLocaleString()} matched by PCO id, ` +
          (t.byPayerManual ? `${t.byPayerManual.toLocaleString()} by a hand match on the giver, ` : "") +
          (t.byDonorManual ? `${t.byDonorManual.toLocaleString()} by a hand match on the donor list, ` : "") +
          `${t.byDonorMatch.toLocaleString()} by name, ` +
          `${t.unmatched.toLocaleString()} unmatched. Gifts are added to the history, not replaced.` +
          place +
          earlier,
        result: {
          fileName: file.name,
          kind: "transactions",
          total: t.total,
          matched: t.byYourId + t.byPayerManual + t.byDonorManual + t.byDonorMatch,
          ambiguous: 0,
          unmatched: t.unmatched,
          toPlace: t.payersToPlace,
        },
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
      result: { fileName: file.name, kind: "donors", total: r.total, matched: r.matched, ambiguous: r.ambiguous, unmatched: r.unmatched },
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
    revalidatePath("/giving");
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

/** Every surface a giver's link shows up on. A hand match rewrites that
 *  giver's gifts and rebuilds the rollups in one transaction, so all of these
 *  are right the moment the action returns — they only need re-rendering. */
function revalidateGiving() {
  revalidatePath("/audit/pushpay");
  revalidatePath("/pushpay");
  revalidatePath("/lanes/give");
  revalidatePath("/giving");
}

/** Re-run matching over the stored giver profiles with the latest rules and
 *  PCO data (no re-upload). Hand matches are left alone. */
export async function rematchPayersAction(): Promise<{ ok: boolean; message: string }> {
  const s = await requireOrg();
  if (s.role !== "admin") return { ok: false, message: "Admin only." };
  const r = rematchPayers(s.orgId);
  revalidateGiving();
  if (r.total === 0) {
    return {
      ok: true,
      message: "No giver profiles are stored yet — import the Transactions export on PushPay first.",
    };
  }
  return {
    ok: true,
    message:
      `Re-matched ${r.total.toLocaleString()} givers — ${r.matched.toLocaleString()} matched, ` +
      `${r.manual.toLocaleString()} kept as hand matches, ${r.ambiguous.toLocaleString()} to review, ` +
      `${r.unmatched.toLocaleString()} unmatched (${r.changed.toLocaleString()} changed).`,
  };
}

export interface PayerMatchState {
  ok: boolean;
  message?: string;
}

/** Place a giver on a person by hand (the audit PushPay connections page). */
export async function assignPayerAction(formData: FormData): Promise<PayerMatchState> {
  const s = await requireOrg();
  if (s.role !== "admin") return { ok: false, message: "Only admins can place a giver." };
  const payerId = String(formData.get("payerId") ?? "");
  const personId = String(formData.get("personId") ?? "");
  if (!payerId || !personId) return { ok: false, message: "Missing which giver to place." };
  try {
    assignPayer(s.orgId, payerId, personId);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not place that giver." };
  }
  revalidateGiving();
  return { ok: true };
}

/** Undo a hand match → back to whatever automatic matching says now. */
export async function clearPayerMatchAction(formData: FormData): Promise<PayerMatchState> {
  const s = await requireOrg();
  if (s.role !== "admin") return { ok: false, message: "Only admins can change a giver's match." };
  const payerId = String(formData.get("payerId") ?? "");
  if (!payerId) return { ok: false, message: "Missing which giver to unassign." };
  try {
    clearPayerMatch(s.orgId, payerId);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not unassign that giver." };
  }
  revalidateGiving();
  return { ok: true };
}
