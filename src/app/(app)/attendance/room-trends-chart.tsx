"use client";

import { useMemo, useState } from "react";
import type { WeeklyAttendanceRow } from "@/lib/attendance-read";

type RoomKey = "center_total" | "chapel_total" | "adult_total" | "kids_total" | "student_total" | "online_live" | "abfs";
const ROOMS: Array<{ key: RoomKey; label: string; color: string }> = [
  { key: "center_total", label: "Center", color: "#2563eb" },
  { key: "chapel_total", label: "Chapel", color: "#7c3aed" },
  { key: "adult_total", label: "Adult worship", color: "#0d9488" },
  { key: "kids_total", label: "Kids", color: "#eab308" },
  { key: "student_total", label: "Students", color: "#f97316" },
  { key: "online_live", label: "Online", color: "#db2777" },
  { key: "abfs", label: "ABFs", color: "#65a30d" },
];

const DAY = 86_400_000;

/** Per-room attendance, week by week — each venue/room its own toggleable
 *  line — plus a trend chip per room (last-12-months average vs the prior 12).
 *  Built from the weekly rows already loaded for the page. */
export function RoomTrendsChart({ rows }: { rows: WeeklyAttendanceRow[] }) {
  const { weeks, series, available, trends } = useMemo(() => {
    const sorted = [...rows].sort((a, b) => a.week_date.localeCompare(b.week_date));
    const weeks = sorted.map((r) => r.week_date);
    const series: Record<RoomKey, Array<number | null>> = {} as Record<RoomKey, Array<number | null>>;
    for (const room of ROOMS) series[room.key] = sorted.map((r) => r[room.key]);
    const available = ROOMS.filter((room) => series[room.key].some((v) => v != null));

    // Trend: last-12-months average vs the prior 12 months, anchored to the
    // latest week (so stale test data still gives a meaningful comparison).
    const latestMs = weeks.length ? new Date(weeks[weeks.length - 1]).valueOf() : 0;
    const recentCut = latestMs - 365 * DAY;
    const priorCut = latestMs - 730 * DAY;
    const trends = new Map<RoomKey, { recent: number | null; deltaPct: number | null }>();
    for (const room of ROOMS) {
      const rec: number[] = [], pri: number[] = [];
      sorted.forEach((r) => {
        const v = r[room.key];
        if (v == null) return;
        const t = new Date(r.week_date).valueOf();
        if (t > recentCut) rec.push(v);
        else if (t > priorCut) pri.push(v);
      });
      const recent = rec.length ? Math.round(rec.reduce((a, b) => a + b, 0) / rec.length) : null;
      const priorAvg = pri.length ? pri.reduce((a, b) => a + b, 0) / pri.length : null;
      const deltaPct = recent != null && priorAvg != null && priorAvg > 0
        ? Math.round(((recent - priorAvg) / priorAvg) * 100) : null;
      trends.set(room.key, { recent, deltaPct });
    }
    return { weeks, series, available, trends };
  }, [rows]);

  const [hidden, setHidden] = useState<Set<RoomKey>>(new Set());
  const [hover, setHover] = useState<number | null>(null);

  if (available.length === 0 || weeks.length < 2) {
    return <p className="text-xs text-subtle">No per-room data in the imported attendance yet.</p>;
  }

  const shown = available.filter((r) => !hidden.has(r.key));
  const width = 1000, height = 280, padL = 44, padR = 14, padT = 14, padB = 30;
  const innerW = width - padL - padR, innerH = height - padT - padB;
  const n = weeks.length;
  const stepX = n > 1 ? innerW / (n - 1) : innerW;
  const xFor = (i: number) => padL + i * stepX;
  let max = 0;
  for (const r of shown) for (const v of series[r.key]) if (v != null && v > max) max = v;
  max = Math.max(1, max);
  const yFor = (v: number) => padT + innerH - (v / max) * innerH;
  const yTicks = niceTicks(max);
  // First week of each calendar year, for x labels.
  const yearTicks = weeks
    .map((w, i) => ({ i, y: w.slice(0, 4) }))
    .filter((x, i, arr) => i === 0 ? false : x.y !== arr[i - 1].y);

  const path = (key: RoomKey) => {
    let d = "", started = false;
    series[key].forEach((v, i) => {
      if (v == null) { started = false; return; }
      d += `${started ? "L" : "M"} ${xFor(i).toFixed(1)} ${yFor(v).toFixed(1)} `;
      started = true;
    });
    return d;
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-3 text-[11px]">
        {available.map((r) => {
          const on = !hidden.has(r.key);
          return (
            <button key={r.key} type="button"
              onClick={() => setHidden((s) => { const n = new Set(s); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n; })}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full border border-border-soft cursor-pointer transition-opacity"
              style={{ opacity: on ? 1 : 0.4 }}>
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: r.color }} />
              <span className={on ? "text-fg" : "text-subtle line-through"}>{r.label}</span>
            </button>
          );
        })}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`}
        onMouseMove={(e) => { const rect = e.currentTarget.getBoundingClientRect(); const vx = ((e.clientX - rect.left) / rect.width) * width; setHover(Math.max(0, Math.min(n - 1, Math.round((vx - padL) / stepX)))); }}
        onMouseLeave={() => setHover(null)}
        style={{ width: "100%", height: "auto", display: "block", cursor: "crosshair" }}>
        {yTicks.map((t) => { const y = yFor(t); return (
          <g key={t}>
            <line x1={padL} x2={width - padR} y1={y} y2={y} stroke="rgba(140,150,170,0.18)" strokeWidth={0.5} strokeDasharray="2 3" />
            <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={10} fill="#7c879c">{t.toLocaleString()}</text>
          </g>
        ); })}
        {yearTicks.map((t) => (
          <g key={t.i}>
            <line x1={xFor(t.i)} x2={xFor(t.i)} y1={padT} y2={padT + innerH} stroke="rgba(140,150,170,0.12)" strokeWidth={0.5} />
            <text x={xFor(t.i)} y={height - padB + 14} textAnchor="middle" fontSize={10} fill="#7c879c">{t.y}</text>
          </g>
        ))}
        {hover != null && <line x1={xFor(hover)} x2={xFor(hover)} y1={padT} y2={padT + innerH} stroke="rgba(168,178,198,0.5)" strokeWidth={1} pointerEvents="none" />}
        {shown.map((r) => <path key={r.key} d={path(r.key)} fill="none" stroke={r.color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />)}
      </svg>
      <div className="min-h-[20px] mt-1 text-xs">
        {hover != null ? (
          <span>
            <span className="font-medium">Week of {weeks[hover]}</span>
            <span className="text-muted ml-3">
              {shown.map((r) => { const v = series[r.key][hover]; return v != null ? `${r.label}: ${v.toLocaleString()}` : null; }).filter(Boolean).join(" · ")}
            </span>
          </span>
        ) : (
          <span className="text-subtle">Weekly attendance per room. Click a room to hide it.</span>
        )}
      </div>

      {/* Trend chips: last-12-mo average vs the prior 12 months, per room. */}
      <div className="mt-3 pt-3 border-t border-border-soft">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted mb-2">Trend — last 12 mo vs prior 12 mo</div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {available.map((r) => {
            const t = trends.get(r.key);
            if (!t || t.recent == null) return null;
            const up = t.deltaPct != null && t.deltaPct > 0;
            const down = t.deltaPct != null && t.deltaPct < 0;
            return (
              <div key={r.key} className="rounded-lg border border-border-soft bg-bg-elev-2/40 p-2.5">
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: r.color }} />
                  <span className="text-xs font-medium">{r.label}</span>
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="tnum text-base font-semibold">{t.recent.toLocaleString()}</span>
                  {t.deltaPct != null && (
                    <span className={`text-xs tnum ${up ? "text-good-soft-fg" : down ? "text-warn-soft-fg" : "text-muted"}`}>
                      {up ? "▲" : down ? "▼" : "→"} {Math.abs(t.deltaPct)}%
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-subtle mt-0.5">avg/week</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function niceTicks(max: number): number[] {
  const step = Math.max(1, Math.ceil(max / 4 / 50) * 50);
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.5; v += step) out.push(v);
  return out;
}
