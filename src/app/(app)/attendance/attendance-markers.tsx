"use client";

import type { AttendanceMarker, ExceptionKind } from "@/lib/attendance-exclusion";

const STYLE: Record<ExceptionKind, { stroke: string; glyph: string; fill: string; label: string; dash?: string }> = {
  cancel: { stroke: "rgba(245,158,11,0.55)", glyph: "✕", fill: "#f59e0b", label: "Cancelled", dash: "3 2" },
  holiday: { stroke: "rgba(217,70,239,0.50)", glyph: "★", fill: "#d946ef", label: "Holiday" },
  note: { stroke: "rgba(148,163,184,0.35)", glyph: "•", fill: "#94a3b8", label: "Note", dash: "2 2" },
};

export function buildMarkerMap(markers: AttendanceMarker[] | undefined): Map<string, AttendanceMarker> {
  const m = new Map<string, AttendanceMarker>();
  for (const x of markers ?? []) m.set(x.week_date, x); // last wins per week
  return m;
}

/** Vertical marker lines + glyphs for cancellation / holiday / note weeks.
 *  Renders as SVG <g> children, so drop it inside the chart's <svg>. */
export function MarkerLayer({
  weeks, markers, xFor, padT, innerH,
}: {
  weeks: string[];
  markers: AttendanceMarker[] | undefined;
  xFor: (i: number) => number;
  padT: number;
  innerH: number;
}) {
  const byWeek = buildMarkerMap(markers);
  return (
    <>
      {weeks.map((w, i) => {
        const mk = byWeek.get(w);
        if (!mk) return null;
        const s = STYLE[mk.kind];
        return (
          <g key={`mk${i}`} pointerEvents="none">
            <line x1={xFor(i)} x2={xFor(i)} y1={padT} y2={padT + innerH} stroke={s.stroke} strokeWidth={0.85} strokeDasharray={s.dash} />
            <text x={xFor(i)} y={padT + 9} textAnchor="middle" fontSize={9} fill={s.fill}>{s.glyph}</text>
          </g>
        );
      })}
    </>
  );
}

/** Small inline legend, only for the marker kinds actually present. */
export function MarkerLegend({ markers }: { markers: AttendanceMarker[] | undefined }) {
  const kinds = new Set((markers ?? []).map((m) => m.kind));
  if (kinds.size === 0) return null;
  const order: ExceptionKind[] = ["cancel", "holiday", "note"];
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-subtle">
      {order.filter((k) => kinds.has(k)).map((k) => (
        <span key={k} className="inline-flex items-center gap-1">
          <span style={{ color: STYLE[k].fill }}>{STYLE[k].glyph}</span>
          {STYLE[k].label}
        </span>
      ))}
    </span>
  );
}

/** Hover text for a week with a marker, e.g. "✕ Snow Closure". */
export function markerHoverText(byWeek: Map<string, AttendanceMarker>, week: string): string | null {
  const mk = byWeek.get(week);
  if (!mk) return null;
  return `${STYLE[mk.kind].glyph} ${mk.reason}`;
}
