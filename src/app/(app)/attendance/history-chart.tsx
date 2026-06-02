"use client";

import { useMemo, useState } from "react";
import type { WeeklyAttendanceRow } from "@/lib/attendance-read";
import { formatWeekDate } from "@/lib/format-date";

export type SeriesKey =
  | "in_person_total"
  | "adult_total"
  | "kids_total"
  | "student_total"
  | "online_live"
  | "abfs";

interface SeriesDef {
  key: SeriesKey;
  label: string;
  color: string;
}

export const ATTENDANCE_SERIES: SeriesDef[] = [
  { key: "in_person_total", label: "In-person total", color: "var(--accent)" },
  { key: "adult_total", label: "Adult worship", color: "var(--good-soft-fg)" },
  { key: "kids_total", label: "Kids worship", color: "var(--warn-soft-fg)" },
  { key: "student_total", label: "Student worship", color: "var(--lane-comm, #7c3aed)" },
  { key: "online_live", label: "Online live", color: "var(--lane-care, #f59e0b)" },
  { key: "abfs", label: "ABFs", color: "var(--muted)" },
];
const SERIES = ATTENDANCE_SERIES;

/** Weekly attendance line chart. Each series is toggleable so the
 *  reader can isolate (e.g.) Sundays only or the online-stream curve.
 *  Hover snaps to the nearest Sunday and shows every active series's
 *  value at that point in a fixed-position legend. */
export function AttendanceHistoryChart({
  rows,
}: {
  rows: WeeklyAttendanceRow[];
}) {
  const [enabled, setEnabled] = useState<Record<SeriesKey, boolean>>({
    in_person_total: true,
    adult_total: false,
    kids_total: false,
    student_total: false,
    online_live: true,
    abfs: false,
  });
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const activeKeys = useMemo(
    () => SERIES.filter((s) => enabled[s.key]).map((s) => s.key),
    [enabled],
  );

  // Y scale = max of every active series across every visible week.
  const yMax = useMemo(() => {
    let m = 0;
    for (const r of rows) {
      for (const k of activeKeys) {
        const v = r[k];
        if (v != null && v > m) m = v;
      }
    }
    return Math.max(1, m);
  }, [rows, activeKeys]);

  const width = 1000;
  const height = 320;
  const padL = 48;
  const padR = 16;
  const padT = 14;
  const padB = 32;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const stepX = rows.length > 1 ? innerW / (rows.length - 1) : innerW;

  function xFor(i: number) {
    return padL + i * stepX;
  }
  function yFor(v: number) {
    return padT + innerH - (v / yMax) * innerH;
  }

  // Build SVG path segments per series, BREAKING the path on any null
  // value so we don't draw a deceiving straight line across a gap.
  function pathFor(key: SeriesKey): string {
    let d = "";
    let penDown = false;
    for (let i = 0; i < rows.length; i++) {
      const v = rows[i][key];
      if (v == null) {
        penDown = false;
        continue;
      }
      const cmd = penDown ? "L" : "M";
      d += `${cmd} ${xFor(i).toFixed(1)} ${yFor(v).toFixed(1)} `;
      penDown = true;
    }
    return d;
  }

  // Year ticks — for a 5+ year span we label every Jan-ish week.
  const yearTicks: Array<{ i: number; label: string }> = [];
  let lastYear: string | null = null;
  for (let i = 0; i < rows.length; i++) {
    const y = rows[i].week_date.slice(0, 4);
    if (y !== lastYear) {
      yearTicks.push({ i, label: y });
      lastYear = y;
    }
  }

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * width;
    if (vx < padL - 6 || vx > width - padR + 6 || rows.length === 0) {
      setHoverIdx(null);
      return;
    }
    const i = Math.max(
      0,
      Math.min(rows.length - 1, Math.round((vx - padL) / stepX)),
    );
    setHoverIdx(i);
  }

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yMax * f));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-3">
        {SERIES.map((s) => {
          const on = enabled[s.key];
          return (
            <button
              key={s.key}
              type="button"
              onClick={() =>
                setEnabled((e) => ({ ...e, [s.key]: !e[s.key] }))
              }
              className={`text-[11px] px-2 py-1 rounded-full border transition-colors cursor-pointer ${
                on
                  ? "border-border-soft text-fg bg-bg-elev-2"
                  : "border-border-softer text-muted hover:text-fg"
              }`}
            >
              <span
                className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                style={{ background: s.color, opacity: on ? 1 : 0.4 }}
              />
              {s.label}
            </button>
          );
        })}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
        style={{ width: "100%", height: "auto", display: "block", cursor: "crosshair" }}
      >
        {yTicks.map((tick, i) => {
          const y = padT + innerH - (tick / yMax) * innerH;
          return (
            <g key={i}>
              <line
                x1={padL}
                x2={width - padR}
                y1={y}
                y2={y}
                stroke="rgba(140,150,170,0.18)"
                strokeWidth={0.5}
                strokeDasharray="2 3"
              />
              <text
                x={padL - 6}
                y={y + 3}
                textAnchor="end"
                fontSize={10}
                fill="#7c879c"
              >
                {tick.toLocaleString()}
              </text>
            </g>
          );
        })}
        {yearTicks.map((t) => (
          <g key={t.i}>
            <line
              x1={xFor(t.i)}
              x2={xFor(t.i)}
              y1={padT}
              y2={padT + innerH}
              stroke="rgba(140,150,170,0.12)"
              strokeWidth={0.5}
            />
            <text
              x={xFor(t.i)}
              y={height - padB + 14}
              textAnchor="middle"
              fontSize={10}
              fill="#7c879c"
            >
              {t.label}
            </text>
          </g>
        ))}
        {SERIES.filter((s) => enabled[s.key]).map((s) => (
          <path
            key={s.key}
            d={pathFor(s.key)}
            fill="none"
            stroke={s.color}
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        ))}
        {hoverIdx != null && (
          <g pointerEvents="none">
            <line
              x1={xFor(hoverIdx)}
              x2={xFor(hoverIdx)}
              y1={padT}
              y2={padT + innerH}
              stroke="rgba(168,178,198,0.5)"
              strokeWidth={1}
            />
            {SERIES.filter((s) => enabled[s.key]).map((s) => {
              const v = rows[hoverIdx][s.key];
              if (v == null) return null;
              return (
                <circle
                  key={s.key}
                  cx={xFor(hoverIdx)}
                  cy={yFor(v)}
                  r={3.5}
                  fill={s.color}
                  stroke="var(--bg)"
                  strokeWidth={1.5}
                />
              );
            })}
          </g>
        )}
      </svg>

      <div className="min-h-[44px] mt-2">
        {hoverIdx != null && rows[hoverIdx] ? (
          <div className="text-xs">
            <span className="font-medium">
              {formatWeekDate(rows[hoverIdx].week_date)}
            </span>
            <span className="text-muted ml-2">
              {SERIES.filter((s) => enabled[s.key]).map((s) => {
                const v = rows[hoverIdx][s.key];
                return (
                  <span key={s.key} className="mr-3">
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-1 align-middle"
                      style={{ background: s.color }}
                    />
                    {s.label}:{" "}
                    <span className="text-fg tnum">
                      {v == null ? "—" : v.toLocaleString()}
                    </span>
                  </span>
                );
              })}
            </span>
          </div>
        ) : (
          <p className="text-xs text-subtle">
            Hover the chart for per-week values. Toggle series with the
            chips above.
          </p>
        )}
      </div>
    </div>
  );
}
