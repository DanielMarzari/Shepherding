"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { driveStatusAction, startDriveAction } from "./actions";

interface Status {
  configured: boolean;
  running: boolean;
  processed: number;
  ok: number;
  total: number;
  remaining: number;
  error?: string;
}

export function DriveButton({
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

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    async function poll() {
      try {
        const s = await driveStatusAction();
        if (cancelled) return;
        setStatus(s);
        if (s.running) {
          wasRunning.current = true;
          timer = setTimeout(poll, 3000);
        } else if (wasRunning.current) {
          wasRunning.current = false;
          router.refresh();
        }
      } catch {
        /* ignore */
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
      const s = await startDriveAction();
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
        className="px-3.5 py-1.5 rounded-lg border border-border-soft text-muted hover:text-fg hover:border-accent text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        {running
          ? "Computing drives…"
          : remaining === 0
            ? "Driving distances computed"
            : "Compute driving distances"}
      </button>
      {running && status && (
        <span className="text-xs text-muted tnum">
          {status.processed.toLocaleString()} done · {status.remaining.toLocaleString()} left
        </span>
      )}
      {!running && status?.error && (
        <span className="text-xs text-warn-soft-fg">{status.error}</span>
      )}
    </div>
  );
}
