"use client";

import { useActionState, useState } from "react";
import { Card, Pill } from "@/components/ui";
import { removeIntegrationAction, saveIntegrationAction, type SaveState } from "./actions";

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

const inputClass =
  "w-full bg-bg-elev-2 border border-border-soft rounded-lg px-3 py-2 text-sm text-fg placeholder:text-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-accent font-mono";

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
    // The id is the anchor /subsplash redirects to.
    <div id={integration.provider} className="scroll-mt-20">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-semibold">{integration.name}</h2>
              <Pill tone={complete ? "accent" : held > 0 ? "warn" : "muted"}>
                {complete
                  ? "Credentials held · sync not built"
                  : held > 0
                    ? `Partial — ${held} of ${required}`
                    : "Not connected"}
              </Pill>
            </div>
            <p className="text-sm text-muted mt-1">{integration.what}</p>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="text-xs px-3 py-1.5 rounded-lg border border-border-soft text-muted hover:text-fg hover:bg-bg-elev-2 shrink-0 cursor-pointer"
            >
              {open ? "Close" : held > 0 ? "Update credentials" : "Add credentials"}
            </button>
          )}
        </div>

        {integration.blocker && (
          <p className="text-sm mt-3 rounded-lg bg-warn-soft-bg px-3 py-2">
            <span className="font-medium text-warn-soft-fg">Blocked: </span>
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
          <div className="mt-3 flex items-baseline gap-3 flex-wrap text-xs text-subtle">
            <span>
              Stored:{" "}
              {integration.stored
                .map((s) => `${s.field} (…${s.last4 ?? "????"})`)
                .join(", ")}
            </span>
            {isAdmin && (
              <form action={removeIntegrationAction}>
                <input type="hidden" name="provider" value={integration.provider} />
                <button
                  type="submit"
                  onClick={(e) => {
                    // Some of these cannot be fetched twice (Apple's .p8 key
                    // downloads once), so a stray click must not delete one.
                    if (!confirm(`Delete the stored ${integration.name} credentials?`)) e.preventDefault();
                  }}
                  className="text-muted hover:text-warn-soft-fg underline-offset-2 hover:underline cursor-pointer"
                >
                  Remove
                </button>
              </form>
            )}
          </div>
        )}

        {open && isAdmin && (
          <form action={action} className="mt-4 space-y-3 border-t border-border-soft pt-4">
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
                      className={inputClass}
                    />
                  ) : (
                    <input
                      id={`${integration.provider}-${f.key}`}
                      name={f.key}
                      type="password"
                      autoComplete="off"
                      placeholder={s ? "Leave blank to keep what's stored" : ""}
                      className={inputClass}
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
                className="px-3.5 py-1.5 rounded-lg bg-accent text-[var(--accent-fg)] text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                {pending ? "Saving…" : "Save"}
              </button>
              {state?.provider === integration.provider && state.message && (
                <span
                  className={"text-xs " + (state.status === "error" ? "text-warn-soft-fg" : "text-muted")}
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
    </div>
  );
}
