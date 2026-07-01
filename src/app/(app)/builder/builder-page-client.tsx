"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BlockConfig, BlockKind, DbSchema, QueryResult } from "@/lib/builder";
import { NAV_SECTIONS } from "@/lib/builder-nav";
import { BlockView, BLOCK_META } from "./blocks";
import { CHART_TYPES, PICTO_ICONS } from "./echarts-block";
import { FilterControl } from "./filter-control";
import { SqlField } from "./sql-field";
import {
  addBlockAction,
  deleteBlockAction,
  deletePageAction,
  moveBlockAction,
  runBlockAction,
  runQueryAction,
  updateBlockAction,
  updatePageAction,
} from "./actions";

export interface ClientBlock {
  id: number;
  position: number;
  kind: BlockKind;
  config: BlockConfig;
  result: QueryResult | null;
}
interface PageInfo { id: number; slug: string; title: string; description: string | null; navSection: string | null }

const PALETTE_GROUPS: Array<{ group: string; kinds: BlockKind[] }> = [
  { group: "Metrics", kinds: ["stat", "kpi", "progress"] },
  { group: "Visuals", kinds: ["chart", "table", "leaderboard", "map"] },
  { group: "Content", kinds: ["text", "divider", "embed"] },
  { group: "Controls", kinds: ["filter"] },
];

const SPAN: Record<number, string> = {
  1: "lg:col-span-1", 2: "lg:col-span-2", 3: "lg:col-span-3",
  4: "lg:col-span-4", 5: "lg:col-span-5", 6: "lg:col-span-6",
};
const spanClass = (n: number | undefined) => SPAN[Math.min(6, Math.max(1, n ?? 1))] ?? "lg:col-span-2";
const chartHint = (id: string) => CHART_TYPES.flatMap((g) => g.items).find((i) => i.id === id)?.hint ?? "";

/** Whether a block kind (with its current config) is powered by a SQL query. */
function blockHasSql(kind: BlockKind, cfg: BlockConfig): boolean {
  if (kind === "text" || kind === "divider" || kind === "embed") return false;
  if (kind === "filter") { const t = cfg.filterType ?? "dropdown"; return t === "dropdown" || t === "chips"; }
  return true;
}

/** Client-side copy of the server's :param extractor (server module is server-only). */
function paramsIn(sql: string): string[] {
  const s = (sql ?? "").replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""').replace(/--[^\n]*/g, "");
  const out = new Set<string>();
  for (const m of s.matchAll(/:([a-zA-Z_]\w*)/g)) out.add(m[1]);
  return [...out];
}

const INPUT = "w-full bg-bg border border-border-soft rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const INPUT_SM = "w-full bg-bg border border-border-soft rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const SELECT = "bg-bg border border-border-soft rounded-lg px-2 py-1.5 text-xs cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function BuilderPageClient({
  page,
  blocks,
  isAdmin,
  initialEdit,
  schema,
}: {
  page: PageInfo;
  blocks: ClientBlock[];
  isAdmin: boolean;
  initialEdit: boolean;
  schema: DbSchema;
}) {
  const router = useRouter();
  const [edit, setEdit] = useState(isAdmin && initialEdit);
  const [pending, start] = useTransition();
  const mutate = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });

  if (!edit) return <ViewMode page={page} blocks={blocks} isAdmin={isAdmin} onEdit={() => setEdit(true)} />;

  return (
    <div className="space-y-5">
      <PageSettings page={page} onDone={() => setEdit(false)} busy={pending} mutate={mutate} />
      <div className="rounded-xl border border-border-soft bg-bg-elev-2/40 p-4 space-y-3">
        <div className="text-xs text-muted font-medium">Add a block</div>
        {PALETTE_GROUPS.map((grp) => (
          <div key={grp.group}>
            <div className="text-[10px] uppercase tracking-wide text-subtle mb-1.5">{grp.group}</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {grp.kinds.map((k) => (
                <button key={k} type="button" disabled={pending} onClick={() => mutate(() => addBlockAction(page.id, k, page.slug))}
                  className="group text-left rounded-lg border border-border-soft hover:border-accent bg-bg/40 px-3 py-2 cursor-pointer disabled:opacity-50 transition-colors">
                  <div className="text-sm font-medium group-hover:text-accent">{BLOCK_META[k].label}</div>
                  <div className="text-[11px] text-subtle leading-snug">{BLOCK_META[k].hint}</div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {blocks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-soft p-8 text-center text-sm text-muted">
          No blocks yet — add one above. Data blocks run a read-only SQL query against the live database.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
          {blocks.map((b, i) => (
            <BlockEditor key={b.id} block={b} slug={page.slug} schema={schema} isFirst={i === 0} isLast={i === blocks.length - 1} mutate={mutate} busy={pending} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── View mode (with live filter parameters) ──────────────────────────

function ViewMode({ page, blocks, isAdmin, onEdit }: { page: PageInfo; blocks: ClientBlock[]; isAdmin: boolean; onEdit: () => void }) {
  const initialParams = useMemo(() => {
    const p: Record<string, string> = {};
    for (const b of blocks) if (b.kind === "filter" && b.config.param) p[b.config.param] = b.config.defaultValue ?? "";
    return p;
  }, [blocks]);
  const [params, setParams] = useState<Record<string, string>>(initialParams);
  const [results, setResults] = useState<Record<number, QueryResult | null>>(() => Object.fromEntries(blocks.map((b) => [b.id, b.result])));
  const [loadingIds, setLoadingIds] = useState<Set<number>>(new Set());

  const deps = useMemo(() => blocks.map((b) => ({ id: b.id, sql: b.config.sql ?? "", params: paramsIn(b.config.sql ?? "") })), [blocks]);

  function setParam(name: string, value: string) {
    const next = { ...params, [name]: value };
    setParams(next);
    const affected = deps.filter((d) => d.sql.trim() && d.params.includes(name));
    if (!affected.length) return;
    setLoadingIds((s) => { const n = new Set(s); affected.forEach((a) => n.add(a.id)); return n; });
    affected.forEach(async (a) => {
      const res = await runBlockAction(a.id, next);
      setResults((r) => ({ ...r, [a.id]: res }));
      setLoadingIds((s) => { const n = new Set(s); n.delete(a.id); return n; });
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{page.title}</h1>
          {page.description && <p className="text-muted text-sm mt-1 max-w-2xl">{page.description}</p>}
        </div>
        {isAdmin && (
          <button type="button" onClick={onEdit} className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-accent text-accent hover:bg-accent hover:text-bg transition-colors cursor-pointer">
            Edit page
          </button>
        )}
      </div>

      {blocks.length === 0 ? (
        <EmptyPage isAdmin={isAdmin} onEdit={onEdit} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
          {blocks.map((b) => {
            if (b.kind === "divider") {
              return <div key={b.id} className={`py-1 ${spanClass(6)}`}><BlockView kind="divider" config={b.config} result={null} /></div>;
            }
            return (
              <div key={b.id} className={`relative rounded-xl border border-border-soft bg-bg-elev-2/40 p-5 ${spanClass(b.config.span)}`}>
                {loadingIds.has(b.id) && (
                  <div className="absolute inset-0 rounded-xl bg-bg/40 backdrop-blur-[1px] flex items-center justify-center text-[11px] text-muted z-10">updating…</div>
                )}
                {b.kind === "filter" ? (
                  <FilterControl config={b.config} result={results[b.id]} value={params[b.config.param ?? ""] ?? ""} onChange={(v) => setParam(b.config.param ?? "", v)} />
                ) : (
                  <BlockView kind={b.kind} config={b.config} result={results[b.id]} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyPage({ isAdmin, onEdit }: { isAdmin: boolean; onEdit: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border-soft p-10 text-center space-y-3">
      <div className="mx-auto w-10 h-10 rounded-lg bg-bg-elev-2 flex items-center justify-center text-muted">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5" aria-hidden>
          <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      </div>
      <div className="text-sm text-muted">This page is empty.</div>
      {isAdmin && <button type="button" onClick={onEdit} className="text-xs px-3 py-1.5 rounded-lg bg-accent text-[var(--accent-fg)] font-medium cursor-pointer">Add blocks</button>}
    </div>
  );
}

function PageSettings({ page, onDone, busy, mutate }: { page: PageInfo; onDone: () => void; busy: boolean; mutate: (fn: () => Promise<unknown>) => void }) {
  const [title, setTitle] = useState(page.title);
  const [desc, setDesc] = useState(page.description ?? "");
  const [nav, setNav] = useState(page.navSection ?? "");
  return (
    <div className="rounded-xl border border-border-soft bg-bg-elev-2/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-muted font-medium">Page — editing</div>
        <div className="flex items-center gap-2">
          <button type="button" disabled={busy} onClick={() => mutate(async () => updatePageAction(page.id, title, desc, page.slug, nav))} className="text-xs px-3 py-1.5 rounded-lg border border-border-soft text-fg hover:bg-bg-elev-2/60 cursor-pointer disabled:opacity-50">Save details</button>
          <button type="button" onClick={onDone} className="text-xs px-3 py-1.5 rounded-lg bg-accent text-[var(--accent-fg)] font-medium cursor-pointer">Done</button>
          <button type="button" disabled={busy} onClick={() => { if (confirm("Delete this whole page?")) mutate(() => deletePageAction(page.id)); }} className="text-xs text-subtle hover:text-warn-soft-fg cursor-pointer">Delete page</button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Page title" className="bg-bg-elev-2 border border-border-soft rounded-lg px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Short description (optional)" className="bg-bg-elev-2 border border-border-soft rounded-lg px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
        <label className="flex flex-col gap-1">
          <select value={nav} onChange={(e) => setNav(e.target.value)} title="Where this page's link appears in the left sidebar"
            className="bg-bg-elev-2 border border-border-soft rounded-lg px-3 py-2 text-sm cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            {NAV_SECTIONS.map((s) => <option key={s.value} value={s.value}>{s.value ? `Sidebar: ${s.label}` : s.label}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}

function BlockEditor({ block, slug, schema, isFirst, isLast, mutate, busy }: {
  block: ClientBlock; slug: string; schema: DbSchema; isFirst: boolean; isLast: boolean; mutate: (fn: () => Promise<unknown>) => void; busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [cfg, setCfg] = useState<BlockConfig>(block.config);
  const [result, setResult] = useState<QueryResult | null>(block.result);
  const [running, setRunning] = useState(false);
  const set = (patch: Partial<BlockConfig>) => setCfg((c) => ({ ...c, ...patch }));
  const kind = block.kind;
  const hasSql = blockHasSql(kind, cfg);
  const meta = BLOCK_META[kind];

  async function run() {
    if (!hasSql) return;
    setRunning(true);
    try { setResult(await runQueryAction(cfg.sql ?? "")); } finally { setRunning(false); }
  }
  function save() { mutate(async () => { await updateBlockAction(block.id, cfg, slug); }); setEditing(false); }
  function cancel() { setCfg(block.config); setResult(block.result); setEditing(false); }

  const ctrl = (
    <div className="flex items-center gap-1 text-muted" onClick={(e) => e.stopPropagation()}>
      <button type="button" disabled={busy || isFirst} title="Move up" onClick={() => mutate(() => moveBlockAction(block.id, "up", slug))} className="w-6 h-6 rounded hover:bg-bg-elev-2 disabled:opacity-30 cursor-pointer">↑</button>
      <button type="button" disabled={busy || isLast} title="Move down" onClick={() => mutate(() => moveBlockAction(block.id, "down", slug))} className="w-6 h-6 rounded hover:bg-bg-elev-2 disabled:opacity-30 cursor-pointer">↓</button>
      <button type="button" disabled={busy} title="Delete block" onClick={() => mutate(() => deleteBlockAction(block.id, slug))} className="w-6 h-6 rounded hover:bg-bg-elev-2 hover:text-warn-soft-fg cursor-pointer">✕</button>
    </div>
  );

  // ── Collapsed: show the rendered block; click to edit ──────────────
  if (!editing) {
    return (
      <div onClick={() => setEditing(true)} title="Click to edit"
        className={`group relative rounded-xl border border-border-soft bg-bg-elev-2/40 p-5 cursor-pointer hover:border-accent transition-colors ${spanClass(cfg.span)}`}>
        <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="text-[10px] text-accent px-1.5 py-0.5 rounded bg-accent/10">edit</span>
          {ctrl}
        </div>
        <BlockView kind={kind} config={cfg} result={result} />
      </div>
    );
  }

  // ── Expanded editor ────────────────────────────────────────────────
  const titlePlaceholder = kind === "text" ? "Heading (optional)" : kind === "divider" ? "Section label" : kind === "filter" ? "Control label" : "Block title";

  return (
    <div className={`rounded-xl border border-accent/50 bg-bg-elev-2/40 p-4 space-y-3 ${spanClass(cfg.span)}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted">
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />{meta.label}
        </span>
        {ctrl}
      </div>

      <input value={cfg.title ?? ""} onChange={(e) => set({ title: e.target.value })} placeholder={titlePlaceholder} className={INPUT} />

      {meta.dataHint && kind !== "chart" && <div className="text-[10px] text-subtle leading-snug">{meta.dataHint}</div>}

      {/* Chart type + pictogram icon */}
      {kind === "chart" && (
        <div className="space-y-1">
          <select value={cfg.chartType ?? "bar"} onChange={(e) => set({ chartType: e.target.value })} className={`${SELECT} w-full`}>
            {CHART_TYPES.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.items.map((it) => <option key={it.id} value={it.id}>{it.label}</option>)}
              </optgroup>
            ))}
          </select>
          {cfg.chartType === "pictogram" && (
            <select value={cfg.icon ?? "person"} onChange={(e) => set({ icon: e.target.value })} className={`${SELECT} w-full`}>
              {PICTO_ICONS.map((ic) => <option key={ic.id} value={ic.id}>{ic.label}</option>)}
            </select>
          )}
          <div className="text-[10px] text-subtle">{chartHint(cfg.chartType ?? "bar")}</div>
        </div>
      )}

      {/* Rich text */}
      {kind === "text" && (
        <textarea value={cfg.text ?? ""} onChange={(e) => set({ text: e.target.value })} rows={5} placeholder="Write markdown…" className={`${INPUT} resize-y font-mono text-xs`} />
      )}

      {/* Divider */}
      {kind === "divider" && (
        <input value={cfg.sub ?? ""} onChange={(e) => set({ sub: e.target.value })} placeholder="Right-aligned note (optional)" className={INPUT_SM} />
      )}

      {/* Image / embed */}
      {kind === "embed" && (
        <>
          <select value={cfg.mode ?? "image"} onChange={(e) => set({ mode: e.target.value as "image" | "iframe" })} className={`${SELECT} w-full`}>
            <option value="image">Image</option>
            <option value="iframe">Iframe embed</option>
          </select>
          <input value={cfg.url ?? ""} onChange={(e) => set({ url: e.target.value })} placeholder="https://… URL" className={INPUT_SM} />
          {(cfg.mode ?? "image") === "image" && (
            <input value={cfg.alt ?? ""} onChange={(e) => set({ alt: e.target.value })} placeholder="Alt text (accessibility)" className={INPUT_SM} />
          )}
        </>
      )}

      {/* Filter controls */}
      {kind === "filter" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[10px] text-subtle col-span-2">Parameter name — reference it as <code className="px-1 rounded bg-bg">:{cfg.param || "name"}</code> in other blocks</label>
          <input value={cfg.param ?? ""} onChange={(e) => set({ param: e.target.value.replace(/[^a-zA-Z0-9_]/g, "") })} placeholder="param name" className={INPUT_SM} />
          <select value={cfg.filterType ?? "dropdown"} onChange={(e) => set({ filterType: e.target.value as BlockConfig["filterType"] })} className={`${SELECT} w-full`}>
            <option value="dropdown">Dropdown</option>
            <option value="chips">Chips</option>
            <option value="date">Date</option>
            <option value="text">Text</option>
          </select>
          <input value={cfg.defaultValue ?? ""} onChange={(e) => set({ defaultValue: e.target.value })} placeholder="Default value (optional)" className={`${INPUT_SM} col-span-2`} />
        </div>
      )}

      {/* SQL */}
      {hasSql && <SqlField value={cfg.sql ?? ""} onChange={(v) => set({ sql: v })} onBlur={run} schema={schema} />}

      {/* Post-SQL extras */}
      {(kind === "stat" || kind === "kpi") && (
        <input value={cfg.sub ?? ""} onChange={(e) => set({ sub: e.target.value })} placeholder="Sub-label (optional)" className={INPUT_SM} />
      )}
      {kind === "progress" && (
        <div className="grid grid-cols-2 gap-2">
          <input type="number" value={cfg.goal ?? 100} onChange={(e) => set({ goal: Number(e.target.value) })} placeholder="Goal" className={INPUT_SM} />
          <input value={cfg.sub ?? ""} onChange={(e) => set({ sub: e.target.value })} placeholder="Sub-label (optional)" className={INPUT_SM} />
        </div>
      )}
      {kind === "leaderboard" && (
        <input type="number" min={1} value={cfg.limit ?? 10} onChange={(e) => set({ limit: Math.max(1, Number(e.target.value)) })} placeholder="Show top N" className={INPUT_SM} />
      )}

      <div className="flex items-center gap-2 text-xs">
        <label className="text-subtle">Width</label>
        <select value={cfg.span ?? 2} onChange={(e) => set({ span: Number(e.target.value) })} className="bg-bg border border-border-soft rounded px-1.5 py-1 text-xs cursor-pointer">
          {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}/6</option>)}
        </select>
        {hasSql && <button type="button" onClick={run} disabled={running} className="ml-auto px-2.5 py-1 rounded border border-border-soft text-muted hover:text-fg cursor-pointer disabled:opacity-50">{running ? "Running…" : "Run"}</button>}
        <button type="button" onClick={cancel} className={`px-2.5 py-1 rounded border border-border-soft text-muted hover:text-fg cursor-pointer ${hasSql ? "" : "ml-auto"}`}>Cancel</button>
        <button type="button" onClick={save} disabled={busy} className="px-3 py-1 rounded bg-accent text-[var(--accent-fg)] font-medium cursor-pointer disabled:opacity-50">Save</button>
      </div>

      <div className="rounded-lg border border-border-soft bg-bg/40 p-3">
        <div className="text-[10px] uppercase tracking-wide text-subtle mb-2">Preview</div>
        <BlockView kind={kind} config={cfg} result={hasSql ? result : null} />
      </div>
    </div>
  );
}
