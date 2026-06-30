"use client";

import { useActionState, useState } from "react";
import { Card, CardHeader, Pill } from "@/components/ui";
import {
  type SaveState,
  removeSubsplashCredentialsAction,
  saveSubsplashCredentialsAction,
} from "./actions";

interface InitialCreds {
  hasCreds: boolean;
  apiKeyLast4: string | null;
  clientSecretLast4: string | null;
  appIdLast4: string | null;
  updatedAt: string | null;
}

const inputClass =
  "w-full bg-bg-elev-2 border border-border-soft rounded-lg px-3 py-2 text-sm text-fg placeholder:text-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60 font-mono";

export function SubsplashCredentialsCard({
  initial,
  isAdmin,
}: {
  initial: InitialCreds;
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState(!initial.hasCreds);
  const [apiKey, setApiKey] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [appId, setAppId] = useState("");
  const [saveState, saveAction, saving] = useActionState<SaveState | null, FormData>(
    saveSubsplashCredentialsAction,
    null,
  );

  const masked = (l4: string | null) => (l4 ? `••••••••••••${l4}` : "");

  function startEditing() {
    setEditing(true);
    setApiKey("");
    setClientSecret("");
    setAppId("");
  }

  return (
    <Card>
      <CardHeader
        title="Subsplash credentials"
        badge={
          initial.hasCreds ? (
            <Pill tone="muted">stored</Pill>
          ) : (
            <Pill tone="muted">not connected</Pill>
          )
        }
      />
      <div className="p-5 space-y-4">
        <p className="text-xs text-muted leading-relaxed">
          From your Subsplash developer access. We store these encrypted at rest
          (AES-256-GCM) — only the last 4 characters are ever shown. Saving
          doesn&apos;t test the connection yet; the Engagement API sync (app
          opens, content, push tokens) gets wired up once access is confirmed.
        </p>

        <form action={saveAction} className="space-y-3">
          <Field
            label="API key / access token"
            name="apiKey"
            value={editing ? apiKey : masked(initial.apiKeyLast4)}
            onChange={setApiKey}
            disabled={!editing || !isAdmin}
            placeholder="Subsplash API key or access token"
            type={editing ? "password" : "text"}
          />
          <Field
            label="Client secret (optional)"
            name="clientSecret"
            value={editing ? clientSecret : masked(initial.clientSecretLast4)}
            onChange={setClientSecret}
            disabled={!editing || !isAdmin}
            placeholder="if your access uses a client secret"
            type={editing ? "password" : "text"}
          />
          <Field
            label="App ID (optional)"
            name="appId"
            value={editing ? appId : masked(initial.appIdLast4)}
            onChange={setAppId}
            disabled={!editing || !isAdmin}
            placeholder="Subsplash app identifier (Faith Church PA)"
          />

          {saveState?.status === "saved" && (
            <p className="text-xs text-good-soft-fg">{saveState.message}</p>
          )}
          {saveState?.status === "error" && (
            <p className="text-xs text-warn-soft-fg">{saveState.message}</p>
          )}

          {isAdmin && (
            <div className="flex items-center gap-2 pt-1">
              {editing ? (
                <>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-3.5 py-1.5 rounded-lg bg-accent text-[var(--accent-fg)] text-xs font-semibold disabled:opacity-50 cursor-pointer"
                  >
                    {saving ? "Saving…" : "Save credentials"}
                  </button>
                  {initial.hasCreds && (
                    <button
                      type="button"
                      onClick={() => setEditing(false)}
                      className="px-3 py-1.5 rounded-lg border border-border-soft text-muted hover:text-fg text-xs cursor-pointer"
                    >
                      Cancel
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  onClick={startEditing}
                  className="px-3.5 py-1.5 rounded-lg border border-accent text-accent hover:bg-accent hover:text-bg text-xs font-medium cursor-pointer"
                >
                  Change credentials
                </button>
              )}
            </div>
          )}
        </form>

        {isAdmin && initial.hasCreds && !editing && (
          <form action={removeSubsplashCredentialsAction} className="pt-1">
            <button
              type="submit"
              className="text-xs text-muted hover:text-warn-soft-fg cursor-pointer"
            >
              Remove credentials
            </button>
          </form>
        )}

        {initial.updatedAt && !editing && (
          <p className="text-[11px] text-subtle">
            Last updated {initial.updatedAt.slice(0, 10)}
          </p>
        )}
      </div>
    </Card>
  );
}

function Field({
  label,
  name,
  value,
  onChange,
  disabled,
  placeholder,
  type = "text",
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  placeholder: string;
  type?: string;
}) {
  return (
    <div>
      <label className="text-xs text-muted block mb-1.5">{label}</label>
      <input
        name={name}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        className={inputClass}
      />
    </div>
  );
}
