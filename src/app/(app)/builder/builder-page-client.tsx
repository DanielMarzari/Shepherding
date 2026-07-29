"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BlockConfig, BlockKind, DbSchema, PageRef, QueryResult } from "@/lib/builder";
import { DEFAULT_CONFIG, LEAF_KINDS } from "@/lib/builder-defaults";
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
  childResults?: (QueryResult | null)[];
}
interface PageInfo { id: number; slug: string; title: string; description: string | null; navSection: string | null; moreSection: string | null }
interface SiblingRef { id: number; title: string; kind: BlockKind }

const PALETTE_GROUPS: Array<{ group: string; kinds: BlockKind[] }> = [
  { group: "Metrics", kinds: ["stat", "kpi", "progress"] },
  { group: "Visuals", kinds: ["chart", "table", "leaderboard", "map"] },
  { group: "Content", kinds: ["text", "divider", "embed"] },
  { group: "Controls", kinds: ["filter"] },
  { group: "Containers", kinds: ["group", "pagelist"] },
];
const DATA_KINDS = new Set<BlockKind>(["stat", "kpi", "progress", "chart", "table", "leaderboard", "map"]);

// 12-column bento: fine enough for quarters/thirds (KPI rows of 4, etc.).
const SPAN: Record<number, string> = {
  1: "lg:col-span-1", 2: "lg:col-span-2", 3: "lg:col-span-3", 4: "lg:col-span-4",
  5: "lg:col-span-5", 6: "lg:col-span-6", 7: "lg:col-span-7", 8: "lg:col-span-8",
  9: "lg:col-span-9", 10: "lg:col-span-10", 11: "lg:col-span-11", 12: "lg:col-span-12",
};
const spanClass = (n: number | undefined) => SPAN[Math.min(12, Math.max(1, n ?? 4))] ?? "lg:col-span-4";
const chartHint = (id: string) => CHART_TYPES.flatMap((g) => g.items).find((i) => i.id === id)?.hint ?? "";

/** Whether a block kind (with its current config) is powered by a SQL query. */
function blockHasSql(kind: BlockKind, cfg: BlockConfig): boolean {
  if (kind === "text" || kind === "divider" || kind === "embed" || kind === "pagelist" || kind === "group") return false;
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
  pages,
}: {
  page: PageInfo;
  blocks: ClientBlock[];
  isAdmin: boolean;
  initialEdit: boolean;
  schema: DbSchema;
  pages: PageRef[];
}) {
  const router = useRouter();
  const [edit, setEdit] = useState(isAdmin && initialEdit);
  const [pending, start] = useTransition();
  const mutate = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });

  const siblings: SiblingRef[] = blocks.map((b) => ({ id: b.id, title: (b.config.title ?? "").trim() || BLOCK_META[b.kind].label, kind: b.kind }));

  if (!edit) return <ViewMode page={page} blocks={blocks} isAdmin={isAdmin} pages={pages} onEdit={() => setEdit(true)} />;

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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-4">
          {blocks.map((b, i) => (
            <BlockEditor key={b.id} block={b} slug={page.slug} schema={schema} pages={pages}
              siblings={siblings.filter((s) => s.id !== b.id && DATA_KINDS.has(s.kind))}
              isFirst={i === 0} isLast={i === blocks.length - 1} mutate={mutate} busy={pending} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── View mode (with live filter parameters) ──────────────────────────

function ViewMode({ page, blocks, isAdmin, pages, onEdit }: { page: PageInfo; blocks: ClientBlock[]; isAdmin: boolean; pages: PageRef[]; onEdit: () => void }) {
  const initialParams = useMemo(() => {
    const p: Record<string, string> = {};
    for (const b of blocks) if (b.kind === "filter" && b.config.param) p[b.config.param] = b.config.defaultValue ?? "";
    return p;
  }, [blocks]);
  const [params, setParams] = useState<Record<string, string>>(initialParams);
  const [results, setResults] = useState<Record<number, QueryResult | null>>(() => Object.fromEntries(blocks.map((b) => [b.id, b.result])));
  const [loadingIds, setLoadingIds] = useState<Set<number>>(new Set());

  const deps = useMemo(() => blocks.map((b) => ({ id: b.id, sql: b.config.sql ?? "", params: paramsIn(b.config.sql ?? "") })), [blocks]);
  const filterByParam = useMemo(() => {
    const m = new Map<string, ClientBlock>();
    for (const b of blocks) if (b.kind === "filter" && b.config.param) m.set(b.config.param, b);
    return m;
  }, [blocks]);

  function setParam(name: string, value: string) {
    const next = { ...params, [name]: value };
    setParams(next);
    const targets = filterByParam.get(name)?.config.targets ?? [];
    const affected = targets.length
      ? deps.filter((d) => targets.includes(d.id) && d.sql.trim())
      : deps.filter((d) => d.sql.trim() && d.params.includes(name));
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-4">
          {blocks.map((b) => {
            if (b.kind === "divider") {
              return <div key={b.id} className={`py-1 ${spanClass(12)}`}><BlockView kind="divider" config={b.config} result={null} /></div>;
            }
            return (
              <div key={b.id} className={`relative rounded-xl border border-border-soft bg-bg-elev-2/40 p-5 ${spanClass(b.config.span)}`}>
                {loadingIds.has(b.id) && (
                  <div className="absolute inset-0 rounded-xl bg-bg/40 backdrop-blur-[1px] flex items-center justify-center text-[11px] text-muted z-10">updating…</div>
                )}
                {b.kind === "filter" ? (
                  <FilterControl config={b.config} result={results[b.id]} value={params[b.config.param ?? ""] ?? ""} onChange={(v) => setParam(b.config.param ?? "", v)} />
                ) : (
                  <BlockView kind={b.kind} config={b.config} result={results[b.id]} pages={pages} childResults={b.childResults} />
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
  const [more, setMore] = useState(page.moreSection ?? "");
  return (
    <div className="rounded-xl border border-border-soft bg-bg-elev-2/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-muted font-medium">Page — editing</div>
        <div className="flex items-center gap-2">
          <button type="button" disabled={busy} onClick={() => mutate(async () => updatePageAction(page.id, title, desc, page.slug, nav, more))} className="text-xs px-3 py-1.5 rounded-lg border border-border-soft text-fg hover:bg-bg-elev-2/60 cursor-pointer disabled:opacity-50">Save details</button>
          <button type="button" onClick={onDone} className="text-xs px-3 py-1.5 rounded-lg bg-accent text-[var(--accent-fg)] font-medium cursor-pointer">Done</button>
          <button type="button" disabled={busy} onClick={() => { if (confirm("Delete this whole page?")) mutate(() => deletePageAction(page.id)); }} className="text-xs text-subtle hover:text-warn-soft-fg cursor-pointer">Delete page</button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Page title" className="bg-bg-elev-2 border border-border-soft rounded-lg px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Short description (optional)" className="bg-bg-elev-2 border border-border-soft rounded-lg px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-subtle">Left sidebar</span>
          <select value={nav} onChange={(e) => setNav(e.target.value)} title="Which left-sidebar group this page's link appears in"
            className="bg-bg-elev-2 border border-border-soft rounded-lg px-3 py-2 text-sm cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            {NAV_SECTIONS.map((s) => <option key={s.value} value={s.value}>{s.value ? `Sidebar: ${s.label}` : s.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-subtle">“See More” heading</span>
          <input value={more} onChange={(e) => setMore(e.target.value)} placeholder="e.g. Reports & insights (blank = not listed)" title="List this page on the See More page under this heading (type any heading)"
            className="bg-bg-elev-2 border border-border-soft rounded-lg px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
        </label>
      </div>
    </div>
  );
}

function LayoutToggle({ cfg, set }: { cfg: BlockConfig; set: (p: Partial<BlockConfig>) => void }) {
  const v = cfg.layout ?? "grid";
  return (
    <div className="inline-flex rounded-lg border border-border-soft overflow-hidden text-xs">
      {(["list", "grid"] as const).map((o) => (
        <button key={o} type="button" onClick={() => set({ layout: o })}
          className={`px-2.5 py-1 cursor-pointer capitalize ${v === o ? "bg-accent text-[var(--accent-fg)]" : "text-muted hover:bg-bg-elev-2"}`}>{o}</button>
      ))}
    </div>
  );
}

/** The per-kind configuration fields, shared by the top-level editor and the
 *  group child editor. */
function BlockFields({ kind, cfg, set, schema, pages, siblings, onSqlBlur }: {
  kind: BlockKind; cfg: BlockConfig; set: (p: Partial<BlockConfig>) => void; schema: DbSchema;
  pages?: PageRef[]; siblings?: SiblingRef[]; onSqlBlur?: () => void;
}) {
  const meta = BLOCK_META[kind];
  const hasSql = blockHasSql(kind, cfg);
  return (
    <>
      {meta.dataHint && kind !== "chart" && <div className="text-[10px] text-subtle leading-snug">{meta.dataHint}</div>}

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

      {kind === "text" && (
        <textarea value={cfg.text ?? ""} onChange={(e) => set({ text: e.target.value })} rows={5} placeholder="Write markdown…" className={`${INPUT} resize-y font-mono text-xs`} />
      )}

      {kind === "divider" && (
        <input value={cfg.sub ?? ""} onChange={(e) => set({ sub: e.target.value })} placeholder="Right-aligned note (optional)" className={INPUT_SM} />
      )}

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

      {kind === "pagelist" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-subtle">Pick pages to link</span>
            <LayoutToggle cfg={cfg} set={set} />
          </div>
          <div className="max-h-44 overflow-auto rounded-lg border border-border-soft p-1.5 space-y-0.5">
            {(pages ?? []).length === 0 && <div className="text-xs text-subtle px-1.5 py-1">No other pages yet — create more pages first.</div>}
            {(pages ?? []).map((p) => {
              const on = (cfg.pages ?? []).includes(p.slug);
              return (
                <label key={p.slug} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-bg-elev-2 cursor-pointer text-xs">
                  <input type="checkbox" checked={on} onChange={() => set({ pages: on ? (cfg.pages ?? []).filter((s) => s !== p.slug) : [...(cfg.pages ?? []), p.slug] })} />
                  <span className="truncate">{p.title}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}

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
          {siblings && siblings.length > 0 && (
            <div className="col-span-2 space-y-1">
              <div className="text-[10px] text-subtle">Affects which blocks? (none selected = every block whose SQL uses <code className="px-1 rounded bg-bg">:{cfg.param || "name"}</code>)</div>
              <div className="flex flex-wrap gap-1.5">
                {siblings.map((s) => {
                  const on = (cfg.targets ?? []).includes(s.id);
                  return (
                    <button key={s.id} type="button" onClick={() => set({ targets: on ? (cfg.targets ?? []).filter((x) => x !== s.id) : [...(cfg.targets ?? []), s.id] })}
                      className={`px-2 py-0.5 rounded-full text-[11px] border cursor-pointer transition-colors ${on ? "bg-accent text-[var(--accent-fg)] border-accent" : "bg-bg-elev-2 text-muted border-border-soft hover:text-fg"}`}>
                      {s.title}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {hasSql && <SqlField value={cfg.sql ?? ""} onChange={(v) => set({ sql: v })} onBlur={onSqlBlur} schema={schema} />}

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
    </>
  );
}

/** Editor for the child blocks nested inside a group container. */
function GroupChildEditor({ cfg, set, schema }: { cfg: BlockConfig; set: (p: Partial<BlockConfig>) => void; schema: DbSchema }) {
  const children = cfg.children ?? [];
  const [childResults, setChildResults] = useState<Record<number, QueryResult | null>>({});
  const [adding, setAdding] = useState<BlockKind>("kpi");
  const ran = useRef(false);

  const setChild = (i: number, patch: Partial<BlockConfig>) =>
    set({ children: children.map((c, idx) => (idx === i ? { ...c, config: { ...c.config, ...patch } } : c)) });
  const addChild = (k: BlockKind) => set({ children: [...children, { kind: k, config: { ...DEFAULT_CONFIG[k] } }] });
  const removeChild = (i: number) => set({ children: children.filter((_, idx) => idx !== i) });
  const moveChild = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= children.length) return;
    const next = [...children];
    [next[i], next[j]] = [next[j], next[i]];
    set({ children: next });
  };
  async function runChild(i: number, sql: string) {
    const res = await runQueryAction(sql);
    setChildResults((r) => ({ ...r, [i]: res }));
  }
  // Run each child's query once when the group editor opens.
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    children.forEach((c, i) => { if (blockHasSql(c.kind, c.config)) runChild(i, c.config.sql ?? ""); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-subtle">Layout</span>
        <LayoutToggle cfg={cfg} set={set} />
      </div>

      {children.map((ch, i) => (
        <div key={i} className="rounded-lg border border-border-soft bg-bg/40 p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wide text-muted">{BLOCK_META[ch.kind].label}</span>
            <div className="flex items-center gap-1 text-muted">
              <button type="button" title="Up" disabled={i === 0} onClick={() => moveChild(i, -1)} className="w-5 h-5 rounded hover:bg-bg-elev-2 disabled:opacity-30 cursor-pointer">↑</button>
              <button type="button" title="Down" disabled={i === children.length - 1} onClick={() => moveChild(i, 1)} className="w-5 h-5 rounded hover:bg-bg-elev-2 disabled:opacity-30 cursor-pointer">↓</button>
              <button type="button" title="Remove" onClick={() => removeChild(i)} className="w-5 h-5 rounded hover:bg-bg-elev-2 hover:text-warn-soft-fg cursor-pointer">✕</button>
            </div>
          </div>
          <input value={ch.config.title ?? ""} onChange={(e) => setChild(i, { title: e.target.value })} placeholder="Title" className={INPUT_SM} />
          <BlockFields kind={ch.kind} cfg={ch.config} set={(p) => setChild(i, p)} schema={schema} onSqlBlur={() => runChild(i, ch.config.sql ?? "")} />
          <div className="rounded border border-border-soft/70 bg-bg/40 p-2">
            <BlockView kind={ch.kind} config={ch.config} result={blockHasSql(ch.kind, ch.config) ? childResults[i] ?? null : null} />
          </div>
        </div>
      ))}

      <div className="flex items-center gap-2">
        <select value={adding} onChange={(e) => setAdding(e.target.value as BlockKind)} className={SELECT}>
          {LEAF_KINDS.map((k) => <option key={k} value={k}>{BLOCK_META[k].label}</option>)}
        </select>
        <button type="button" onClick={() => addChild(adding)} className="px-2.5 py-1 rounded-lg border border-border-soft text-xs text-muted hover:text-fg hover:border-accent cursor-pointer">+ Add to group</button>
      </div>
    </div>
  );
}

function BlockEditor({ block, slug, schema, pages, siblings, isFirst, isLast, mutate, busy }: {
  block: ClientBlock; slug: string; schema: DbSchema; pages: PageRef[]; siblings: SiblingRef[];
  isFirst: boolean; isLast: boolean; mutate: (fn: () => Promise<unknown>) => void; busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [cfg, setCfg] = useState<BlockConfig>(block.config);
  const [result, setResult] = useState<QueryResult | null>(block.result);
  const [running, setRunning] = useState(false);
  const set = (patch: Partial<BlockConfig>) => setCfg((c) => ({ ...c, ...patch }));
  const kind = block.kind;
  const hasSql = blockHasSql(kind, cfg);
  const meta = BLOCK_META[kind];
  const showHeight = kind === "map" || kind === "chart";

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

  if (!editing) {
    return (
      <div onClick={() => setEditing(true)} title="Click to edit"
        className={`group relative rounded-xl border border-border-soft bg-bg-elev-2/40 p-5 cursor-pointer hover:border-accent transition-colors ${spanClass(cfg.span)}`}>
        <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="text-[10px] text-accent px-1.5 py-0.5 rounded bg-accent/10">edit</span>
          {ctrl}
        </div>
        <BlockView kind={kind} config={cfg} result={result} pages={pages} />
      </div>
    );
  }

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

      {kind === "group" ? (
        <GroupChildEditor cfg={cfg} set={set} schema={schema} />
      ) : (
        <BlockFields kind={kind} cfg={cfg} set={set} schema={schema} pages={pages} siblings={siblings} onSqlBlur={run} />
      )}

      <div className="flex items-center gap-2 text-xs flex-wrap">
        <label className="text-subtle">Width</label>
        <select value={cfg.span ?? 4} onChange={(e) => set({ span: Number(e.target.value) })} className="bg-bg border border-border-soft rounded px-1.5 py-1 text-xs cursor-pointer">
          {[[2, "1/6"], [3, "1/4"], [4, "1/3"], [6, "1/2"], [8, "2/3"], [9, "3/4"], [10, "5/6"], [12, "Full"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {showHeight && (
          <>
            <label className="text-subtle">Height</label>
            <select value={cfg.height ?? "standard"} onChange={(e) => set({ height: e.target.value as BlockConfig["height"] })} className="bg-bg border border-border-soft rounded px-1.5 py-1 text-xs cursor-pointer">
              <option value="standard">Thin</option>
              <option value="double">Double</option>
              <option value="triple">Triple</option>
            </select>
          </>
        )}
        {kind === "table" && (
          <>
            <label className="text-subtle">Density</label>
            <select value={cfg.density ?? "condensed"} onChange={(e) => set({ density: e.target.value as BlockConfig["density"] })} className="bg-bg border border-border-soft rounded px-1.5 py-1 text-xs cursor-pointer">
              <option value="condensed">Condensed</option>
              <option value="normal">Normal (spacious)</option>
            </select>
          </>
        )}
        {hasSql && <button type="button" onClick={run} disabled={running} className="ml-auto px-2.5 py-1 rounded border border-border-soft text-muted hover:text-fg cursor-pointer disabled:opacity-50">{running ? "Running…" : "Run"}</button>}
        <button type="button" onClick={cancel} className={`px-2.5 py-1 rounded border border-border-soft text-muted hover:text-fg cursor-pointer ${hasSql ? "" : "ml-auto"}`}>Cancel</button>
        <button type="button" onClick={save} disabled={busy} className="px-3 py-1 rounded bg-accent text-[var(--accent-fg)] font-medium cursor-pointer disabled:opacity-50">Save</button>
      </div>

      {kind !== "group" && (
        <div className="rounded-lg border border-border-soft bg-bg/40 p-3">
          <div className="text-[10px] uppercase tracking-wide text-subtle mb-2">Preview</div>
          <BlockView kind={kind} config={cfg} result={hasSql ? result : null} pages={pages} />
        </div>
      )}
    </div>
  );
}
