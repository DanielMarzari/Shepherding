import Link from "next/link";
import type { BlockConfig, BlockKind, PageRef, QueryResult } from "@/lib/builder";
import { colorClass } from "@/lib/builder-defaults";
import { renderMarkdown, MD_CLASS } from "@/lib/markdown";
import { EChartsBlock } from "./echarts-block";
import { BuilderMap } from "./builder-map";

const MAP_H: Record<string, number> = { standard: 300, double: 560, triple: 840 };
const CHART_H: Record<string, number> = { standard: 280, double: 520, triple: 780 };

const fmt = (v: unknown): string => {
  if (v == null) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return String(v);
};

/** Row → ratio segments normalized to the smallest (["1","3.5"]). */
const ratioSegments = (row: unknown[]): string[] => {
  const nums = row.map(Number).filter((n) => Number.isFinite(n));
  const mn = Math.min(...nums);
  if (!nums.length || !(mn > 0)) return ["—"];
  return nums.map((n) => { const r = n / mn; return Number.isInteger(r) ? String(r) : r.toFixed(1); });
};
/** Row → raw number segments (["15","43","17"]). */
const listSegments = (row: unknown[]): string[] => {
  const nums = row.map(Number).filter((n) => Number.isFinite(n));
  return nums.length ? nums.map((n) => n.toLocaleString()) : ["—"];
};

/** Amber/green/red preset for a cell against a per-column threshold band. */
function bandClass(v: number, t: { base: number; band?: number; invert?: boolean }): string {
  const band = t.band ?? 0;
  const hi = v >= t.base + band, lo = v <= t.base - band;
  const good = t.invert ? "text-bad-soft-fg" : "text-good-soft-fg";
  const bad = t.invert ? "text-good-soft-fg" : "text-bad-soft-fg";
  return hi ? good : lo ? bad : "text-warn-soft-fg";
}

function QueryError({ error }: { error: string }) {
  return <div className="rounded-lg border border-warn-soft-bg bg-warn-soft-bg/30 px-3 py-2 text-xs text-warn-soft-fg">{error}</div>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-6 text-center text-xs text-subtle">{children}</div>;
}

/** Renders a single block from its config + pre-run query result. Used in both
 *  the live editor preview and the finished page. */
export function BlockView({ kind, config, result, pages, childResults }: {
  kind: BlockKind;
  config: BlockConfig;
  result: QueryResult | null;
  pages?: PageRef[];
  childResults?: (QueryResult | null)[];
}) {
  const title = (config.title ?? "").trim();

  if (kind === "text") {
    return <div className={`${MD_CLASS} ${colorClass(config.color)}`} dangerouslySetInnerHTML={{ __html: renderMarkdown(config.text ?? "") }} />;
  }

  if (kind === "pagelist") return <PageList config={config} pages={pages ?? []} />;
  if (kind === "group") return <Group config={config} childResults={childResults} pages={pages} />;

  if (kind === "divider") {
    return (
      <div className="flex items-center gap-3 py-1">
        <span className={`text-xs font-semibold uppercase tracking-wide whitespace-nowrap ${colorClass(config.color) || "text-muted"}`}>{title || "Section"}</span>
        <span className="h-px flex-1 bg-border-soft" />
        {config.sub && <span className="text-[11px] text-subtle whitespace-nowrap">{config.sub}</span>}
      </div>
    );
  }

  if (kind === "embed") return <EmbedView config={config} />;
  if (kind === "filter") return <FilterPreview config={config} result={result} />;

  if (kind === "chart") {
    return (
      <div className="space-y-2">
        {title && <h3 className="text-sm font-semibold">{title}</h3>}
        <EChartsBlock config={config} result={result} height={CHART_H[config.height ?? "standard"] ?? 280} />
      </div>
    );
  }
  if (kind === "map") {
    return (
      <div className="space-y-2">
        {title && <h3 className="text-sm font-semibold">{title}</h3>}
        <BuilderMap result={result} height={MAP_H[config.height ?? "standard"] ?? 300} />
      </div>
    );
  }

  const body = () => {
    if (!result) return <Empty>No data yet.</Empty>;
    if (result.error) return <QueryError error={result.error} />;
    if (kind === "stat") {
      const row = result.rows[0] ?? [];
      if (config.format === "ratio" || config.format === "list") {
        const segs = config.format === "ratio" ? ratioSegments(row) : listSegments(row);
        const sep = config.format === "ratio" ? " : " : " · ";
        return (
          <div>
            <div className="tnum text-2xl font-semibold leading-tight">
              {segs.map((s, i) => (
                <span key={i}>
                  {i > 0 && <span className="text-subtle font-normal">{sep}</span>}
                  <span className={colorClass(config.segmentColors?.[i]) || colorClass(config.color)}>{s}</span>
                </span>
              ))}
            </div>
            {config.sub && <div className="text-xs text-subtle mt-1">{config.sub}</div>}
          </div>
        );
      }
      return (
        <div>
          <div className={`tnum text-3xl font-semibold leading-tight ${colorClass(config.color)}`}>{fmt(row[0])}</div>
          {config.sub && <div className="text-xs text-subtle mt-1">{config.sub}</div>}
        </div>
      );
    }
    if (kind === "kpi") return <Kpi config={config} result={result} />;
    if (kind === "progress") return <Progress config={config} result={result} />;
    if (kind === "leaderboard") return <Leaderboard config={config} result={result} />;

    // table — "condensed" (tight, the default) or "normal" (spacious, like the
    // original hand-coded page tables): larger text, roomy padding, a header
    // rule and row hover, with text columns left-aligned and numeric columns
    // right-aligned (NOT centered).
    if (result.columns.length === 0) return <Empty>No columns returned.</Empty>;
    const normal = config.density === "normal";
    // A column is numeric if its first non-null cell is a number — used to
    // right-align number columns (header + cells) in normal mode.
    const colNum = result.columns.map((_, j) => typeof result.rows.find((r) => r[j] != null)?.[j] === "number");
    // Preset text color per column: an explicit column override wins, else the
    // block-wide color, else default text.
    const colColor = (j: number): string => colorClass(config.columnColors?.[result.columns[j]]) || colorClass(config.color);
    // Per-cell threshold band (overrides the column's flat color for that cell).
    const cellColor = (j: number, cell: unknown): string => {
      const t = config.columnThresholds?.[result.columns[j]];
      if (t && typeof cell === "number") return bandClass(cell, t);
      return colColor(j);
    };
    return (
      <div className="overflow-x-auto">
        <table className={`w-full tnum border-collapse ${normal ? "text-sm" : "text-xs"}`}>
          <thead>
            <tr className={`text-muted ${normal ? "border-b border-border-soft" : ""}`}>
              {result.columns.map((c, j) => (
                <th key={c} className={`font-medium whitespace-nowrap ${normal ? `px-4 py-2.5 ${colNum[j] ? "text-right" : "text-left"}` : "text-left py-1 pr-3"}`}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.slice(0, 200).map((r, i) => (
              <tr key={i} className={`border-t border-border-soft/60 ${normal ? "hover:bg-bg-elev-2/50 transition-colors" : ""}`}>
                {r.map((cell, j) => (
                  <td key={j} className={normal
                    ? `px-4 py-2.5 whitespace-nowrap ${colNum[j] ? "text-right tnum" : "text-left"} ${cellColor(j, cell) || "text-fg"}`
                    : `py-1 pr-3 whitespace-nowrap ${typeof cell === "number" ? "text-right tnum" : ""} ${cellColor(j, cell) || "text-fg"}`}>{fmt(cell)}</td>
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

// ── Sub-renderers ────────────────────────────────────────────────────

/** Column index holding the value: second column if present, else the first. */
const valueIdx = (r: QueryResult) => (r.columns.length >= 2 ? 1 : 0);

function DeltaBadge({ delta }: { delta: number }) {
  const up = delta >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium tnum ${up ? "text-[color:var(--good-soft-fg)]" : "text-warn-soft-fg"}`}>
      <svg viewBox="0 0 12 12" className="w-3 h-3" fill="currentColor" aria-hidden>
        <path d={up ? "M6 2l4 6H2z" : "M6 10L2 4h8z"} />
      </svg>
      {Math.abs(delta).toFixed(1)}%
    </span>
  );
}

function Sparkline({ vals, up }: { vals: number[]; up: boolean }) {
  const w = 120, h = 32, pad = 2;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;
  const pts = vals.map((v, i) => {
    const x = pad + (i / Math.max(1, vals.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - lo) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const color = up ? "#16a34a" : "#dc2626";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-8 mt-1.5" aria-hidden>
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Kpi({ config, result }: { config: BlockConfig; result: QueryResult }) {
  const idx = valueIdx(result);
  const vals = result.rows.map((r) => Number(r[idx])).filter((n) => Number.isFinite(n));
  const last = vals[vals.length - 1] ?? 0;
  const prev = vals.length >= 2 ? vals[vals.length - 2] : undefined;
  const delta = prev != null && prev !== 0 ? ((last - prev) / Math.abs(prev)) * 100 : null;
  return (
    <div>
      <div className="flex items-end justify-between gap-2">
        <div className={`tnum text-3xl font-semibold leading-tight ${colorClass(config.color)}`}>{fmt(last)}</div>
        {delta != null && <DeltaBadge delta={delta} />}
      </div>
      {vals.length > 1 && <Sparkline vals={vals} up={delta == null || delta >= 0} />}
      {config.sub && <div className="text-xs text-subtle mt-1">{config.sub}</div>}
    </div>
  );
}

function Progress({ config, result }: { config: BlockConfig; result: QueryResult }) {
  const cur = Number(result.rows[0]?.[0]) || 0;
  const goalCell = result.columns.length >= 2 ? Number(result.rows[0]?.[1]) : NaN;
  const goal = Number.isFinite(goalCell) && goalCell > 0 ? goalCell : (config.goal ?? 100);
  const pct = goal ? Math.max(0, Math.min(100, (cur / goal) * 100)) : 0;
  return (
    <div>
      <div className="flex items-end justify-between mb-1.5">
        <div className={`tnum text-2xl font-semibold ${colorClass(config.color)}`}>{fmt(cur)}</div>
        <div className="text-xs text-subtle tnum">of {fmt(goal)} · {pct.toFixed(0)}%</div>
      </div>
      <div className="h-2.5 rounded-full bg-bg-elev-2 overflow-hidden">
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      {config.sub && <div className="text-xs text-subtle mt-1.5">{config.sub}</div>}
    </div>
  );
}

function Leaderboard({ config, result }: { config: BlockConfig; result: QueryResult }) {
  const idx = valueIdx(result);
  const rows = result.rows.slice(0, config.limit ?? 10).map((r) => ({ label: String(r[0] ?? ""), value: Number(r[idx]) || 0 }));
  if (rows.length === 0) return <Empty>No rows.</Empty>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ol className="space-y-1.5">
      {rows.map((r, i) => (
        <li key={i} className="flex items-center gap-2.5">
          <span className="tnum text-xs text-subtle w-4 text-right shrink-0">{i + 1}</span>
          <span className="w-6 h-6 rounded-full bg-bg-elev-2 flex items-center justify-center text-[10px] font-semibold text-muted shrink-0">{(r.label[0] ?? "?").toUpperCase()}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm truncate">{r.label}</span>
              <span className="tnum text-xs text-muted shrink-0">{fmt(r.value)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-bg-elev-2 mt-1 overflow-hidden">
              <div className="h-full rounded-full bg-accent/70" style={{ width: `${(r.value / max) * 100}%` }} />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function EmbedView({ config }: { config: BlockConfig }) {
  const url = (config.url ?? "").trim();
  const title = (config.title ?? "").trim();
  if (!url) return <Empty>Add an image or embed URL below.</Empty>;
  if (!/^(https?:|\/)/i.test(url)) return <QueryError error="URL must start with http(s):// or /." />;
  return (
    <div className="space-y-2">
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      {config.mode === "iframe" ? (
        <iframe src={url} title={title || "embed"} className="w-full rounded-lg border border-border-soft" style={{ height: 300 }} sandbox="allow-scripts allow-same-origin allow-popups allow-forms" referrerPolicy="no-referrer" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={config.alt || title || "embedded image"} className="w-full rounded-lg border border-border-soft object-cover" />
      )}
    </div>
  );
}

/** Static, non-interactive preview of a filter (used in the editor). The live
 *  interactive control is FilterControl, rendered in view mode. */
function FilterPreview({ config, result }: { config: BlockConfig; result: QueryResult | null }) {
  const title = (config.title ?? "").trim();
  const ft = config.filterType ?? "dropdown";
  const opts = (result?.rows ?? []).slice(0, 6).map((r) => String(r[0] ?? ""));
  return (
    <div className="space-y-1.5">
      {title && <div className="text-xs font-medium text-muted">{title}</div>}
      {config.param && (
        <div className="text-[10px] text-subtle">
          sets <code className="px-1 py-0.5 rounded bg-bg-elev-2">:{config.param}</code> · {ft}
        </div>
      )}
      {(ft === "dropdown" || ft === "chips") && (
        <div className="flex flex-wrap gap-1.5">
          <span className="px-2 py-0.5 rounded-full text-[11px] bg-accent/15 text-accent border border-accent/30">All</span>
          {opts.map((o, i) => (
            <span key={i} className="px-2 py-0.5 rounded-full text-[11px] bg-bg-elev-2 text-muted border border-border-soft">{o}</span>
          ))}
        </div>
      )}
      {ft === "date" && <span className="inline-block text-xs text-subtle border border-border-soft rounded px-2 py-1">date picker</span>}
      {ft === "text" && <span className="inline-block text-xs text-subtle border border-border-soft rounded px-2 py-1">text input</span>}
    </div>
  );
}

function PageList({ config, pages }: { config: BlockConfig; pages: PageRef[] }) {
  const title = (config.title ?? "").trim();
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  const items = (config.pages ?? []).map((s) => bySlug.get(s)).filter(Boolean) as PageRef[];
  const grid = (config.layout ?? "grid") === "grid";
  return (
    <div className="space-y-2">
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      {items.length === 0 ? (
        <Empty>No pages selected.</Empty>
      ) : (
        <div className={grid ? "grid grid-cols-1 sm:grid-cols-2 gap-2.5" : "space-y-2"}>
          {items.map((p) => (
            <Link key={p.slug} href={`/builder/${p.slug}`} className="group flex items-start justify-between gap-3 rounded-lg border border-border-soft bg-bg/40 px-3.5 py-3 hover:border-accent transition-colors">
              <div className="min-w-0">
                <div className="text-sm font-medium group-hover:text-accent truncate">{p.title}</div>
                {p.description && <div className="text-xs text-subtle truncate">{p.description}</div>}
              </div>
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-subtle shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Group({ config, childResults, pages }: { config: BlockConfig; childResults?: (QueryResult | null)[]; pages?: PageRef[] }) {
  const title = (config.title ?? "").trim();
  const children = config.children ?? [];
  const grid = config.layout === "grid";
  return (
    <div className="space-y-2">
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      {children.length === 0 ? (
        <Empty>Empty group.</Empty>
      ) : (
        <div className={grid ? "grid grid-cols-2 gap-3" : "space-y-3"}>
          {children.map((ch, i) => (
            <div key={i} className="rounded-lg border border-border-soft/70 bg-bg/30 p-3">
              <BlockView kind={ch.kind} config={ch.config} result={childResults?.[i] ?? null} pages={pages} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const BLOCK_META: Record<BlockKind, { label: string; hint: string; dataHint?: string }> = {
  stat: { label: "Stat", hint: "A single big number.", dataHint: "Return one row — the first cell is the number." },
  kpi: { label: "KPI + trend", hint: "Big number, % delta, and a sparkline.", dataHint: "col1 = period, col2 = value, ordered oldest → newest. Latest point is the number; delta is vs the previous point." },
  progress: { label: "Progress", hint: "A goal bar with % complete.", dataHint: "col1 = current value; optional col2 = goal (otherwise set the goal below)." },
  chart: { label: "Chart", hint: "30+ chart types — bar, line, pie, sankey, heatmap…", dataHint: "Shape depends on the chart type — shown once you pick one." },
  table: { label: "Table", hint: "Any columns and rows.", dataHint: "Any SELECT — every returned column becomes a table column." },
  leaderboard: { label: "Leaderboard", hint: "Ranked list with inline bars.", dataHint: "col1 = label, col2 = value, ordered highest → lowest." },
  map: { label: "Map", hint: "Plot points on a map.", dataHint: "col1 = lat, col2 = lng, col3 = label (opt), col4 = size (opt)." },
  text: { label: "Rich text", hint: "Markdown — headings, bold, links, lists." },
  divider: { label: "Divider", hint: "A titled section separator." },
  embed: { label: "Image / embed", hint: "An image or an iframe embed." },
  filter: { label: "Filter", hint: "A control that feeds :param into other blocks.", dataHint: "Dropdown / chips: col1 = value, col2 = label (optional). Date / text need no query." },
  pagelist: { label: "Page list", hint: "Link to other builder pages (a menu page)." },
  group: { label: "Group", hint: "A container that nests other blocks (KPIs in a list…)." },
};
