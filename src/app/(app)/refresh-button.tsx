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

/** Admin-only refresh control. The button sits in the page header;
 *  while a refresh is in flight a full-width progress banner mounts
 *  below the header (via a portal-style fixed element rendered in the
 *  same component) so the bar always has room to display regardless
 *  of the header's flex / wrap behaviour. */
export function RefreshSnapshotsButton({
  isAdmin,
  refreshedAt,
}: {
  isAdmin: boolean;
  refreshedAt: string | null;
}) {
  const [run, setRun] = useState<RunState | null>(null);
  const [errMessage, setErrMessage] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function pollUntilDone(runId: number) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
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
            await revalidateDashboardAction();
            setTimeout(() => setRun(null), 2500);
          }
        }
      } catch (e) {
        setErrMessage(e instanceof Error ? e.message : "Poll failed.");
        if (pollRef.current) clearInterval(pollRef.current);
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
    try {
      const result = await startRefreshAction();
      if (!result.ok) {
        setErrMessage(result.message);
        setRun(null);
        return;
      }
      pollUntilDone(result.runId);
    } catch (e) {
      setErrMessage(e instanceof Error ? e.message : "Failed to start.");
      setRun(null);
    }
  }

  const isRunning = run?.status === "running";
  const isDone = run?.status === "ok";
  const isError = run?.status === "error";
  // 0% with no work yet would look stuck — start the bar at a visible
  // 5% so the user sees motion as soon as they click.
  const pct = run
    ? run.step === 0
      ? 5
      : Math.round((run.step / run.total) * 100)
    : 0;

  return (
    <>
      <div className="flex items-center gap-3 text-xs flex-wrap justify-end">
        {!run && (
          <span className="text-subtle hidden xl:inline">
            {refreshedAt
              ? `Snapshot updated ${new Date(refreshedAt).toLocaleString()}`
              : "Snapshot not built yet — click refresh."}
          </span>
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

      {/* Fixed-position status banner — top-right of viewport, above
          everything else. Can't be squeezed by parent flex layouts.
          Slides in while a refresh is in flight and stays visible
          through completion (then auto-dismisses 2.5s after ok). */}
      {run && (
        <div
          className="fixed top-4 right-4 z-50 w-[340px] max-w-[calc(100vw-2rem)] rounded-lg border border-border-soft bg-bg-elev shadow-lg p-3"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-baseline justify-between gap-3 text-xs mb-2">
            <span
              className={
                isError
                  ? "text-warn-soft-fg font-medium"
                  : isDone
                    ? "text-good-soft-fg font-medium"
                    : "text-fg font-medium"
              }
            >
              {isError
                ? `Refresh failed`
                : isDone
                  ? `Refresh complete in ${(run.elapsedMs / 1000).toFixed(1)}s`
                  : `Refreshing snapshot · step ${run.step}/${run.total}`}
            </span>
            <span className="tnum text-subtle">
              {isDone ? "100%" : `${pct}%`}
            </span>
          </div>
          <div className="h-2 rounded-full overflow-hidden bg-bg-elev-2 border border-border-soft">
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
          <div className="mt-2 text-[11px] text-muted break-words">
            {isError ? (run.error ?? "unknown error") : run.label || "Starting…"}
          </div>
        </div>
      )}
    </>
  );
}
