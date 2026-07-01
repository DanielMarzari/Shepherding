"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BlockConfig, BlockKind, QueryResult } from "@/lib/builder";
import { BlockView, BLOCK_META } from "./blocks";
import {
  addBlockAction,
  deleteBlockAction,
  deletePageAction,
  moveBlockAction,
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
interface PageInfo {
  id: number;
  slug: string;
  title: string;
  description: string | null;
}

const KINDS: BlockKind[] = ["stat", "bar", "table", "text"];
const spanClass = (n: number | undefined) =>
  n === 3 ? "lg:col-span-3" : n === 2 ? "lg:col-span-2" : "lg:col-span-1";

export function BuilderPageClient({
  page,
  blocks,
  isAdmin,
  initialEdit,
}: {
  page: PageInfo;
  blocks: ClientBlock[];
  isAdmin: boolean;
  initialEdit: boolean;
}) {
  const router = useRouter();
  const [edit, setEdit] = useState(isAdmin && initialEdit);
  const [pending, start] = useTransition();

  const mutate = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });

  // ── VIEW MODE ──────────────────────────────────────────────────────
  if (!edit) {
    return (
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{page.title}</h1>
            {page.description && <p className="text-muted text-sm mt-1 max-w-2xl">{page.description}</p>}
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setEdit(true)}
              className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-accent text-accent hover:bg-accent hover:text-bg transition-colors cursor-pointer"
            >
              Edit page
            </button>
          )}
        </div>
        {blocks.length === 0 ? (
          <EmptyPage isAdmin={isAdmin} onEdit={() => setEdit(true)} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {blocks.map((b) => (
              <div key={b.id} className={`rounded-xl border border-border-soft bg-bg-elev-2/40 p-5 ${spanClass(b.config.span)}`}>
                <BlockView kind={b.kind} config={b.config} result={b.result} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── EDIT MODE ──────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <PageSettings page={page} onDone={() => setEdit(false)} busy={pending} mutate={mutate} />

      {/* Block palette */}
      <div className="rounded-xl border border-border-soft bg-bg-elev-2/40 p-4">
        <div className="text-xs text-muted font-medium mb-2">Add a block</div>
        <div className="flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              disabled={pending}
              onClick={() => mutate(() => addBlockAction(page.id, k, page.slug))}
              className="group text-left rounded-lg border border-border-soft hover:border-accent bg-bg/40 px-3 py-2 cursor-pointer disabled:opacity-50 transition-colors"
            >
              <div className="text-sm font-medium group-hover:text-accent">{BLOCK_META[k].label}</div>
              <div className="text-[11px] text-subtle">{BLOCK_META[k].hint}</div>
            </button>
          ))}
        </div>
      </div>

      {blocks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-soft p-8 text-center text-sm text-muted">
          No blocks yet — add one above. Each block runs a read-only SQL query against the live database.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {blocks.map((b, i) => (
            <BlockEditor
              key={b.id}
              block={b}
              slug={page.slug}
              isFirst={i === 0}
              isLast={i === blocks.length - 1}
              mutate={mutate}
              busy={pending}
            />
          ))}
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
      {isAdmin && (
        <button type="button" onClick={onEdit} className="text-xs px-3 py-1.5 rounded-lg bg-accent text-[var(--accent-fg)] font-medium cursor-pointer">
          Add blocks
        </button>
      )}
    </div>
  );
}

function PageSettings({
  page,
  onDone,
  busy,
  mutate,
}: {
  page: PageInfo;
  onDone: () => void;
  busy: boolean;
  mutate: (fn: () => Promise<unknown>) => void;
}) {
  const [title, setTitle] = useState(page.title);
  const [desc, setDesc] = useState(page.description ?? "");
  return (
    <div className="rounded-xl border border-border-soft bg-bg-elev-2/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-muted font-medium">Page — editing</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => mutate(async () => updatePageAction(page.id, title, desc, page.slug))}
            className="text-xs px-3 py-1.5 rounded-lg border border-border-soft text-fg hover:bg-bg-elev-2/60 cursor-pointer disabled:opacity-50"
          >
            Save details
          </button>
          <button
            type="button"
            onClick={onDone}
            className="text-xs px-3 py-1.5 rounded-lg bg-accent text-[var(--accent-fg)] font-medium cursor-pointer"
          >
            Done
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => { if (confirm("Delete this whole page?")) mutate(() => deletePageAction(page.id)); }}
            className="text-xs text-subtle hover:text-warn-soft-fg cursor-pointer"
          >
            Delete page
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Page title"
          className="bg-bg-elev-2 border border-border-soft rounded-lg px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="Short description (optional)"
          className="bg-bg-elev-2 border border-border-soft rounded-lg px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </div>
    </div>
  );
}

function BlockEditor({
  block,
  slug,
  isFirst,
  isLast,
  mutate,
  busy,
}: {
  block: ClientBlock;
  slug: string;
  isFirst: boolean;
  isLast: boolean;
  mutate: (fn: () => Promise<unknown>) => void;
  busy: boolean;
}) {
  const [cfg, setCfg] = useState<BlockConfig>(block.config);
  const [result, setResult] = useState<QueryResult | null>(block.result);
  const [running, setRunning] = useState(false);
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<BlockConfig>) => { setCfg((c) => ({ ...c, ...patch })); setSaved(false); };
  const hasSql = block.kind !== "text";

  async function run() {
    if (!hasSql) return;
    setRunning(true);
    try { setResult(await runQueryAction(cfg.sql ?? "")); } finally { setRunning(false); }
  }
  function save() {
    mutate(async () => { await updateBlockAction(block.id, cfg, slug); });
    setSaved(true);
  }

  return (
    <div className={`rounded-xl border border-border-soft bg-bg-elev-2/40 p-4 space-y-3 ${spanClass(cfg.span)}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted">
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />{BLOCK_META[block.kind].label}
        </span>
        <div className="flex items-center gap-1 text-muted">
          <button type="button" disabled={busy || isFirst} title="Move up" onClick={() => mutate(() => moveBlockAction(block.id, "up", slug))} className="w-6 h-6 rounded hover:bg-bg-elev-2 disabled:opacity-30 cursor-pointer">↑</button>
          <button type="button" disabled={busy || isLast} title="Move down" onClick={() => mutate(() => moveBlockAction(block.id, "down", slug))} className="w-6 h-6 rounded hover:bg-bg-elev-2 disabled:opacity-30 cursor-pointer">↓</button>
          <button type="button" disabled={busy} title="Delete block" onClick={() => mutate(() => deleteBlockAction(block.id, slug))} className="w-6 h-6 rounded hover:bg-bg-elev-2 hover:text-warn-soft-fg cursor-pointer">✕</button>
        </div>
      </div>

      <input
        value={cfg.title ?? ""}
        onChange={(e) => set({ title: e.target.value })}
        placeholder={block.kind === "text" ? "Heading (optional)" : "Block title"}
        className="w-full bg-bg border border-border-soft rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />

      {block.kind === "text" ? (
        <textarea
          value={cfg.text ?? ""}
          onChange={(e) => set({ text: e.target.value })}
          rows={4}
          placeholder="Write text…"
          className="w-full bg-bg border border-border-soft rounded-lg px-2.5 py-1.5 text-sm resize-y focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      ) : (
        <>
          <textarea
            value={cfg.sql ?? ""}
            onChange={(e) => set({ sql: e.target.value })}
            onBlur={run}
            rows={4}
            spellCheck={false}
            placeholder="SELECT …"
            className="w-full bg-bg border border-border-soft rounded-lg px-2.5 py-1.5 text-xs font-mono resize-y focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          {block.kind === "stat" && (
            <input
              value={cfg.sub ?? ""}
              onChange={(e) => set({ sub: e.target.value })}
              placeholder="Sub-label (optional)"
              className="w-full bg-bg border border-border-soft rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          )}
        </>
      )}

      <div className="flex items-center gap-2 text-xs">
        <label className="text-subtle">Width</label>
        <select
          value={cfg.span ?? 1}
          onChange={(e) => set({ span: Number(e.target.value) })}
          className="bg-bg border border-border-soft rounded px-1.5 py-1 text-xs cursor-pointer"
        >
          <option value={1}>1 col</option>
          <option value={2}>2 cols</option>
          <option value={3}>3 cols (full)</option>
        </select>
        {hasSql && (
          <button type="button" onClick={run} disabled={running} className="ml-auto px-2.5 py-1 rounded border border-border-soft text-muted hover:text-fg cursor-pointer disabled:opacity-50">
            {running ? "Running…" : "Run"}
          </button>
        )}
        <button type="button" onClick={save} disabled={busy} className={`px-2.5 py-1 rounded font-medium cursor-pointer disabled:opacity-50 ${saved ? "border border-good-soft-bg text-good-soft-fg" : "bg-accent text-[var(--accent-fg)]"} ${hasSql ? "" : "ml-auto"}`}>
          {saved ? "Saved" : "Save"}
        </button>
      </div>

      {/* Live preview */}
      <div className="rounded-lg border border-border-soft bg-bg/40 p-3">
        <div className="text-[10px] uppercase tracking-wide text-subtle mb-2">Preview</div>
        <BlockView kind={block.kind} config={cfg} result={hasSql ? result : null} />
      </div>
    </div>
  );
}
