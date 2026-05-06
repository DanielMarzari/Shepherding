"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { getSyncStatusAction, syncNowAction, type SyncStatusState } from "./actions";

export function SyncNowButton() {
  const router = useRouter();
  const [status, setStatus] = useState<SyncStatusState | null>(null);
  const [pending, startTransition] = useTransition();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // On mount: check whether a sync is already running (e.g. user navigated
  // away mid-sync and came back). If so, start polling.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getSyncStatusAction();
      if (!cancelled) {
        setStatus(s);
        if (s.running) startPolling();
      }
    })();
    return () => {
      cancelled = true;
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const s = await getSyncStatusAction();
      setStatus(s);
      if (!s.running) {
        stopPolling();
        // Refresh server-rendered counts on the page.
        router.refresh();
      }
    }, 3000);
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function onClick() {
    startTransition(async () => {
      const fd = new FormData();
      const result = await syncNowAction(null, fd);
      if (result.status === "started" || result.status === "already-running") {
        const s = await getSyncStatusAction();
        setStatus(s);
        if (s.running) startPolling();
      } else if (result.status === "error") {
        setStatus({
          running: false,
          startedAt: null,
          finishedAt: null,
          status: "error",
          changes: 0,
          warning: result.message ?? "Sync failed.",
          details: null,
        });
      }
    });
  }

  const running = status?.running ?? false;
  const lastDone = !running && status?.status && status.status !== "running" ? status : null;

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onClick}
        disabled={pending || running}
        className="px-3 py-1.5 rounded bg-accent text-[var(--accent-fg)] text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={running || pending ? "animate-spin" : ""}
        >
          <path d="M3 12a9 9 0 0 1 15.5-6.3M21 4v5h-5" />
          <path d="M21 12a9 9 0 0 1-15.5 6.3M3 20v-5h5" />
        </svg>
        {running ? "Syncing in background…" : pending ? "Starting…" : "Sync now"}
      </button>
      {running && status?.startedAt && (
        <span className="text-xs text-muted">
          started {relativeMinutes(status.startedAt)} · safe to navigate away
        </span>
      )}
      {!running && lastDone && lastDone.status === "ok" && lastDone.details && (
        <span className="text-xs text-good-soft-fg">
          Synced {lastDone.details.people.upserted.toLocaleString()} people,{" "}
          {lastDone.details.formSubmissions.upserted} submissions in{" "}
          {(lastDone.details.durationMs / 1000).toFixed(1)}s
          {lastDone.warning ? ` · ⚠ ${lastDone.warning}` : ""}
        </span>
      )}
      {!running && lastDone && lastDone.status === "error" && (
        <span className="text-xs text-bad-soft-fg">
          Last sync failed: {lastDone.warning ?? "unknown error"}
        </span>
      )}
    </div>
  );
}

function relativeMinutes(iso: string): string {
  const ms = Date.now() - new Date(iso).valueOf();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m === 1) return "1 min ago";
  return `${m} min ago`;
}
