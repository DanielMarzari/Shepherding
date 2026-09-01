"use client";

import { useState, useTransition } from "react";
import {
  DEFAULT_NAV_CONFIG,
  PAGE_REGISTRY,
  type NavConfig,
  type NavGroup,
  type NavItemRef,
} from "@/lib/nav-registry";
import { saveNavConfigAction } from "./actions";

const clone = (c: NavConfig): NavConfig => structuredClone(c);

function itemLabel(it: NavItemRef): string {
  if (it.kind === "builder") return it.label;
  return PAGE_REGISTRY[it.pageKey]?.defaultLabel ?? it.pageKey;
}
function itemKey(it: NavItemRef): string {
  return it.kind === "builder" ? `builder:${it.slug}` : it.pageKey;
}

const BTN = "text-xs px-2 py-1 rounded-lg border border-border-soft text-muted hover:text-fg hover:border-accent disabled:opacity-30 disabled:hover:border-border-soft cursor-pointer transition-colors";

export function NavEditor({ initial, isAdmin }: { initial: NavConfig; isAdmin: boolean }) {
  const [cfg, setCfg] = useState<NavConfig>(() => clone(initial));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  const assigned = new Set<string>();
  for (const g of cfg.groups) for (const it of g.items) if (it.kind === "page") assigned.add(it.pageKey);
  const unassigned = Object.keys(PAGE_REGISTRY).filter((k) => !assigned.has(k));

  function apply(next: NavConfig) {
    setCfg(next);
    setDirty(true);
    setMsg(null);
  }
  const mutate = (fn: (c: NavConfig) => void) => {
    const next = clone(cfg);
    fn(next);
    apply(next);
  };

  function save() {
    start(async () => {
      const res = await saveNavConfigAction(cfg);
      setMsg({ ok: res.ok, text: res.message });
      if (res.ok) setDirty(false);
    });
  }
  function reset() {
    apply(clone(DEFAULT_NAV_CONFIG));
  }

  if (!isAdmin) {
    return <p className="text-sm text-muted">Only admins can edit the navigation.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={pending || !dirty}
          className="text-sm px-3 py-1.5 rounded-lg border border-accent text-accent hover:bg-accent hover:text-bg disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-accent cursor-pointer transition-colors">
          {pending ? "Saving…" : "Save navigation"}
        </button>
        <button type="button" onClick={reset} disabled={pending} className={BTN}>Reset to default</button>
        {dirty && !msg && <span className="text-xs text-subtle">Unsaved changes</span>}
        {msg && <span className={`text-xs ${msg.ok ? "text-good-soft-fg" : "text-warn-soft-fg"}`}>{msg.text}</span>}
      </div>

      <p className="text-xs text-subtle max-w-2xl">
        Drag isn&apos;t needed — use the arrows to reorder. Set a group to{" "}
        <span className="text-fg">Drill-in</span> to make it a single sidebar entry
        that opens its own list (with a Back arrow). Page Builder pages you&apos;ve
        pinned to the nav are placed from each page&apos;s own settings and merged
        in automatically.
      </p>

      <div className="space-y-3">
        {cfg.groups.map((g, gi) => (
          <GroupCard
            key={gi}
            group={g}
            gi={gi}
            total={cfg.groups.length}
            unassigned={unassigned}
            onRename={(label) => mutate((c) => { c.groups[gi].label = label; })}
            onMode={(mode) => mutate((c) => { c.groups[gi].mode = mode; })}
            onCollapsible={(v) => mutate((c) => { c.groups[gi].collapsible = v; })}
            onMoveGroup={(dir) => mutate((c) => {
              const j = gi + dir;
              if (j < 0 || j >= c.groups.length) return;
              [c.groups[gi], c.groups[j]] = [c.groups[j], c.groups[gi]];
            })}
            onDeleteGroup={() => mutate((c) => { c.groups.splice(gi, 1); })}
            onAddPage={(pageKey) => mutate((c) => { c.groups[gi].items.push({ kind: "page", pageKey }); })}
            onRemoveItem={(ii) => mutate((c) => { c.groups[gi].items.splice(ii, 1); })}
            onMoveItem={(ii, dir) => mutate((c) => {
              const items = c.groups[gi].items;
              const j = ii + dir;
              if (j < 0 || j >= items.length) return;
              [items[ii], items[j]] = [items[j], items[ii]];
            })}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={() => mutate((c) => { c.groups.push({ id: `group-${c.groups.length + 1}-${c.groups.length}`, label: "New heading", mode: "top", items: [] }); })}
        className="text-sm px-3 py-1.5 rounded-lg border border-dashed border-border-soft text-muted hover:text-fg hover:border-accent cursor-pointer transition-colors"
      >
        + Add heading
      </button>

      {unassigned.length > 0 && (
        <div className="rounded-xl border border-border-soft p-4">
          <div className="text-xs uppercase tracking-wider text-subtle mb-2">
            Not in the sidebar ({unassigned.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {unassigned.map((k) => (
              <span key={k} className="text-xs px-2 py-1 rounded-lg bg-bg-elev-2 text-muted">
                {PAGE_REGISTRY[k].defaultLabel}
              </span>
            ))}
          </div>
          <p className="text-[11px] text-subtle mt-2">Add any of these to a heading with its “Add page” menu.</p>
        </div>
      )}
    </div>
  );
}

function GroupCard({
  group, gi, total, unassigned,
  onRename, onMode, onCollapsible, onMoveGroup, onDeleteGroup, onAddPage, onRemoveItem, onMoveItem,
}: {
  group: NavGroup;
  gi: number;
  total: number;
  unassigned: string[];
  onRename: (label: string) => void;
  onMode: (mode: "top" | "drill") => void;
  onCollapsible: (v: boolean) => void;
  onMoveGroup: (dir: -1 | 1) => void;
  onDeleteGroup: () => void;
  onAddPage: (pageKey: string) => void;
  onRemoveItem: (ii: number) => void;
  onMoveItem: (ii: number, dir: -1 | 1) => void;
}) {
  const [addKey, setAddKey] = useState("");
  return (
    <div className="rounded-xl border border-border-soft p-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          value={group.label}
          onChange={(e) => onRename(e.target.value)}
          aria-label="Heading name"
          className="bg-bg border border-border-soft rounded-lg px-2.5 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent"
        />
        <select
          value={group.mode}
          onChange={(e) => onMode(e.target.value as "top" | "drill")}
          aria-label="Group mode"
          className="bg-bg border border-border-soft rounded-lg px-2 py-1.5 text-xs cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/40"
        >
          <option value="top">Top-level</option>
          <option value="drill">Drill-in</option>
        </select>
        {group.mode === "top" && (
          <label className="text-xs text-muted flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={group.collapsible ?? false} onChange={(e) => onCollapsible(e.target.checked)} />
            Collapsible
          </label>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => onMoveGroup(-1)} disabled={gi === 0} className={BTN} aria-label="Move heading up">↑</button>
          <button type="button" onClick={() => onMoveGroup(1)} disabled={gi === total - 1} className={BTN} aria-label="Move heading down">↓</button>
          <button type="button" onClick={onDeleteGroup} className={`${BTN} hover:!text-warn-soft-fg`} aria-label="Delete heading">✕</button>
        </div>
      </div>

      {group.items.length === 0 ? (
        <p className="text-xs text-subtle mb-2">No pages in this heading yet.</p>
      ) : (
        <ul className="space-y-1 mb-2">
          {group.items.map((it, ii) => (
            <li key={itemKey(it)} className="flex items-center gap-2 bg-bg-elev-2/50 rounded-lg px-2.5 py-1.5">
              <span className="text-sm flex-1 min-w-0 truncate">
                {itemLabel(it)}
                {it.kind === "builder" && <span className="text-[10px] text-subtle ml-2">page builder</span>}
              </span>
              <button type="button" onClick={() => onMoveItem(ii, -1)} disabled={ii === 0} className={BTN} aria-label="Move page up">↑</button>
              <button type="button" onClick={() => onMoveItem(ii, 1)} disabled={ii === group.items.length - 1} className={BTN} aria-label="Move page down">↓</button>
              <button type="button" onClick={() => onRemoveItem(ii)} className={BTN} aria-label="Remove page">✕</button>
            </li>
          ))}
        </ul>
      )}

      {unassigned.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            value={addKey}
            onChange={(e) => setAddKey(e.target.value)}
            className="bg-bg border border-border-soft rounded-lg px-2 py-1.5 text-xs cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/40"
          >
            <option value="">Add page…</option>
            {unassigned.map((k) => (
              <option key={k} value={k}>{PAGE_REGISTRY[k].defaultLabel}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={!addKey}
            onClick={() => { if (addKey) { onAddPage(addKey); setAddKey(""); } }}
            className={BTN}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
