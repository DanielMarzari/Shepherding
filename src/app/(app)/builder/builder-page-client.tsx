"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { BlockConfig, BlockKind, DbSchema, PageRef, QueryDebug, QueryResult } from "@/lib/builder";
import { DEFAULT_CONFIG, LEAF_KINDS, COLOR_PRESETS } from "@/lib/builder-defaults";
import { SOURCE_META, sourceMeta } from "@/lib/builder-source-meta";
import { BlockView, BLOCK_META } from "./blocks";
import { CHART_TYPES, PICTO_ICONS } from "./echarts-block";
import { FilterControl } from "./filter-control";
import { SqlField } from "./sql-field";
import {
  addBlockAction,
  deleteBlockAction,
  deletePageAction,
  runBlockAction,
  runQueryAction,
  runSourceAction,
  undoPageAction,
  updateBlockAction,
  updatePageAction,
  reorderBlocksAction,
  resetPageToSeedAction,
} from "./actions";

export interface ClientBlock {
  id: number;
  position: number;
  kind: BlockKind;
  config: BlockConfig;
  result: QueryResult | null;
  childResults?: (QueryResult | null)[];
}

/** A stat can point at another block on the page ("See more"). Seeded pages
 *  name the target by title because they cannot know ids; the editor stores an
 *  id. Resolve to an id here so the rest of the code only deals in ids. */
function revealTargetId(b: ClientBlock, blocks: ClientBlock[]): number | null {
  if (typeof b.config.revealsBlock === "number") return b.config.revealsBlock;
  const t = b.config.revealsBlockTitle;
  if (!t) return null;
  return blocks.find((x) => (x.config.title ?? "").trim() === t.trim())?.id ?? null;
}

/** Blocks that only appear once their stat is asked to show them. */
function revealableIds(blocks: ClientBlock[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const b of blocks) {
    const target = revealTargetId(b, blocks);
    if (target != null && target !== b.id) m.set(target, b.id);
  }
  return m;
}

interface PageInfo { id: number; slug: string; title: string; description: string | null; navSection: string | null; moreSection: string | null }
interface SiblingRef { id: number; title: string; kind: BlockKind }

const PALETTE_GROUPS: Array<{ group: string; kinds: BlockKind[] }> = [
  { group: "Metrics", kinds: ["stat", "kpi", "progress"] },
  { group: "Visuals", kinds: ["chart", "table", "leaderboard", "map", "linkcard"] },
  { group: "Content", kinds: ["text", "divider", "embed"] },
  { group: "Controls", kinds: ["filter"] },
  { group: "Containers", kinds: ["group", "pagelist"] },
];
const DATA_KINDS = new Set<BlockKind>(["stat", "kpi", "progress", "chart", "table", "leaderboard", "map", "linkcard"]);
/** Kinds that support a whole-element preset text color. */
const COLORABLE = new Set<BlockKind>(["stat", "kpi", "progress", "text", "divider", "leaderboard", "table"]);

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
  if (kind === "filter") { const t = cfg.filterType ?? "dropdown"; return t === "dropdown" || t === "chips" || t === "tabs"; }
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
  versionCount = 0,
  seedUpdate,
  queryLog = [],
  navSections,
}: {
  page: PageInfo;
  blocks: ClientBlock[];
  isAdmin: boolean;
  initialEdit: boolean;
  schema: DbSchema;
  pages: PageRef[];
  versionCount?: number;
  seedUpdate?: { available: boolean; storedRevision: number; seedRevision: number } | null;
  queryLog?: QueryDebug[];
  /** This org's actual layers, from its nav config — not a hardcoded list. */
  navSections: Array<{ value: string; label: string }>;
}) {
  const router = useRouter();
  const [edit, setEdit] = useState(isAdmin && initialEdit);
  const [pending, start] = useTransition();
  const mutate = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });
  // Undo restores the last snapshot; a full reload back into edit mode guarantees
  // every block editor picks up the restored config (their local state is seeded
  // on mount).
  const undo = () => start(async () => {
    await undoPageAction(page.id, page.slug);
    window.location.assign(`${window.location.pathname}?edit=1`);
  });

  // Drag-and-drop ordering. Only the ID ORDER is held locally, so the grid
  // reflows under the cursor immediately; the blocks themselves always come
  // from props. When the server revalidates, `blocks` changes identity and the
  // optimistic order is dropped during render — React's documented way to
  // reset state on a prop change, rather than a setState inside an effect.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [orderIds, setOrderIds] = useState<number[] | null>(null);
  const [seenBlocks, setSeenBlocks] = useState(blocks);
  if (seenBlocks !== blocks) {
    setSeenBlocks(blocks);
    setOrderIds(null);
  }
  const order = orderIds
    ? (orderIds.map((id) => blocks.find((b) => b.id === id)).filter(Boolean) as ClientBlock[])
    : blocks;

  function dropAt(to: number) {
    const from = dragIndex;
    setDragIndex(null);
    setOverIndex(null);
    if (from === null || from === to) return;
    const next = order.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setOrderIds(next.map((b) => b.id));
    mutate(() => reorderBlocksAction(page.id, next.map((b) => b.id), page.slug));
  }

  const siblings: SiblingRef[] = blocks.map((b) => ({ id: b.id, title: (b.config.title ?? "").trim() || BLOCK_META[b.kind].label, kind: b.kind }));
  // In edit mode every card stays visible — a card you cannot see is a card you
  // cannot fix — but the ones that only appear on click say so.
  const revealTargetsInEdit = useMemo(() => {
    const m = new Map<number, string>();
    for (const [targetId, statId] of revealableIds(blocks)) {
      const stat = blocks.find((x) => x.id === statId);
      m.set(targetId, (stat?.config.title ?? "").trim() || "a stat");
    }
    return m;
  }, [blocks]);

  if (!edit) return <ViewMode page={page} blocks={blocks} isAdmin={isAdmin} pages={pages} onEdit={() => setEdit(true)} />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted">Editing — click a block to change it. Each change can be undone.</div>
        <button type="button" onClick={undo} disabled={pending || versionCount === 0}
          title={versionCount === 0 ? "Nothing to undo yet" : `Undo the last change (${versionCount} available)`}
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-border-soft text-muted hover:text-fg hover:border-accent disabled:opacity-40 disabled:hover:border-border-soft cursor-pointer transition-colors">
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></svg>
          Undo{versionCount > 0 ? ` (${versionCount})` : ""}
        </button>
        {seedUpdate?.available && (
          <button
            type="button"
            disabled={pending}
            title={`This page has been edited, so it stopped taking template updates automatically. Rebuild it from the current template (revision ${seedUpdate.seedRevision}; this page is on ${seedUpdate.storedRevision}). Your layout changes are discarded, and Undo brings them back.`}
            onClick={() => {
              if (!confirm("Rebuild this page from the current template?\n\nLayout changes you made to this page will be discarded. Undo restores them.")) return;
              mutate(() => resetPageToSeedAction(page.id, page.slug));
            }}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-accent text-accent hover:bg-accent hover:text-bg font-medium disabled:opacity-40 cursor-pointer transition-colors"
          >
            Update from template
          </button>
        )}
      </div>
      <QueryInspector queryLog={queryLog} slug={page.slug} />
      <PageSettings navSections={navSections} page={page} onDone={() => setEdit(false)} busy={pending} mutate={mutate} />
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
          {order.map((b, i) => (
            <BlockEditor key={b.id} block={b} slug={page.slug} schema={schema} pages={pages}
              siblings={siblings.filter((s) => s.id !== b.id && DATA_KINDS.has(s.kind))}
              revealedBy={revealTargetsInEdit.get(b.id) ?? null}
              mutate={mutate} busy={pending}
              dragging={dragIndex === i}
              dropTarget={overIndex === i && dragIndex !== null && dragIndex !== i}
              onDragStart={() => setDragIndex(i)}
              onDragOver={() => setOverIndex(i)}
              onDrop={() => dropAt(i)}
              onDragEnd={() => { setDragIndex(null); setOverIndex(null); }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Query inspector (edit-mode only) ─────────────────────────────────
// Shows how many queries rendered the page, each one's wall-clock ms + row
// count, and an EXPLAIN-derived big-O — the debugging surface the admin asked
// for. Complexity is flagged with a text tier + chip (never hue alone), so
// it's legible for red-green colorblindness.

function QueryInspector({ queryLog, slug }: { queryLog: QueryDebug[]; slug: string }) {
  const [open, setOpen] = useState(false);
  if (queryLog.length === 0) return null;
  const totalMs = queryLog.reduce((s, q) => s + q.ms, 0);
  const heavy = queryLog.filter(
    (q) => q.plan && (q.plan.tier === "nested" || q.plan.tier === "correlated"),
  ).length;
  const slowest = Math.max(...queryLog.map((q) => q.ms));
  return (
    <div className="rounded-xl border border-border-soft bg-bg-elev-2/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 cursor-pointer"
      >
        <span className="flex items-center gap-2 text-sm min-w-0">
          <svg
            viewBox="0 0 24 24"
            className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
          <span className="font-medium">Query inspector</span>
          <span className="text-muted truncate">
            {queryLog.length} quer{queryLog.length === 1 ? "y" : "ies"} · {totalMs.toFixed(0)}ms to render
          </span>
        </span>
        {heavy > 0 && (
          <span className="shrink-0 text-[11px] px-1.5 py-0.5 rounded bg-warn-soft-bg text-warn-soft-fg font-medium">
            {heavy} heavy
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-border-softer">
          <div className="px-4 py-2 text-[11px] text-subtle leading-relaxed">
            Blocks run one after another on a single connection, so the total ≈
            the real load time. Named sources are memoized — a source&apos;s whole
            cost lands on its first block and reads ~0ms after.{" "}
            <Link
              href={`/settings/performance?from=${slug}`}
              className="text-accent hover:underline"
            >
              Optimization suggestions →
            </Link>
          </div>
          <ul className="divide-y divide-border-softer">
            {queryLog.map((q, i) => (
              <QueryRow key={`${q.blockId}-${i}`} q={q} slowest={slowest} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function QueryRow({ q, slowest }: { q: QueryDebug; slowest: number }) {
  const [show, setShow] = useState(false);
  const isHeavy = q.plan && (q.plan.tier === "nested" || q.plan.tier === "correlated");
  const isSlow = q.ms > 50 && q.ms >= slowest * 0.75;
  const tier = q.source ? "source" : q.plan?.tier ?? "n/a";
  return (
    <li className="px-4 py-2">
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="w-full flex items-center gap-3 text-left cursor-pointer"
      >
        <span className="flex-1 min-w-0">
          <span className="text-sm font-medium">{q.title}</span>
          <span className="text-[11px] text-subtle ml-2">
            {q.kind}
            {q.source ? ` · ${q.source}` : ""}
          </span>
        </span>
        <span className="text-[11px] text-muted tnum shrink-0">
          {q.rows.toLocaleString()} row{q.rows === 1 ? "" : "s"}
        </span>
        <span
          className={`text-xs tnum shrink-0 ${isSlow ? "text-warn-soft-fg font-semibold" : "text-muted"}`}
        >
          {q.deduped ? "reused" : `${q.ms.toFixed(0)}ms`}
        </span>
        <span
          className={`text-[11px] shrink-0 px-1.5 py-0.5 rounded font-medium ${
            q.deduped
              ? "bg-bg-elev-2 text-subtle"
              : isHeavy
                ? "bg-warn-soft-bg text-warn-soft-fg"
                : "bg-bg-elev-2 text-muted"
          }`}
        >
          {q.deduped ? "deduped" : tier}
        </span>
      </button>
      {show && (
        <div className="mt-2 space-y-2">
          {q.sql ? (
            <pre className="text-[11px] bg-bg rounded-lg border border-border-softer p-2 overflow-x-auto whitespace-pre-wrap">
              {q.sql}
            </pre>
          ) : (
            <div className="text-[11px] text-subtle">
              Named source <code className="font-mono">{q.source}</code> — runs in
              TypeScript (decrypts PII / builds analytics), so there&apos;s no single
              SQL statement to plan; its cost shows as measured ms.
            </div>
          )}
          {q.plan && (
            <div className="text-[11px] text-muted">
              <span className="font-medium text-fg">{q.plan.bigO}</span> ·{" "}
              {q.plan.fullScans} full scan{q.plan.fullScans === 1 ? "" : "s"},{" "}
              {q.plan.indexedSteps} indexed
              {q.plan.correlated ? `, ${q.plan.correlated} correlated` : ""}
              <details className="mt-1">
                <summary className="cursor-pointer hover:text-fg">EXPLAIN QUERY PLAN</summary>
                <pre className="mt-1 whitespace-pre-wrap text-[10px] text-subtle">
                  {q.plan.detail.join("\n")}
                </pre>
              </details>
            </div>
          )}
          {q.error && <div className="text-[11px] text-warn-soft-fg">{q.error}</div>}
        </div>
      )}
    </li>
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
  // Cards a stat can reveal: target block id -> the stat that reveals it. They
  // stay out of the grid entirely until asked for, so nothing reserves space
  // for them and the remaining cards close up.
  const revealable = useMemo(() => revealableIds(blocks), [blocks]);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const toggleReveal = (targetId: number) =>
    setRevealed((cur) => {
      const n = new Set(cur);
      if (n.has(targetId)) n.delete(targetId); else n.add(targetId);
      return n;
    });

  const deps = useMemo(() => blocks.map((b) => ({ id: b.id, sql: b.config.sql ?? "", source: b.config.source, params: paramsIn(b.config.sql ?? "") })), [blocks]);
  const filterByParam = useMemo(() => {
    const m = new Map<string, ClientBlock>();
    for (const b of blocks) if (b.kind === "filter" && b.config.param) m.set(b.config.param, b);
    return m;
  }, [blocks]);

  function setParam(name: string, value: string) {
    const next = { ...params, [name]: value };
    setParams(next);
    const targets = filterByParam.get(name)?.config.targets ?? [];
    // Source-backed blocks receive every param (they use what they need), so
    // any filter change re-runs them; SQL blocks re-run when they reference :name.
    const affected = targets.length
      ? deps.filter((d) => targets.includes(d.id) && (d.sql.trim() || d.source))
      : deps.filter((d) => (d.sql.trim() && d.params.includes(name)) || !!d.source);
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
            // Hidden until its stat asks for it.
            if (revealable.has(b.id) && !revealed.has(b.id)) return null;
            if (b.kind === "divider") {
              return <div key={b.id} className={`py-1 ${spanClass(12)}`}><BlockView kind="divider" config={b.config} result={null} /></div>;
            }
            const target = revealTargetId(b, blocks);
            return (
              <div key={b.id} className={`relative rounded-xl border border-border-soft bg-bg-elev p-5 ${spanClass(b.config.span)}`}>
                {loadingIds.has(b.id) && (
                  <div className="absolute inset-0 rounded-xl bg-bg/40 backdrop-blur-[1px] flex items-center justify-center text-[11px] text-muted z-10">updating…</div>
                )}
                {b.kind === "filter" ? (
                  <FilterControl config={b.config} result={results[b.id]} value={params[b.config.param ?? ""] ?? ""} onChange={(v) => setParam(b.config.param ?? "", v)} />
                ) : (
                  <BlockView
                    kind={b.kind} config={b.config} result={results[b.id]} pages={pages}
                    childResults={b.childResults}
                    reveal={target != null ? { shown: revealed.has(target), toggle: () => toggleReveal(target) } : undefined}
                  />
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

function PageSettings({ page, onDone, busy, mutate, navSections }: { page: PageInfo; onDone: () => void; busy: boolean; mutate: (fn: () => Promise<unknown>) => void; navSections: Array<{ value: string; label: string }> }) {
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
          <span className="text-[10px] uppercase tracking-wide text-subtle">Layer</span>
          <select value={nav} onChange={(e) => setNav(e.target.value)} title="Which hub layer this page appears in"
            className="bg-bg-elev-2 border border-border-soft rounded-lg px-3 py-2 text-sm cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            {navSections.map((s) => <option key={s.value} value={s.value}>{s.value ? `Layer: ${s.label}` : s.label}</option>)}
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
function BlockFields({ kind, cfg, set, schema, pages, siblings, onSqlBlur, onRun, running }: {
  kind: BlockKind; cfg: BlockConfig; set: (p: Partial<BlockConfig>) => void; schema: DbSchema;
  pages?: PageRef[]; siblings?: SiblingRef[]; onSqlBlur?: () => void; onRun?: () => void; running?: boolean;
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
          {(cfg.chartType ?? "bar") === "bar" && (
            <label className="flex items-center gap-2 text-[11px] text-muted cursor-pointer">
              <input type="checkbox" checked={!!cfg.colorByCategory} onChange={(e) => set({ colorByCategory: e.target.checked })} />
              Color each bar by category
            </label>
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
            <option value="tabs">Tabs</option>
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

      {DATA_KINDS.has(kind) && (
        <div className="space-y-1">
          <select value={cfg.source ?? ""} onChange={(e) => set({ source: e.target.value || undefined })} className={`${SELECT} w-full`}>
            <option value="">Data from: SQL query</option>
            {SOURCE_META.map((s) => <option key={s.id} value={s.id}>Data from: {s.label}</option>)}
          </select>
          {cfg.source && <div className="text-[10px] text-subtle leading-snug">{sourceMeta(cfg.source)?.description}</div>}
        </div>
      )}

      {hasSql && !cfg.source && <SqlField value={cfg.sql ?? ""} onChange={(v) => set({ sql: v })} onBlur={onSqlBlur} onRun={onRun} running={running} schema={schema} />}

      {kind === "stat" && (
        <select value={cfg.format ?? "number"} onChange={(e) => set({ format: e.target.value as BlockConfig["format"] })} className={`${SELECT} w-full`}>
          <option value="number">Show as: number</option>
          <option value="ratio">Show as: ratio (1 : x) — normalizes every number the query returns</option>
          <option value="list">Show as: list (a · b · c) — the query&apos;s numbers, raw</option>
        </select>
      )}
      {kind === "stat" && (cfg.format ?? "number") === "number" && (
        <input value={cfg.secondaryLabel ?? ""} onChange={(e) => set({ secondaryLabel: e.target.value || undefined })} placeholder={`"+N" label — uses the query's 2nd column (e.g. "kids")`} className={INPUT_SM} />
      )}
      {kind === "stat" && (cfg.format ?? "number") === "number" && (
        <input type="number" min={0} value={cfg.valueColumn ?? 0} onChange={(e) => set({ valueColumn: Math.max(0, Number(e.target.value)) || undefined })} placeholder="Value column (0 = first)" title="Which result column holds the number (0 = first). Lets several cards share one source row." className={INPUT_SM} />
      )}
      {(kind === "stat" || kind === "kpi") && (
        <input value={cfg.sub ?? ""} onChange={(e) => set({ sub: e.target.value })} placeholder="Sub-label (optional)" className={INPUT_SM} />
      )}
      {kind === "stat" && siblings && siblings.length > 0 && (
        <div className="rounded-lg border border-border-soft/70 p-2 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-subtle">
            &ldquo;See more&rdquo; opens another card
          </div>
          <select
            value={cfg.revealsBlock ?? ""}
            onChange={(e) =>
              set({
                revealsBlock: e.target.value ? Number(e.target.value) : undefined,
                revealsBlockTitle: undefined,
              })
            }
            className={`${SELECT} w-full`}
          >
            <option value="">Nothing — this is just a number</option>
            {siblings.map((sib) => (
              <option key={sib.id} value={sib.id}>{sib.title}</option>
            ))}
          </select>
          {(cfg.revealsBlock || cfg.revealsBlockTitle) && (
            <input
              value={cfg.detailLabel ?? ""}
              onChange={(e) => set({ detailLabel: e.target.value || undefined })}
              placeholder={`Link text (default "See more")`}
              className={INPUT_SM}
            />
          )}
          <div className="text-[10px] text-subtle">
            That card stays out of the page until this number is clicked, so it
            doesn&apos;t leave a gap next to its neighbours.
          </div>
        </div>
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
          <BlockFields kind={ch.kind} cfg={ch.config} set={(p) => setChild(i, p)} schema={schema} onSqlBlur={() => runChild(i, ch.config.sql ?? "")} onRun={() => runChild(i, ch.config.sql ?? "")} />
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

function BlockEditor({
  block, slug, schema, pages, siblings, revealedBy, mutate, busy,
  dragging, dropTarget, onDragStart, onDragOver, onDrop, onDragEnd,
}: {
  block: ClientBlock; slug: string; schema: DbSchema; pages: PageRef[]; siblings: SiblingRef[];
  /** Title of the stat that reveals this card, when it only appears on click. */
  revealedBy?: string | null;
  mutate: (fn: () => Promise<unknown>) => void; busy: boolean;
  dragging: boolean; dropTarget: boolean;
  onDragStart: () => void; onDragOver: () => void; onDrop: () => void; onDragEnd: () => void;
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
    if (!hasSql && !cfg.source) return;
    setRunning(true);
    try { setResult(cfg.source ? await runSourceAction(cfg.source) : await runQueryAction(cfg.sql ?? "")); } finally { setRunning(false); }
  }
  function save() { mutate(async () => { await updateBlockAction(block.id, cfg, slug); }); setEditing(false); }
  function cancel() { setCfg(block.config); setResult(block.result); setEditing(false); }

  const ctrl = (
    <div className="flex items-center gap-1 text-muted" onClick={(e) => e.stopPropagation()}>
      <span
        title="Drag to reorder"
        aria-label="Drag to reorder"
        className="w-6 h-6 rounded hover:bg-bg-elev-2 grid place-items-center cursor-grab active:cursor-grabbing select-none leading-none"
      >
        ⠿
      </span>
      <button type="button" disabled={busy} title="Delete block" onClick={() => mutate(() => deleteBlockAction(block.id, slug))} className="w-6 h-6 rounded hover:bg-bg-elev-2 hover:text-warn-soft-fg cursor-pointer">✕</button>
    </div>
  );

  if (!editing) {
    return (
      <div onClick={() => setEditing(true)} title="Click to edit"
        draggable={!busy}
        onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(); }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; onDragOver(); }}
        onDrop={(e) => { e.preventDefault(); onDrop(); }}
        onDragEnd={onDragEnd}
        className={`group relative rounded-xl border bg-bg-elev p-5 cursor-pointer transition-colors ${spanClass(cfg.span)} ${
          dragging
            ? "opacity-40 border-accent"
            : dropTarget
              ? "border-accent ring-2 ring-accent/40"
              : "border-border-soft hover:border-accent"
        }`}>
        <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="text-[10px] text-accent px-1.5 py-0.5 rounded bg-accent/10">edit</span>
          {ctrl}
        </div>
        {revealedBy && (
          <div className="absolute top-2 left-2 text-[10px] text-subtle px-1.5 py-0.5 rounded bg-bg-elev-2 border border-border-soft">
            shown by &ldquo;{revealedBy}&rdquo;
          </div>
        )}
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
        <BlockFields kind={kind} cfg={cfg} set={set} schema={schema} pages={pages} siblings={siblings} onSqlBlur={run} onRun={run} running={running} />
      )}

      {kind === "stat" && (cfg.format === "ratio" || cfg.format === "list") && (result?.rows?.[0]?.length ?? 0) > 0 && (
        <div className="rounded-lg border border-border-soft/70 p-2 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-subtle">Segment colors (run the query first)</div>
          <div className="flex flex-wrap gap-1.5">
            {(result?.rows?.[0] ?? []).filter((v) => Number.isFinite(Number(v))).map((_, i) => (
              <select key={i} value={cfg.segmentColors?.[i] ?? "normal"}
                onChange={(e) => { const a = [...(cfg.segmentColors ?? [])]; while (a.length <= i) a.push("normal"); a[i] = e.target.value; set({ segmentColors: a }); }}
                className="bg-bg border border-border-soft rounded px-1 py-0.5 text-[11px] cursor-pointer">
                {COLOR_PRESETS.map((p) => <option key={p.id} value={p.id}>{`#${i + 1}: ${p.label}`}</option>)}
              </select>
            ))}
          </div>
        </div>
      )}

      {kind === "table" && result?.columns && result.columns.length > 0 && (
        <div className="rounded-lg border border-border-soft/70 p-2 space-y-1.5">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-subtle">
            <span>Per-column color</span>
            <span className="normal-case tracking-normal">bands: base ± band color cells green/amber/red · ✓ = lower is better</span>
          </div>
          <div className="space-y-1">
            {result.columns.map((c) => {
              const th = cfg.columnThresholds?.[c];
              const setTh = (patch: Partial<{ base: number; band: number; invert: boolean }> | null) => {
                const next = { ...(cfg.columnThresholds ?? {}) };
                if (patch === null) delete next[c];
                else next[c] = { ...(next[c] ?? { base: 0 }), ...patch };
                set({ columnThresholds: next });
              };
              return (
                <div key={c} className="flex items-center gap-1.5 text-xs min-w-0">
                  <span className="truncate w-28 shrink-0" title={c}>{c}</span>
                  <select value={cfg.columnColors?.[c] ?? "normal"}
                    onChange={(e) => set({ columnColors: { ...(cfg.columnColors ?? {}), [c]: e.target.value } })}
                    className="bg-bg border border-border-soft rounded px-1 py-0.5 text-[11px] cursor-pointer">
                    {COLOR_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                  <input type="number" placeholder="base" value={th?.base ?? ""}
                    onChange={(e) => (e.target.value === "" ? setTh(null) : setTh({ base: Number(e.target.value) }))}
                    className="w-14 bg-bg border border-border-soft rounded px-1 py-0.5 text-[11px]" />
                  <input type="number" placeholder="±band" value={th?.band ?? ""} disabled={!th}
                    onChange={(e) => setTh({ band: Number(e.target.value) })}
                    className="w-14 bg-bg border border-border-soft rounded px-1 py-0.5 text-[11px] disabled:opacity-40" />
                  <input type="checkbox" checked={!!th?.invert} disabled={!th} title="lower is better (flip green/red)"
                    onChange={(e) => setTh({ invert: e.target.checked })} className="cursor-pointer disabled:opacity-40" />
                  <label className="flex items-center gap-0.5 text-[10px] text-subtle cursor-pointer" title="Render this column's newline-joined list as chips">
                    <input type="checkbox" checked={(cfg.chipColumns ?? []).includes(c)}
                      onChange={(e) => set({ chipColumns: e.target.checked ? [...(cfg.chipColumns ?? []), c] : (cfg.chipColumns ?? []).filter((x) => x !== c) })}
                      className="cursor-pointer" />
                    chips
                  </label>
                </div>
              );
            })}
          </div>
        </div>
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
            <label className="flex items-center gap-1 text-subtle cursor-pointer"><input type="checkbox" checked={!!cfg.sortable} onChange={(e) => set({ sortable: e.target.checked })} />Sortable</label>
            <label className="text-subtle">Max rows</label>
            <input type="number" min={1} value={cfg.limit ?? ""} placeholder="all" onChange={(e) => set({ limit: e.target.value === "" ? undefined : Math.max(1, Number(e.target.value)) })} className="w-16 bg-bg border border-border-soft rounded px-1.5 py-1 text-xs" />
          </>
        )}
        {COLORABLE.has(kind) && (
          <>
            <label className="text-subtle">Color</label>
            <select value={cfg.color ?? "normal"} onChange={(e) => set({ color: e.target.value as BlockConfig["color"] })} className="bg-bg border border-border-soft rounded px-1.5 py-1 text-xs cursor-pointer">
              {COLOR_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </>
        )}
        {hasSql && cfg.source && <button type="button" onClick={run} disabled={running} className="ml-auto px-2.5 py-1 rounded border border-border-soft text-muted hover:text-fg cursor-pointer disabled:opacity-50">{running ? "Running…" : "Run"}</button>}
        <button type="button" onClick={cancel} className={`px-2.5 py-1 rounded border border-border-soft text-muted hover:text-fg cursor-pointer ${hasSql && cfg.source ? "" : "ml-auto"}`}>Cancel</button>
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
