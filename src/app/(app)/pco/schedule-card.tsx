"use client";

import { useActionState, useState } from "react";
import { Card, CardHeader, Pill } from "@/components/ui";
import {
  type SyncSaveState,
  saveSyncSettingsAction,
} from "./actions";
import type { SyncFrequency, SyncSettings } from "@/lib/pco";

const FREQUENCIES: { value: SyncFrequency; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const DOW_OPTIONS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function ScheduleCard({
  initial,
  isAdmin,
}: {
  initial: SyncSettings;
  isAdmin: boolean;
}) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [frequency, setFrequency] = useState<SyncFrequency>(initial.frequency);
  const [runAtHour, setRunAtHour] = useState(initial.runAtHour);
  const [runAtDow, setRunAtDow] = useState(initial.runAtDow);
  const [runAtDom, setRunAtDom] = useState(initial.runAtDom);
  const [emailOnFailure, setEmailOnFailure] = useState(initial.emailOnFailure);
  const [autoResolve, setAutoResolve] = useState(initial.autoResolveConflicts);

  const [state, action, pending] = useActionState<SyncSaveState | null, FormData>(
    saveSyncSettingsAction,
    null,
  );

  return (
    <Card>
      <CardHeader
        title="Auto-sync schedule"
        badge={enabled ? <Pill tone="good">Enabled</Pill> : <Pill tone="muted">Off</Pill>}
      />
      <form action={action}>
        <div className="p-5 space-y-5">
          {!isAdmin && (
            <div className="rounded border border-warn-soft-bg bg-warn-soft-bg/40 px-3 py-2 text-xs text-warn-soft-fg">
              Only org admins can change sync settings.
            </div>
          )}

          {/* Master toggle */}
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">Run automatically</div>
              <div className="text-xs text-muted">
                When off, you can still trigger a sync manually with the Sync now button.
              </div>
            </div>
            <Toggle
              name="enabled"
              checked={enabled}
              onChange={setEnabled}
              disabled={!isAdmin}
            />
          </div>

          {/* Frequency */}
          <div>
            <label className="text-xs text-muted block mb-2">Frequency</label>
            <div className="grid grid-cols-3 gap-1.5 max-w-md">
              {FREQUENCIES.map((f) => (
                <button
                  type="button"
                  key={f.value}
                  disabled={!isAdmin || !enabled}
                  onClick={() => setFrequency(f.value)}
                  className={`px-3 py-1.5 rounded border text-xs font-medium transition-colors ${
                    frequency === f.value
                      ? "border-accent bg-accent-soft-bg text-accent-soft-fg"
                      : "border-border-soft text-muted hover:text-fg hover:bg-bg-elev-2/60 disabled:opacity-50"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <input type="hidden" name="frequency" value={frequency} />
          </div>

          {/* When to run */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md">
            <div>
              <label className="text-xs text-muted block mb-2">Time of day</label>
              <select
                name="runAtHour"
                value={runAtHour}
                onChange={(e) => setRunAtHour(Number(e.target.value))}
                disabled={!isAdmin || !enabled}
                className="w-full bg-transparent border border-border-soft rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent disabled:opacity-60"
              >
                {Array.from({ length: 24 }).map((_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
              <p className="text-xs text-subtle mt-1.5">Local server time.</p>
            </div>

            {frequency === "weekly" && (
              <div>
                <label className="text-xs text-muted block mb-2">Day of week</label>
                <select
                  name="runAtDow"
                  value={runAtDow}
                  onChange={(e) => setRunAtDow(Number(e.target.value))}
                  disabled={!isAdmin || !enabled}
                  className="w-full bg-transparent border border-border-soft rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent disabled:opacity-60"
                >
                  {DOW_OPTIONS.map((d, i) => (
                    <option key={i} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-subtle mt-1.5">Runs once a week.</p>
              </div>
            )}
            {frequency !== "weekly" && (
              <input type="hidden" name="runAtDow" value={runAtDow} />
            )}

            {frequency === "monthly" && (
              <div>
                <label className="text-xs text-muted block mb-2">Day of month</label>
                <select
                  name="runAtDom"
                  value={runAtDom}
                  onChange={(e) => setRunAtDom(Number(e.target.value))}
                  disabled={!isAdmin || !enabled}
                  className="w-full bg-transparent border border-border-soft rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent disabled:opacity-60"
                >
                  {Array.from({ length: 28 }).map((_, i) => {
                    const n = i + 1;
                    return (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    );
                  })}
                </select>
                <p className="text-xs text-subtle mt-1.5">Capped at 28 to fit every month.</p>
              </div>
            )}
            {frequency !== "monthly" && (
              <input type="hidden" name="runAtDom" value={runAtDom} />
            )}
          </div>

          {/* Behavior toggles */}
          <div className="pt-3 border-t border-border-soft space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="font-medium text-sm">Email me when a sync fails</div>
                <div className="text-xs text-muted">
                  One alert per failure. Stops noise from sending the same error twice.
                </div>
              </div>
              <Toggle
                name="emailOnFailure"
                checked={emailOnFailure}
                onChange={setEmailOnFailure}
                disabled={!isAdmin}
              />
            </div>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="font-medium text-sm">Auto-resolve PCO conflicts</div>
                <div className="text-xs text-muted">
                  When a record changed in both PCO and Shepherding since the last sync,
                  PCO wins automatically. Off = the conflict is logged and waits for an
                  admin to choose. PCO is your source of truth, so most churches turn this
                  on.
                </div>
              </div>
              <Toggle
                name="autoResolveConflicts"
                checked={autoResolve}
                onChange={setAutoResolve}
                disabled={!isAdmin}
              />
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
              {pending ? "Saving…" : "Save schedule"}
            </button>
          </div>
        </div>
      </form>
    </Card>
  );
}

function Toggle({
  name,
  checked,
  onChange,
  disabled,
}: {
  name: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`relative inline-block w-9 h-5 rounded-full transition-colors shrink-0 ${
        checked ? "bg-accent" : "bg-bg-elev-2 border border-border-soft"
      } ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="sr-only"
      />
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : ""
        }`}
      />
    </label>
  );
}
