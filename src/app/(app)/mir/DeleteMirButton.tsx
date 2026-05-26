"use client";

import { deleteMirAction } from "./actions";

/** Tiny client wrapper for the delete-report form so we can prompt for
 *  confirmation before the server action fires. */
export function DeleteMirButton({ id }: { id: number }) {
  return (
    <form
      action={deleteMirAction}
      onSubmit={(e) => {
        if (!confirm("Delete this report? This can't be undone.")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="text-xs text-muted hover:text-warn-soft-fg cursor-pointer"
      >
        Delete report
      </button>
    </form>
  );
}
