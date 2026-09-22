"use client";

import { useState, useTransition } from "react";
import type { PushpayUploadRow } from "@/lib/pushpay-import";
import { removePushpayUploadAction } from "./actions";

/** One upload, with its timestamp already formatted on the server so the list
 *  reads the same before and after hydration. */
export interface UploadView extends PushpayUploadRow {
  importedLabel: string;
}

const n = (x: number) => x.toLocaleString();
const plural = (x: number, one: string, many = `${one}s`) => `${n(x)} ${x === 1 ? one : many}`;

/** The sentence about the gifts that stay: WHY they stay, and — separately —
 *  which of them keep the values this file wrote.
 *
 *  These are two different sets and were once described as one. A gift stays
 *  because some other upload also carried it, older or newer. What it then
 *  holds is whatever upload wrote it LAST, which is this file only for the
 *  gifts it re-supplied; the ones a later file re-supplied hold that later
 *  file's fund, source and person. Only the first set is irreversible from
 *  our side, so only it carries the warning. */
function keptSentences(u: UploadView): string {
  if (u.giftsShared === 0) return "";
  // When it owns nothing, the opening line has already said every gift here is
  // in another upload — no need to say it twice.
  const stay =
    u.giftsOwned === 0
      ? ""
      : `${plural(u.giftsShared, "gift")} in this file ${u.giftsShared === 1 ? "stays" : "stay"}, because another upload carried ${u.giftsShared === 1 ? "it" : "them"} too.`;
  if (u.giftsKeepingValues === 0) return stay ? `\n\n${stay}` : "";
  const which =
    u.giftsKeepingValues === u.giftsShared
      ? `${u.giftsKeepingValues === 1 ? "That gift still holds" : "Those gifts still hold"}`
      : `${plural(u.giftsKeepingValues, "of them still holds", "of them still hold")}`;
  return `\n\n${stay}${stay ? " " : ""}${which} the fund, source and person THIS file wrote — we keep no earlier version of a gift, so that part cannot be undone.`;
}

/** Exactly what Remove will do, in the words the confirmation asks with. */
function confirmText(u: UploadView): string {
  const name = u.fileName ?? "this upload";
  if (u.kind === "donors") {
    if (u.superseded) {
      return `Remove the record of ${name}?\n\nA later All Donors upload has already replaced its donors, so there are no donor rows left from it. This removes only its line in this list.`;
    }
    return `Remove ${name}?\n\nAn All Donors upload replaces the whole donor list, so this deletes all ${plural(u.donorsHeld, "donor")} — including any matched by hand.\n\nThis cannot be undone.`;
  }
  if (u.giftsHeld === 0) {
    return `Remove ${name}?\n\nNone of this file's gifts are in the database any more, so this removes only its line in this list.`;
  }
  if (u.giftsOwned === 0) {
    // Nothing is deleted, so the only warning that belongs here is the one
    // about the values it wrote, which keptSentences adds when it applies.
    return `Remove ${name}?\n\nThis deletes no gifts on its own: all ${plural(u.giftsHeld, "gift")} in this file are in another upload too, and that upload keeps them here. Remove that one as well and they go with it.${keptSentences(u)}`;
  }
  return `Remove ${name}?\n\nThis deletes ${plural(u.giftsOwned, "gift")}: the ones no other upload supplies.${keptSentences(u)}\n\nThis cannot be undone.`;
}

/** What the row says Remove will take, under the button, so an admin reads it
 *  before opening the dialog. */
function removeSummary(u: UploadView): string {
  if (u.kind === "donors") {
    return u.superseded
      ? "Already replaced by a later upload — Remove takes out this record only."
      : `Remove deletes all ${plural(u.donorsHeld, "donor")}.`;
  }
  if (u.giftsHeld === 0) return "None of its gifts are still here — Remove takes out this record only.";
  if (u.giftsOwned === 0) {
    return `Remove deletes nothing on its own: all ${plural(u.giftsHeld, "gift")} in this file are in another upload too. Remove that one as well.`;
  }
  const kept = u.giftsShared ? ` ${plural(u.giftsShared, "gift")} another upload also carried would stay.` : "";
  const mine = u.giftsKeepingValues
    ? ` ${plural(u.giftsKeepingValues, "gift")} would keep the values this file wrote.`
    : "";
  return `Remove deletes ${plural(u.giftsOwned, "gift")}.${kept}${mine}`;
}

export function PushpayUploadList({ uploads, isAdmin }: { uploads: UploadView[]; isAdmin: boolean }) {
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ status: "ok" | "error"; message: string } | null>(null);

  if (uploads.length === 0) {
    return (
      <p className="text-sm text-muted">
        No uploads recorded yet. The first file you save shows up here, with what it brought
        and a way to take it back out.
      </p>
    );
  }

  function remove(u: UploadView) {
    if (!window.confirm(confirmText(u))) return;
    setBusyId(u.id);
    start(async () => {
      const r = await removePushpayUploadAction(u.id);
      setMsg(r);
      setBusyId(null);
    });
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border-softer rounded-lg border border-border-soft">
        {uploads.map((u) => (
          <li key={u.id} className="flex flex-wrap items-start gap-3 px-3.5 py-3 text-sm">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="rounded border border-border-soft px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted">
                  {u.kind === "donors" ? "All donors" : "Transactions"}
                </span>
                <span className="font-medium break-words">
                  {u.fileName ?? (u.isBackfilled ? "Before this list began" : "Unnamed file")}
                </span>
                <span className="text-[11px] text-subtle tnum">{u.importedLabel}</span>
              </div>

              {u.isBackfilled && (
                <div className="text-[11px] text-muted">
                  Stands for every gift already imported when this list started. One record for
                  all of them, so they can be removed like any other dataset.
                </div>
              )}

              <div className="text-[11px] text-subtle tnum">
                {u.kind === "donors" ? (
                  <>
                    {plural(u.total, "donor")} in the file · {n(u.matched)} matched ·{" "}
                    {n(u.ambiguous)} to review · {n(u.unmatched)} unmatched
                  </>
                ) : (
                  <>
                    {plural(u.total, "gift")} in the file · {n(u.inserted)} new to us
                    {/* Only when it differs from the file's own count: a gift
                        can have gone with another dataset, or the file can
                        list one twice. */}
                    {u.giftsHeld !== u.total ? <> · {n(u.giftsHeld)} still here</> : null}
                    {u.firstGiftOn && u.lastGiftOn ? (
                      <> · gifts dated {u.firstGiftOn} → {u.lastGiftOn}</>
                    ) : null}
                  </>
                )}
              </div>

              {u.kind === "transactions" && (
                <div className="text-[11px] text-subtle tnum">
                  {n(u.byYourId)} matched by PCO id · {n(u.byDonorManual)} by a hand match ·{" "}
                  {n(u.byDonorMatch)} by name · {n(u.unmatched)} unmatched
                </div>
              )}

              {isAdmin && <div className="text-[11px] text-muted">{removeSummary(u)}</div>}
            </div>

            {isAdmin && (
              <button
                type="button"
                onClick={() => remove(u)}
                disabled={pending}
                className="shrink-0 text-xs text-muted hover:text-warn-soft-fg disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer underline-offset-2 hover:underline"
              >
                {busyId === u.id ? "Removing…" : u.kind === "donors" && u.superseded ? "Remove record" : "Remove"}
              </button>
            )}
          </li>
        ))}
      </ul>

      {msg && (
        <p className={`text-xs ${msg.status === "ok" ? "text-good-soft-fg" : "text-warn-soft-fg"}`}>
          {/* The leading word carries the outcome, so the message never depends
              on its colour alone. */}
          <span className="font-semibold">{msg.status === "ok" ? "Done — " : "Couldn't remove — "}</span>
          {msg.message}
        </p>
      )}
    </div>
  );
}
