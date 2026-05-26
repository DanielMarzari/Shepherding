"use client";

import { useRef, useTransition } from "react";
import { uploadMirPdfAction } from "./actions";

/** File picker that submits as soon as a PDF is chosen — no separate
 *  "Upload" button. The transition wrapper gives us a pending state so
 *  the input is locked while the server parses the file. */
export function UploadMirPdfForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      ref={formRef}
      action={uploadMirPdfAction}
      encType="multipart/form-data"
      className="flex flex-wrap items-center gap-3"
    >
      <input
        type="file"
        name="file"
        accept="application/pdf,.pdf"
        disabled={pending}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            startTransition(() => formRef.current?.requestSubmit());
          }
        }}
        className="text-sm text-fg file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-border-soft file:bg-bg-elev-2 file:text-fg file:cursor-pointer file:hover:border-accent disabled:opacity-60 disabled:cursor-not-allowed"
      />
      {pending && (
        <span className="text-xs text-muted">Parsing PDF…</span>
      )}
    </form>
  );
}
