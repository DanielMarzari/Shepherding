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

/** Per-room attendance trends — monthly averages, each venue/room its own
 *  toggleable line. Built from the weekly rows already loaded for the page. */
export function RoomTrendsChart({ rows }: { rows: WeeklyAttendanceRow[] }) {
  // Monthly average per room (ignoring blank weeks).
  const { months, series, available } = useMemo(() => {
    const agg = new Map<string, Record<RoomKey, { sum: number; n: number }>>();
    for (const r of rows) {
      const ym = r.week_date.slice(0, 7);
      let e = agg.get(ym);
      if (!e) { e = {} as Record<RoomKey, { sum: number; n: number }>; agg.set(ym, e); }
      for (const room of ROOMS) {
        const v = r[room.key];
        if (v != null) {
          const c = e[room.key] ?? { sum: 0, n: 0 };
          c.sum += v; c.n += 1; e[room.key] = c;
        }
      }
    }
    const months = [...agg.keys()].sort();
    const series: Record<RoomKey, Array<number | null>> = {} as Record<RoomKey, Array<number | null>>;
    for (const room of ROOMS) {
      series[room.key] = months.map((m) => {
        const c = agg.get(m)?.[room.key];
        return c && c.n > 0 ? Math.round(c.sum / c.n) : null;
      });
    }
    const available = ROOMS.filter((room) => series[room.key].some((v) => v != null));
    return { months, series, available };
  }, [rows]);

  const [hidden, setHidden] = useState<Set<RoomKey>>(new Set());
  const [hover, setHover] = useState<number | null>(null);

  if (available.length === 0 || months.length < 2) {
    return <p className="text-xs text-subtle">No per-room data in the imported attendance yet.</p>;
  }

  const shown = available.filter((r) => !hidden.has(r.key));
  const width = 1000, height = 280, padL = 44, padR = 14, padT = 14, padB = 30;
  const innerW = width - padL - padR, innerH = height - padT - padB;
  const n = months.length;
  const stepX = n > 1 ? innerW / (n - 1) : innerW;
  const xFor = (i: number) => padL + i * stepX;
  let max = 0;
  for (const r of shown) for (const v of series[r.key]) if (v != null && v > max) max = v;
  max = Math.max(1, max);
  const yFor = (v: number) => padT + innerH - (v / max) * innerH;
  const yTicks = niceTicks(max);
  const yearTicks = months.map((m, i) => ({ i, m })).filter((x) => x.m.endsWith("-01"));

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
          <text key={t.i} x={xFor(t.i)} y={height - padB + 14} textAnchor="middle" fontSize={10} fill="#7c879c">{t.m.slice(0, 4)}</text>
        ))}
        {hover != null && <line x1={xFor(hover)} x2={xFor(hover)} y1={padT} y2={padT + innerH} stroke="rgba(168,178,198,0.5)" strokeWidth={1} pointerEvents="none" />}
        {shown.map((r) => <path key={r.key} d={path(r.key)} fill="none" stroke={r.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
      </svg>
      <div className="min-h-[34px] mt-1 text-xs">
        {hover != null ? (
          <span>
            <span className="font-medium">{months[hover]}</span>
            <span className="text-muted ml-3">
              {shown.map((r) => { const v = series[r.key][hover]; return v != null ? `${r.label}: ${v.toLocaleString()}` : null; }).filter(Boolean).join(" · ")}
            </span>
          </span>
        ) : (
          <span className="text-subtle">Monthly average attendance per room. Click a room to hide it.</span>
        )}
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
