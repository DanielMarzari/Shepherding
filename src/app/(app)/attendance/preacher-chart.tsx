"use client";

import { useMemo, useState } from "react";
import type { WeeklyAttendanceRow } from "@/lib/attendance-read";
import type { PreacherStat } from "@/lib/attendance-preacher";
import { formatWeekDate } from "@/lib/format-date";

const PALETTE = [
  "var(--accent)",
  "var(--good-soft-fg)",
  "var(--warn-soft-fg)",
  "#7c3aed",
  "#f59e0b",
  "#3b82f6",
  "#ec4899",
  "#14b8a6",
];
const OTHER_COLOR = "var(--muted)";

/** In-person Sunday attendance with each week's dot colored by who
 *  preached (LIVE service). The legend lists each preacher's average
 *  attendance and how many Sundays — click a name to isolate them. */
export function PreacherChart({
  rows,
  perWeek,
  stats,
}: {
  rows: WeeklyAttendanceRow[];
  perWeek: (string | null)[];
  stats: PreacherStat[];
}) {
  const [focus, setFocus] = useState<string | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const colorByName = useMemo(() => {
    const m = new Map<string, string>();
    stats.forEach((s, i) => {
      if (i < PALETTE.length) m.set(s.name, PALETTE[i]);
    });
    return m;
  }, [stats]);
  const colorFor = (name: string | null) =>
    name ? (colorByName.get(name) ?? OTHER_COLOR) : OTHER_COLOR;

  const yMax = useMemo(() => {
    let m = 0;
    for (const r of rows)
      if (r.in_person_total != null && r.in_person_total > m) m = r.in_person_total;
    return Math.max(1, m);
  }, [rows]);

  const width = 1000;
  const height = 320;
  const padL = 48;
  const padR = 16;
  const padT = 14;
  const padB = 32;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const stepX = rows.length > 1 ? innerW / (rows.length - 1) : innerW;
  const xFor = (i: number) => padL + i * stepX;
  const yFor = (v: number) => padT + innerH - (v / yMax) * innerH;

  const linePath = useMemo(() => {
    let d = "";
    let pen = false;
    for (let i = 0; i < rows.length; i++) {
      const v = rows[i].in_person_total;
      if (v == null || rows[i].exception_reason) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"} ${xFor(i).toFixed(1)} ${yFor(v).toFixed(1)} `;
      pen = true;
    }
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, yMax]);

  const yearTicks: Array<{ i: number; label: string }> = [];
  let lastYear: string | null = null;
  rows.forEach((r, i) => {
    const y = r.week_date.slice(0, 4);
    if (y !== lastYear) {
      yearTicks.push({ i, label: y });
      lastYear = y;
    }
  });
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yMax * f));

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * width;
    if (vx < padL - 6 || vx > width - padR + 6 || rows.length === 0) {
      setHoverIdx(null);
      return;
    }
    setHoverIdx(Math.max(0, Math.min(rows.length - 1, Math.round((vx - padL) / stepX))));
  }

  const hr = hoverIdx != null ? rows[hoverIdx] : null;
  const hName = hoverIdx != null ? perWeek[hoverIdx] : null;

  return (
    <div>
      {/* Legend / per-preacher stats */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-3">
        {stats.map((s) => {
          const on = focus === null || focus === s.name;
          return (
            <button
              key={s.name}
              type="button"
              onClick={() => setFocus((f) => (f === s.name ? null : s.name))}
              className={`text-[11px] px-2 py-1 rounded-full border transition-colors cursor-pointer ${
                on ? "border-border-soft text-fg bg-bg-elev-2" : "border-border-softer text-muted hover:text-fg"
              }`}
            >
              <span
                className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                style={{ background: colorFor(s.name), opacity: on ? 1 : 0.4 }}
              />
              {s.name}{" "}
              <span className="text-muted tnum">
                · {s.avg.toLocaleString()} avg · {s.weeks}
              </span>
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
          const y = yFor(tick);
          return (
            <g key={i}>
              <line x1={padL} x2={width - padR} y1={y} y2={y} stroke="rgba(140,150,170,0.18)" strokeWidth={0.5} strokeDasharray="2 3" />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={10} fill="#7c879c">
                {tick.toLocaleString()}
              </text>
            </g>
          );
        })}
        {yearTicks.map((t) => (
          <g key={t.i}>
            <line x1={xFor(t.i)} x2={xFor(t.i)} y1={padT} y2={padT + innerH} stroke="rgba(140,150,170,0.12)" strokeWidth={0.5} />
            <text x={xFor(t.i)} y={height - padB + 14} textAnchor="middle" fontSize={10} fill="#7c879c">
              {t.label}
            </text>
          </g>
        ))}

        {/* Attendance line (muted) + per-week preacher dots */}
        <path d={linePath} fill="none" stroke="rgba(140,150,170,0.45)" strokeWidth={1.25} strokeLinejoin="round" />
        {rows.map((r, i) => {
          if (r.in_person_total == null || r.exception_reason) return null;
          const name = perWeek[i];
          const dim = focus !== null && name !== focus;
          return (
            <circle
              key={i}
              cx={xFor(i)}
              cy={yFor(r.in_person_total)}
              r={focus !== null && name === focus ? 3 : 2}
              fill={colorFor(name)}
              opacity={dim ? 0.12 : 0.95}
            />
          );
        })}

        {hoverIdx != null && hr && (
          <g pointerEvents="none">
            <line x1={xFor(hoverIdx)} x2={xFor(hoverIdx)} y1={padT} y2={padT + innerH} stroke="rgba(168,178,198,0.5)" strokeWidth={1} />
            {hr.in_person_total != null && !hr.exception_reason && (
              <circle cx={xFor(hoverIdx)} cy={yFor(hr.in_person_total)} r={4} fill={colorFor(hName)} stroke="var(--bg)" strokeWidth={1.5} />
            )}
          </g>
        )}
      </svg>

      <div className="min-h-[44px] mt-2">
        {hr ? (
          <div className="text-xs flex flex-wrap items-center gap-x-3">
            <span className="font-medium">{formatWeekDate(hr.week_date)}</span>
            {hr.exception_reason ? (
              <span className="text-warn-soft-fg">Excluded: {hr.exception_reason}</span>
            ) : (
              <>
                <span className="text-muted">
                  In-person:{" "}
                  <span className="text-fg tnum">
                    {hr.in_person_total == null ? "—" : hr.in_person_total.toLocaleString()}
                  </span>
                </span>
                <span className="text-muted">
                  <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: colorFor(hName) }} />
                  Preacher: <span className="text-fg">{hName ?? "—"}</span>
                </span>
              </>
            )}
          </div>
        ) : (
          <p className="text-xs text-subtle">
            Each dot is a Sunday, colored by who preached the LIVE service.
            Click a preacher to isolate their Sundays.
          </p>
        )}
      </div>
    </div>
  );
}
