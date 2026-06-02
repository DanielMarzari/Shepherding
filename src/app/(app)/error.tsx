"use client";

import Link from "next/link";
import { useEffect } from "react";

/** Catch-all error boundary for every (app) route. Any unhandled
 *  exception in a server component, server action, or client render
 *  inside this segment lands here instead of showing a bare "Internal
 *  Server Error". The user can click "Try again" to re-render the
 *  segment without a full reload. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side errors are already logged by Next; this prints the
    // client-visible details too so they show up in the browser console.
    // eslint-disable-next-line no-console
    console.error("App route error:", error);

    // Stale-chunk recovery after a redeploy: the browser asked for a JS
    // chunk that no longer exists. Hard-reload to the current build,
    // guarded so a truly-missing chunk can't reload-loop.
    const isChunkError =
      error?.name === "ChunkLoadError" ||
      /loading chunk|ChunkLoadError|failed to load/i.test(error?.message ?? "");
    if (isChunkError && typeof window !== "undefined") {
      const KEY = "chunk-reload-at";
      const last = Number(sessionStorage.getItem(KEY) ?? 0);
      if (Date.now() - last > 10_000) {
        sessionStorage.setItem(KEY, String(Date.now()));
        window.location.reload();
      }
    }
  }, [error]);

  return (
    <div className="min-h-screen bg-bg text-fg flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center space-y-4">
        <div className="text-4xl">⚠️</div>
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-muted text-sm">
          We hit an error rendering this page. The rest of the app is
          fine — try again, or head back home.
        </p>
        {error.digest && (
          <p className="text-[11px] text-subtle tnum">
            Reference: <span className="font-mono">{error.digest}</span>
          </p>
        )}
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            type="button"
            onClick={reset}
            className="px-3.5 py-1.5 rounded-lg border border-accent text-accent hover:bg-accent hover:text-bg text-xs font-medium cursor-pointer"
          >
            Try again
          </button>
          <Link
            href="/"
            className="px-3 py-1.5 rounded-lg border border-border-soft text-muted hover:text-fg text-xs cursor-pointer"
          >
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
