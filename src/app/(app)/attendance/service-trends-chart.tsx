"use client";

import { useMemo, useState } from "react";
import type { ServiceAttendanceRow } from "@/lib/attendance-read";

const ROOMS: Array<{ key: string; label: string }> = [
  { key: "center", label: "Center" },
  { key: "chapel", label: "Chapel" },
  { key: "kids", label: "Kids" },
  { key: "student", label: "Students" },
];
// Distinct colors per service-time slot (assigned by sorted order).
const PALETTE = ["#2563eb", "#0d9488", "#f97316", "#7c3aed", "#db2777", "#65a30d"];

const toMinutes = (svc: string) => {
  const [h, m] = svc.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Per-service-time attendance for one room, monthly averages, each service
 *  time its own toggleable line. Service times drift over the years, so we
 *  plot whatever times appear (each as a separate line, null where absent). */
export function ServiceTrendsChart({ rows }: { rows: ServiceAttendanceRow[] }) {
  const roomsPresent = useMemo(
    () => ROOMS.filter((r) => rows.some((x) => x.room === r.key && x.count != null)),
    [rows],
  );
  const [room, setRoom] = useState<string>(roomsPresent[0]?.key ?? "center");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);

  const { months, services, series } = useMemo(() => {
    const roomRows = rows.filter((r) => r.room === room && r.count != null);
    const agg = new Map<string, Map<string, { sum: number; n: number }>>(); // ym -> svc -> {}
    const svcSet = new Set<string>();
    for (const r of roomRows) {
      const ym = r.week_date.slice(0, 7);
      svcSet.add(r.service);
      let e = agg.get(ym);
      if (!e) { e = new Map(); agg.set(ym, e); }
      const c = e.get(r.service) ?? { sum: 0, n: 0 };
      c.sum += r.count as number; c.n += 1; e.set(r.service, c);
    }
    const months = [...agg.keys()].sort();
    const services = [...svcSet].sort((a, b) => toMinutes(a) - toMinutes(b));
    const series: Record<string, Array<number | null>> = {};
    for (const s of services) {
      series[s] = months.map((m) => {
        const c = agg.get(m)?.get(s);
        return c && c.n > 0 ? Math.round(c.sum / c.n) : null;
      });
    }
    return { months, services, series };
  }, [rows, room]);

  if (roomsPresent.length === 0) {
    return (
      <p className="text-xs text-subtle">
        No per-service data imported yet — re-import the attendance spreadsheets to capture it.
      </p>
    );
  }

  const colorFor = (svc: string) => PALETTE[services.indexOf(svc) % PALETTE.length];
  const shown = services.filter((s) => !hidden.has(s));
  const width = 1000, height = 280, padL = 44, padR = 14, padT = 14, padB = 30;
  const innerW = width - padL - padR, innerH = height - padT - padB;
  const n = months.length;
  const stepX = n > 1 ? innerW / (n - 1) : innerW;
  const xFor = (i: number) => padL + i * stepX;
  let max = 0;
  for (const s of shown) for (const v of series[s]) if (v != null && v > max) max = v;
  max = Math.max(1, max);
  const yFor = (v: number) => padT + innerH - (v / max) * innerH;
  const yTicks = niceTicks(max);
  const yearTicks = months.map((m, i) => ({ i, m })).filter((x) => x.m.endsWith("-01"));

  const path = (svc: string) => {
    let d = "", started = false;
    series[svc].forEach((v, i) => {
      if (v == null) { started = false; return; }
      d += `${started ? "L" : "M"} ${xFor(i).toFixed(1)} ${yFor(v).toFixed(1)} `;
      started = true;
    });
    return d;
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="inline-flex rounded-lg border border-border-soft overflow-hidden text-[11px]">
          {roomsPresent.map((r) => (
            <button key={r.key} type="button" onClick={() => { setRoom(r.key); setHidden(new Set()); }}
              className={`px-2.5 py-1 cursor-pointer transition-colors ${room === r.key ? "bg-accent text-white" : "text-muted hover:text-fg"}`}>
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {services.map((s) => {
            const on = !hidden.has(s);
            return (
              <button key={s} type="button"
                onClick={() => setHidden((prev) => { const x = new Set(prev); if (x.has(s)) x.delete(s); else x.add(s); return x; })}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full border border-border-soft cursor-pointer transition-opacity"
                style={{ opacity: on ? 1 : 0.4 }}>
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: colorFor(s) }} />
                <span className={on ? "text-fg" : "text-subtle line-through"}>{s}</span>
              </button>
            );
          })}
        </div>
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
        {shown.map((s) => <path key={s} d={path(s)} fill="none" stroke={colorFor(s)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
      </svg>
      <div className="min-h-[34px] mt-1 text-xs">
        {hover != null ? (
          <span>
            <span className="font-medium">{months[hover]}</span>
            <span className="text-muted ml-3">
              {shown.map((s) => { const v = series[s][hover]; return v != null ? `${s}: ${v.toLocaleString()}` : null; }).filter(Boolean).join(" · ")}
            </span>
          </span>
        ) : (
          <span className="text-subtle">Monthly average attendance per service time. Click a service to hide it.</span>
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
