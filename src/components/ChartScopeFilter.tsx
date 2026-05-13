"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

interface Option {
  value: string;
  label: string;
}

interface Group {
  label: string;
  options: Option[];
}

/** Single dropdown that controls the demographic + trend charts on
 *  /groups and /teams. URL is the source of truth (?chart=<value>) so
 *  back/forward and link-sharing both work. */
export function ChartScopeFilter({
  current,
  groups,
}: {
  current: string;
  groups: Group[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function pick(value: string) {
    const sp = new URLSearchParams(params.toString());
    if (!value || value === "all") sp.delete("chart");
    else sp.set("chart", value);
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
    router.refresh();
  }

  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="text-muted">Chart scope:</span>
      <select
        value={current || "all"}
        onChange={(e) => pick(e.target.value)}
        className="bg-bg-elev border border-border-soft rounded px-2 py-1 text-fg text-xs cursor-pointer"
      >
        {groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

/** Parse a "?chart=" string back into a DemographicScope. Returns null
 *  for the default value ("all"). */
export function parseChartScope(
  raw: string | undefined,
): { kind: string; id?: string } | null {
  if (!raw || raw === "all") return null;
  if (raw.startsWith("group:")) return { kind: "group", id: raw.slice(6) };
  if (raw.startsWith("groupType:"))
    return { kind: "groupType", id: raw.slice(10) };
  if (raw.startsWith("team:")) return { kind: "team", id: raw.slice(5) };
  if (raw.startsWith("serviceType:"))
    return { kind: "serviceType", id: raw.slice(12) };
  return null;
}
