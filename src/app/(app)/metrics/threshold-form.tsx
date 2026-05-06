"use client";

import { useActionState, useState } from "react";
import { saveThresholdsAction, type MetricsSaveState } from "./actions";

export function ThresholdForm({
  initialActivity,
  initialSync,
  isAdmin,
}: {
  initialActivity: number;
  initialSync: number;
  isAdmin: boolean;
}) {
  const [activity, setActivity] = useState(initialActivity);
  const [sync, setSync] = useState(initialSync);
  const [state, action, pending] = useActionState<MetricsSaveState | null, FormData>(
    saveThresholdsAction,
    null,
  );
  return (
    <form action={action} className="space-y-5">
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <label className="text-sm font-medium" htmlFor="activityMonths">
            Activity threshold
          </label>
          <span className="tnum text-sm text-muted">{activity} months</span>
        </div>
        <p className="text-xs text-muted mb-2.5">
          A person counts as <span className="text-good-soft-fg font-medium">active</span> if
          they have any measurable PCO activity in this window. Anyone created in this window
          but with no activity is <span className="text-accent font-medium">present</span>.
          Everyone else with no activity is{" "}
          <span className="text-warn-soft-fg font-medium">inactive</span>.
        </p>
        <input
          id="activityMonths"
          name="activityMonths"
          type="range"
          min="1"
          max="36"
          step="1"
          value={activity}
          onChange={(e) => setActivity(Number(e.target.value))}
          disabled={!isAdmin}
          className="w-full accent-[var(--accent)] disabled:opacity-50"
        />
        <div className="flex justify-between text-[10px] text-subtle tnum mt-1">
          <span>1 mo</span>
          <span>12 mo</span>
          <span>18 mo</span>
          <span>24 mo</span>
          <span>36 mo</span>
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <label className="text-sm font-medium" htmlFor="syncThresholdMonths">
            Sync look-back threshold
          </label>
          <span className="tnum text-sm text-muted">{sync} months</span>
        </div>
        <p className="text-xs text-muted mb-2.5">
          Each sync always pulls at least the last <em>{sync}</em> months — even when our
          cursor is more recent. Catches retroactive PCO edits without re-fetching ancient
          records that won&apos;t change.
        </p>
        <input
          id="syncThresholdMonths"
          name="syncThresholdMonths"
          type="range"
          min="1"
          max="24"
          step="1"
          value={sync}
          onChange={(e) => setSync(Number(e.target.value))}
          disabled={!isAdmin}
          className="w-full accent-[var(--accent)] disabled:opacity-50"
        />
        <div className="flex justify-between text-[10px] text-subtle tnum mt-1">
          <span>1 mo</span>
          <span>3 mo</span>
          <span>6 mo</span>
          <span>12 mo</span>
          <span>24 mo</span>
        </div>
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
          className="px-3 py-1.5 rounded bg-accent text-[var(--accent-fg)] text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? "Saving…" : "Save thresholds"}
        </button>
      </div>
    </form>
  );
}
