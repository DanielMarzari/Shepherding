"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, null);
  return (
    <form action={formAction} className="space-y-3">
      <div>
        <label className="text-xs text-muted block mb-1.5" htmlFor="email">
          Church email
        </label>
        {/* Text, not email: the leadership team signs in with a name
            ("leadership") rather than an address. */}
        <input
          id="email"
          name="email"
          type="text"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          autoComplete="username"
          defaultValue={state?.email ?? ""}
          required
          className="w-full bg-transparent border border-border-soft rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
        />
      </div>
      <div>
        <label className="text-xs text-muted block mb-1.5" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full bg-transparent border border-border-soft rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
        />
      </div>
      {state?.error ? (
        <div className="text-sm text-bad-soft-fg bg-bad-soft-bg rounded px-3 py-2">
          {state.error}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full px-3 py-2 rounded bg-accent text-[var(--accent-fg)] text-sm font-medium disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
