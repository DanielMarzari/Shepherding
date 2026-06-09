"use client";

import { useMemo, useState } from "react";
import type { CohortDecay } from "@/lib/retention-read";

type Mode = "people" | "share" | "lines";

/** Retention decay by join-year cohort. Three views:
 *  - People: stacked area of engaged people per year (each cohort a band
 *    you watch taper) → total engaged is the stack height.
 *  - Share: same, normalized to 100% (composition of the engaged base).
 *  - Lines: each cohort's retention % over time (the decay rate). */
export function RetentionDecayChart({ decay }: { decay: CohortDecay[] }) {
  const [mode, setMode] = useState<Mode>("people");
  const [hoverYear, setHoverYear] = useState<number | null>(null);
  const cohorts = useMemo(() => decay.filter((c) => c.size >= 10), [decay]);

  const years = useMemo(() => {
    const set = new Set<number>();
    for (const c of cohorts) for (const p of c.points) set.add(p.year);
    return [...set].sort((a, b) => a - b);
  }, [cohorts]);

  if (cohorts.length === 0 || years.length < 2) {
    return <p className="text-xs text-subtle">Not enough cohort history yet to chart decay.</p>;
  }

  const width = 1000, height = 300;
  const padL = 40, padR = 66, padT = 14, padB = 34;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const y0 = years[0], y1 = years[years.length - 1];
  const span = Math.max(1, y1 - y0);
  const xFor = (yr: number) => padL + ((yr - y0) / span) * innerW;
  const yFor = (frac: number) => padT + innerH - frac * innerH; // frac 0..1 of plot height
  const colorFor = (i: number) => `hsl(${Math.round(212 - (i / Math.max(1, cohorts.length - 1)) * 190)} 70% 55%)`;

  const countAt = (c: CohortDecay, yr: number) => c.points.find((p) => p.year === yr)?.count ?? 0;
  const totalAt = (yr: number) => cohorts.reduce((a, c) => a + countAt(c, yr), 0);
  const maxTotal = Math.max(1, ...years.map(totalAt));
  const yTotals: Record<number, number> = Object.fromEntries(years.map((yr) => [yr, totalAt(yr)]));

  // Stacked band (oldest cohort at the bottom). Returns the fraction-of-height
  // lower/upper boundary for cohort index i at year yr, per current mode.
  const bounds = (i: number, yr: number): [number, number] => {
    let lowerCount = 0;
    for (let j = 0; j < i; j++) lowerCount += countAt(cohorts[j], yr);
    const upperCount = lowerCount + countAt(cohorts[i], yr);
    if (mode === "share") {
      const tot = yTotals[yr] || 1;
      return [lowerCount / tot, upperCount / tot];
    }
    return [lowerCount / maxTotal, upperCount / maxTotal];
  };

  const yTicks = mode === "share" ? [0, 0.25, 0.5, 0.75, 1] : niceTicks(maxTotal);

  return (
    <div>
      <div className="flex items-center gap-2 mb-2 text-[11px]">
        {(["people", "share", "lines"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${mode === m ? "border-accent bg-bg-elev-2 text-fg" : "border-border-soft text-muted hover:text-fg"}`}
          >
            {m === "people" ? "Total people" : m === "share" ? "% share" : "Retention %"}
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
          const yr = Math.round(y0 + ((vx - padL) / innerW) * span);
          setHoverYear(years.includes(yr) ? yr : null);
        }}
        onMouseLeave={() => setHoverYear(null)}
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
        {years.map((yr) => (
          <text key={yr} x={xFor(yr)} y={height - padB + 14} textAnchor="middle" fontSize={10} fill="#7c879c">{yr}</text>
        ))}
        {hoverYear != null && (
          <line x1={xFor(hoverYear)} x2={xFor(hoverYear)} y1={padT} y2={padT + innerH} stroke="rgba(168,178,198,0.55)" strokeWidth={1} pointerEvents="none" />
        )}

        {mode === "lines"
          ? cohorts.map((c, i) => {
              const col = colorFor(i);
              const d = c.points.map((p, k) => `${k === 0 ? "M" : "L"} ${xFor(p.year).toFixed(1)} ${yFor(p.pct / 100).toFixed(1)}`).join(" ");
              const last = c.points[c.points.length - 1];
              return (
                <g key={c.year}>
                  <path d={d} fill="none" stroke={col} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  <text x={xFor(last.year) + 5} y={yFor(last.pct / 100) + 3} fontSize={9} fill={col}>{c.year}: {last.pct}%</text>
                </g>
              );
            })
          : cohorts.map((c, i) => {
              const col = colorFor(i);
              // upper boundary forward, lower boundary back → filled band
              let d = "";
              years.forEach((yr, k) => {
                const [, up] = bounds(i, yr);
                d += `${k === 0 ? "M" : "L"} ${xFor(yr).toFixed(1)} ${yFor(up).toFixed(1)} `;
              });
              for (let k = years.length - 1; k >= 0; k--) {
                const [lo] = bounds(i, years[k]);
                d += `L ${xFor(years[k]).toFixed(1)} ${yFor(lo).toFixed(1)} `;
              }
              d += "Z";
              return <path key={c.year} d={d} fill={col} fillOpacity={0.8} stroke={col} strokeWidth={0.4} />;
            })}
      </svg>

      <div className="min-h-[34px] mt-2 text-xs">
        {hoverYear != null ? (
          <span>
            <span className="font-medium">{hoverYear}</span>
            <span className="text-muted ml-3">
              {mode !== "lines" && <span className="text-fg tnum mr-2">{yTotals[hoverYear]?.toLocaleString() ?? 0} engaged total</span>}
              {cohorts
                .map((c) => {
                  const p = c.points.find((x) => x.year === hoverYear);
                  if (!p) return null;
                  return mode === "lines" ? `${c.year}: ${p.pct}%` : `${c.year}: ${p.count.toLocaleString()}`;
                })
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        ) : (
          <p className="text-subtle">
            {mode === "people"
              ? "Stacked engaged people by join-year cohort — the stack height is total engaged; each band tapers as that cohort decays."
              : mode === "share"
                ? "Same, normalized to 100% — the share of today's engaged base contributed by each join-year cohort."
                : "Each line is a join-year cohort's retention %; the slope is the decay rate."}
          </p>
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
