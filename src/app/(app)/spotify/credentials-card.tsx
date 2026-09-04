"use client";

import { useActionState, useState, useTransition } from "react";
import { Card, CardHeader, Pill } from "@/components/ui";
import {
  type SaveState,
  type SyncState,
  removeSpotifyCredentialsAction,
  saveSpotifyCredentialsAction,
  syncSpotifyCatalogueAction,
  verifySpotifyCredentialsAction,
} from "./actions";

interface InitialCreds {
  hasCreds: boolean;
  clientIdLast4: string | null;
  clientSecretLast4: string | null;
  artistId: string | null;
  artistName: string | null;
  followerCount: number | null;
  verifiedAt: string | null;
  updatedAt: string | null;
}

const inputClass =
  "w-full bg-bg-elev-2 border border-border-soft rounded-lg px-3 py-2 text-sm text-fg placeholder:text-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60 font-mono";

export function SpotifyCredentialsCard({
  initial,
  isAdmin,
  defaultArtistId,
}: {
  initial: InitialCreds;
  isAdmin: boolean;
  defaultArtistId: string;
}) {
  const [editing, setEditing] = useState(!initial.hasCreds);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [artistId, setArtistId] = useState(initial.artistId ?? defaultArtistId);
  const [saveState, saveAction, saving] = useActionState<SaveState | null, FormData>(
    saveSpotifyCredentialsAction,
    null,
  );
  const [recheck, setRecheck] = useState<SaveState | null>(null);
  const [rechecking, startRecheck] = useTransition();
  const [sync, setSync] = useState<SyncState | null>(null);
  const [syncing, startSync] = useTransition();

  const masked = (l4: string | null) => (l4 ? `••••••••••••${l4}` : "");
  const state = saveState ?? recheck;

  function startEditing() {
    setEditing(true);
    setClientId("");
    setClientSecret("");
    setArtistId(initial.artistId ?? defaultArtistId);
  }

  return (
    <Card>
      <CardHeader
        title="Spotify credentials"
        badge={
          initial.verifiedAt ? (
            <Pill tone="good">connected</Pill>
          ) : initial.hasCreds ? (
            <Pill tone="warn">stored, unverified</Pill>
          ) : (
            <Pill tone="muted">not connected</Pill>
          )
        }
      />
      <div className="p-5 space-y-4">
        <p className="text-xs text-muted leading-relaxed">
          From your app at{" "}
          <a
            href="https://developer.spotify.com/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            developer.spotify.com/dashboard
          </a>{" "}
          → your app → Settings. Stored encrypted at rest (AES-256-GCM); only the
          last 4 characters are ever shown again. Saving checks the key straight
          away and names the artist it reached, so a key pointed at the wrong
          artist can&apos;t sit here looking fine.
        </p>

        {initial.verifiedAt && initial.artistName && (
          <div className="rounded-lg border border-border-soft bg-bg-elev-2/50 px-3 py-2.5 text-xs">
            <span className="text-fg font-medium">{initial.artistName}</span>
            <span className="text-muted">
              {" "}
              ·{" "}
              {initial.followerCount != null
                ? `${initial.followerCount.toLocaleString()} followers`
                : "follower count not reported for this key"}
            </span>
            <span className="text-subtle">
              {" "}
              · checked {new Date(initial.verifiedAt).toLocaleDateString()}
            </span>
          </div>
        )}

        <form action={saveAction} className="space-y-3">
          <Field
            label="Client ID"
            name="clientId"
            value={editing ? clientId : masked(initial.clientIdLast4)}
            onChange={setClientId}
            disabled={!editing || !isAdmin}
            placeholder="32-character client ID"
          />
          <Field
            label="Client Secret"
            name="clientSecret"
            value={editing ? clientSecret : masked(initial.clientSecretLast4)}
            onChange={setClientSecret}
            disabled={!editing || !isAdmin}
            placeholder="click “View client secret” in the dashboard"
            type={editing ? "password" : "text"}
          />
          <Field
            label="Artist"
            name="artistId"
            value={artistId}
            onChange={setArtistId}
            disabled={!editing || !isAdmin}
            placeholder="artist ID or the artist URL"
            hint="Faith Church Music by default. Paste the artist URL if that's easier."
          />

          {state?.status === "saved" && (
            <p className="text-xs text-good-soft-fg">{state.message}</p>
          )}
          {state?.status === "error" && (
            <p className="text-xs text-warn-soft-fg">{state.message}</p>
          )}
          {sync?.status === "ok" && <p className="text-xs text-good-soft-fg">{sync.message}</p>}
          {sync?.status === "error" && (
            <p className="text-xs text-warn-soft-fg">{sync.message}</p>
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
                    {saving ? "Saving and checking…" : "Save and check"}
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
                <>
                  <button
                    type="button"
                    onClick={startEditing}
                    className="px-3.5 py-1.5 rounded-lg border border-accent text-accent hover:bg-accent hover:text-bg text-xs font-medium cursor-pointer"
                  >
                    Change credentials
                  </button>
                  <button
                    type="button"
                    disabled={rechecking}
                    onClick={() =>
                      startRecheck(async () => setRecheck(await verifySpotifyCredentialsAction()))
                    }
                    className="px-3 py-1.5 rounded-lg border border-border-soft text-muted hover:text-fg text-xs disabled:opacity-50 cursor-pointer"
                  >
                    {rechecking ? "Checking…" : "Re-check"}
                  </button>
                  <button
                    type="button"
                    disabled={syncing}
                    onClick={() =>
                      startSync(async () => setSync(await syncSpotifyCatalogueAction()))
                    }
                    className="px-3 py-1.5 rounded-lg border border-border-soft text-muted hover:text-fg text-xs disabled:opacity-50 cursor-pointer"
                    title="Pull the released catalogue into the Original Music report"
                  >
                    {syncing ? "Syncing…" : "Sync catalogue"}
                  </button>
                </>
              )}
            </div>
          )}
        </form>

        {isAdmin && initial.hasCreds && !editing && (
          <form action={removeSpotifyCredentialsAction} className="pt-1">
            <button
              type="submit"
              className="text-xs text-muted hover:text-warn-soft-fg cursor-pointer"
            >
              Remove credentials
            </button>
          </form>
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
  hint,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  placeholder?: string;
  type?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-muted block mb-1">{label}</span>
      <input
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        type={type}
        autoComplete="off"
        spellCheck={false}
        className={inputClass}
      />
      {hint && <span className="text-[11px] text-subtle block mt-1">{hint}</span>}
    </label>
  );
}
