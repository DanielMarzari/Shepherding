"use client";

import { useEffect } from "react";

/** Last-resort error boundary — catches errors in the root layout
 *  itself, where the regular error.tsx can't render because the layout
 *  failed. Must include its own <html> and <body> since it replaces the
 *  whole document tree. Intentionally minimal: no Tailwind, no imports,
 *  nothing that could itself blow up. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("Global error:", error);

    // Stale-build recovery after a redeploy: either a JS chunk that no
    // longer exists (ChunkLoadError) or a Server Action id the new
    // server doesn't recognize (UnrecognizedActionError). Both mean
    // the tab is running old code — hard-reload to the current build.
    // Guard with sessionStorage so a genuine failure can't loop.
    const msg = `${error?.name ?? ""} ${error?.message ?? ""}`;
    const isStaleBuild =
      /ChunkLoadError|loading chunk|failed to load|UnrecognizedActionError|Server Action .* was not found|failed-to-find-server-action/i.test(
        msg,
      );
    if (isStaleBuild && typeof window !== "undefined") {
      const KEY = "chunk-reload-at";
      const last = Number(sessionStorage.getItem(KEY) ?? 0);
      // Only auto-reload if we haven't already done so in the last 10s.
      if (Date.now() - last > 10_000) {
        sessionStorage.setItem(KEY, String(Date.now()));
        window.location.reload();
      }
    }
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          background: "#0e1218",
          color: "#e6e9f0",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, sans-serif",
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: 480, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 8px" }}>
            Something broke at the very top of the app
          </h1>
          <p
            style={{
              color: "#aab2c5",
              fontSize: 14,
              lineHeight: 1.55,
              margin: "0 0 16px",
            }}
          >
            The page didn&apos;t render. Try refreshing — if it keeps
            happening, the reference below will help locate the issue.
          </p>
          {error.digest && (
            <p
              style={{
                color: "#7c879c",
                fontSize: 11,
                fontFamily: "ui-monospace, monospace",
                margin: "0 0 16px",
              }}
            >
              Reference: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid #5dc8a8",
              color: "#5dc8a8",
              background: "transparent",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
