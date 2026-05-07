"use client";

import { useActionState, useState } from "react";
import { saveAttendanceAction, type AttendanceSaveState } from "./actions";

export function AttendanceForm({
  initial,
  isAdmin,
}: {
  initial: number | null;
  isAdmin: boolean;
}) {
  const [value, setValue] = useState<string>(initial == null ? "" : String(initial));
  const [state, action, pending] = useActionState<AttendanceSaveState | null, FormData>(
    saveAttendanceAction,
    null,
  );
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="weekly" className="text-xs text-muted block mb-1.5">
          Average weekly Sunday attendance
        </label>
        <div className="flex items-center gap-3">
          <input
            id="weekly"
            name="weekly"
            type="number"
            min={0}
            max={1_000_000}
            step={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={!isAdmin}
            placeholder="e.g. 3000"
            className="bg-transparent border border-border-soft rounded px-3 py-2 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent disabled:opacity-60"
          />
          <span className="text-xs text-muted">people / week</span>
        </div>
        <p className="text-xs text-subtle mt-1.5">
          Use a recent 4-week rolling average for the most representative number. Update
          when seasons change.
        </p>
      </div>
      {state?.status === "saved" && (
        <div className="rounded border border-good-soft-bg bg-good-soft-bg/40 px-3 py-2 text-sm text-good-soft-fg">
          {state.message}
        </div>
      )}
      {state?.status === "error" && (
        <div className="rounded border border-bad-soft-bg bg-bad-soft-bg/40 px-3 py-2 text-sm text-bad-soft-fg">
          {state.message}
        </div>
      )}
      <div className="flex justify-end pt-3 border-t border-border-soft">
        <button
          type="submit"
          disabled={!isAdmin || pending}
          className="px-3 py-1.5 rounded bg-accent text-[var(--accent-fg)] text-xs font-medium disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
