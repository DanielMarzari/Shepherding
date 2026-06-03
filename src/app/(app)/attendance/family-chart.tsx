"use client";

import { useMemo, useState } from "react";
import type { WeeklyAttendanceRow } from "@/lib/attendance-read";
import { formatWeekDate } from "@/lib/format-date";
import { isExcludingReason } from "@/lib/attendance-exclusion";

type Key = "adult_total" | "kids_total" | "student_total";
const SERIES: { key: Key; label: string; color: string }[] = [
  { key: "adult_total", label: "Adults", color: "var(--good-soft-fg)" },
  { key: "kids_total", label: "Kids", color: "var(--warn-soft-fg)" },
  { key: "student_total", label: "Students", color: "var(--lane-comm, #7c3aed)" },
];
const SHARE_COLOR = "#14b8a6";

/** Adults / kids / students per Sunday (left axis) with the kids' share
 *  of in-person attendance (right axis, %) so you can see whether the
 *  church is skewing younger or older over time. */
export function FamilyChart({
  rows,
  kidsShare,
}: {
  rows: WeeklyAttendanceRow[];
  kidsShare: (number | null)[];
}) {
  const [enabled, setEnabled] = useState<Record<Key | "share", boolean>>({
    adult_total: true,
    kids_total: true,
    student_total: false,
    share: true,
  });
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const activeKeys = useMemo(
    () => SERIES.filter((s) => enabled[s.key]).map((s) => s.key),
    [enabled],
  );

  const yMax = useMemo(() => {
    let m = 0;
    for (const r of rows)
      for (const k of activeKeys) {
        const v = r[k];
        if (v != null && v > m) m = v;
      }
    return Math.max(1, m);
  }, [rows, activeKeys]);

  const shareMax = useMemo(() => {
    let m = 0;
    for (const s of kidsShare) if (s != null && s > m) m = s;
    return Math.max(5, Math.ceil(m / 5) * 5);
  }, [kidsShare]);

  const width = 1000;
  const height = 320;
  const padL = 48;
  const padR = 44;
  const padT = 14;
  const padB = 32;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const stepX = rows.length > 1 ? innerW / (rows.length - 1) : innerW;
  const xFor = (i: number) => padL + i * stepX;
  const yFor = (v: number) => padT + innerH - (v / yMax) * innerH;
  const yShare = (v: number) => padT + innerH - (v / shareMax) * innerH;

  function pathFor(get: (r: WeeklyAttendanceRow) => number | null, y: (v: number) => number, i0Excl = true) {
    let d = "";
    let pen = false;
    for (let i = 0; i < rows.length; i++) {
      const v = get(rows[i]);
      if (v == null || (i0Excl && isExcludingReason(rows[i].exception_reason))) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"} ${xFor(i).toFixed(1)} ${y(v).toFixed(1)} `;
      pen = true;
    }
    return d;
  }

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
  const shareTicks = [0, 0.5, 1].map((f) => Math.round(shareMax * f));

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
  const hShare = hoverIdx != null ? kidsShare[hoverIdx] : null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-3">
        {SERIES.map((s) => (
          <Chip
            key={s.key}
            on={enabled[s.key]}
            color={s.color}
            label={s.label}
            onClick={() => setEnabled((e) => ({ ...e, [s.key]: !e[s.key] }))}
          />
        ))}
        <Chip
          on={enabled.share}
          color={SHARE_COLOR}
          label="Kids' share %"
          onClick={() => setEnabled((e) => ({ ...e, share: !e.share }))}
        />
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
        {enabled.share &&
          shareTicks.map((t, i) => (
            <text key={`s${i}`} x={width - padR + 6} y={yShare(t) + 3} textAnchor="start" fontSize={10} fill={SHARE_COLOR}>
              {t}%
            </text>
          ))}
        {yearTicks.map((t) => (
          <g key={t.i}>
            <line x1={xFor(t.i)} x2={xFor(t.i)} y1={padT} y2={padT + innerH} stroke="rgba(140,150,170,0.12)" strokeWidth={0.5} />
            <text x={xFor(t.i)} y={height - padB + 14} textAnchor="middle" fontSize={10} fill="#7c879c">
              {t.label}
            </text>
          </g>
        ))}

        {enabled.share && (
          <path
            d={pathFor((r) => {
              const ip = r.in_person_total;
              return r.kids_total != null && ip && ip > 0 ? (r.kids_total / ip) * 100 : null;
            }, yShare)}
            fill="none"
            stroke={SHARE_COLOR}
            strokeWidth={1.1}
            strokeDasharray="4 3"
            opacity={0.85}
          />
        )}
        {SERIES.filter((s) => enabled[s.key]).map((s) => (
          <path key={s.key} d={pathFor((r) => r[s.key], yFor)} fill="none" stroke={s.color} strokeWidth={1.6} strokeLinejoin="round" />
        ))}

        {hoverIdx != null && hr && (
          <g pointerEvents="none">
            <line x1={xFor(hoverIdx)} x2={xFor(hoverIdx)} y1={padT} y2={padT + innerH} stroke="rgba(168,178,198,0.5)" strokeWidth={1} />
            {!isExcludingReason(hr.exception_reason) &&
              SERIES.filter((s) => enabled[s.key]).map((s) => {
                const v = hr[s.key];
                if (v == null) return null;
                return <circle key={s.key} cx={xFor(hoverIdx)} cy={yFor(v)} r={3.5} fill={s.color} stroke="var(--bg)" strokeWidth={1.5} />;
              })}
          </g>
        )}
      </svg>

      <div className="min-h-[44px] mt-2">
        {hr ? (
          <div className="text-xs flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium">{formatWeekDate(hr.week_date)}</span>
            {SERIES.filter((s) => enabled[s.key]).map((s) => (
              <span key={s.key} className="text-muted">
                <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: s.color }} />
                {s.label}: <span className="text-fg tnum">{hr[s.key] == null ? "—" : hr[s.key]!.toLocaleString()}</span>
              </span>
            ))}
            {enabled.share && (
              <span className="text-muted">
                <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: SHARE_COLOR }} />
                Kids&apos; share: <span className="text-fg tnum">{hShare == null ? "—" : `${hShare.toFixed(0)}%`}</span>
              </span>
            )}
          </div>
        ) : (
          <p className="text-xs text-subtle">
            Adults / kids / students per Sunday, plus the kids&apos; share of
            in-person attendance (dashed, right axis).
          </p>
        )}
      </div>
    </div>
  );
}

function Chip({
  on,
  color,
  label,
  onClick,
}: {
  on: boolean;
  color: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[11px] px-2 py-1 rounded-full border transition-colors cursor-pointer ${
        on ? "border-border-soft text-fg bg-bg-elev-2" : "border-border-softer text-muted hover:text-fg"
      }`}
    >
      <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ background: color, opacity: on ? 1 : 0.4 }} />
      {label}
    </button>
  );
}
