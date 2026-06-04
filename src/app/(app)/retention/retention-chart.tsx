"use client";

import { useMemo, useState } from "react";
import type { RetentionCohort } from "@/lib/retention-read";

/** Retention by join-cohort as a bar chart, toggleable between yearly
 *  and monthly granularity (like the attendance charts). Settled cohorts
 *  are solid bars; cohorts still inside the activity window are shown
 *  faded/striped as "ongoing" since their % isn't meaningful yet. */
export function RetentionChart({
  byYear,
  byMonth,
}: {
  byYear: RetentionCohort[];
  byMonth: RetentionCohort[];
}) {
  const [gran, setGran] = useState<"year" | "month">("year");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const cohorts = gran === "year" ? byYear : byMonth;

  const width = 1000;
  const height = 300;
  const padL = 40;
  const padR = 14;
  const padT = 14;
  const padB = 34;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const n = cohorts.length;
  const slot = n > 0 ? innerW / n : innerW;
  const barW = Math.max(1, Math.min(40, slot * 0.7));
  const yFor = (pct: number) => padT + innerH - (pct / 100) * innerH;
  const xCenter = (i: number) => padL + slot * (i + 0.5);

  // Year boundary ticks (for the month view, label the first month of
  // each year; for the year view, every bar).
  const ticks = useMemo(() => {
    const out: Array<{ i: number; label: string }> = [];
    let lastYear = "";
    cohorts.forEach((c, i) => {
      const yr = c.key.slice(0, 4);
      if (gran === "year") out.push({ i, label: yr });
      else if (yr !== lastYear) {
        out.push({ i, label: yr });
        lastYear = yr;
      }
    });
    return out;
  }, [cohorts, gran]);

  const yTicks = [0, 25, 50, 75, 100];

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * width;
    const i = Math.floor((vx - padL) / slot);
    setHoverIdx(i >= 0 && i < n ? i : null);
  }

  const hc = hoverIdx != null ? cohorts[hoverIdx] : null;

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
          striped = ongoing (inside the activity window)
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
        style={{ width: "100%", height: "auto", display: "block", cursor: "crosshair" }}
      >
        <defs>
          <pattern
            id="ret-pending"
            patternUnits="userSpaceOnUse"
            width="6"
            height="6"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="6" fill="var(--bg-elev-2)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--muted)" strokeWidth="2" opacity="0.5" />
          </pattern>
        </defs>

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

        {cohorts.map((c, i) => {
          const h = innerH - (yFor(c.pct) - padT);
          const x = xCenter(i) - barW / 2;
          const hovered = i === hoverIdx;
          if (c.pending) {
            // Full-height faded striped bar — value unknown.
            return (
              <rect
                key={c.key}
                x={x}
                y={padT}
                width={barW}
                height={innerH}
                fill="url(#ret-pending)"
                opacity={hovered ? 0.9 : 0.6}
              />
            );
          }
          return (
            <rect
              key={c.key}
              x={x}
              y={yFor(c.pct)}
              width={barW}
              height={Math.max(0, h)}
              rx={1.5}
              fill="var(--accent)"
              opacity={hovered ? 1 : 0.85}
            />
          );
        })}

        {ticks.map((t) => (
          <text
            key={`${t.i}-${t.label}`}
            x={xCenter(t.i)}
            y={height - padB + 14}
            textAnchor="middle"
            fontSize={10}
            fill="#7c879c"
          >
            {t.label}
          </text>
        ))}
      </svg>

      <div className="min-h-[40px] mt-2">
        {hc ? (
          <div className="text-xs">
            <span className="font-medium">{hc.label}</span>
            <span className="text-muted ml-3">
              {hc.pending ? (
                <span className="text-subtle">
                  ongoing — joined {hc.joined.toLocaleString()}, too recent to
                  measure
                </span>
              ) : (
                <>
                  <span className="text-fg tnum">{hc.pct}%</span> retained ·{" "}
                  {hc.retained.toLocaleString()} of {hc.joined.toLocaleString()}{" "}
                  still active
                </>
              )}
            </span>
          </div>
        ) : (
          <p className="text-xs text-subtle">
            Hover a bar for the cohort&apos;s retention. Toggle year / month
            above.
          </p>
        )}
      </div>
    </div>
  );
}
