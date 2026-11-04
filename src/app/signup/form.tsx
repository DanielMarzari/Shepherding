"use client";

import { useActionState } from "react";
import { signupAction, type SignupState } from "./actions";

const input =
  "w-full bg-transparent border border-border-soft rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent";

export function SignupForm({ domain }: { domain: string }) {
  const [state, formAction, pending] = useActionState<SignupState, FormData>(signupAction, null);

  if (state && "sent" in state) {
    return (
      <div className="rounded-lg border border-border-soft bg-bg-elev px-4 py-5 text-sm leading-relaxed">
        <div className="font-semibold mb-1.5">Check your inbox</div>
        <p className="text-muted">
          We sent a link to <strong className="text-fg">{state.email}</strong>. Open it to
          finish creating your account. It expires in 24 hours.
        </p>
        <p className="text-subtle text-xs mt-3">
          Nothing there after a few minutes? Check your spam folder, or fill in the form
          again to send a new link.
        </p>
      </div>
    );
  }

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
          defaultValue={state && "error" in state ? state.name : ""}
          required
          className={input}
        />
      </div>
      <div>
        <label className="text-xs text-muted block mb-1.5" htmlFor="email">
          Church email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder={`you@${domain}`}
          defaultValue={state && "error" in state ? state.email : ""}
          required
          className={input}
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
          className={input}
        />
        <p className="text-xs text-subtle mt-1.5">At least 8 characters.</p>
      </div>
      {state && "error" in state ? (
        <div className="text-sm text-bad-soft-fg bg-bad-soft-bg rounded px-3 py-2">
          {state.error}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full px-3 py-2 rounded bg-accent text-[var(--accent-fg)] text-sm font-medium disabled:opacity-50"
      >
        {pending ? "Sending link…" : "Create account"}
      </button>
    </form>
  );
}
