"use client";

import { useActionState } from "react";
import { confirmAction, type ConfirmState } from "./actions";

export function ConfirmForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<ConfirmState, FormData>(confirmAction, null);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="token" value={token} />
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
        {pending ? "Confirming…" : "Confirm and sign in"}
      </button>
    </form>
  );
}
