"use client";

import { useMemo, useState, type ReactNode } from "react";

export interface SortableColumn<Row> {
  /** Stable column identifier (used as the sort key). */
  key: string;
  /** Header label. */
  label: ReactNode;
  /** Cell renderer for this column. */
  render: (row: Row) => ReactNode;
  /** Value the row should be sorted by when this column is the
   *  active sort key. Defaults to the rendered cell coerced to
   *  string, which is enough for simple "text" columns; numeric or
   *  date columns should provide an explicit value so the comparison
   *  isn't lexicographic. Return null to push the row to the end
   *  regardless of direction. */
  sortValue?: (row: Row) => string | number | null;
  /** Set to false to make the column unsortable. */
  sortable?: boolean;
  /** Header alignment. Body cells follow the same alignment. */
  align?: "left" | "right" | "center";
  /** Optional extra Tailwind classes for the column's header cell. */
  className?: string;
  /** Optional extra classes for the body cells. */
  cellClassName?: string;
  /** Tooltip on the header. */
  title?: string;
}

/** Generic in-memory sortable table. Renders a click-to-sort header
 *  for each column and re-sorts the rows in JS on every click. Each
 *  column controls its own sort value via `sortValue` so the
 *  comparison is sensible for text / number / date / null cells.
 *
 *  This isn't a virtualized / paginated table — it's meant for the
 *  small-to-medium tables on /shepherds, /shepherd-team, and the
 *  home / lanes summary cards. For thousands of rows with paging
 *  (/people, /groups) the URL-based server-side sort is still the
 *  right pattern. */
export function SortableTable<Row>({
  rows,
  columns,
  initialSortKey,
  initialSortDir = "asc",
  rowKey,
  emptyMessage,
  rowClassName,
}: {
  rows: Row[];
  columns: SortableColumn<Row>[];
  initialSortKey?: string;
  initialSortDir?: "asc" | "desc";
  rowKey: (row: Row, idx: number) => string;
  emptyMessage?: ReactNode;
  /** Extra classes for the <tr>. Can be a string or a fn (row, idx). */
  rowClassName?: string | ((row: Row, idx: number) => string);
}) {
  const [sortKey, setSortKey] = useState<string | null>(
    initialSortKey ?? null,
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">(initialSortDir);

  function toggleSort(key: string): void {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Numeric columns most commonly want desc-first (biggest
      // number on top); text columns want asc-first (alphabetical).
      // Use the column's stated alignment as a coarse proxy: a
      // right-aligned column is usually a number, so start desc.
      const col = columns.find((c) => c.key === key);
      setSortDir(col?.align === "right" ? "desc" : "asc");
    }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col || col.sortable === false) return rows;
    const sortValue = col.sortValue ?? ((r: Row) => stringify(col.render(r)));
    const out = [...rows];
    const dir = sortDir === "asc" ? 1 : -1;
    out.sort((a, b) => {
      const av = sortValue(a);
      const bv = sortValue(b);
      // Nulls always at the end regardless of direction so the
      // "no value" rows don't crowd the top half just because the
      // direction flipped.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * dir;
      }
      return String(av).localeCompare(String(bv)) * dir;
    });
    return out;
  }, [rows, columns, sortKey, sortDir]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted">
          <tr className="border-b border-border-soft">
            {columns.map((c) => {
              const sortable = c.sortable !== false;
              const active = sortable && sortKey === c.key;
              const alignClass =
                c.align === "right"
                  ? "text-right"
                  : c.align === "center"
                    ? "text-center"
                    : "text-left";
              return (
                <th
                  key={c.key}
                  className={`font-medium px-5 py-2 ${alignClass} ${c.className ?? ""}`}
                  title={c.title}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className={`inline-flex items-center gap-1 transition-colors hover:text-fg cursor-pointer ${
                        active ? "text-fg" : ""
                      } ${c.align === "right" ? "flex-row-reverse" : ""}`}
                    >
                      <span>{c.label}</span>
                      <span
                        className={`text-[9px] ${active ? "opacity-100" : "opacity-30"}`}
                        aria-hidden
                      >
                        {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  ) : (
                    <span>{c.label}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-5 py-10 text-center text-muted"
              >
                {emptyMessage ?? "No rows."}
              </td>
            </tr>
          ) : (
            sorted.map((row, idx) => {
              const cls =
                typeof rowClassName === "function"
                  ? rowClassName(row, idx)
                  : rowClassName ?? "";
              return (
                <tr
                  key={rowKey(row, idx)}
                  className={`border-b border-border-softer hover:bg-bg-elev-2/60 align-top ${cls}`}
                >
                  {columns.map((c) => {
                    const alignClass =
                      c.align === "right"
                        ? "text-right"
                        : c.align === "center"
                          ? "text-center"
                          : "text-left";
                    return (
                      <td
                        key={c.key}
                        className={`px-5 py-3 ${alignClass} ${c.cellClassName ?? ""}`}
                      >
                        {c.render(row)}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Best-effort scalar form of a rendered cell for the default sort.
 *  Numbers come out numeric; strings stay strings; React nodes get
 *  their textContent flattened. */
function stringify(v: ReactNode): string {
  if (v == null || typeof v === "boolean") return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(stringify).join("");
  if (typeof v === "object" && "props" in v) {
    const props = (v as { props: { children?: ReactNode } }).props;
    return stringify(props.children ?? "");
  }
  return "";
}
