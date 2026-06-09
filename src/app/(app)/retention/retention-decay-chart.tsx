"use client";

import { useMemo, useState } from "react";
import type { CohortDecay } from "@/lib/retention-read";

type Mode = "people" | "share";
type Gran = "year" | "month";

/** Retention decay by join-year cohort, as a stacked area: each cohort is a
 *  band you watch ramp then taper. "Total people" → stack height is total
 *  engaged; "% share" → composition of the engaged base. Year or month
 *  resolution on the time axis. */
export function RetentionDecayChart({ decay }: { decay: CohortDecay[] }) {
  const [mode, setMode] = useState<Mode>("people");
  const [gran, setGran] = useState<Gran>("year");
  const [hoverX, setHoverX] = useState<number | null>(null);
  const cohorts = useMemo(() => decay.filter((c) => c.size >= 10), [decay]);

  // Per-cohort {x → count} for the chosen granularity, and the global x axis.
  const { series, times } = useMemo(() => {
    const series = cohorts.map((c) => {
      const m = new Map<number, number>();
      if (gran === "year") {
        for (const p of c.points) m.set(p.year, p.count);
      } else {
        for (const p of c.monthly) {
          const x = Number(p.key.slice(0, 4)) + (Number(p.key.slice(5, 7)) - 1) / 12;
          m.set(x, p.count);
        }
      }
      return m;
    });
    const set = new Set<number>();
    for (const m of series) for (const x of m.keys()) set.add(x);
    return { series, times: [...set].sort((a, b) => a - b) };
  }, [cohorts, gran]);

  if (cohorts.length === 0 || times.length < 2) {
    return <p className="text-xs text-subtle">Not enough cohort history yet to chart decay.</p>;
  }

  const width = 1000, height = 300;
  const padL = 40, padR = 14, padT = 14, padB = 34;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const x0 = times[0], x1 = times[times.length - 1];
  const xspan = Math.max(0.001, x1 - x0);
  const xFor = (x: number) => padL + ((x - x0) / xspan) * innerW;
  const yFor = (frac: number) => padT + innerH - frac * innerH;
  const colorFor = (i: number) => `hsl(${Math.round(212 - (i / Math.max(1, cohorts.length - 1)) * 190)} 70% 55%)`;

  const countAt = (i: number, x: number) => series[i].get(x) ?? 0;
  const totalAt = (x: number) => series.reduce((a, _, i) => a + countAt(i, x), 0);
  const maxTotal = Math.max(1, ...times.map(totalAt));
  const yTotals: Record<number, number> = Object.fromEntries(times.map((x) => [x, totalAt(x)]));

  const bounds = (i: number, x: number): [number, number] => {
    let lower = 0;
    for (let j = 0; j < i; j++) lower += countAt(j, x);
    const upper = lower + countAt(i, x);
    const denom = mode === "share" ? (yTotals[x] || 1) : maxTotal;
    return [lower / denom, upper / denom];
  };

  const yTicks = mode === "share" ? [0, 0.25, 0.5, 0.75, 1] : niceTicks(maxTotal);
  const yearTicks = [...new Set(times.map((x) => Math.floor(x)))]; // integer years present

  return (
    <div>
      <div className="flex items-center gap-2 mb-2 text-[11px] flex-wrap">
        {(["people", "share"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)}
            className={`px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${mode === m ? "border-accent bg-bg-elev-2 text-fg" : "border-border-soft text-muted hover:text-fg"}`}>
            {m === "people" ? "Total people" : "% share"}
          </button>
        ))}
        <span className="mx-1 text-border-soft">|</span>
        {(["year", "month"] as const).map((g) => (
          <button key={g} type="button" onClick={() => { setGran(g); setHoverX(null); }}
            className={`px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${gran === g ? "border-accent bg-bg-elev-2 text-fg" : "border-border-soft text-muted hover:text-fg"}`}>
            {g === "year" ? "By year" : "By month"}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mb-2 text-[11px]">
        <span className="text-subtle">cohort joined:</span>
        {cohorts.map((c, i) => (
          <span key={c.year} className="inline-flex items-center gap-1.5 text-muted">
            <span className="inline-block w-3 h-[3px] rounded" style={{ background: colorFor(i) }} />
            {c.year}
          </span>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const vx = ((e.clientX - rect.left) / rect.width) * width;
          const target = x0 + ((vx - padL) / innerW) * xspan;
          let best = times[0], bd = Infinity;
          for (const t of times) { const d = Math.abs(t - target); if (d < bd) { bd = d; best = t; } }
          setHoverX(best);
        }}
        onMouseLeave={() => setHoverX(null)}
        style={{ width: "100%", height: "auto", display: "block", cursor: "crosshair" }}
      >
        {yTicks.map((t) => {
          const frac = mode === "share" ? t : t / maxTotal;
          const y = yFor(frac);
          return (
            <g key={t}>
              <line x1={padL} x2={width - padR} y1={y} y2={y} stroke="rgba(140,150,170,0.18)" strokeWidth={0.5} strokeDasharray="2 3" />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={10} fill="#7c879c">
                {mode === "share" ? `${Math.round(t * 100)}%` : t.toLocaleString()}
              </text>
            </g>
          );
        })}
        {yearTicks.map((yr) => (
          <text key={yr} x={xFor(yr)} y={height - padB + 14} textAnchor="middle" fontSize={10} fill="#7c879c">{yr}</text>
        ))}
        {hoverX != null && (
          <line x1={xFor(hoverX)} x2={xFor(hoverX)} y1={padT} y2={padT + innerH} stroke="rgba(168,178,198,0.55)" strokeWidth={1} pointerEvents="none" />
        )}
        {cohorts.map((c, i) => {
          const col = colorFor(i);
          let d = "";
          times.forEach((x, k) => { const [, up] = bounds(i, x); d += `${k === 0 ? "M" : "L"} ${xFor(x).toFixed(1)} ${yFor(up).toFixed(1)} `; });
          for (let k = times.length - 1; k >= 0; k--) { const [lo] = bounds(i, times[k]); d += `L ${xFor(times[k]).toFixed(1)} ${yFor(lo).toFixed(1)} `; }
          d += "Z";
          return <path key={c.year} d={d} fill={col} fillOpacity={0.8} stroke={col} strokeWidth={0.4} />;
        })}
      </svg>

      <div className="min-h-[34px] mt-2 text-xs">
        {hoverX != null ? (
          <span>
            <span className="font-medium">{gran === "year" ? Math.floor(hoverX) : fmtMonth(hoverX)}</span>
            <span className="text-muted ml-3">
              <span className="text-fg tnum mr-2">{(yTotals[hoverX] ?? 0).toLocaleString()} engaged</span>
              {cohorts.map((c, i) => { const n = countAt(i, hoverX); return n > 0 ? `${c.year}: ${n.toLocaleString()}` : null; }).filter(Boolean).join(" · ")}
            </span>
          </span>
        ) : (
          <p className="text-subtle">
            {mode === "people"
              ? "Stacked engaged people by join-year cohort — stack height is the total engaged; each band ramps then tapers as that cohort decays."
              : "Each band is a join-year cohort's share of today's engaged base, over time."}
          </p>
        )}
      </div>
    </div>
  );
}

const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtMonth(x: number): string {
  const yr = Math.floor(x);
  const mo = Math.round((x - yr) * 12);
  return `${MO[mo] ?? ""} ${yr}`;
}
function niceTicks(max: number): number[] {
  const step = Math.max(1, Math.ceil(max / 4 / 50) * 50);
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.5; v += step) out.push(v);
  return out;
}
