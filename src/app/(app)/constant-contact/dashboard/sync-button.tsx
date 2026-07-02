"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncConstantContactAction } from "../actions";

export function CcSyncButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run(fullRefresh: boolean) {
    setMsg(null);
    start(async () => {
      const r = await syncConstantContactAction(fullRefresh);
      if (r.ok) setMsg(`Synced (${r.requests ?? 0} API calls${r.capped ? ", hit the per-run cap — run again to continue" : ""}).`);
      else setMsg(`Sync failed: ${r.error ?? "unknown error"}`);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button type="button" disabled={pending} onClick={() => run(false)}
        className="px-3.5 py-1.5 rounded-lg bg-accent text-[var(--accent-fg)] text-xs font-semibold disabled:opacity-50 cursor-pointer">
        {pending ? "Syncing…" : "Sync now"}
      </button>
      <button type="button" disabled={pending} onClick={() => { if (confirm("Full refresh re-pulls ALL Constant Contact data (slower, more API calls). Continue?")) run(true); }}
        className="px-3 py-1.5 rounded-lg border border-border-soft text-muted hover:text-fg text-xs disabled:opacity-50 cursor-pointer">
        Full refresh
      </button>
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </div>
  );
}
