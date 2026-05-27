"use client";

import { useEffect, useRef, useState } from "react";
import {
  getRefreshStatusAction,
  revalidateDashboardAction,
  startRefreshAction,
} from "./actions";

interface RunState {
  step: number;
  total: number;
  label: string;
  status: "running" | "ok" | "error";
  error: string | null;
  elapsedMs: number;
}

const POLL_INTERVAL_MS = 500;

/** Admin-only button that rebuilds the dashboard snapshot tables. Fires
 *  a background refresh and polls its status every 500ms so the user
 *  gets a labeled progress bar instead of an opaque "Refreshing…" with
 *  no indication of how far along it is.
 *
 *  Steps:
 *    1/4 Computing per-person activity rollup
 *    2/4 Classifying people
 *    3/4 Summarizing groups
 *    4/4 Aggregating org totals */
export function RefreshSnapshotsButton({
  isAdmin,
  refreshedAt,
}: {
  isAdmin: boolean;
  refreshedAt: string | null;
}) {
  const [run, setRun] = useState<RunState | null>(null);
  const [errMessage, setErrMessage] = useState<string | null>(null);
  // Poll interval id so we can cancel cleanly on unmount.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function pollUntilDone(runId: number) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const status = await getRefreshStatusAction(runId);
      if (!status) {
        setErrMessage("Refresh status not found.");
        if (pollRef.current) clearInterval(pollRef.current);
        return;
      }
      setRun({
        step: status.currentStep,
        total: status.totalSteps,
        label: status.stepLabel ?? "",
        status: status.status,
        error: status.error,
        elapsedMs: status.elapsedMs,
      });
      if (status.status !== "running") {
        if (pollRef.current) clearInterval(pollRef.current);
        if (status.status === "ok") {
          // Revalidate so the page re-reads the new snapshot. The
          // parent server component re-renders with a fresh
          // `refreshedAt` prop, then we clear the inline run-state
          // a moment later so the new stamp ("Snapshot updated …")
          // takes over from the green "Done" pill.
          await revalidateDashboardAction();
          setTimeout(() => setRun(null), 2500);
        }
      }
    }, POLL_INTERVAL_MS);
  }

  async function handleClick() {
    setErrMessage(null);
    setRun({
      step: 0,
      total: 4,
      label: "Starting…",
      status: "running",
      error: null,
      elapsedMs: 0,
    });
    const result = await startRefreshAction();
    if (!result.ok) {
      setErrMessage(result.message);
      setRun(null);
      return;
    }
    pollUntilDone(result.runId);
  }

  const isRunning = run?.status === "running";
  const isDone = run?.status === "ok";
  const isError = run?.status === "error";
  const pct = run ? Math.round((run.step / run.total) * 100) : 0;

  // Stamp from the latest committed snapshot, NOT the in-flight run.
  // Once a fresh run completes the parent server component
  // re-fetches and re-passes a newer refreshedAt prop.
  const stamp = refreshedAt
    ? `Snapshot updated ${new Date(refreshedAt).toLocaleString()}`
    : "Snapshot not built yet — click refresh.";

  return (
    <div className="flex items-center gap-3 text-xs flex-wrap justify-end">
      {!run && (
        <span className="text-subtle hidden xl:inline">{stamp}</span>
      )}

      {/* Inline progress bar — only while running or just-finished */}
      {run && (
        <div className="flex items-center gap-2 min-w-[260px]">
          <div className="flex-1 min-w-[160px]">
            <div className="h-1.5 rounded-full overflow-hidden bg-bg-elev-2 border border-border-soft">
              <div
                className={`h-full transition-[width] duration-300 ${
                  isError
                    ? "bg-warn-soft-fg"
                    : isDone
                      ? "bg-good-soft-fg"
                      : "bg-accent"
                }`}
                style={{ width: `${isDone ? 100 : pct}%` }}
              />
            </div>
            <div className="flex justify-between mt-1 text-[10px]">
              <span
                className={
                  isError
                    ? "text-warn-soft-fg"
                    : isDone
                      ? "text-good-soft-fg"
                      : "text-muted"
                }
              >
                {isError
                  ? `Error: ${run.error ?? "unknown"}`
                  : isDone
                    ? `Done · ${(run.elapsedMs / 1000).toFixed(1)}s`
                    : `${run.step}/${run.total} · ${run.label}`}
              </span>
              {!isError && (
                <span className="text-subtle tnum">
                  {isDone ? "100%" : `${pct}%`}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {errMessage && (
        <span className="text-warn-soft-fg text-[11px]">{errMessage}</span>
      )}

      {isAdmin && (
        <button
          type="button"
          onClick={handleClick}
          disabled={isRunning}
          className="px-2.5 py-1.5 rounded border border-border-soft text-muted hover:text-fg transition-colors disabled:opacity-50 cursor-pointer shrink-0"
        >
          {isRunning ? "Refreshing…" : "↻ Refresh"}
        </button>
      )}
    </div>
  );
}
