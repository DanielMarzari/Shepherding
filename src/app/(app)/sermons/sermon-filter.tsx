"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, Pill } from "@/components/ui";
import { NEXT_STEPS_CATALOG } from "@/lib/next-steps-catalog";
import type { SermonListRow } from "@/lib/sermon-impact";

const STEPS = NEXT_STEPS_CATALOG.filter((s) => s.sermonKey || (s.sermonPatterns && s.sermonPatterns.length));

function fmtDate(iso: string): string {
  return new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function SermonFilter({ sermons }: { sermons: SermonListRow[] }) {
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return sermons.filter((s) => {
      if (tag && !s.calls.some((c) => c.key === tag)) return false;
      if (!needle) return true;
      return (
        (s.title ?? "").toLowerCase().includes(needle) ||
        (s.topic ?? "").toLowerCase().includes(needle) ||
        (s.speaker ?? "").toLowerCase().includes(needle) ||
        s.preachedOn.includes(needle)
      );
    });
  }, [sermons, q, tag]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title, topic, speaker, date…"
          aria-label="Search sermons"
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
          {STEPS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setTag(tag === s.key ? null : s.key)}
              aria-pressed={tag === s.key}
              title={s.what}
              className={`text-xs rounded-full px-2.5 py-1 border transition-colors cursor-pointer ${
                tag === s.key
                  ? "border-accent-soft-fg/60 bg-accent-soft-bg text-accent-soft-fg font-medium"
                  : "border-border-soft text-muted hover:text-fg"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted">
        {filtered.length} of {sermons.length} sermons
        {tag ? ` calling “${STEPS.find((s) => s.key === tag)?.name}”` : ""}
      </p>

      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[680px]">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-border-soft">
              <th className="font-medium px-4 py-2.5">Date</th>
              <th className="font-medium px-4 py-2.5">Sermon</th>
              <th className="font-medium px-4 py-2.5">Speaker</th>
              <th className="font-medium px-4 py-2.5">Next steps called</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.sourceId} className="border-b border-border-soft/60 last:border-0 align-top">
                <td className="px-4 py-2.5 whitespace-nowrap text-xs text-muted">{fmtDate(s.preachedOn)}</td>
                <td className="px-4 py-2.5">
                  <Link
                    href={`/sermons/${s.sourceId}`}
                    className="font-medium leading-tight text-accent-soft-fg hover:underline"
                  >
                    {s.title ?? "Untitled"}
                  </Link>
                  {s.topic && <div className="text-xs text-muted">{s.topic}</div>}
                </td>
                <td className="px-4 py-2.5 text-xs text-muted whitespace-nowrap">{s.speaker ?? "—"}</td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {s.calls.length === 0 ? (
                      <span className="text-xs text-muted">—</span>
                    ) : (
                      s.calls.map((c) => (
                        <Pill key={c.key} tone={c.intensity >= 2 ? "accent" : "muted"}>
                          {c.name}
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
                  No sermons match that filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
