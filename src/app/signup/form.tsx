"use client";

import { useActionState } from "react";
import { signupAction } from "./actions";

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signupAction, null);
  return (
    <form action={formAction} className="space-y-3">
      <div>
        <label className="text-xs text-muted block mb-1.5" htmlFor="name">
          Your name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          required
          className="w-full bg-transparent border border-border-soft rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
        />
      </div>
      <div>
        <label className="text-xs text-muted block mb-1.5" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
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
          autoComplete="new-password"
          minLength={8}
          required
          className="w-full bg-transparent border border-border-soft rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
        />
        <p className="text-xs text-subtle mt-1.5">8+ characters.</p>
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
        {pending ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}
