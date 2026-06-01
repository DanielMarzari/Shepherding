"use client";

import { useActionState } from "react";
import { type IntakeLoginState, intakeLoginAction } from "./actions";

const INITIAL: IntakeLoginState = { status: "idle" };

export function IntakeEmailForm() {
  const [state, action, pending] = useActionState(intakeLoginAction, INITIAL);
  return (
    <form action={action} className="space-y-3">
      <input
        type="email"
        name="email"
        required
        autoComplete="email"
        placeholder="you@yourchurch.org"
        className="w-full bg-bg-elev-2 border border-border-soft rounded-lg px-3 py-2.5 text-fg placeholder:text-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      <button
        type="submit"
        disabled={pending}
        className="w-full px-3 py-2.5 rounded-lg bg-accent text-[var(--accent-fg)] font-medium disabled:opacity-50 cursor-pointer"
      >
        {pending ? "Checking…" : "Continue"}
      </button>
      {state.status === "error" && (
        <p className="text-sm text-warn-soft-fg">{state.message}</p>
      )}
    </form>
  );
}
