"use client";

import { useMemo, useState } from "react";
import type { CohortDecay } from "@/lib/retention-read";

/** Per-cohort retention decay: one line per join-year, showing what % of
 *  that cohort was still active as of each later year-end. */
export function RetentionDecayChart({ decay }: { decay: CohortDecay[] }) {
  const [hoverYear, setHoverYear] = useState<number | null>(null);
  const cohorts = decay.filter((c) => c.size >= 10); // skip tiny cohorts (noisy)

  const years = useMemo(() => {
    const set = new Set<number>();
    for (const c of cohorts) for (const p of c.points) set.add(p.year);
    return [...set].sort((a, b) => a - b);
  }, [cohorts]);

  if (cohorts.length === 0 || years.length < 2) {
    return <p className="text-xs text-subtle">Not enough cohort history yet to chart decay.</p>;
  }

  const width = 1000;
  const height = 300;
  const padL = 40, padR = 64, padT = 14, padB = 34;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const y0 = years[0], y1 = years[years.length - 1];
  const span = Math.max(1, y1 - y0);
  const xFor = (yr: number) => padL + ((yr - y0) / span) * innerW;
  const yFor = (pct: number) => padT + innerH - (pct / 100) * innerH;

  // Color per cohort — oldest blue → newest amber.
  const colorFor = (i: number) => `hsl(${Math.round(212 - (i / Math.max(1, cohorts.length - 1)) * 190)} 70% 55%)`;

  return (
    <div>
      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mb-3 text-[11px]">
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
          const yr = Math.round(y0 + ((vx - padL) / innerW) * span);
          setHoverYear(years.includes(yr) ? yr : null);
        }}
        onMouseLeave={() => setHoverYear(null)}
        style={{ width: "100%", height: "auto", display: "block", cursor: "crosshair" }}
      >
        {[0, 25, 50, 75, 100].map((t) => {
          const y = yFor(t);
          return (
            <g key={t}>
              <line x1={padL} x2={width - padR} y1={y} y2={y} stroke="rgba(140,150,170,0.18)" strokeWidth={0.5} strokeDasharray="2 3" />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={10} fill="#7c879c">{t}%</text>
            </g>
          );
        })}
        {years.map((yr) => (
          <text key={yr} x={xFor(yr)} y={height - padB + 14} textAnchor="middle" fontSize={10} fill="#7c879c">{yr}</text>
        ))}
        {hoverYear != null && (
          <line x1={xFor(hoverYear)} x2={xFor(hoverYear)} y1={padT} y2={padT + innerH} stroke="rgba(168,178,198,0.5)" strokeWidth={1} pointerEvents="none" />
        )}
        {cohorts.map((c, i) => {
          const col = colorFor(i);
          const d = c.points.map((p, k) => `${k === 0 ? "M" : "L"} ${xFor(p.year).toFixed(1)} ${yFor(p.pct).toFixed(1)}`).join(" ");
          const last = c.points[c.points.length - 1];
          return (
            <g key={c.year}>
              <path d={d} fill="none" stroke={col} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {c.points.map((p) => (
                <circle key={p.year} cx={xFor(p.year)} cy={yFor(p.pct)} r={hoverYear === p.year ? 3.5 : 1.8} fill={col} />
              ))}
              <text x={xFor(last.year) + 5} y={yFor(last.pct) + 3} fontSize={9} fill={col}>{c.year}: {last.pct}%</text>
            </g>
          );
        })}
      </svg>

      <div className="min-h-[34px] mt-2 text-xs">
        {hoverYear != null ? (
          <span>
            <span className="font-medium">{hoverYear}</span>
            <span className="text-muted ml-3">
              {cohorts
                .map((c) => {
                  const p = c.points.find((x) => x.year === hoverYear);
                  return p ? `${c.year} cohort: ${p.pct}%` : null;
                })
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        ) : (
          <p className="text-subtle">
            Each line is a join-year cohort; follow it down to see how its retention decayed year by year.
          </p>
        )}
      </div>
    </div>
  );
}
