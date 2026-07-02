"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui";
import type { CcSyncSettings } from "@/lib/constant-contact";
import { saveCcScheduleAction } from "./actions";

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const input =
  "bg-bg-elev-2 border border-border-soft rounded-lg px-2.5 py-1.5 text-sm cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60";

export function CcScheduleCard({ initial, isAdmin }: { initial: CcSyncSettings; isAdmin: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [frequency, setFrequency] = useState<CcSyncSettings["frequency"]>(initial.frequency);
  const [hour, setHour] = useState(initial.runAtHour);
  const [dow, setDow] = useState(initial.runAtDow);
  const [dom, setDom] = useState(initial.runAtDom);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  function save() {
    setSaved(false);
    start(async () => {
      await saveCcScheduleAction({ enabled, frequency, runAtHour: hour, runAtDow: dow, runAtDom: dom });
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <Card className="h-full">
      <CardHeader title="Auto-sync schedule" />
      <div className="p-5 space-y-4">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={enabled} disabled={!isAdmin} onChange={(e) => setEnabled(e.target.checked)} />
          Run automatically
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted">Frequency
            <select value={frequency} disabled={!isAdmin} onChange={(e) => setFrequency(e.target.value as CcSyncSettings["frequency"])} className={input}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">Hour (UTC)
            <select value={hour} disabled={!isAdmin} onChange={(e) => setHour(Number(e.target.value))} className={input}>
              {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>)}
            </select>
          </label>
          {frequency === "weekly" && (
            <label className="flex flex-col gap-1 text-xs text-muted">Day of week
              <select value={dow} disabled={!isAdmin} onChange={(e) => setDow(Number(e.target.value))} className={input}>
                {DOW.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </label>
          )}
          {frequency === "monthly" && (
            <label className="flex flex-col gap-1 text-xs text-muted">Day of month
              <select value={dom} disabled={!isAdmin} onChange={(e) => setDom(Number(e.target.value))} className={input}>
                {Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
              </select>
            </label>
          )}
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <button type="button" disabled={pending} onClick={save} className="px-3.5 py-1.5 rounded-lg bg-accent text-[var(--accent-fg)] text-xs font-semibold disabled:opacity-50 cursor-pointer">
              {pending ? "Saving…" : "Save schedule"}
            </button>
            {saved && <span className="text-xs text-good-soft-fg">Saved.</span>}
          </div>
        )}
        <p className="text-[11px] text-subtle">Runs via the 15-minute host cron; times are UTC. First run is a deep sync, then a rolling 3-month window.</p>
      </div>
    </Card>
  );
}
