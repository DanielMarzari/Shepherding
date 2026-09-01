"use client";

import { useRef, useState, useTransition } from "react";
import {
  DEFAULT_NAV_CONFIG,
  PAGE_REGISTRY,
  type NavConfig,
  type NavItemRef,
} from "@/lib/nav-registry";
import { saveNavConfigAction, createNavPageAction } from "./actions";

interface BuilderPageRef { slug: string; title: string }

const clone = (c: NavConfig): NavConfig => structuredClone(c);
const itemLabel = (it: NavItemRef) => (it.kind === "builder" ? it.label : PAGE_REGISTRY[it.pageKey]?.defaultLabel ?? it.pageKey);
const itemKey = (it: NavItemRef) => (it.kind === "builder" ? `builder:${it.slug}` : it.pageKey);

/** WYSIWYG nav/hub builder: looks like the real hub (left rail of layers, right
 *  panel of that layer's pages). Drag to reorder layers and pages; add a layer;
 *  add a page (existing or brand-new). */
export function NavEditor({
  initial,
  builderPages,
  isAdmin,
}: {
  initial: NavConfig;
  builderPages: BuilderPageRef[];
  isAdmin: boolean;
}) {
  const [cfg, setCfg] = useState<NavConfig>(() => clone(initial));
  const [sel, setSel] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [newName, setNewName] = useState("");
  const dragLayer = useRef<number | null>(null);
  const dragCard = useRef<{ gi: number; ii: number } | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const groups = cfg.groups;
  const selected = groups[Math.min(sel, groups.length - 1)];
  const selIndex = Math.min(sel, groups.length - 1);

  const assignedPages = new Set<string>();
  const assignedSlugs = new Set<string>();
  for (const g of groups) for (const it of g.items) {
    if (it.kind === "page") assignedPages.add(it.pageKey);
    else assignedSlugs.add(it.slug);
  }
  const unassignedRegistry = Object.keys(PAGE_REGISTRY).filter((k) => !assignedPages.has(k));
  // Exclude builder pages that are just the seeded twin of a registry page
  // (slug === a registry key, e.g. "groups", "demographics") so they don't
  // show twice — the registry entry is the canonical one.
  const availableBuilder = builderPages.filter((p) => !assignedSlugs.has(p.slug) && !PAGE_REGISTRY[p.slug]);

  const mutate = (fn: (c: NavConfig) => void) => {
    const next = clone(cfg);
    fn(next);
    setCfg(next);
    setDirty(true);
    setMsg(null);
  };

  function save() {
    start(async () => {
      const res = await saveNavConfigAction(cfg);
      setMsg({ ok: res.ok, text: res.message });
      if (res.ok) setDirty(false);
    });
  }
  function addLayer() {
    mutate((c) => { c.groups.push({ id: `layer-${c.groups.length}-${Math.random().toString(36).slice(2, 7)}`, label: "New layer", mode: "top", items: [] }); });
    setSel(groups.length);
  }
  function addItem(it: NavItemRef) { mutate((c) => { c.groups[selIndex].items.push(it); }); }
  function createNew() {
    const name = newName.trim();
    if (!name) return;
    start(async () => {
      const res = await createNavPageAction(name);
      if ("error" in res) { setMsg({ ok: false, text: res.error }); return; }
      mutate((c) => { c.groups[selIndex].items.push({ kind: "builder", slug: res.slug, label: res.title }); });
      setNewName("");
      setPicking(false);
    });
  }

  // drag: reorder layers (rail rows) + reorder/move cards
  function dropOnLayer(toGi: number) {
    if (dragCard.current) {
      const from = dragCard.current;
      mutate((c) => { const [it] = c.groups[from.gi].items.splice(from.ii, 1); c.groups[toGi].items.push(it); });
      dragCard.current = null;
    } else if (dragLayer.current != null && dragLayer.current !== toGi) {
      const from = dragLayer.current;
      mutate((c) => { const [g] = c.groups.splice(from, 1); let idx = toGi; if (from < toGi) idx--; c.groups.splice(idx, 0, g); });
      setSel(toGi);
      dragLayer.current = null;
    }
    setOver(null);
  }
  function dropOnCard(gi: number, toIi: number) {
    if (!dragCard.current) return;
    const from = dragCard.current;
    mutate((c) => { const [it] = c.groups[from.gi].items.splice(from.ii, 1); let idx = toIi; if (from.gi === gi && from.ii < toIi) idx--; c.groups[gi].items.splice(Math.max(0, idx), 0, it); });
    dragCard.current = null;
    setOver(null);
  }

  if (!isAdmin) return <p className="text-sm text-muted">Only admins can edit the navigation.</p>;

  return (
    <div className="space-y-4" onDragEnd={() => { dragLayer.current = null; dragCard.current = null; setOver(null); }}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={pending || !dirty}
          className="text-sm px-3 py-1.5 rounded-lg border border-accent text-accent hover:bg-accent hover:text-bg disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-accent cursor-pointer transition-colors">
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => { setCfg(clone(DEFAULT_NAV_CONFIG)); setSel(0); setDirty(true); setMsg(null); }}
          disabled={pending} className="text-sm px-3 py-1.5 rounded-lg border border-border-soft text-muted hover:text-fg hover:border-accent cursor-pointer transition-colors">
          Reset to default
        </button>
        {dirty && !msg && <span className="text-xs text-subtle">Unsaved changes</span>}
        {msg && <span className={`text-xs ${msg.ok ? "text-good-soft-fg" : "text-warn-soft-fg"}`}>{msg.text}</span>}
        <span className="text-xs text-subtle ml-auto hidden md:block">This is your home hub — drag layers and pages to arrange.</span>
      </div>

      {/* Rail + panel — mirrors the hub */}
      <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-0 rounded-xl border border-border-soft overflow-hidden">
        {/* Rail = layers */}
        <div className="bg-bg-elev-2/40 border-b md:border-b-0 md:border-r border-border-soft p-2.5 space-y-1">
          {groups.map((g, gi) => (
            <div
              key={gi}
              draggable
              onDragStart={() => { dragLayer.current = gi; }}
              onDragOver={(e) => { if (dragLayer.current != null || dragCard.current) { e.preventDefault(); setOver(`layer:${gi}`); } }}
              onDrop={(e) => { e.preventDefault(); dropOnLayer(gi); }}
              onClick={() => setSel(gi)}
              className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
                over === `layer:${gi}` ? "ring-1 ring-accent" : ""
              } ${gi === selIndex ? "bg-bg-elev-2 text-fg" : "text-muted hover:text-fg hover:bg-bg-elev-2"}`}
            >
              <span className="cursor-grab active:cursor-grabbing text-subtle select-none" aria-hidden>⠿</span>
              <input
                value={g.label}
                onChange={(e) => mutate((c) => { c.groups[gi].label = e.target.value; })}
                onClick={(e) => e.stopPropagation()}
                aria-label="Layer name"
                className="flex-1 min-w-0 bg-transparent text-sm font-medium focus:outline-none focus:bg-bg rounded px-1 py-0.5"
              />
              <span className="text-[11px] text-subtle tnum">{g.items.length}</span>
              <button type="button" onClick={(e) => { e.stopPropagation(); mutate((c) => { c.groups.splice(gi, 1); }); if (selIndex >= gi) setSel(Math.max(0, selIndex - 1)); }}
                aria-label="Delete layer" className="opacity-0 group-hover:opacity-100 text-subtle hover:text-warn-soft-fg text-xs cursor-pointer">✕</button>
            </div>
          ))}
          <button type="button" onClick={addLayer}
            className="w-full text-left px-2 py-1.5 rounded-lg text-sm text-accent hover:bg-accent-soft-bg cursor-pointer">
            + Add a layer
          </button>
        </div>

        {/* Panel = selected layer's pages */}
        <div className="p-4 md:p-5 min-w-0">
          {!selected ? (
            <div className="text-sm text-muted">Add a layer to start.</div>
          ) : (
            <>
              <input
                value={selected.label}
                onChange={(e) => mutate((c) => { c.groups[selIndex].label = e.target.value; })}
                aria-label="Layer title"
                className="text-lg font-semibold tracking-tight bg-transparent focus:outline-none focus:bg-bg-elev-2 rounded px-1 -ml-1 mb-3 w-full"
              />
              {selected.items.length === 0 ? (
                <div
                  className={`rounded-lg border border-dashed px-5 py-8 text-center text-sm text-muted mb-3 ${over === `body:${selIndex}` ? "border-accent bg-accent-soft-bg" : "border-border-soft"}`}
                  onDragOver={(e) => { if (dragCard.current) { e.preventDefault(); setOver(`body:${selIndex}`); } }}
                  onDrop={(e) => { e.preventDefault(); dropOnCard(selIndex, 0); }}
                >
                  No pages here yet — add one below.
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
                  {selected.items.map((it, ii) => (
                    <div
                      key={itemKey(it)}
                      draggable
                      onDragStart={(e) => { e.stopPropagation(); dragCard.current = { gi: selIndex, ii }; }}
                      onDragOver={(e) => { if (dragCard.current) { e.preventDefault(); setOver(`card:${selIndex}:${ii}`); } }}
                      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dropOnCard(selIndex, ii); }}
                      className={`group relative rounded-xl border p-4 bg-bg-elev/40 cursor-grab active:cursor-grabbing transition-colors ${
                        over === `card:${selIndex}:${ii}` ? "border-accent" : "border-border-soft"
                      }`}
                    >
                      <button type="button" onClick={() => mutate((c) => { c.groups[selIndex].items.splice(ii, 1); })}
                        aria-label={`Remove ${itemLabel(it)}`} className="absolute top-3 right-3 text-subtle hover:text-warn-soft-fg text-sm cursor-pointer">✕</button>
                      <div className="flex items-center gap-2 pr-6">
                        <span aria-hidden className="text-subtle text-xs">⠿</span>
                        <span className="font-semibold text-sm truncate">{itemLabel(it)}</span>
                      </div>
                      <div className="text-[11px] text-subtle mt-1">
                        {it.kind === "builder" ? "Page Builder page" : "Page"}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Add a page */}
              {!picking ? (
                <button type="button" onClick={() => setPicking(true)}
                  className="text-sm px-3 py-1.5 rounded-lg border border-dashed border-border-soft text-accent hover:border-accent hover:bg-accent-soft-bg cursor-pointer">
                  + Add a page
                </button>
              ) : (
                <div className="rounded-xl border border-border-soft p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-medium uppercase tracking-wider text-subtle">Add a page to “{selected.label}”</div>
                    <button type="button" onClick={() => setPicking(false)} className="text-xs text-subtle hover:text-fg cursor-pointer">Done</button>
                  </div>
                  {/* Create new */}
                  <div className="flex items-center gap-2">
                    <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name a new page…"
                      onKeyDown={(e) => { if (e.key === "Enter") createNew(); }}
                      className="flex-1 bg-bg border border-border-soft rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent" />
                    <button type="button" onClick={createNew} disabled={pending || !newName.trim()}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-accent text-accent hover:bg-accent hover:text-bg disabled:opacity-40 cursor-pointer">
                      Create new
                    </button>
                  </div>
                  {/* Existing */}
                  {(unassignedRegistry.length > 0 || availableBuilder.length > 0) ? (
                    <div>
                      <div className="text-[11px] text-subtle mb-1.5">or add one you already have</div>
                      <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
                        {unassignedRegistry.map((k) => (
                          <button key={k} type="button" onClick={() => addItem({ kind: "page", pageKey: k })}
                            className="text-xs px-2 py-1 rounded-lg border border-border-soft hover:border-accent hover:text-accent cursor-pointer">
                            {PAGE_REGISTRY[k].defaultLabel}
                          </button>
                        ))}
                        {availableBuilder.map((p) => (
                          <button key={p.slug} type="button" onClick={() => addItem({ kind: "builder", slug: p.slug, label: p.title })}
                            className="text-xs px-2 py-1 rounded-lg border border-border-soft hover:border-accent hover:text-accent cursor-pointer">
                            {p.title} <span className="text-subtle">· builder</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-subtle">Every existing page is already placed. Create a new one above.</div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
