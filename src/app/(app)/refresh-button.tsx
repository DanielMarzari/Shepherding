"use client";

import { useState, useTransition } from "react";
import { refreshDashboardSnapshotsAction } from "./actions";

/** Tiny admin-only button that rebuilds the dashboard / lanes
 *  snapshot tables on demand. The snapshots also refresh after every
 *  PCO sync — this is for "I want to see fresh numbers now" without
 *  triggering a full pull. */
export function RefreshSnapshotsButton({
  isAdmin,
  refreshedAt,
}: {
  isAdmin: boolean;
  refreshedAt: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handleClick() {
    setMessage(null);
    startTransition(async () => {
      const result = await refreshDashboardSnapshotsAction();
      setMessage(result.message);
    });
  }

  const stamp = refreshedAt
    ? `Snapshot updated ${new Date(refreshedAt).toLocaleString()}`
    : "Snapshot not built yet — run a PCO sync or click refresh.";

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-subtle hidden xl:inline">{stamp}</span>
      {isAdmin && (
        <button
          type="button"
          onClick={handleClick}
          disabled={isPending}
          className="px-2.5 py-1.5 rounded border border-border-soft text-muted hover:text-fg transition-colors disabled:opacity-50 cursor-pointer"
        >
          {isPending ? "Refreshing…" : "↻ Refresh"}
        </button>
      )}
      {message && (
        <span className="text-accent text-[11px]">{message}</span>
      )}
    </div>
  );
}
