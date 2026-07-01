"use client";

import type { BlockConfig, QueryResult } from "@/lib/builder";

/** Interactive filter rendered in view mode; its value is injected into other
 *  blocks' queries as the `:param` placeholder. */
export function FilterControl({
  config,
  result,
  value,
  onChange,
}: {
  config: BlockConfig;
  result: QueryResult | null;
  value: string;
  onChange: (v: string) => void;
}) {
  const title = (config.title ?? "").trim();
  const ft = config.filterType ?? "dropdown";
  const options = (result?.rows ?? []).map((r) => ({
    value: String(r[0] ?? ""),
    label: r[1] != null ? String(r[1]) : String(r[0] ?? ""),
  }));
  const input = "bg-bg border border-border-soft rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";

  return (
    <div className="space-y-2">
      {title && <div className="text-xs font-medium text-muted">{title}</div>}

      {ft === "dropdown" && (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={`${input} w-full cursor-pointer`}>
          <option value="">All</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}

      {ft === "chips" && (
        <div className="flex flex-wrap gap-1.5">
          <Chip active={value === ""} onClick={() => onChange("")}>All</Chip>
          {options.map((o) => (
            <Chip key={o.value} active={value === o.value} onClick={() => onChange(o.value)}>{o.label}</Chip>
          ))}
        </div>
      )}

      {ft === "date" && (
        <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className={`${input} w-full`} />
      )}

      {ft === "text" && (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Type to filter…" className={`${input} w-full`} />
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-xs border cursor-pointer transition-colors ${
        active ? "bg-accent text-[var(--accent-fg)] border-accent" : "bg-bg-elev-2 text-muted border-border-soft hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}
