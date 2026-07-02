"use client";

import { useState } from "react";

type Fmt = "text" | "num" | "pct";
export interface Col { key: string; label: string; align?: "right"; format?: Fmt }
type Row = Record<string, string | number | null>;

function fmt(v: string | number | null, f?: Fmt): string {
  if (v == null) return "—";
  if (f === "num" && typeof v === "number") return v.toLocaleString();
  if (f === "pct" && typeof v === "number") return `${(v * 100).toFixed(1)}%`;
  return String(v);
}

/** A compact table whose columns sort on click (values sort by their raw type). */
export function SortableTable({ columns, rows, initial }: { columns: Col[]; rows: Row[]; initial?: { key: string; dir: "asc" | "desc" } }) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>(initial ?? { key: columns[0].key, dir: "asc" });
  const sorted = [...rows].sort((a, b) => {
    const va = a[sort.key], vb = b[sort.key];
    let c: number;
    if (typeof va === "number" && typeof vb === "number") c = va - vb;
    else if (va == null) c = -1;
    else if (vb == null) c = 1;
    else c = String(va).localeCompare(String(vb));
    return sort.dir === "asc" ? c : -c;
  });
  const toggle = (k: string) => setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "asc" }));

  if (rows.length === 0) return <p className="text-xs text-subtle">Nothing synced yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted">
            {columns.map((c) => (
              <th key={c.key} onClick={() => toggle(c.key)}
                className={`py-1 pr-3 cursor-pointer select-none hover:text-fg ${c.align === "right" ? "text-right" : "text-left"}`}>
                {c.label}
                <span className="text-accent">{sort.key === c.key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i} className="border-t border-border-soft/60">
              {columns.map((c) => (
                <td key={c.key} className={`py-1 pr-3 ${c.align === "right" ? "text-right tnum" : ""} max-w-[300px] truncate`}>
                  {fmt(row[c.key], c.format)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
