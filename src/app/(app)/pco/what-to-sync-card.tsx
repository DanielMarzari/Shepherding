"use client";

import { useActionState, useState } from "react";
import { Card, CardHeader, Pill } from "@/components/ui";
import { saveSyncEntitiesAction, type SyncEntitiesSaveState } from "./actions";
import type { SyncEntity } from "@/lib/pco";

export function WhatToSyncCard({
  initial,
  entities,
  isAdmin,
}: {
  initial: Record<string, boolean>;
  entities: SyncEntity[];
  isAdmin: boolean;
}) {
  const [toggles, setToggles] = useState(initial);
  const [state, action, pending] = useActionState<
    SyncEntitiesSaveState | null,
    FormData
  >(saveSyncEntitiesAction, null);

  function setEntity(key: string, val: boolean) {
    setToggles((prev) => ({ ...prev, [key]: val }));
  }

  const enabledCount = entities.filter((e) =>
    e.required ? true : toggles[e.key],
  ).length;

  return (
    <Card>
      <CardHeader
        title="What to sync"
        right={
          <span className="text-xs text-muted">
            {enabledCount} of {entities.length} enabled
          </span>
        }
      />
      <form action={action}>
        <div className="px-5 py-4 text-sm text-muted">
          Per-entity toggles. Disable anything you don&apos;t want pulled — it shrinks the
          sync window and reduces PCO API calls.
        </div>
        <ul className="divide-y divide-border-softer border-t border-border-soft">
          {entities.map((e) => {
            const checked = e.required ? true : toggles[e.key] ?? false;
            return (
              <li key={e.key} className="px-5 py-3.5 flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{e.label}</span>
                    {e.required ? <Pill tone="muted">required</Pill> : null}
                  </div>
                  <p className="text-xs text-muted mt-0.5">{e.description}</p>
                </div>
                <Toggle
                  name={`entity_${e.key}`}
                  checked={checked}
                  onChange={(v) => setEntity(e.key, v)}
                  disabled={!isAdmin || e.required}
                />
              </li>
            );
          })}
        </ul>
        <div className="px-5 py-3 border-t border-border-soft flex items-center justify-between gap-3">
          <div className="text-xs">
            {state?.status === "saved" && (
              <span className="text-good-soft-fg">{state.message}</span>
            )}
            {state?.status === "error" && (
              <span className="text-bad-soft-fg">{state.message}</span>
            )}
          </div>
          <button
            type="submit"
            disabled={!isAdmin || pending}
            className="px-3 py-1.5 rounded bg-accent text-[var(--accent-fg)] text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pending ? "Saving…" : "Save entities"}
          </button>
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
