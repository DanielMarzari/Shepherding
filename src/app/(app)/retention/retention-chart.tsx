"use client";

import { useMemo, useState } from "react";
import type { RetentionPoint } from "@/lib/retention-read";

/** Retention by join-cohort as a LINE graph, toggleable between yearly
 *  and monthly granularity. The solid line runs through settled cohorts;
 *  the recent "ongoing" tail (still inside the activity window, so not
 *  yet measurable) is shaded instead of plotted as a misleading ~100%. */
export function RetentionChart({
  byYear,
  byMonth,
}: {
  byYear: RetentionPoint[];
  byMonth: RetentionPoint[];
}) {
  const [gran, setGran] = useState<"year" | "month">("year");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const points = gran === "year" ? byYear : byMonth;
  const n = points.length;

  const width = 1000;
  const height = 300;
  const padL = 40;
  const padR = 14;
  const padT = 14;
  const padB = 34;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const stepX = n > 1 ? innerW / (n - 1) : innerW;
  const xFor = (i: number) => padL + i * stepX;
  const yFor = (pct: number) => padT + innerH - (pct / 100) * innerH;

  const firstPending = useMemo(() => points.findIndex((p) => p.pending), [points]);

  // Line + area through SETTLED points only.
  const settled = useMemo(
    () => points.map((p, i) => ({ p, i })).filter((x) => !x.p.pending),
    [points],
  );
  const linePath = useMemo(() => {
    let d = "";
    settled.forEach(({ p, i }, k) => {
      d += `${k === 0 ? "M" : "L"} ${xFor(i).toFixed(1)} ${yFor(p.pct).toFixed(1)} `;
    });
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, stepX, n]);

  const yTicks = [0, 25, 50, 75, 100];
  const yearTicks = useMemo(() => {
    const out: Array<{ i: number; label: string }> = [];
    let last = "";
    points.forEach((p, i) => {
      const yr = p.key.slice(0, 4);
      if (yr !== last) {
        out.push({ i, label: yr });
        last = yr;
      }
    });
    return out;
  }, [points]);

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * width;
    if (vx < padL - 6 || vx > width - padR + 6 || n === 0) {
      setHoverIdx(null);
      return;
    }
    setHoverIdx(Math.max(0, Math.min(n - 1, Math.round((vx - padL) / stepX))));
  }

  const hp = hoverIdx != null ? points[hoverIdx] : null;
  const bandX = firstPending >= 0 ? xFor(firstPending) : null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        {(["year", "month"] as const).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => {
              setGran(g);
              setHoverIdx(null);
            }}
            className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${
              gran === g
                ? "border-accent bg-bg-elev-2 text-fg"
                : "border-border-soft text-muted hover:text-fg"
            }`}
          >
            {g === "year" ? "By year" : "By month"}
          </button>
        ))}
        <span className="ml-2 text-[11px] text-subtle">
          shaded = ongoing (inside the activity window)
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
        style={{ width: "100%", height: "auto", display: "block", cursor: "crosshair" }}
      >
        {/* y gridlines */}
        {yTicks.map((t) => {
          const y = yFor(t);
          return (
            <g key={t}>
              <line x1={padL} x2={width - padR} y1={y} y2={y} stroke="rgba(140,150,170,0.18)" strokeWidth={0.5} strokeDasharray="2 3" />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={10} fill="#7c879c">
                {t}%
              </text>
            </g>
          );
        })}

        {/* ongoing band over the trailing pending cohorts */}
        {bandX != null && (
          <g>
            <rect
              x={bandX}
              y={padT}
              width={width - padR - bandX}
              height={innerH}
              fill="rgba(140,150,170,0.10)"
            />
            <text x={bandX + 4} y={padT + 11} fontSize={9} fill="#7c879c">
              ongoing
            </text>
          </g>
        )}

        {/* year tick labels */}
        {yearTicks.map((t) => (
          <g key={`${t.i}-${t.label}`}>
            <line x1={xFor(t.i)} x2={xFor(t.i)} y1={padT} y2={padT + innerH} stroke="rgba(140,150,170,0.10)" strokeWidth={0.5} />
            <text x={xFor(t.i)} y={height - padB + 14} textAnchor="middle" fontSize={10} fill="#7c879c">
              {t.label}
            </text>
          </g>
        ))}

        {/* retention line (settled) */}
        <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {settled.map(({ p, i }) => (
          <circle key={p.key} cx={xFor(i)} cy={yFor(p.pct)} r={2.5} fill="var(--accent)" />
        ))}

        {/* hover */}
        {hoverIdx != null && hp && (
          <g pointerEvents="none">
            <line x1={xFor(hoverIdx)} x2={xFor(hoverIdx)} y1={padT} y2={padT + innerH} stroke="rgba(168,178,198,0.5)" strokeWidth={1} />
            {!hp.pending && (
              <circle cx={xFor(hoverIdx)} cy={yFor(hp.pct)} r={4} fill="var(--accent)" stroke="var(--bg)" strokeWidth={1.5} />
            )}
          </g>
        )}
      </svg>

      <div className="min-h-[40px] mt-2">
        {hp ? (
          <div className="text-xs">
            <span className="font-medium">{hp.label}</span>
            <span className="text-muted ml-3">
              {hp.pending ? (
                <span className="text-subtle">
                  ongoing — joined {hp.joined.toLocaleString()}, too recent to
                  measure
                </span>
              ) : (
                <>
                  <span className="text-fg tnum">{hp.pct}%</span> retained ·{" "}
                  {hp.retained.toLocaleString()} of {hp.joined.toLocaleString()}{" "}
                  still active
                </>
              )}
            </span>
          </div>
        ) : (
          <p className="text-xs text-subtle">
            Hover the line for a cohort&apos;s retention. Toggle year / month
            above.
          </p>
        )}
      </div>
    </div>
  );
}
