"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

interface Option {
  value: string;
  label: string;
  count: number;
}

/** Dropdown that scopes /people to one membership_type. "__none__" picks
 *  rows where membership_type IS NULL (PCO leaves it blank for some
 *  imports). The empty string keeps the unfiltered list. */
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

  function pick(value: string) {
    const sp = new URLSearchParams(params.toString());
    if (!value) sp.delete("membership");
    else sp.set("membership", value);
    sp.delete("page"); // reset paging when filter changes
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
    // Force RSC re-fetch — push alone sometimes returns the cached payload
    // when only searchParams differ on the same route segment.
    router.refresh();
  }

  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="text-muted">Membership:</span>
      <select
        value={current}
        onChange={(e) => pick(e.target.value)}
        className="bg-bg-elev border border-border-soft rounded px-2 py-1 text-fg text-xs cursor-pointer"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label} ({o.count.toLocaleString()})
          </option>
        ))}
      </select>
    </label>
  );
}
