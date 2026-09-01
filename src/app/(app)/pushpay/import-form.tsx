"use client";

import { useRef, useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { type ImportCsvState, importPushpayCsvAction } from "./actions";

const INITIAL: ImportCsvState = { status: "idle" };

/** Drag-and-drop CSV uploader for the PushPay "All Donors" export. A dashed
 *  drop zone feeds a hidden native file input (so the existing server action's
 *  formData.get("file") still works); re-importing replaces the stored set. */
export function PushpayImportForm() {
  const [state, action, pending] = useActionState(importPushpayCsvAction, INITIAL);
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const r = state.result;

  function accept(file: File | undefined | null) {
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      setDropError("That's not a .csv file — export the PushPay donor list as CSV.");
      return;
    }
    // Push the dropped file into the real input so the form submits it natively.
    const dt = new DataTransfer();
    dt.items.add(file);
    if (inputRef.current) inputRef.current.files = dt.files;
    setFileName(file.name);
    setDropError(null);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    accept(e.dataTransfer.files?.[0]);
  }

  function clear() {
    if (inputRef.current) inputRef.current.value = "";
    setFileName(null);
    setDropError(null);
  }

  return (
    // key={state.status} remounts after a save so the zone + state reset cleanly.
    <form action={action} className="space-y-3" key={state.status}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        disabled={pending}
        aria-label="Choose or drop a PushPay CSV export"
        className={`w-full rounded-xl border-2 border-dashed px-5 py-8 text-center transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
          dragOver
            ? "border-accent bg-accent-soft-bg"
            : fileName
              ? "border-accent/60 bg-bg-elev"
              : "border-border-soft hover:border-accent/60 hover:bg-bg-elev"
        }`}
      >
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`mx-auto mb-2 ${fileName ? "text-accent" : "text-subtle"}`}
          aria-hidden="true"
        >
          <path d="M12 15V3" />
          <path d="m7 8 5-5 5 5" />
          <path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
        </svg>
        {fileName ? (
          <div className="text-sm">
            <span className="font-medium text-fg">{fileName}</span>
            <span className="text-subtle"> — ready to save</span>
          </div>
        ) : (
          <div className="text-sm text-muted">
            <span className="text-fg font-medium">Drag &amp; drop</span> your PushPay
            CSV here, or <span className="text-accent">click to browse</span>
          </div>
        )}
        <div className="text-[11px] text-subtle mt-1">
          Donors → All Donors, exported as .csv
        </div>
      </button>

      {/* Hidden native input — the form actually submits this. */}
      <input
        ref={inputRef}
        type="file"
        name="file"
        accept=".csv"
        required
        disabled={pending}
        onChange={(e) => {
          setFileName(e.target.files?.[0]?.name ?? null);
          setDropError(null);
        }}
        className="sr-only"
        tabIndex={-1}
      />

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || !fileName}
          className="px-3 py-1.5 rounded-lg border border-accent text-accent hover:bg-accent hover:text-bg disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium cursor-pointer"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {fileName && !pending && (
          <button
            type="button"
            onClick={clear}
            className="text-xs text-subtle hover:text-fg cursor-pointer"
          >
            Remove
          </button>
        )}
        {dropError && <span className="text-xs text-warn-soft-fg">{dropError}</span>}
        {state.status === "ok" && (
          <span className="text-xs text-good-soft-fg">{state.message}</span>
        )}
        {state.status === "error" && (
          <span className="text-xs text-warn-soft-fg">{state.message}</span>
        )}
      </div>

      {r && (
        <div className="rounded-lg border border-border-soft overflow-hidden">
          <div className="grid grid-cols-4 divide-x divide-border-softer text-center">
            <Stat label="Donors" value={r.total} tone="fg" />
            <Stat label="Matched" value={r.matched} tone="good" />
            <Stat label="To review" value={r.ambiguous} tone="warn" />
            <Stat label="Unmatched" value={r.unmatched} tone="muted" />
          </div>
          {(r.ambiguous > 0 || r.unmatched > 0) && (
            <Link
              href="/audit/pushpay"
              className="block border-t border-border-softer px-3 py-2 text-xs font-medium text-accent hover:bg-accent-soft-bg"
            >
              Review {(r.ambiguous + r.unmatched).toLocaleString()} donors that need a person →
            </Link>
          )}
        </div>
      )}
    </form>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "fg" | "good" | "warn" | "muted";
}) {
  const cls =
    tone === "good"
      ? "text-good-soft-fg"
      : tone === "warn"
        ? "text-warn-soft-fg"
        : tone === "muted"
          ? "text-muted"
          : "text-fg";
  return (
    <div className="px-2 py-3">
      <div className={`text-lg font-semibold tnum ${cls}`}>{value.toLocaleString()}</div>
      <div className="text-[11px] text-subtle mt-0.5">{label}</div>
    </div>
  );
}
