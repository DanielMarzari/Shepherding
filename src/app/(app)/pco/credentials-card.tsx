"use client";

import { useActionState, useEffect, useState } from "react";
import { Card, CardHeader, Pill } from "@/components/ui";
import {
  type SaveState,
  type TestState,
  saveCredentialsAction,
  testConnectionAction,
} from "./actions";

interface InitialCreds {
  hasCreds: boolean;
  appIdLast4: string | null;
  secretLast4: string | null;
  webhookSecretLast4: string | null;
  organizationName: string | null;
  verifiedAt: string | null;
}

export function CredentialsCard({
  initial,
  isAdmin,
}: {
  initial: InitialCreds;
  isAdmin: boolean;
}) {
  // When creds are saved, fields render locked with masked dots until the user
  // clicks "Change credentials". Editing mode clears the values for new entry.
  const [editing, setEditing] = useState(!initial.hasCreds);
  const [appId, setAppId] = useState("");
  const [secret, setSecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");

  function startEditing() {
    setEditing(true);
    setAppId("");
    setSecret("");
    setWebhookSecret("");
  }

  // When locked, show 16 dots with the saved last4 visible at the end.
  function maskedDisplay(last4: string | null): string {
    if (!last4) return "";
    return "••••••••••••" + last4;
  }
  const [testState, testAction, testing] = useActionState<TestState | null, FormData>(
    testConnectionAction,
    null,
  );
  const [saveState, saveAction, saving] = useActionState<SaveState | null, FormData>(
    saveCredentialsAction,
    null,
  );

  // If user edits the inputs after a successful test, invalidate the test
  // result locally so they have to re-test before saving.
  const [testValidFor, setTestValidFor] = useState<string | null>(null);
  const currentKey = `${appId}|${secret}|${webhookSecret}`;
  useEffect(() => {
    if (testState?.status === "ok") {
      setTestValidFor(`${testState.appId}|${testState.secret}|${testState.webhookSecret}`);
    }
  }, [testState]);

  const testIsValid = testState?.status === "ok" && testValidFor === currentKey;
  const canSave = isAdmin && testIsValid && !saving;

  // Show org name freshly detected on a successful test (still valid for current input),
  // otherwise fall back to whatever was saved.
  const detectedOrgName =
    testState?.status === "ok" && testValidFor === currentKey
      ? (testState.organizationName ?? null)
      : initial.organizationName;

  return (
    <Card>
      <CardHeader
        title="Credentials"
        badge={
          initial.hasCreds ? (
            <Pill tone="good">Saved</Pill>
          ) : (
            <Pill tone="muted">Not connected</Pill>
          )
        }
        right={
          <span className="text-xs text-muted">Personal Access Token (PAT)</span>
        }
      />
      <div className="p-5 space-y-4">
        {!isAdmin && (
          <div className="rounded border border-warn-soft-bg bg-warn-soft-bg/40 px-3 py-2 text-xs text-warn-soft-fg">
            Only org admins can change PCO credentials. You can view current state below.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field
            label="Application ID"
            hint={
              editing
                ? "From PCO · Account › Personal Access Tokens"
                : "Saved · click Change credentials to replace"
            }
            id="appId"
            value={editing ? appId : maskedDisplay(initial.appIdLast4)}
            onChange={setAppId}
            placeholder="paste from PCO"
            type="password"
            disabled={!isAdmin || !editing}
            locked={!editing}
          />
          <Field
            label="Secret"
            hint={
              editing
                ? "Stored encrypted. Only the last 4 chars are shown after save."
                : "Saved · encrypted at rest"
            }
            id="secret"
            value={editing ? secret : maskedDisplay(initial.secretLast4)}
            onChange={setSecret}
            placeholder="shown once in PCO"
            type="password"
            disabled={!isAdmin || !editing}
            locked={!editing}
          />
          <Field
            label="Webhook secret"
            hint={
              editing
                ? "Optional · used to verify real-time webhook pushes."
                : initial.webhookSecretLast4
                  ? "Saved · encrypted at rest"
                  : "Not set"
            }
            id="webhookSecret"
            value={editing ? webhookSecret : maskedDisplay(initial.webhookSecretLast4)}
            onChange={setWebhookSecret}
            placeholder="leave blank if not using webhooks"
            type="password"
            disabled={!isAdmin || !editing}
            locked={!editing}
            optional
          />
          <div>
            <label className="text-xs text-muted block mb-1.5">Organization name</label>
            <div
              className={`px-3 py-2 text-sm rounded border border-border-soft ${
                detectedOrgName ? "text-fg bg-bg-elev-2/30" : "text-muted bg-bg-elev-2/40"
              }`}
            >
              {detectedOrgName ?? "Will be detected on Test connection"}
            </div>
            <p className="text-xs text-subtle mt-1.5">
              Auto-detected from PCO when you test the connection.
            </p>
          </div>
        </div>

        {/* Test result */}
        {testState?.status === "ok" && testValidFor === currentKey && (
          <div className="rounded border border-good-soft-bg bg-good-soft-bg/40 px-3 py-2.5 flex items-start gap-2 text-sm">
            <span className="w-2 h-2 rounded-full bg-good mt-1.5 shrink-0" />
            <div className="flex-1">
              <div className="text-good-soft-fg font-medium">
                Connection successful
              </div>
              <div className="text-xs text-muted mt-0.5">
                Connected to{" "}
                <span className="text-fg font-medium">
                  {testState.organizationName}
                </span>
                . Click Save to store credentials.
              </div>
            </div>
          </div>
        )}
        {testState?.status === "error" && (
          <div className="rounded border border-bad-soft-bg bg-bad-soft-bg/40 px-3 py-2.5 flex items-start gap-2 text-sm">
            <span className="w-2 h-2 rounded-full bg-bad mt-1.5 shrink-0" />
            <div className="flex-1">
              <div className="text-bad-soft-fg font-medium">Test failed</div>
              <div className="text-xs text-muted mt-0.5">{testState.error}</div>
            </div>
          </div>
        )}
        {testState?.status === "ok" && testValidFor !== currentKey && (
          <div className="rounded border border-warn-soft-bg bg-warn-soft-bg/40 px-3 py-2.5 text-xs text-warn-soft-fg">
            Credentials changed since last test. Test again before saving.
          </div>
        )}

        {/* Save state */}
        {saveState?.status === "saved" && (
          <div className="rounded border border-good-soft-bg bg-good-soft-bg/40 px-3 py-2.5 text-sm text-good-soft-fg">
            {saveState.message}
          </div>
        )}
        {saveState?.status === "error" && (
          <div className="rounded border border-bad-soft-bg bg-bad-soft-bg/40 px-3 py-2.5 text-sm text-bad-soft-fg">
            {saveState.message}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center justify-between pt-3 border-t border-border-soft">
          <div className="text-xs text-muted">
            {initial.verifiedAt
              ? `Last verified ${new Date(initial.verifiedAt).toLocaleString()}`
              : "Never tested"}
          </div>
          <div className="flex gap-2">
            {!editing && initial.hasCreds && (
              <button
                type="button"
                onClick={startEditing}
                disabled={!isAdmin}
                className="px-3 py-1.5 rounded border border-border-soft text-xs text-fg hover:bg-bg-elev-2/60 disabled:opacity-50"
              >
                Change credentials
              </button>
            )}
            {editing && (
              <>
                {initial.hasCreds && (
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    className="px-3 py-1.5 rounded border border-border-soft text-xs text-muted hover:text-fg"
                  >
                    Cancel
                  </button>
                )}
                <form action={testAction}>
                  <input type="hidden" name="appId" value={appId} />
                  <input type="hidden" name="secret" value={secret} />
                  <input type="hidden" name="webhookSecret" value={webhookSecret} />
                  <button
                    type="submit"
                    disabled={testing || !appId || !secret || !isAdmin}
                    className="px-3 py-1.5 rounded border border-border-soft text-xs text-fg hover:bg-bg-elev-2/60 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {testing ? "Testing…" : "Test connection"}
                  </button>
                </form>
                <form action={saveAction}>
                  <input type="hidden" name="appId" value={appId} />
                  <input type="hidden" name="secret" value={secret} />
                  <input type="hidden" name="webhookSecret" value={webhookSecret} />
                  <button
                    type="submit"
                    disabled={!canSave}
                    title={
                      !isAdmin
                        ? "Admin only"
                        : !testIsValid
                          ? "Test connection first"
                          : ""
                    }
                    className="px-3 py-1.5 rounded bg-accent text-[var(--accent-fg)] text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? "Saving…" : "Save credentials"}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function Field({
  label,
  hint,
  id,
  value,
  onChange,
  placeholder,
  type,
  disabled,
  optional,
  locked,
}: {
  label: string;
  hint: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type: "text" | "password";
  disabled?: boolean;
  optional?: boolean;
  locked?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-xs text-muted mb-1.5 flex items-center gap-2">
        <span>{label}</span>
        {optional ? <span className="text-subtle text-[10px]">optional</span> : null}
      </label>
      <input
        id={id}
        name={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        // Locked saved-state uses readOnly so the value stays at full
        // foreground color (not the disabled grey). Editing-but-disabled
        // still uses disabled (admin-only viewers see greyed inputs).
        disabled={disabled && !locked}
        readOnly={locked}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-1p-ignore="true"
        data-lpignore="true"
        data-form-type="other"
        style={
          // Visually mask the secret only while editing it (so the user
          // can't accidentally screen-share it). When locked, the value
          // is already pre-masked with bullet glyphs server-side.
          type === "password" && !locked
            ? ({ WebkitTextSecurity: "disc" } as React.CSSProperties)
            : undefined
        }
        className="w-full bg-transparent border border-border-soft rounded px-3 py-2 text-sm font-mono text-fg placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent disabled:opacity-60 read-only:cursor-default read-only:text-fg"
      />
      <p className="text-xs text-subtle mt-1.5">{hint}</p>
    </div>
  );
}
