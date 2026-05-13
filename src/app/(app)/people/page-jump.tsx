"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

/** Tiny inline "jump to page N" form that drops into a Pagination block.
 *  Keeps the rest of the search params intact; just rewrites ?page=. */
export function PageJump({
  currentPage,
  totalPages,
}: {
  currentPage: number;
  totalPages: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [val, setVal] = useState(String(currentPage));

  function go(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseInt(val, 10);
    const n = Math.max(1, Math.min(totalPages, isNaN(parsed) ? 1 : parsed));
    const sp = new URLSearchParams(params.toString());
    if (n === 1) sp.delete("page");
    else sp.set("page", String(n));
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <form onSubmit={go} className="inline-flex items-center gap-1">
      <input
        type="number"
        min="1"
        max={totalPages}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        aria-label="Jump to page"
        className="w-14 px-1.5 py-0.5 text-xs rounded border border-border-soft bg-bg-elev text-fg tnum text-center focus:outline-none focus:border-accent"
      />
      <button
        type="submit"
        className="px-2 py-0.5 text-xs rounded border border-border-soft text-muted hover:text-fg cursor-pointer"
      >
        Go
      </button>
    </form>
  );
}
