"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, Pill } from "@/components/ui";
import { NEXT_STEPS_CATALOG, CATEGORY_LABELS } from "@/lib/next-steps-catalog";
import type { PlanListRow } from "@/lib/announcement-impact";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function PlanFilter({ plans }: { plans: PlanListRow[] }) {
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return plans.filter((p) => {
      if (tag && !p.steps.some((t: { key: string }) => t.key === tag)) return false;
      if (!needle) return true;
      return (
        (p.title ?? "").toLowerCase().includes(needle) ||
        (p.serviceTypeName ?? "").toLowerCase().includes(needle) ||
        (p.sortDate ?? "").includes(needle)
      );
    });
  }, [plans, q, tag]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search date, service, title…"
          aria-label="Search service plans"
          className="flex-1 min-w-[220px] rounded-lg border border-border-soft bg-bg-elev-2/40 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent-soft-fg/40"
        />
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setTag(null)}
            aria-pressed={tag === null}
            className={`text-xs rounded-full px-2.5 py-1 border transition-colors cursor-pointer ${
              tag === null
                ? "border-accent-soft-fg/60 bg-accent-soft-bg text-accent-soft-fg font-medium"
                : "border-border-soft text-muted hover:text-fg"
            }`}
          >
            All
          </button>
          {NEXT_STEPS_CATALOG.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTag(tag === t.key ? null : t.key)}
              aria-pressed={tag === t.key}
              title={`${CATEGORY_LABELS[t.category]} — ${t.what}`}
              className={`text-xs rounded-full px-2.5 py-1 border transition-colors cursor-pointer ${
                tag === t.key
                  ? "border-accent-soft-fg/60 bg-accent-soft-bg text-accent-soft-fg font-medium"
                  : "border-border-soft text-muted hover:text-fg"
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted">
        {filtered.length} of {plans.length} services
        {tag ? ` announcing “${NEXT_STEPS_CATALOG.find((t) => t.key === tag)?.name}”` : ""}
      </p>

      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[680px]">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-border-soft">
              <th className="font-medium px-4 py-2.5">Date</th>
              <th className="font-medium px-4 py-2.5">Service</th>
              <th className="font-medium px-4 py-2.5 text-right">Items</th>
              <th className="font-medium px-4 py-2.5">Announced</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.planId} className="border-b border-border-soft/60 last:border-0 align-top">
                <td className="px-4 py-2.5 whitespace-nowrap text-xs">
                  <Link
                    href={`/service-plans/${p.planId}`}
                    className="text-accent-soft-fg hover:underline font-medium"
                  >
                    {fmtDate(p.sortDate)}
                  </Link>
                </td>
                <td className="px-4 py-2.5">
                  <div className="text-xs">{p.serviceTypeName ?? "—"}</div>
                  {p.title && <div className="text-xs text-muted">{p.title}</div>}
                </td>
                <td className="px-4 py-2.5 text-right text-xs text-muted tabular-nums">{p.itemCount}</td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {p.steps.length === 0 ? (
                      <span className="text-xs text-muted">—</span>
                    ) : (
                      p.steps.map((t: { key: string; name: string }) => (
                        <Pill key={t.key} tone="accent">
                          {t.name}
                        </Pill>
                      ))
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted">
                  No services match that filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
