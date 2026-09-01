"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PAGE_REGISTRY, type NavGroup, type NavItemRef } from "@/lib/nav-registry";

/** Drill-in groups that also have a gallery landing page (the "Both" behavior:
 *  clicking the entry drills the sidebar AND opens the landing). */
const DRILL_LANDING: Record<string, string> = {
  "settings-integration": "/settings",
};

interface ResolvedItem {
  key: string;
  href: string;
  label: string;
  badge?: number;
}

function resolveItem(it: NavItemRef): ResolvedItem | null {
  if (it.kind === "builder") {
    return { key: `builder:${it.slug}`, href: `/builder/${it.slug}`, label: it.label };
  }
  const def = PAGE_REGISTRY[it.pageKey];
  if (!def) return null;
  return { key: it.pageKey, href: def.href, label: def.defaultLabel, badge: def.badge };
}

const ROW = "px-2 py-1.5 rounded flex items-center justify-between transition-colors";
const rowCls = (active: boolean) =>
  `${ROW} ${active ? "bg-bg-elev-2 text-fg font-medium" : "text-fg hover:bg-bg-elev-2"}`;

export function SidebarNav({
  groups,
  activeKey,
}: {
  groups: NavGroup[];
  activeKey: string | null;
}) {
  // If the active page lives inside a drill-in group, open that group so the
  // active row is visible on load.
  const initialDrill = useMemo(() => {
    if (!activeKey) return null;
    const g = groups.find(
      (grp) => grp.mode === "drill" && grp.items.some((it) => resolveItem(it)?.key === activeKey),
    );
    return g?.id ?? null;
  }, [groups, activeKey]);

  const [drillId, setDrillId] = useState<string | null>(initialDrill);

  const drillGroup = drillId ? groups.find((g) => g.id === drillId && g.mode === "drill") : null;

  if (drillGroup) {
    const landing = DRILL_LANDING[drillGroup.id];
    return (
      <nav className="space-y-0.5" aria-label={drillGroup.label}>
        <button
          type="button"
          onClick={() => setDrillId(null)}
          className="w-full text-left px-2 py-1.5 rounded flex items-center gap-1.5 text-muted hover:text-fg hover:bg-bg-elev-2 transition-colors cursor-pointer"
        >
          <span aria-hidden>←</span> All sections
        </button>
        <div className="text-xs text-muted uppercase tracking-wider mt-4 mb-2 px-2">
          {drillGroup.label}
        </div>
        <ul className="space-y-0.5">
          {landing && (
            <li>
              <Link href={landing} className={rowCls(false)}>
                <span className="flex items-center gap-2">
                  <span aria-hidden className="text-subtle">▦</span> Overview
                </span>
              </Link>
            </li>
          )}
          {drillGroup.items.map((it) => {
            const r = resolveItem(it);
            if (!r) return null;
            return (
              <li key={r.key}>
                <Link href={r.href} className={rowCls(r.key === activeKey)}>
                  <span>{r.label}</span>
                  {r.badge ? <span className="text-xs text-accent tnum">{r.badge}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  return (
    <nav aria-label="Primary">
      {groups.map((g, i) => {
        if (g.mode === "drill") {
          return <DrillEntry key={g.id} group={g} onDrill={() => setDrillId(g.id)} first={i === 0} />;
        }
        return <TopGroup key={g.id} group={g} activeKey={activeKey} first={i === 0} />;
      })}
    </nav>
  );
}

function TopGroup({ group, activeKey, first }: { group: NavGroup; activeKey: string | null; first: boolean }) {
  const items = group.items.map(resolveItem).filter((x): x is ResolvedItem => x !== null);
  const hasActive = items.some((r) => r.key === activeKey);
  // Collapsible groups start collapsed unless they contain the active page.
  const [open, setOpen] = useState(!group.collapsible || hasActive);

  return (
    <div className={first ? "" : "mt-7"}>
      {group.collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center justify-between px-2 mb-2 text-xs text-muted uppercase tracking-wider hover:text-fg transition-colors cursor-pointer"
        >
          <span>{group.label}</span>
          <span aria-hidden className={`transition-transform ${open ? "rotate-90" : ""}`}>›</span>
        </button>
      ) : (
        <div className="text-xs text-muted uppercase tracking-wider mb-2 px-2">{group.label}</div>
      )}
      {open && (
        <ul className="space-y-0.5">
          {items.map((r) => (
            <li key={r.key}>
              <Link href={r.href} className={rowCls(r.key === activeKey)}>
                <span>{r.label}</span>
                {r.badge ? <span className="text-xs text-accent tnum">{r.badge}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DrillEntry({ group, onDrill, first }: { group: NavGroup; onDrill: () => void; first: boolean }) {
  const landing = DRILL_LANDING[group.id];
  const inner = (
    <>
      <span>{group.label}</span>
      <span aria-hidden className="text-subtle">›</span>
    </>
  );
  return (
    <div className={first ? "" : "mt-7"}>
      {landing ? (
        // "Both": navigate to the gallery landing AND drill the sidebar in.
        <Link href={landing} onClick={onDrill} className={`${ROW} text-fg hover:bg-bg-elev-2`}>
          {inner}
        </Link>
      ) : (
        <button type="button" onClick={onDrill} className={`${ROW} w-full text-left text-fg hover:bg-bg-elev-2 cursor-pointer`}>
          {inner}
        </button>
      )}
    </div>
  );
}
