"use client";

import { useRef, useState, useTransition } from "react";
import {
  DEFAULT_NAV_CONFIG,
  PAGE_REGISTRY,
  type NavConfig,
  type NavItemRef,
} from "@/lib/nav-registry";
import { saveNavConfigAction } from "./actions";

type Drag =
  | { type: "page"; gi: number; ii: number }
  | { type: "layer"; gi: number }
  | null;

const clone = (c: NavConfig): NavConfig => structuredClone(c);
const itemLabel = (it: NavItemRef) =>
  it.kind === "builder" ? it.label : PAGE_REGISTRY[it.pageKey]?.defaultLabel ?? it.pageKey;
const itemKey = (it: NavItemRef) => (it.kind === "builder" ? `builder:${it.slug}` : it.pageKey);

export function NavEditor({ initial, isAdmin }: { initial: NavConfig; isAdmin: boolean }) {
  const [cfg, setCfg] = useState<NavConfig>(() => clone(initial));
  const drag = useRef<Drag>(null);
  const [over, setOver] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  const assigned = new Set<string>();
  for (const g of cfg.groups) for (const it of g.items) if (it.kind === "page") assigned.add(it.pageKey);
  const unassigned = Object.keys(PAGE_REGISTRY).filter((k) => !assigned.has(k));

  const mutate = (fn: (c: NavConfig) => void) => {
    const next = clone(cfg);
    fn(next);
    setCfg(next);
    setDirty(true);
    setMsg(null);
  };

  function dropPage(toGi: number, toIi: number) {
    const d = drag.current;
    if (!d || d.type !== "page") return;
    mutate((c) => {
      const item = c.groups[d.gi].items[d.ii];
      c.groups[d.gi].items.splice(d.ii, 1);
      let idx = toIi;
      if (d.gi === toGi && d.ii < toIi) idx--;
      idx = Math.max(0, Math.min(idx, c.groups[toGi].items.length));
      c.groups[toGi].items.splice(idx, 0, item);
    });
  }
  function dropLayer(toGi: number) {
    const d = drag.current;
    if (!d || d.type !== "layer" || d.gi === toGi) return;
    mutate((c) => {
      const [g] = c.groups.splice(d.gi, 1);
      let idx = toGi;
      if (d.gi < toGi) idx--;
      c.groups.splice(idx, 0, g);
    });
  }

  function save() {
    start(async () => {
      const res = await saveNavConfigAction(cfg);
      setMsg({ ok: res.ok, text: res.message });
      if (res.ok) setDirty(false);
    });
  }

  if (!isAdmin) return <p className="text-sm text-muted">Only admins can edit the navigation.</p>;

  return (
    <div className="space-y-4" onDragEnd={() => { drag.current = null; setOver(null); }}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={pending || !dirty}
          className="text-sm px-3 py-1.5 rounded-lg border border-accent text-accent hover:bg-accent hover:text-bg disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-accent cursor-pointer transition-colors">
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => mutate(() => { setCfg(clone(DEFAULT_NAV_CONFIG)); })}
          disabled={pending}
          className="text-sm px-3 py-1.5 rounded-lg border border-border-soft text-muted hover:text-fg hover:border-accent cursor-pointer transition-colors">
          Reset to default
        </button>
        {dirty && !msg && <span className="text-xs text-subtle">Unsaved changes</span>}
        {msg && <span className={`text-xs ${msg.ok ? "text-good-soft-fg" : "text-warn-soft-fg"}`}>{msg.text}</span>}
      </div>

      <p className="text-xs text-subtle max-w-2xl">
        This is your home hub. Drag a page to move it within a layer or into
        another; drag a layer by its handle to reorder. Add layers and pages
        below. Page Builder pages you&apos;ve pinned to the nav are placed from
        each page&apos;s own settings.
      </p>

      {/* Layers */}
      <div className="space-y-3">
        {cfg.groups.map((g, gi) => (
          <div
            key={gi}
            className={`rounded-xl border p-4 transition-colors ${over === `layer:${gi}` ? "border-accent" : "border-border-soft"}`}
            onDragOver={(e) => {
              if (drag.current?.type === "layer") { e.preventDefault(); setOver(`layer:${gi}`); }
            }}
            onDrop={(e) => {
              if (drag.current?.type === "layer") { e.preventDefault(); dropLayer(gi); setOver(null); }
            }}
          >
            <div className="flex items-center gap-2 mb-3">
              <span
                draggable
                onDragStart={() => { drag.current = { type: "layer", gi }; }}
                title="Drag to reorder layer"
                className="cursor-grab active:cursor-grabbing text-subtle hover:text-fg select-none px-1"
                aria-hidden
              >
                ⠿
              </span>
              <input
                value={g.label}
                onChange={(e) => mutate((c) => { c.groups[gi].label = e.target.value; })}
                aria-label="Layer name"
                className="bg-bg border border-border-soft rounded-lg px-2.5 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent"
              />
              <span className="text-[11px] text-subtle">{g.items.length} page{g.items.length === 1 ? "" : "s"}</span>
              <button type="button" onClick={() => mutate((c) => { c.groups.splice(gi, 1); })}
                aria-label="Delete layer"
                className="ml-auto text-xs px-2 py-1 rounded-lg border border-border-soft text-subtle hover:text-warn-soft-fg hover:border-warn-soft-fg cursor-pointer transition-colors">
                Remove layer
              </button>
            </div>

            {/* Page chips (drop zone for pages) */}
            <div
              className={`flex flex-wrap gap-2 min-h-11 rounded-lg p-2 border border-dashed transition-colors ${
                over === `body:${gi}` ? "border-accent bg-accent-soft-bg" : "border-border-softer"
              }`}
              onDragOver={(e) => {
                if (drag.current?.type === "page") { e.preventDefault(); setOver(`body:${gi}`); }
              }}
              onDrop={(e) => {
                if (drag.current?.type === "page") { e.preventDefault(); dropPage(gi, g.items.length); setOver(null); }
              }}
            >
              {g.items.length === 0 && (
                <span className="text-xs text-subtle px-1 py-1.5">Drag pages here, or add one below.</span>
              )}
              {g.items.map((it, ii) => (
                <span
                  key={itemKey(it)}
                  draggable
                  onDragStart={(e) => { e.stopPropagation(); drag.current = { type: "page", gi, ii }; }}
                  onDragOver={(e) => {
                    if (drag.current?.type === "page") { e.preventDefault(); e.stopPropagation(); setOver(`chip:${gi}:${ii}`); }
                  }}
                  onDrop={(e) => {
                    if (drag.current?.type === "page") { e.preventDefault(); e.stopPropagation(); dropPage(gi, ii); setOver(null); }
                  }}
                  className={`inline-flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-lg border cursor-grab active:cursor-grabbing transition-colors ${
                    over === `chip:${gi}:${ii}` ? "border-accent" : "border-border-soft"
                  } bg-bg-elev-2/50`}
                >
                  <span aria-hidden className="text-subtle text-xs">⠿</span>
                  {itemLabel(it)}
                  {it.kind === "builder" && <span className="text-[10px] text-subtle">page builder</span>}
                  <button type="button" onClick={() => mutate((c) => { c.groups[gi].items.splice(ii, 1); })}
                    aria-label={`Remove ${itemLabel(it)}`}
                    className="text-subtle hover:text-warn-soft-fg cursor-pointer">×</button>
                </span>
              ))}
            </div>

            {unassigned.length > 0 && <AddPage unassigned={unassigned} onAdd={(k) => mutate((c) => { c.groups[gi].items.push({ kind: "page", pageKey: k }); })} />}
          </div>
        ))}
      </div>

      <button type="button"
        onClick={() => mutate((c) => { c.groups.push({ id: `layer-${c.groups.length}-${Math.random().toString(36).slice(2, 8)}`, label: "New layer", mode: "top", items: [] }); })}
        className="text-sm px-3 py-1.5 rounded-lg border border-dashed border-border-soft text-muted hover:text-fg hover:border-accent cursor-pointer transition-colors">
        + Add a layer
      </button>

      {unassigned.length > 0 && (
        <div className="rounded-xl border border-border-soft p-4">
          <div className="text-xs uppercase tracking-wider text-subtle mb-2">Not in the hub ({unassigned.length})</div>
          <div className="flex flex-wrap gap-1.5">
            {unassigned.map((k) => (
              <span key={k} className="text-xs px-2 py-1 rounded-lg bg-bg-elev-2 text-muted">{PAGE_REGISTRY[k].defaultLabel}</span>
            ))}
          </div>
          <p className="text-[11px] text-subtle mt-2">Add any of these to a layer with its “+ add page” menu.</p>
        </div>
      )}
    </div>
  );
}

function AddPage({ unassigned, onAdd }: { unassigned: string[]; onAdd: (k: string) => void }) {
  const [k, setK] = useState("");
  return (
    <div className="flex items-center gap-2 mt-2">
      <select value={k} onChange={(e) => setK(e.target.value)}
        className="bg-bg border border-border-soft rounded-lg px-2 py-1.5 text-xs cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/40">
        <option value="">+ add page…</option>
        {unassigned.map((u) => <option key={u} value={u}>{PAGE_REGISTRY[u].defaultLabel}</option>)}
      </select>
      <button type="button" disabled={!k} onClick={() => { if (k) { onAdd(k); setK(""); } }}
        className="text-xs px-2 py-1 rounded-lg border border-border-soft text-muted hover:text-fg hover:border-accent disabled:opacity-30 cursor-pointer transition-colors">Add</button>
    </div>
  );
}
