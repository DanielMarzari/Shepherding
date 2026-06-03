"use client";

import { useMemo, useState } from "react";
import type { WeeklyAttendanceRow } from "@/lib/attendance-read";
import { formatWeekDate } from "@/lib/format-date";
import { isExcludingReason } from "@/lib/attendance-exclusion";
import { ATTENDANCE_SERIES, type SeriesKey } from "./history-chart";

export interface WeatherCell {
  tmaxF: number | null;
  tminF: number | null;
  rainIn: number | null;
  snowIn: number | null;
}
export interface ChartMarker {
  date: string;
  kind: "easter" | "christmas";
  label: string;
}

const TEMP_COLOR = "var(--lane-care, #f59e0b)";
const RAIN_COLOR = "#3b82f6";
const SNOW_COLOR = "#cbd5e1";

/** Sunday attendance (every series, toggleable — left axis) lined up
 *  against Trexlertown weather: a daily high/low temperature band
 *  (right axis) and a rain-vs-snow precipitation strip along the
 *  bottom. Holiday markers optional. Hover snaps to the nearest Sunday. */
export function AttendanceWeatherChart({
  rows,
  weather,
  markers,
}: {
  rows: WeeklyAttendanceRow[];
  weather: WeatherCell[];
  markers: ChartMarker[];
}) {
  const [enabled, setEnabled] = useState<Record<SeriesKey, boolean>>({
    in_person_total: true,
    adult_total: false,
    kids_total: false,
    student_total: false,
    online_live: false,
    abfs: false,
  });
  const [showTemp, setShowTemp] = useState(true);
  const [showPrecip, setShowPrecip] = useState(true);
  const [showMarkers, setShowMarkers] = useState(false);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const idxByDate = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r, i) => m.set(r.week_date, i));
    return m;
  }, [rows]);
  function nearestIdx(date: string): number {
    const exact = idxByDate.get(date);
    if (exact != null) return exact;
    let best = 0;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].week_date <= date) best = i;
      else break;
    }
    return best;
  }

  const activeKeys = useMemo(
    () => ATTENDANCE_SERIES.filter((s) => enabled[s.key]).map((s) => s.key),
    [enabled],
  );

  const attMax = useMemo(() => {
    let m = 0;
    for (const r of rows)
      for (const k of activeKeys) {
        const v = r[k];
        if (v != null && v > m) m = v;
      }
    return Math.max(1, m);
  }, [rows, activeKeys]);

  const [tMin, tMax] = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const w of weather) {
      if (w?.tminF != null && w.tminF < lo) lo = w.tminF;
      if (w?.tmaxF != null && w.tmaxF > hi) hi = w.tmaxF;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 100];
    return [Math.floor(lo - 4), Math.ceil(hi + 4)];
  }, [weather]);

  const precipMax = useMemo(() => {
    let m = 0;
    for (const w of weather) {
      const t = (w?.rainIn ?? 0) + (w?.snowIn ?? 0);
      if (t > m) m = t;
    }
    return Math.max(0.5, m);
  }, [weather]);

  const width = 1000;
  const height = 380;
  const padL = 48;
  const padR = 44;
  const padT = 14;
  const padB = 26;
  const precipH = 46;
  const linesBottom = height - padB - precipH - 10;
  const precipTop = linesBottom + 10;
  const precipBottom = height - padB;
  const innerW = width - padL - padR;
  const innerH = linesBottom - padT;
  const stepX = rows.length > 1 ? innerW / (rows.length - 1) : innerW;

  const xFor = (i: number) => padL + i * stepX;
  const yAtt = (v: number) => padT + innerH - (v / attMax) * innerH;
  const yTemp = (t: number) =>
    padT + innerH - ((t - tMin) / Math.max(1, tMax - tMin)) * innerH;

  function attPath(key: SeriesKey): string {
    let d = "";
    let pen = false;
    for (let i = 0; i < rows.length; i++) {
      const v = rows[i][key];
      if (v == null) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"} ${xFor(i).toFixed(1)} ${yAtt(v).toFixed(1)} `;
      pen = true;
    }
    return d;
  }

  // Contiguous runs where both hi & lo exist → filled temp band polygons.
  const tempBands = useMemo(() => {
    const polys: string[] = [];
    let run: number[] = [];
    const flush = () => {
      if (run.length >= 2) {
        const top = run.map((i) => `${xFor(i).toFixed(1)} ${yTemp(weather[i]!.tmaxF!).toFixed(1)}`);
        const bot = [...run]
          .reverse()
          .map((i) => `${xFor(i).toFixed(1)} ${yTemp(weather[i]!.tminF!).toFixed(1)}`);
        polys.push(`M ${top.join(" L ")} L ${bot.join(" L ")} Z`);
      }
      run = [];
    };
    for (let i = 0; i < rows.length; i++) {
      const w = weather[i];
      if (w?.tmaxF != null && w.tminF != null) run.push(i);
      else flush();
    }
    flush();
    return polys;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, weather, tMin, tMax, attMax, activeKeys]);

  function tempHighPath(): string {
    let d = "";
    let pen = false;
    for (let i = 0; i < rows.length; i++) {
      const v = weather[i]?.tmaxF;
      if (v == null) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"} ${xFor(i).toFixed(1)} ${yTemp(v).toFixed(1)} `;
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

  const attTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(attMax * f));
  const tempTicks = [0, 0.5, 1].map((f) => Math.round(tMin + (tMax - tMin) * f));
  const barW = Math.max(1, Math.min(6, stepX * 0.7));

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
  const hw = hoverIdx != null ? weather[hoverIdx] : null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-3">
        {ATTENDANCE_SERIES.map((s) => (
          <Chip
            key={s.key}
            on={enabled[s.key]}
            color={s.color}
            label={s.label}
            onClick={() => setEnabled((e) => ({ ...e, [s.key]: !e[s.key] }))}
          />
        ))}
        <span className="w-px h-4 bg-border-soft mx-1" />
        <Chip on={showTemp} color={TEMP_COLOR} label="Temp hi/lo °F" onClick={() => setShowTemp((v) => !v)} />
        <Chip on={showPrecip} color={RAIN_COLOR} label="Rain / snow" onClick={() => setShowPrecip((v) => !v)} />
        <Chip on={showMarkers} color="var(--good-soft-fg)" label="Holiday markers" onClick={() => setShowMarkers((v) => !v)} />
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
        style={{ width: "100%", height: "auto", display: "block", cursor: "crosshair" }}
      >
        {/* Attendance gridlines + left axis */}
        {attTicks.map((tick, i) => {
          const y = yAtt(tick);
          return (
            <g key={`a${i}`}>
              <line x1={padL} x2={width - padR} y1={y} y2={y} stroke="rgba(140,150,170,0.18)" strokeWidth={0.5} strokeDasharray="2 3" />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={10} fill="#7c879c">
                {tick.toLocaleString()}
              </text>
            </g>
          );
        })}

        {/* Right temp axis labels */}
        {showTemp &&
          tempTicks.map((t, i) => (
            <text key={`t${i}`} x={width - padR + 6} y={yTemp(t) + 3} textAnchor="start" fontSize={10} fill={TEMP_COLOR}>
              {t}°
            </text>
          ))}

        {/* Year ticks */}
        {yearTicks.map((t) => (
          <g key={`y${t.i}`}>
            <line x1={xFor(t.i)} x2={xFor(t.i)} y1={padT} y2={precipBottom} stroke="rgba(140,150,170,0.12)" strokeWidth={0.5} />
            <text x={xFor(t.i)} y={height - padB + 13} textAnchor="middle" fontSize={10} fill="#7c879c">
              {t.label}
            </text>
          </g>
        ))}

        {/* Temperature band + high line */}
        {showTemp && (
          <>
            {tempBands.map((d, i) => (
              <path key={`tb${i}`} d={d} fill={TEMP_COLOR} opacity={0.13} stroke="none" />
            ))}
            <path d={tempHighPath()} fill="none" stroke={TEMP_COLOR} strokeWidth={1.1} opacity={0.8} strokeLinejoin="round" />
          </>
        )}

        {/* Excluded weeks (snow closures, cancellations). */}
        {rows.map((r, i) =>
          isExcludingReason(r.exception_reason) ? (
            <g key={`ex${i}`} pointerEvents="none">
              <line x1={xFor(i)} x2={xFor(i)} y1={padT} y2={linesBottom} stroke="rgba(148,163,184,0.30)" strokeWidth={0.75} strokeDasharray="2 2" />
              <text x={xFor(i)} y={padT + 9} textAnchor="middle" fontSize={9} fill="#94a3b8">
                ✕
              </text>
            </g>
          ) : null,
        )}

        {/* Attendance lines */}
        {ATTENDANCE_SERIES.filter((s) => enabled[s.key]).map((s) => (
          <path key={s.key} d={attPath(s.key)} fill="none" stroke={s.color} strokeWidth={1.6} strokeLinejoin="round" />
        ))}

        {/* Precipitation strip */}
        {showPrecip && (
          <>
            <line x1={padL} x2={width - padR} y1={precipBottom} y2={precipBottom} stroke="rgba(140,150,170,0.25)" strokeWidth={0.5} />
            <text x={padL - 6} y={precipTop + 8} textAnchor="end" fontSize={9} fill="#7c879c">
              {precipMax.toFixed(1)}&quot;
            </text>
            {rows.map((_, i) => {
              const w = weather[i];
              if (!w) return null;
              const rain = w.rainIn ?? 0;
              const snow = w.snowIn ?? 0;
              if (rain <= 0 && snow <= 0) return null;
              const rH = (rain / precipMax) * precipH;
              const sH = (snow / precipMax) * precipH;
              const x = xFor(i) - barW / 2;
              return (
                <g key={`p${i}`}>
                  {rain > 0 && <rect x={x} y={precipBottom - rH} width={barW} height={rH} fill={RAIN_COLOR} opacity={0.8} />}
                  {snow > 0 && <rect x={x} y={precipBottom - rH - sH} width={barW} height={sH} fill={SNOW_COLOR} opacity={0.9} />}
                </g>
              );
            })}
          </>
        )}

        {/* Markers */}
        {showMarkers &&
          markers.map((m, i) => {
            const x = xFor(nearestIdx(m.date));
            const glyph = m.kind === "easter" ? "✝" : "✦";
            const color = m.kind === "easter" ? "var(--good-soft-fg)" : "var(--warn-soft-fg)";
            return (
              <g key={`m${i}`}>
                <line x1={x} x2={x} y1={padT} y2={linesBottom} stroke={color} strokeWidth={0.75} strokeDasharray="1 3" opacity={0.6} />
                <text x={x} y={padT + 9} textAnchor="middle" fontSize={11} fill={color}>
                  {glyph}
                </text>
              </g>
            );
          })}

        {/* Hover */}
        {hoverIdx != null && (
          <g pointerEvents="none">
            <line x1={xFor(hoverIdx)} x2={xFor(hoverIdx)} y1={padT} y2={precipBottom} stroke="rgba(168,178,198,0.5)" strokeWidth={1} />
            {ATTENDANCE_SERIES.filter((s) => enabled[s.key]).map((s) => {
              const v = hr?.[s.key];
              if (v == null) return null;
              return <circle key={s.key} cx={xFor(hoverIdx)} cy={yAtt(v)} r={3.5} fill={s.color} stroke="var(--bg)" strokeWidth={1.5} />;
            })}
            {showTemp && hw?.tmaxF != null && (
              <circle cx={xFor(hoverIdx)} cy={yTemp(hw.tmaxF)} r={3} fill={TEMP_COLOR} stroke="var(--bg)" strokeWidth={1.5} />
            )}
            {showTemp && hw?.tminF != null && (
              <circle cx={xFor(hoverIdx)} cy={yTemp(hw.tminF)} r={3} fill={TEMP_COLOR} stroke="var(--bg)" strokeWidth={1.5} opacity={0.6} />
            )}
          </g>
        )}
      </svg>

      <div className="min-h-[44px] mt-2">
        {hr ? (
          <div className="text-xs flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium">{formatWeekDate(hr.week_date)}</span>
            {hr.exception_reason && (
              <span
                className={
                  isExcludingReason(hr.exception_reason)
                    ? "text-warn-soft-fg"
                    : "text-subtle"
                }
              >
                {isExcludingReason(hr.exception_reason) ? "Excluded" : "Note"}:{" "}
                {hr.exception_reason}
              </span>
            )}
            {ATTENDANCE_SERIES.filter((s) => enabled[s.key]).map((s) => (
              <span key={s.key} className="text-muted">
                <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: s.color }} />
                {s.label}: <span className="text-fg tnum">{hr[s.key] == null ? "—" : hr[s.key]!.toLocaleString()}</span>
              </span>
            ))}
            <span className="text-muted">
              <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: TEMP_COLOR }} />
              Temp: <span className="text-fg tnum">{hw?.tmaxF == null ? "—" : `${Math.round(hw.tmaxF)}°`} / {hw?.tminF == null ? "—" : `${Math.round(hw.tminF)}°`}</span>
            </span>
            <span className="text-muted">
              <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: RAIN_COLOR }} />
              Rain: <span className="text-fg tnum">{hw?.rainIn == null ? "—" : `${hw.rainIn.toFixed(2)}"`}</span>
            </span>
            <span className="text-muted">
              <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: SNOW_COLOR }} />
              Snow: <span className="text-fg tnum">{hw?.snowIn == null ? "—" : `${hw.snowIn.toFixed(1)}"`}</span>
            </span>
          </div>
        ) : (
          <p className="text-xs text-subtle">
            Hover for the week&apos;s attendance and Trexlertown weather. Shaded band = daily high/low; bottom bars = rain (blue) &amp; snow (white).
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
