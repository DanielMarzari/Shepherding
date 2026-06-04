"use client";

import { useActionState, useState } from "react";
import { Card, CardHeader, Pill } from "@/components/ui";
import {
  type SaveState,
  removePushpayCredentialsAction,
  savePushpayCredentialsAction,
} from "./actions";

interface InitialCreds {
  hasCreds: boolean;
  clientIdLast4: string | null;
  clientSecretLast4: string | null;
  orgKeyLast4: string | null;
  updatedAt: string | null;
}

const inputClass =
  "w-full bg-bg-elev-2 border border-border-soft rounded-lg px-3 py-2 text-sm text-fg placeholder:text-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60 font-mono";

export function PushpayCredentialsCard({
  initial,
  isAdmin,
}: {
  initial: InitialCreds;
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState(!initial.hasCreds);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [orgKey, setOrgKey] = useState("");
  const [saveState, saveAction, saving] = useActionState<SaveState | null, FormData>(
    savePushpayCredentialsAction,
    null,
  );

  const masked = (l4: string | null) => (l4 ? `••••••••••••${l4}` : "");

  function startEditing() {
    setEditing(true);
    setClientId("");
    setClientSecret("");
    setOrgKey("");
  }

  return (
    <Card>
      <CardHeader
        title="PushPay credentials"
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
          From your PushPay Developer Portal app. We store these encrypted at
          rest (AES-256-GCM) — only the last 4 characters are ever shown.
          Saving doesn&apos;t test the connection yet; the giving sync gets
          wired up once the integration is finalized.
        </p>

        <form action={saveAction} className="space-y-3">
          <Field
            label="Client ID"
            name="clientId"
            value={editing ? clientId : masked(initial.clientIdLast4)}
            onChange={setClientId}
            disabled={!editing || !isAdmin}
            placeholder="PushPay app client ID"
          />
          <Field
            label="Client Secret"
            name="clientSecret"
            value={editing ? clientSecret : masked(initial.clientSecretLast4)}
            onChange={setClientSecret}
            disabled={!editing || !isAdmin}
            placeholder="PushPay app client secret"
            type={editing ? "password" : "text"}
          />
          <Field
            label="Organization / merchant key (optional)"
            name="orgKey"
            value={editing ? orgKey : masked(initial.orgKeyLast4)}
            onChange={setOrgKey}
            disabled={!editing || !isAdmin}
            placeholder="PushPay organization key"
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
          <form action={removePushpayCredentialsAction} className="pt-1">
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
