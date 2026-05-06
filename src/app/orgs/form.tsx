"use client";

import { useActionState, useState } from "react";
import { createOrgAction, joinOrgAction, logoutAction, selectOrgAction } from "./actions";

interface Org {
  id: number;
  name: string;
  role?: "admin" | "member";
}

export function OrgPicker({
  myOrgs,
  otherOrgs,
}: {
  myOrgs: Org[];
  otherOrgs: Org[];
}) {
  const [mode, setMode] = useState<"select" | "create">(myOrgs.length > 0 ? "select" : "create");
  const [selectState, selectAction, selectPending] = useActionState(selectOrgAction, null);
  const [joinState, joinAction, joinPending] = useActionState(joinOrgAction, null);
  const [createState, createActionFn, createPending] = useActionState(createOrgAction, null);

  return (
    <div className="space-y-6">
      <div className="flex gap-2 text-sm">
        <button
          type="button"
          onClick={() => setMode("select")}
          className={`px-3 py-1.5 rounded-full border ${
            mode === "select"
              ? "bg-bg-elev-2 border-border-soft text-fg"
              : "border-border-soft text-muted hover:text-fg"
          }`}
        >
          Pick existing
        </button>
        <button
          type="button"
          onClick={() => setMode("create")}
          className={`px-3 py-1.5 rounded-full border ${
            mode === "create"
              ? "bg-bg-elev-2 border-border-soft text-fg"
              : "border-border-soft text-muted hover:text-fg"
          }`}
        >
          Create new
        </button>
      </div>

      {mode === "select" && (
        <div className="space-y-5">
          {myOrgs.length > 0 && (
            <div>
              <h2 className="text-xs uppercase tracking-wider text-muted mb-2">
                Your organizations
              </h2>
              <form action={selectAction} className="space-y-2">
                {myOrgs.map((o) => (
                  <label
                    key={o.id}
                    className="flex items-center gap-3 px-4 py-3 border border-border-soft rounded cursor-pointer hover:bg-bg-elev-2/60"
                  >
                    <input type="radio" name="orgId" value={o.id} required className="accent-[var(--accent)]" />
                    <span className="flex-1">
                      <span className="font-medium">{o.name}</span>
                      <span className="text-xs text-muted ml-2">
                        {o.role === "admin" ? "Admin" : "Member"}
                      </span>
                    </span>
                  </label>
                ))}
                {selectState?.error && (
                  <div className="text-sm text-bad-soft-fg bg-bad-soft-bg rounded px-3 py-2">
                    {selectState.error}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={selectPending}
                  className="w-full px-3 py-2 rounded bg-accent text-[var(--accent-fg)] text-sm font-medium disabled:opacity-50"
                >
                  {selectPending ? "Loading…" : "Continue"}
                </button>
              </form>
            </div>
          )}

          {otherOrgs.length > 0 && (
            <div>
              <h2 className="text-xs uppercase tracking-wider text-muted mb-2">
                Other organizations on this server
              </h2>
              <form action={joinAction} className="space-y-2">
                {otherOrgs.map((o) => (
                  <label
                    key={o.id}
                    className="flex items-center gap-3 px-4 py-3 border border-border-soft rounded cursor-pointer hover:bg-bg-elev-2/60"
                  >
                    <input type="radio" name="orgId" value={o.id} required className="accent-[var(--accent)]" />
                    <span className="flex-1">
                      <span className="font-medium">{o.name}</span>
                    </span>
                  </label>
                ))}
                {joinState?.error && (
                  <div className="text-sm text-bad-soft-fg bg-bad-soft-bg rounded px-3 py-2">
                    {joinState.error}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={joinPending}
                  className="w-full px-3 py-2 rounded border border-border-soft text-sm font-medium disabled:opacity-50"
                >
                  {joinPending ? "Joining…" : "Request access"}
                </button>
              </form>
            </div>
          )}

          {myOrgs.length === 0 && otherOrgs.length === 0 && (
            <p className="text-sm text-muted">
              No organizations yet — create the first one.
            </p>
          )}
        </div>
      )}

      {mode === "create" && (
        <form action={createActionFn} className="space-y-3">
          <div>
            <label htmlFor="name" className="text-xs text-muted block mb-1.5">
              Organization name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              maxLength={80}
              placeholder="e.g. Grace Community Church"
              className="w-full bg-transparent border border-border-soft rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
            />
            <p className="text-xs text-subtle mt-1.5">You&apos;ll automatically become the admin.</p>
          </div>
          {createState?.error && (
            <div className="text-sm text-bad-soft-fg bg-bad-soft-bg rounded px-3 py-2">
              {createState.error}
            </div>
          )}
          <button
            type="submit"
            disabled={createPending}
            className="w-full px-3 py-2 rounded bg-accent text-[var(--accent-fg)] text-sm font-medium disabled:opacity-50"
          >
            {createPending ? "Creating…" : "Create organization"}
          </button>
        </form>
      )}

      <form action={logoutAction} className="text-center pt-4 border-t border-border-soft">
        <button type="submit" className="text-xs text-muted hover:text-fg">
          Sign out
        </button>
      </form>
    </div>
  );
}
