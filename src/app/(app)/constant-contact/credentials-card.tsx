"use client";

import { useActionState, useState } from "react";
import { Card, CardHeader, Pill } from "@/components/ui";
import {
  type SaveState,
  removeConstantContactCredentialsAction,
  saveConstantContactCredentialsAction,
} from "./actions";

interface InitialCreds {
  hasCreds: boolean;
  apiKeyLast4: string | null;
  appSecretLast4: string | null;
  refreshTokenLast4: string | null;
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
  const [refreshToken, setRefreshToken] = useState("");
  const [saveState, saveAction, saving] = useActionState<SaveState | null, FormData>(
    saveConstantContactCredentialsAction,
    null,
  );

  const masked = (l4: string | null) => (l4 ? `••••••••••••${l4}` : "");

  function startEditing() {
    setEditing(true);
    setApiKey("");
    setAppSecret("");
    setRefreshToken("");
  }

  return (
    <Card>
      <CardHeader
        title="Constant Contact credentials"
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
          From your Constant Contact Developer Portal (V3 API) app — the API Key
          and App Secret. We store these encrypted at rest (AES-256-GCM) — only
          the last 4 characters are ever shown. Saving doesn&apos;t test the
          connection yet; the targeted-email + open/click sync gets wired up once
          the OAuth flow is finalized.
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
            label="App Secret"
            name="appSecret"
            value={editing ? appSecret : masked(initial.appSecretLast4)}
            onChange={setAppSecret}
            disabled={!editing || !isAdmin}
            placeholder="Constant Contact app secret"
            type={editing ? "password" : "text"}
          />
          <Field
            label="Refresh token (optional)"
            name="refreshToken"
            value={editing ? refreshToken : masked(initial.refreshTokenLast4)}
            onChange={setRefreshToken}
            disabled={!editing || !isAdmin}
            placeholder="OAuth2 refresh token, if you have one"
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
