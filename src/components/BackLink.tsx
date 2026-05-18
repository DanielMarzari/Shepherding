"use client";

import { useRouter } from "next/navigation";

/** Single-purpose back button. Calls `router.back()` so you land
 *  wherever you came from (preserving search params, scroll, etc.).
 *  Falls back to a normal Link to `fallback` if there's no history
 *  — e.g. the user landed here from a fresh tab. */
export function BackLink({
  fallback,
  children,
}: {
  fallback: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        // window.history.length includes the initial blank entry, so
        // anything >1 means we have somewhere to go back to.
        if (typeof window !== "undefined" && window.history.length > 1) {
          router.back();
        } else {
          router.push(fallback);
        }
      }}
      className="text-xs text-muted hover:text-fg cursor-pointer"
    >
      {children}
    </button>
  );
}
