"use client";

import { useActionState, useEffect, useState } from "react";
import {
  type ServingFormState,
  saveServingInterestFormAction,
} from "./actions";

const INITIAL: ServingFormState = { status: "idle" };

/** Dropdown for picking which PCO form counts as the "serving interest"
 *  trigger on /pipeline. Admin-only writes — non-admins see the same
 *  selector disabled so they can still tell what's configured.
 *
 *  Controlled <select> with a useEffect that syncs to the `current`
 *  prop — otherwise the React reconciler keeps the old uncontrolled
 *  DOM value across revalidation and the picker LOOKS reverted even
 *  though the save succeeded. */
export function ServingFormPicker({
  forms,
  current,
  isAdmin,
}: {
  forms: Array<{ id: string; name: string; active: boolean }>;
  current: string | null;
  isAdmin: boolean;
}) {
  const [state, action, pending] = useActionState(
    saveServingInterestFormAction,
    INITIAL,
  );
  const [value, setValue] = useState<string>(current ?? "");
  useEffect(() => {
    setValue(current ?? "");
  }, [current]);

  return (
    <form action={action} className="space-y-2">
      <select
        name="formId"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={!isAdmin || pending}
        className="w-full bg-bg-elev-2 border border-border-soft rounded px-2.5 py-1.5 text-sm text-fg disabled:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
      >
        <option value="">— pick a form —</option>
        {forms.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
            {f.active ? "" : " (inactive)"}
          </option>
        ))}
      </select>
      {isAdmin && (
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="px-3 py-1.5 rounded-lg border border-accent text-accent hover:bg-accent hover:text-bg disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium cursor-pointer"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          {state.status === "saved" && (
            <span className="text-xs text-good-soft-fg">{state.message}</span>
          )}
          {state.status === "error" && (
            <span className="text-xs text-warn-soft-fg">{state.message}</span>
          )}
        </div>
      )}
      {forms.length === 0 && (
        <p className="text-[11px] text-warn-soft-fg">
          No PCO forms synced yet — enable the Forms entity on /pco and
          run a sync.
        </p>
      )}
    </form>
  );
}
