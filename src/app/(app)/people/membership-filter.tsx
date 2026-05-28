"use client";

import { useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

interface Option {
  value: string;
  label: string;
  count: number;
}

/** Dropdown that scopes /people to one membership_type. "__none__" picks
 *  rows where membership_type IS NULL (PCO leaves it blank for some
 *  imports). The empty string keeps the unfiltered list.
 *
 *  Navigates inside startTransition so the change is a SOFT update —
 *  React keeps the current page mounted and just re-fetches the server
 *  component for the new searchParams, rather than tearing down to the
 *  route's loading.tsx skeleton. `isPending` dims the control while the
 *  new data streams in. */
export function MembershipFilter({
  current,
  options,
}: {
  current: string;
  options: Option[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function pick(value: string) {
    const sp = new URLSearchParams(params.toString());
    if (!value) sp.delete("membership");
    else sp.set("membership", value);
    sp.delete("page"); // reset paging when filter changes
    const qs = sp.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  return (
    <label
      className="flex items-center gap-2 text-xs"
      aria-busy={isPending}
    >
      <span className="text-muted">Membership:</span>
      <select
        value={current}
        onChange={(e) => pick(e.target.value)}
        disabled={isPending}
        className={`bg-bg-elev border border-border-soft rounded px-2 py-1 text-fg text-xs cursor-pointer transition-opacity ${
          isPending ? "opacity-50" : ""
        }`}
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
