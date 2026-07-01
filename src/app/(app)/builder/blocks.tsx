import type { BlockConfig, BlockKind, QueryResult } from "@/lib/builder";

const fmt = (v: unknown): string => {
  if (v == null) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return String(v);
};

function QueryError({ error }: { error: string }) {
  return (
    <div className="rounded-lg border border-warn-soft-bg bg-warn-soft-bg/30 px-3 py-2 text-xs text-warn-soft-fg">
      {error}
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-6 text-center text-xs text-subtle">{children}</div>;
}

/** Renders a single block from its config + pre-run query result. Used in both
 *  the live editor preview and the finished page. */
export function BlockView({
  kind,
  config,
  result,
}: {
  kind: BlockKind;
  config: BlockConfig;
  result: QueryResult | null;
}) {
  const title = (config.title ?? "").trim();

  if (kind === "text") {
    return (
      <div className="space-y-1.5">
        {title && <h3 className="text-sm font-semibold">{title}</h3>}
        <p className="text-sm text-muted leading-relaxed whitespace-pre-wrap">
          {config.text || "…"}
        </p>
      </div>
    );
  }

  const body = () => {
    if (!result) return <Empty>No data yet.</Empty>;
    if (result.error) return <QueryError error={result.error} />;

    if (kind === "stat") {
      const v = result.rows[0]?.[0];
      return (
        <div>
          <div className="tnum text-3xl font-semibold leading-tight">{fmt(v)}</div>
          {config.sub && <div className="text-xs text-subtle mt-1">{config.sub}</div>}
        </div>
      );
    }

    if (kind === "bar") {
      const rows = result.rows.filter((r) => typeof r[1] === "number");
      if (rows.length === 0) return <Empty>Query should return a label column and a numeric value column.</Empty>;
      const max = Math.max(1, ...rows.map((r) => Number(r[1])));
      return (
        <div className="space-y-1.5">
          {rows.slice(0, 30).map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-28 shrink-0 truncate text-muted" title={fmt(r[0])}>{fmt(r[0])}</span>
              <div className="flex-1 h-4 rounded bg-bg-elev-2/60 overflow-hidden">
                <div className="h-full rounded bg-accent" style={{ width: `${(Number(r[1]) / max) * 100}%` }} />
              </div>
              <span className="w-16 text-right tnum text-fg">{fmt(r[1])}</span>
            </div>
          ))}
        </div>
      );
    }

    // table
    if (result.columns.length === 0) return <Empty>No columns returned.</Empty>;
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs tnum border-collapse">
          <thead>
            <tr className="text-muted">
              {result.columns.map((c) => (
                <th key={c} className="text-left font-medium py-1 pr-3 whitespace-nowrap">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.slice(0, 200).map((r, i) => (
              <tr key={i} className="border-t border-border-soft/60">
                {r.map((cell, j) => (
                  <td key={j} className={`py-1 pr-3 whitespace-nowrap ${typeof cell === "number" ? "text-right tnum" : "text-fg"}`}>
                    {fmt(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {(result.truncated || result.rows.length > 200) && (
          <div className="text-[10px] text-subtle mt-1.5">Showing the first {Math.min(result.rows.length, 200).toLocaleString()} rows.</div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      {body()}
    </div>
  );
}

export const BLOCK_META: Record<BlockKind, { label: string; hint: string }> = {
  stat: { label: "Stat", hint: "A single big number (first cell of the query)." },
  bar: { label: "Bar chart", hint: "Label + numeric value per row." },
  table: { label: "Table", hint: "Any columns and rows." },
  text: { label: "Text", hint: "Notes / a heading — no query." },
};
