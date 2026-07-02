"use client";

import { useActionState, useEffect, useState } from "react";
import { Card, CardHeader, Pill } from "@/components/ui";
import {
  type SaveState,
  removeConstantContactCredentialsAction,
  saveConstantContactCredentialsAction,
} from "./actions";

interface InitialCreds {
  hasCreds: boolean;
  connected: boolean;
  apiKeyLast4: string | null;
  appSecretLast4: string | null;
  verifiedAt: string | null;
  updatedAt: string | null;
}

const inputClass =
  "w-full bg-bg-elev-2 border border-border-soft rounded-lg px-3 py-2 text-sm text-fg placeholder:text-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60 font-mono";

export function ConstantContactCredentialsCard({
  initial,
  isAdmin,
}: {
  initial: InitialCreds;
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState(!initial.hasCreds);
  const [apiKey, setApiKey] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [saveState, saveAction, saving] = useActionState<SaveState | null, FormData>(
    saveConstantContactCredentialsAction,
    null,
  );

  // On a successful save, drop out of edit mode so the Connect button shows.
  const justSaved = saveState?.status === "saved";
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (justSaved) setEditing(false);
  }, [justSaved]);

  const masked = (l4: string | null) => (l4 ? `••••••••••••${l4}` : "");

  function startEditing() {
    setEditing(true);
    setApiKey("");
    setAppSecret("");
  }

  return (
    <Card>
      <CardHeader
        title="Constant Contact credentials"
        badge={
          initial.connected ? (
            <Pill tone="good">connected</Pill>
          ) : initial.hasCreds ? (
            <Pill tone="warn">not connected</Pill>
          ) : (
            <Pill tone="muted">no API key</Pill>
          )
        }
      />
      <div className="p-5 space-y-4">
        <p className="text-xs text-muted leading-relaxed">
          Paste the <strong>API Key</strong> (client ID) from your Constant Contact V3 app.
          The App Secret is only needed if your app uses the confidential
          Authorization-Code flow — leave it blank for a PKCE app. Everything is
          encrypted at rest (AES-256-GCM); only the last 4 characters are shown.
        </p>

        <form action={saveAction} className="space-y-3">
          <Field
            label="API Key"
            name="apiKey"
            value={editing ? apiKey : masked(initial.apiKeyLast4)}
            onChange={setApiKey}
            disabled={!editing || !isAdmin}
            placeholder="Constant Contact API key (client ID)"
          />
          <Field
            label="App Secret (optional)"
            name="appSecret"
            value={editing ? appSecret : masked(initial.appSecretLast4)}
            onChange={setAppSecret}
            disabled={!editing || !isAdmin}
            placeholder="Only if your app requires a client secret"
            type={editing ? "password" : "text"}
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

        {/* OAuth connect */}
        {isAdmin && (initial.hasCreds || justSaved) && !editing && (
          <div className="pt-2 border-t border-border-soft space-y-2">
            {initial.connected ? (
              <>
                <p className="text-xs text-good-soft-fg">
                  Connected{initial.verifiedAt ? ` on ${initial.verifiedAt.slice(0, 10)}` : ""}. The app manages the tokens from here.
                </p>
                <a
                  href="/constant-contact/connect"
                  className="inline-block px-3 py-1.5 rounded-lg border border-border-soft text-muted hover:text-fg text-xs cursor-pointer"
                >
                  Reconnect
                </a>
              </>
            ) : (
              <>
                <p className="text-xs text-muted">
                  Next: authorize the app with Constant Contact. You&apos;ll be
                  taken to Constant Contact to approve, then sent back here.
                </p>
                <a
                  href="/constant-contact/connect"
                  className="inline-block px-3.5 py-1.5 rounded-lg bg-accent text-[var(--accent-fg)] text-xs font-semibold cursor-pointer"
                >
                  Connect Constant Contact
                </a>
              </>
            )}
          </div>
        )}

        {isAdmin && initial.hasCreds && !editing && (
          <form action={removeConstantContactCredentialsAction} className="pt-1">
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
