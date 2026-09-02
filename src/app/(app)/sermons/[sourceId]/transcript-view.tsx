"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui";

export interface TranscriptCall {
  key: string;
  label: string;
  quote: string;
  range: { start: number; end: number } | null;
}

/** Distinct highlight colors. Deliberately NOT red/green (Dan is red-green
 *  colorblind) and every highlight also carries a bold underline + an inline
 *  label chip, so the tag is never conveyed by hue alone. */
const HILITE = [
  "bg-accent-soft-bg text-accent-soft-fg decoration-accent-soft-fg",
  "bg-warn-soft-bg text-warn-soft-fg decoration-warn-soft-fg",
  "bg-good-soft-bg text-good-soft-fg decoration-good-soft-fg",
  "bg-bg-elev-2 text-fg decoration-fg",
];

interface Segment {
  text: string;
  call: TranscriptCall | null;
  colorIdx: number;
}

export function TranscriptView({
  transcript,
  calls,
}: {
  transcript: string;
  calls: TranscriptCall[];
}) {
  const [only, setOnly] = useState<string | null>(null);

  const located = useMemo(
    () =>
      calls
        .filter((c) => c.range)
        .sort((a, b) => a.range!.start - b.range!.start),
    [calls],
  );

  const segments = useMemo<Segment[]>(() => {
    if (located.length === 0) return [{ text: transcript, call: null, colorIdx: 0 }];
    const out: Segment[] = [];
    let cursor = 0;
    located.forEach((c) => {
      const { start, end } = c.range!;
      if (start < cursor) return; // overlapping quote — skip the later one
      if (start > cursor) out.push({ text: transcript.slice(cursor, start), call: null, colorIdx: 0 });
      const idx = calls.findIndex((x) => x.key === c.key);
      out.push({ text: transcript.slice(start, end), call: c, colorIdx: idx % HILITE.length });
      cursor = end;
    });
    if (cursor < transcript.length) out.push({ text: transcript.slice(cursor), call: null, colorIdx: 0 });
    return out;
  }, [transcript, located, calls]);

  return (
    <div className="space-y-3">
      {located.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Highlighted:</span>
          {located.map((c) => {
            const idx = calls.findIndex((x) => x.key === c.key) % HILITE.length;
            const active = only === null || only === c.key;
            return (
              <a
                key={c.key}
                href={`#call-${c.key}`}
                onClick={() => setOnly(only === c.key ? null : c.key)}
                className={`text-xs rounded-full px-2.5 py-1 border cursor-pointer transition-opacity ${
                  HILITE[idx]
                } ${active ? "opacity-100" : "opacity-40"} border-border-soft`}
              >
                {c.label}
              </a>
            );
          })}
          {only && (
            <button
              type="button"
              onClick={() => setOnly(null)}
              className="text-xs text-muted hover:text-fg underline cursor-pointer"
            >
              show all
            </button>
          )}
        </div>
      )}

      <Card className="p-5">
        <p className="text-[0.95rem] leading-[1.85] whitespace-pre-wrap">
          {segments.map((seg, i) =>
            seg.call && (only === null || only === seg.call.key) ? (
              <mark
                key={i}
                id={`call-${seg.call.key}`}
                className={`${HILITE[seg.colorIdx]} rounded px-1 py-0.5 underline decoration-2 underline-offset-2 font-medium scroll-mt-24`}
                title={`${seg.call.label} — this is where the call was made`}
              >
                {seg.text}
                <span className="ml-1 text-[0.65rem] uppercase tracking-wide font-semibold opacity-80 not-italic">
                  ({seg.call.label})
                </span>
              </mark>
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )}
        </p>
      </Card>
    </div>
  );
}
