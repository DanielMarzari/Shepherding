"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui";
import { saveIntegrationAction, type SaveState } from "./actions";

export interface FieldView {
  key: string;
  label: string;
  help: string;
  multiline?: boolean;
  optional?: boolean;
}

export interface IntegrationView {
  provider: string;
  name: string;
  what: string;
  where: string[];
  blocker: string | null;
  outputs: string[];
  fields: FieldView[];
  stored: Array<{ field: string; last4: string | null; updatedAt: string }>;
}

export function IntegrationCard({
  integration,
  isAdmin,
}: {
  integration: IntegrationView;
  isAdmin: boolean;
}) {
  const [state, action, pending] = useActionState<SaveState | null, FormData>(
    saveIntegrationAction,
    null,
  );
  const [open, setOpen] = useState(false);
  const stored = new Map(integration.stored.map((s) => [s.field, s]));
  const held = integration.stored.length;
  const required = integration.fields.filter((f) => !f.optional).length;
  const complete = integration.fields
    .filter((f) => !f.optional)
    .every((f) => stored.has(f.key));

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold">{integration.name}</h2>
            <span
              className={
                "text-[11px] px-2 py-0.5 rounded-full border font-medium " +
                (complete
                  ? "border-sky-500/40 text-sky-300 bg-sky-500/10"
                  : held > 0
                    ? "border-amber-500/40 text-amber-300 bg-amber-500/10"
                    : "border-white/15 text-subtle")
              }
            >
              {complete
                ? "Credentials held · sync not built"
                : held > 0
                  ? `Partial — ${held} of ${required}`
                  : "Not connected"}
            </span>
          </div>
          <p className="text-sm text-muted mt-1">{integration.what}</p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-xs px-3 py-1.5 rounded-md border border-white/15 hover:bg-white/5 shrink-0"
          >
            {open ? "Close" : held > 0 ? "Update credentials" : "Add credentials"}
          </button>
        )}
      </div>

      {integration.blocker && (
        <p className="text-sm mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <span className="font-medium">Blocked: </span>
          <span className="text-muted">{integration.blocker}</span>
        </p>
      )}

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-subtle mb-1.5">
            Would measure
          </h3>
          <ul className="text-sm text-muted space-y-1 list-disc pl-5">
            {integration.outputs.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-subtle mb-1.5">
            How to get it
          </h3>
          <ul className="text-sm text-muted space-y-1 list-disc pl-5 leading-relaxed">
            {integration.where.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      </div>

      {held > 0 && (
        <div className="mt-3 text-xs text-subtle">
          Stored:{" "}
          {integration.stored
            .map((s) => `${s.field} (…${s.last4 ?? "????"})`)
            .join(", ")}
        </div>
      )}

      {open && isAdmin && (
        <form action={action} className="mt-4 space-y-3 border-t border-white/10 pt-4">
          <input type="hidden" name="provider" value={integration.provider} />
          {integration.fields.map((f) => {
            const s = stored.get(f.key);
            return (
              <div key={f.key}>
                <label className="block text-xs font-medium mb-1" htmlFor={`${integration.provider}-${f.key}`}>
                  {f.label}
                  {f.optional && <span className="text-subtle font-normal"> (optional)</span>}
                  {s && (
                    <span className="text-subtle font-normal"> · stored, ends …{s.last4 ?? "????"}</span>
                  )}
                </label>
                {f.multiline ? (
                  <textarea
                    id={`${integration.provider}-${f.key}`}
                    name={f.key}
                    rows={4}
                    autoComplete="off"
                    placeholder={s ? "Leave blank to keep what's stored" : ""}
                    className="w-full text-sm rounded-md bg-black/20 border border-white/15 px-3 py-2 font-mono"
                  />
                ) : (
                  <input
                    id={`${integration.provider}-${f.key}`}
                    name={f.key}
                    type="password"
                    autoComplete="off"
                    placeholder={s ? "Leave blank to keep what's stored" : ""}
                    className="w-full text-sm rounded-md bg-black/20 border border-white/15 px-3 py-2 font-mono"
                  />
                )}
                <p className="text-xs text-subtle mt-1">{f.help}</p>
              </div>
            );
          })}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="text-sm px-3 py-1.5 rounded-md border border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save"}
            </button>
            {state?.provider === integration.provider && state.message && (
              <span
                className={
                  "text-xs " + (state.status === "error" ? "text-amber-300" : "text-muted")
                }
              >
                {state.message}
              </span>
            )}
          </div>
          <p className="text-xs text-subtle">
            Encrypted at rest with the app key — the same protection as PCO and all PII.
            Stored values are never sent back to this page.
          </p>
        </form>
      )}
    </Card>
  );
}
