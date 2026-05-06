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
  const [appId, setAppId] = useState("");
  const [secret, setSecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
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
            hint="From PCO · Account › Personal Access Tokens"
            id="appId"
            value={appId}
            onChange={setAppId}
            placeholder={
              initial.appIdLast4 ? `••••${initial.appIdLast4}` : "paste from PCO"
            }
            type="text"
            disabled={!isAdmin}
          />
          <Field
            label="Secret"
            hint="Stored encrypted. Only the last 4 chars are shown after save."
            id="secret"
            value={secret}
            onChange={setSecret}
            placeholder={
              initial.secretLast4 ? `••••${initial.secretLast4}` : "shown once in PCO"
            }
            type="password"
            disabled={!isAdmin}
          />
          <Field
            label="Webhook secret"
            hint="Optional · used to verify real-time webhook pushes."
            id="webhookSecret"
            value={webhookSecret}
            onChange={setWebhookSecret}
            placeholder={
              initial.webhookSecretLast4
                ? `••••${initial.webhookSecretLast4}`
                : "leave blank if not using webhooks"
            }
            type="text"
            disabled={!isAdmin}
            optional
          />
          <div>
            <label className="text-xs text-muted block mb-1.5">Organization name</label>
            <div className="px-3 py-2 text-sm text-muted bg-bg-elev-2/40 rounded border border-border-soft">
              {initial.organizationName ?? "Will be detected on Test connection"}
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
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        className="w-full bg-transparent border border-border-soft rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent disabled:opacity-60"
      />
      <p className="text-xs text-subtle mt-1.5">{hint}</p>
    </div>
  );
}
