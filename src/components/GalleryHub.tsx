"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { togglePinAction } from "@/app/actions/pins";

export interface GalleryLink {
  href: string;
  title: string;
  description: string;
  external?: boolean;
  /** Section label, filled in for search results so a card shows where it lives. */
  section?: string;
}
export interface GallerySection {
  id: string;
  label: string;
  blurb?: string;
  links: GalleryLink[];
}

const PINNED_ID = "__pinned";

export function GalleryHub({
  sections,
  pinned,
  emptyHint,
}: {
  sections: GallerySection[];
  pinned: string[];
  emptyHint?: string;
}) {
  const pathname = usePathname();
  const [pins, setPins] = useState<Set<string>>(new Set(pinned));
  const [query, setQuery] = useState("");
  const [, start] = useTransition();

  const allLinks = useMemo(
    () => sections.flatMap((s) => s.links.map((l) => ({ ...l, section: s.label }))),
    [sections],
  );
  const pinnedLinks = useMemo(
    () => allLinks.filter((l) => pins.has(l.href)),
    [allLinks, pins],
  );

  const railEntries = useMemo(() => {
    const base = pinnedLinks.length
      ? [{ id: PINNED_ID, label: "Pinned", count: pinnedLinks.length }]
      : [];
    return base.concat(sections.map((s) => ({ id: s.id, label: s.label, count: s.links.length })));
  }, [sections, pinnedLinks.length]);

  const [selected, setSelected] = useState<string>(() => railEntries[0]?.id ?? "");

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const visible: GalleryLink[] = searching
    ? allLinks.filter(
        (l) =>
          l.title.toLowerCase().includes(q) ||
          l.description.toLowerCase().includes(q) ||
          (l.section ?? "").toLowerCase().includes(q),
      )
    : selected === PINNED_ID
      ? pinnedLinks
      : (sections.find((s) => s.id === selected) ?? sections[0])?.links ?? [];

  const activeSection = sections.find((s) => s.id === selected);

  function togglePin(href: string) {
    setPins((prev) => {
      const next = new Set(prev);
      if (next.has(href)) next.delete(href);
      else next.add(href);
      return next;
    });
    start(() => {
      void togglePinAction(href, pathname);
    });
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-0 rounded-xl border border-border-soft overflow-hidden">
      {/* Rail */}
      <div className="bg-bg-elev-2/40 border-b md:border-b-0 md:border-r border-border-soft p-2.5 md:p-3">
        <div className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible">
          {railEntries.map((e) => {
            const on = !searching && e.id === selected;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => {
                  setQuery("");
                  setSelected(e.id);
                }}
                className={`shrink-0 md:w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
                  on ? "bg-bg-elev-2 text-fg font-medium" : "text-muted hover:text-fg hover:bg-bg-elev-2"
                }`}
              >
                {e.id === PINNED_ID && <span aria-hidden className="text-accent">★</span>}
                <span className="truncate">{e.label}</span>
                <span className="ml-auto text-[11px] text-subtle tnum">{e.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Detail */}
      <div className="p-4 md:p-5 min-w-0">
        {/* Search */}
        <div className="relative mb-4">
          <svg
            width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden
          >
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages…"
            aria-label="Search pages"
            className="w-full bg-bg border border-border-soft rounded-lg pl-9 pr-3 py-2 text-sm placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent"
          />
        </div>

        {!searching && activeSection && selected !== PINNED_ID && (
          <div className="mb-3">
            <h2 className="text-lg font-semibold tracking-tight">{activeSection.label}</h2>
            {activeSection.blurb && <p className="text-xs text-muted mt-0.5">{activeSection.blurb}</p>}
          </div>
        )}
        {!searching && selected === PINNED_ID && (
          <div className="mb-3">
            <h2 className="text-lg font-semibold tracking-tight">Pinned</h2>
            <p className="text-xs text-muted mt-0.5">The tools you reach for — star any card to add it here.</p>
          </div>
        )}
        {searching && (
          <div className="mb-3 text-xs text-muted">
            {visible.length} result{visible.length === 1 ? "" : "s"} for “{query.trim()}”
          </div>
        )}

        {visible.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border-soft px-5 py-10 text-center text-sm text-muted">
            {searching
              ? `No pages match “${query.trim()}”.`
              : selected === PINNED_ID
                ? "Nothing pinned yet. Star a card to keep it one click away."
                : emptyHint ?? "Nothing here yet."}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {visible.map((l) => (
              <div key={l.href} className="group relative rounded-xl border border-border-soft p-4 hover:border-accent transition-colors">
                <button
                  type="button"
                  onClick={() => togglePin(l.href)}
                  aria-label={pins.has(l.href) ? `Unpin ${l.title}` : `Pin ${l.title}`}
                  aria-pressed={pins.has(l.href)}
                  className={`absolute top-3 right-3 text-sm cursor-pointer ${
                    pins.has(l.href) ? "text-accent" : "text-subtle hover:text-accent"
                  }`}
                >
                  {pins.has(l.href) ? "★" : "☆"}
                </button>
                {l.external ? (
                  <a href={l.href} target="_blank" rel="noopener noreferrer" className="font-semibold pr-6 block hover:text-accent">
                    {l.title} ↗
                  </a>
                ) : (
                  <Link href={l.href} className="font-semibold pr-6 block hover:text-accent">
                    {l.title} →
                  </Link>
                )}
                <p className="text-xs text-muted leading-relaxed mt-1.5">{l.description}</p>
                {searching && l.section && (
                  <span className="mt-2 inline-block text-[10px] uppercase tracking-wide text-subtle">{l.section}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
