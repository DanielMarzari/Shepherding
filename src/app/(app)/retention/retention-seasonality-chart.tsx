"use client";

import { useState } from "react";
import type { MonthSeasonality } from "@/lib/retention-read";

/** Retention by calendar join-month as a line — Jan→Dec on the x-axis. */
export function RetentionSeasonalityChart({
  seasonality,
  bestMonth,
  worstMonth,
}: {
  seasonality: MonthSeasonality[];
  bestMonth: number | null;
  worstMonth: number | null;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const withData = seasonality.filter((s) => s.joined > 0);
  if (withData.length < 2) return <p className="text-xs text-subtle">Not enough monthly history yet.</p>;

  const width = 1000, height = 240;
  const padL = 36, padR = 14, padT = 14, padB = 30;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const xFor = (mo: number) => padL + ((mo - 1) / 11) * innerW;
  const yFor = (pct: number) => padT + innerH - (pct / 100) * innerH;

  const d = withData
    .map((s, k) => `${k === 0 ? "M" : "L"} ${xFor(s.month).toFixed(1)} ${yFor(s.pct).toFixed(1)}`)
    .join(" ");
  const hs = hover != null ? seasonality[hover - 1] : null;

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const vx = ((e.clientX - rect.left) / rect.width) * width;
          const mo = Math.round(((vx - padL) / innerW) * 11) + 1;
          setHover(mo >= 1 && mo <= 12 ? mo : null);
        }}
        onMouseLeave={() => setHover(null)}
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
        {seasonality.map((s) => (
          <text key={s.month} x={xFor(s.month)} y={height - padB + 14} textAnchor="middle" fontSize={10} fill="#7c879c">{s.label}</text>
        ))}
        {hover != null && (
          <line x1={xFor(hover)} x2={xFor(hover)} y1={padT} y2={padT + innerH} stroke="rgba(168,178,198,0.5)" strokeWidth={1} pointerEvents="none" />
        )}
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {withData.map((s) => {
          const col = s.month === bestMonth ? "var(--good-soft-fg)" : s.month === worstMonth ? "var(--warn-soft-fg)" : "var(--accent)";
          return <circle key={s.month} cx={xFor(s.month)} cy={yFor(s.pct)} r={s.month === bestMonth || s.month === worstMonth ? 4 : 2.5} fill={col} />;
        })}
      </svg>
      <div className="min-h-[34px] mt-1 text-xs">
        {hs && hs.joined > 0 ? (
          <span>
            <span className="font-medium">{hs.label}</span>
            <span className="text-muted ml-3">
              <span className="text-fg tnum">{hs.pct}%</span> retained · {hs.retained.toLocaleString()} of{" "}
              {hs.joined.toLocaleString()} across {hs.cohorts} {hs.cohorts === 1 ? "year" : "years"}
            </span>
          </span>
        ) : (
          <span className="text-subtle">Hover a month for its pooled retention. Green = best, red = worst.</span>
        )}
      </div>
    </div>
  );
}
