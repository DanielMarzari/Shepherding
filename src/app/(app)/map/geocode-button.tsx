"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { geocodeStatusAction, startGeocodeAction } from "./actions";

interface Status {
  running: boolean;
  processed: number;
  matched: number;
  total: number;
  remaining: number;
  error?: string;
}

export function GeocodeButton({
  pending,
  isAdmin,
}: {
  pending: number;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const wasRunning = useRef(false);

  // Poll while a run is active (and once on mount to pick up a run that's
  // already going from a previous visit / the cron).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    async function poll() {
      try {
        const s = await geocodeStatusAction();
        if (cancelled) return;
        setStatus(s);
        if (s.running) {
          wasRunning.current = true;
          timer = setTimeout(poll, 3000);
        } else if (wasRunning.current) {
          // Just finished — pull in the newly-plotted points.
          wasRunning.current = false;
          router.refresh();
        }
      } catch {
        /* ignore transient poll errors */
      }
    }
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [router]);

  if (!isAdmin) return null;

  async function start() {
    setBusy(true);
    try {
      const s = await startGeocodeAction();
      setStatus(s);
      wasRunning.current = s.running;
    } finally {
      setBusy(false);
    }
  }

  const running = status?.running ?? false;
  const remaining = status?.remaining ?? pending;

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        type="button"
        onClick={start}
        disabled={busy || running || remaining === 0}
        className="px-3.5 py-1.5 rounded-lg border border-accent text-accent hover:bg-accent hover:text-bg text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        {running
          ? "Geocoding…"
          : remaining === 0
            ? "All addresses geocoded"
            : "Geocode all addresses"}
      </button>
      {running && status && (
        <span className="text-xs text-muted tnum">
          {status.processed.toLocaleString()} done ·{" "}
          {status.matched.toLocaleString()} placed ·{" "}
          {status.remaining.toLocaleString()} left
        </span>
      )}
      {!running && status?.error && (
        <span className="text-xs text-warn-soft-fg">{status.error}</span>
      )}
    </div>
  );
}
