"use client";

import { useActionState, useRef } from "react";
import { type MirUploadState, uploadMirPdfAction } from "./actions";

const INITIAL: MirUploadState = { status: "idle" };

/** File picker that submits as soon as a PDF is chosen — no separate
 *  "Upload" button. Errors from the server action are surfaced inline
 *  via useActionState so the admin sees WHY a parse failed (production
 *  builds otherwise mask the thrown error as a generic 500). */
export function UploadMirPdfForm() {
  const [state, formAction, pending] = useActionState(
    uploadMirPdfAction,
    INITIAL,
  );
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={formAction}
      encType="multipart/form-data"
      className="space-y-2"
    >
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          name="file"
          accept="application/pdf,.pdf"
          disabled={pending}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              formRef.current?.requestSubmit();
            }
          }}
          className="text-sm text-fg file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-border-soft file:bg-bg-elev-2 file:text-fg file:cursor-pointer file:hover:border-accent disabled:opacity-60 disabled:cursor-not-allowed"
        />
        {pending && (
          <span className="text-xs text-muted">Parsing PDF…</span>
        )}
      </div>
      {state.status === "error" && (
        <p className="text-xs text-warn-soft-fg">
          {state.message}
        </p>
      )}
    </form>
  );
}
