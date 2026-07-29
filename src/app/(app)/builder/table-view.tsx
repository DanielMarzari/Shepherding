"use client";

import { useState } from "react";
import type { BlockConfig, QueryResult } from "@/lib/builder";
import { colorClass } from "@/lib/builder-defaults";

const fmt = (v: unknown): string => {
  if (v == null) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return String(v);
};

function bandClass(v: number, t: { base: number; band?: number; invert?: boolean }): string {
  const band = t.band ?? 0;
  const hi = v >= t.base + band, lo = v <= t.base - band;
  const good = t.invert ? "text-bad-soft-fg" : "text-good-soft-fg";
  const bad = t.invert ? "text-good-soft-fg" : "text-bad-soft-fg";
  return hi ? good : lo ? bad : "text-warn-soft-fg";
}

/** A chip-column cell → its parts (newline-joined string, or an array). */
function chipParts(cell: unknown): string[] {
  if (Array.isArray(cell)) return cell.map((x) => String(x)).filter(Boolean);
  return String(cell ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
}

/** Table block: density (condensed / normal), per-column & per-cell coloring,
 *  optional chip columns, click-to-sort headers, and a row limit. */
export function TableView({ config, result }: { config: BlockConfig; result: QueryResult }) {
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const cols = result.columns;
  if (cols.length === 0) return <div className="py-6 text-center text-xs text-subtle">No columns returned.</div>;

  const normal = config.density === "normal";
  const sortable = !!config.sortable;
  const chipSet = new Set(config.chipColumns ?? []);
  const isChip = cols.map((c) => chipSet.has(c));
  const colNum = cols.map((c, j) => !isChip[j] && typeof result.rows.find((r) => r[j] != null)?.[j] === "number");
  const colColor = (j: number): string => colorClass(config.columnColors?.[cols[j]]) || colorClass(config.color);
  const cellColor = (j: number, cell: unknown): string => {
    const t = config.columnThresholds?.[cols[j]];
    if (t && typeof cell === "number") return bandClass(cell, t);
    return colColor(j);
  };
  // Chip columns sort by how many chips they carry.
  const sortKey = (cell: unknown, j: number): unknown => (isChip[j] ? chipParts(cell).length : cell);

  let rows = result.rows;
  if (sort) {
    const { col, dir } = sort;
    rows = [...rows].sort((a, b) => {
      const x = sortKey(a[col], col), y = sortKey(b[col], col);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
      return String(x).localeCompare(String(y)) * dir;
    });
  }
  const limit = config.limit && config.limit > 0 ? config.limit : 200;
  const shown = rows.slice(0, limit);

  const toggle = (j: number) => setSort((s) => (s && s.col === j ? { col: j, dir: (s.dir === 1 ? -1 : 1) as 1 | -1 } : { col: j, dir: colNum[j] ? -1 : 1 }));

  return (
    <div className="overflow-x-auto">
      <table className={`w-full tnum border-collapse ${normal ? "text-sm" : "text-xs"}`}>
        <thead>
          <tr className={`text-muted ${normal ? "border-b border-border-soft" : ""}`}>
            {cols.map((c, j) => {
              const active = sort?.col === j;
              const alignRight = colNum[j];
              const base = `font-medium whitespace-nowrap ${normal ? `px-4 py-2.5 ${alignRight ? "text-right" : "text-left"}` : `py-1 pr-3 ${alignRight ? "text-right" : "text-left"}`}`;
              if (!sortable) return <th key={c} className={base}>{c}</th>;
              return (
                <th key={c} className={base}>
                  <button type="button" onClick={() => toggle(j)}
                    className={`inline-flex items-center gap-1 cursor-pointer hover:text-fg transition-colors ${active ? "text-fg" : ""} ${alignRight ? "flex-row-reverse" : ""}`}>
                    <span>{c}</span>
                    <span className={`text-[10px] ${active ? "text-accent" : "text-subtle"}`}>{active ? (sort!.dir === 1 ? "▲" : "▼") : "↕"}</span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i} className={`border-t border-border-soft/60 ${normal ? "hover:bg-bg-elev-2/50 transition-colors" : ""}`}>
              {r.map((cell, j) => {
                if (isChip[j]) {
                  const parts = chipParts(cell);
                  return (
                    <td key={j} className={`${normal ? "px-4 py-2.5" : "py-1 pr-3"} text-left align-top`}>
                      {parts.length === 0 ? <span className="text-subtle">—</span> : (
                        <span className="flex flex-wrap gap-1.5">
                          {parts.map((p, k) => (
                            <span key={k} className="inline-block rounded-full bg-bg-elev-2 text-fg px-2 py-0.5 text-xs whitespace-nowrap">{p}</span>
                          ))}
                        </span>
                      )}
                    </td>
                  );
                }
                return (
                  <td key={j} className={normal
                    ? `px-4 py-2.5 whitespace-nowrap ${colNum[j] ? "text-right tnum" : "text-left"} ${cellColor(j, cell) || "text-fg"}`
                    : `py-1 pr-3 whitespace-nowrap ${typeof cell === "number" ? "text-right tnum" : ""} ${cellColor(j, cell) || "text-fg"}`}>{fmt(cell)}</td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && (
        <div className="text-[10px] text-subtle mt-1.5">Showing {shown.length.toLocaleString()} of {rows.length.toLocaleString()} rows.</div>
      )}
    </div>
  );
}
