"use client";

import { useMemo, useState } from "react";
import { formatWeekDate } from "@/lib/format-date";

export interface WeatherPoint {
  date: string;
  att: number | null;
  tmaxF: number | null;
  precipIn: number | null;
}
export interface ChartMarker {
  date: string;
  kind: "easter" | "christmas";
  label: string;
}
export interface ChartBand {
  startDate: string;
  endDate: string;
  kind: "post-easter" | "summer";
  label: string;
}

const TEMP_COLOR = "var(--lane-care, #f59e0b)";
const ATT_COLOR = "var(--accent)";
const BAND_FILL: Record<ChartBand["kind"], string> = {
  "post-easter": "rgba(245,158,11,0.10)",
  summer: "rgba(56,138,210,0.10)",
};

/** Sunday in-person attendance (left axis) lined up against the daily
 *  high temperature in Trexlertown, PA (right axis), with seasonal
 *  markers (Easter ✝, Christmas ✦) and shaded bands (post-Easter lull,
 *  summer). Hover snaps to the nearest Sunday. */
export function AttendanceWeatherChart({
  points,
  markers,
  bands,
  baseline,
}: {
  points: WeatherPoint[];
  markers: ChartMarker[];
  bands: ChartBand[];
  baseline: number | null;
}) {
  const [showTemp, setShowTemp] = useState(true);
  const [showBands, setShowBands] = useState(true);
  const [showMarkers, setShowMarkers] = useState(true);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const idxByDate = useMemo(() => {
    const m = new Map<string, number>();
    points.forEach((p, i) => m.set(p.date, i));
    return m;
  }, [points]);

  function nearestIdx(date: string): number {
    const exact = idxByDate.get(date);
    if (exact != null) return exact;
    let best = 0;
    for (let i = 0; i < points.length; i++) {
      if (points[i].date <= date) best = i;
      else break;
    }
    return best;
  }

  const attMax = useMemo(() => {
    let m = 0;
    for (const p of points) if (p.att != null && p.att > m) m = p.att;
    return Math.max(1, m);
  }, [points]);

  const [tMin, tMax] = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of points) {
      if (p.tmaxF == null) continue;
      if (p.tmaxF < lo) lo = p.tmaxF;
      if (p.tmaxF > hi) hi = p.tmaxF;
    }
    if (!Number.isFinite(lo)) return [0, 100];
    return [Math.floor(lo - 5), Math.ceil(hi + 5)];
  }, [points]);

  const width = 1000;
  const height = 320;
  const padL = 48;
  const padR = 44;
  const padT = 14;
  const padB = 32;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const stepX = points.length > 1 ? innerW / (points.length - 1) : innerW;

  const xFor = (i: number) => padL + i * stepX;
  const yAtt = (v: number) => padT + innerH - (v / attMax) * innerH;
  const yTemp = (t: number) =>
    padT + innerH - ((t - tMin) / Math.max(1, tMax - tMin)) * innerH;

  function pathFor(get: (p: WeatherPoint) => number | null, y: (v: number) => number) {
    let d = "";
    let pen = false;
    for (let i = 0; i < points.length; i++) {
      const v = get(points[i]);
      if (v == null) {
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
  points.forEach((p, i) => {
    const y = p.date.slice(0, 4);
    if (y !== lastYear) {
      yearTicks.push({ i, label: y });
      lastYear = y;
    }
  });

  const attTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(attMax * f));
  const tempTicks = [0, 0.5, 1].map((f) => Math.round(tMin + (tMax - tMin) * f));

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * width;
    if (vx < padL - 6 || vx > width - padR + 6 || points.length === 0) {
      setHoverIdx(null);
      return;
    }
    setHoverIdx(
      Math.max(0, Math.min(points.length - 1, Math.round((vx - padL) / stepX))),
    );
  }

  const hp = hoverIdx != null ? points[hoverIdx] : null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-3">
        <Toggle on color={ATT_COLOR} label="In-person attendance" onClick={() => {}} locked />
        <Toggle
          on={showTemp}
          color={TEMP_COLOR}
          label="High temp °F"
          onClick={() => setShowTemp((v) => !v)}
        />
        <Toggle
          on={showBands}
          color="rgba(245,158,11,0.5)"
          label="Seasonal bands"
          onClick={() => setShowBands((v) => !v)}
        />
        <Toggle
          on={showMarkers}
          color="var(--good-soft-fg)"
          label="Holiday markers"
          onClick={() => setShowMarkers((v) => !v)}
        />
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
        style={{ cursor: "crosshair" }}
      >
        {/* Bands */}
        {showBands &&
          bands.map((b, i) => {
            const x1 = xFor(nearestIdx(b.startDate));
            const x2 = xFor(nearestIdx(b.endDate));
            if (x2 <= x1) return null;
            return (
              <rect
                key={`b${i}`}
                x={x1}
                y={padT}
                width={x2 - x1}
                height={innerH}
                fill={BAND_FILL[b.kind]}
              />
            );
          })}

        {/* Attendance gridlines + left axis */}
        {attTicks.map((tick, i) => {
          const y = yAtt(tick);
          return (
            <g key={`a${i}`}>
              <line
                x1={padL}
                x2={width - padR}
                y1={y}
                y2={y}
                stroke="rgba(140,150,170,0.18)"
                strokeWidth={0.5}
                strokeDasharray="2 3"
              />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={10} fill="#7c879c">
                {tick.toLocaleString()}
              </text>
            </g>
          );
        })}

        {/* Right temp axis labels */}
        {showTemp &&
          tempTicks.map((t, i) => (
            <text
              key={`t${i}`}
              x={width - padR + 6}
              y={yTemp(t) + 3}
              textAnchor="start"
              fontSize={10}
              fill={TEMP_COLOR}
            >
              {t}°
            </text>
          ))}

        {/* Year ticks */}
        {yearTicks.map((t) => (
          <g key={`y${t.i}`}>
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

        {/* Baseline */}
        {baseline != null && (
          <line
            x1={padL}
            x2={width - padR}
            y1={yAtt(baseline)}
            y2={yAtt(baseline)}
            stroke="rgba(168,178,198,0.5)"
            strokeWidth={1}
            strokeDasharray="5 4"
          />
        )}

        {/* Temp line */}
        {showTemp && (
          <path
            d={pathFor((p) => p.tmaxF, yTemp)}
            fill="none"
            stroke={TEMP_COLOR}
            strokeWidth={1.25}
            strokeLinejoin="round"
            opacity={0.85}
          />
        )}

        {/* Attendance line */}
        <path
          d={pathFor((p) => p.att, yAtt)}
          fill="none"
          stroke={ATT_COLOR}
          strokeWidth={1.75}
          strokeLinejoin="round"
        />

        {/* Markers */}
        {showMarkers &&
          markers.map((m, i) => {
            const x = xFor(nearestIdx(m.date));
            const glyph = m.kind === "easter" ? "✝" : "✦";
            const color = m.kind === "easter" ? "var(--good-soft-fg)" : "var(--warn-soft-fg)";
            return (
              <g key={`m${i}`}>
                <line
                  x1={x}
                  x2={x}
                  y1={padT}
                  y2={padT + innerH}
                  stroke={color}
                  strokeWidth={0.75}
                  strokeDasharray="1 3"
                  opacity={0.6}
                />
                <text x={x} y={padT + 9} textAnchor="middle" fontSize={11} fill={color}>
                  {glyph}
                </text>
              </g>
            );
          })}

        {/* Hover */}
        {hoverIdx != null && hp && (
          <g pointerEvents="none">
            <line
              x1={xFor(hoverIdx)}
              x2={xFor(hoverIdx)}
              y1={padT}
              y2={padT + innerH}
              stroke="rgba(168,178,198,0.5)"
              strokeWidth={1}
            />
            {hp.att != null && (
              <circle cx={xFor(hoverIdx)} cy={yAtt(hp.att)} r={3.5} fill={ATT_COLOR} stroke="var(--bg)" strokeWidth={1.5} />
            )}
            {showTemp && hp.tmaxF != null && (
              <circle cx={xFor(hoverIdx)} cy={yTemp(hp.tmaxF)} r={3} fill={TEMP_COLOR} stroke="var(--bg)" strokeWidth={1.5} />
            )}
          </g>
        )}
      </svg>

      <div className="min-h-[44px] mt-2">
        {hp ? (
          <div className="text-xs">
            <span className="font-medium">{formatWeekDate(hp.date)}</span>
            <span className="text-muted ml-3">
              <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: ATT_COLOR }} />
              In-person:{" "}
              <span className="text-fg tnum">{hp.att == null ? "—" : hp.att.toLocaleString()}</span>
            </span>
            <span className="text-muted ml-3">
              <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: TEMP_COLOR }} />
              High:{" "}
              <span className="text-fg tnum">{hp.tmaxF == null ? "—" : `${Math.round(hp.tmaxF)}°F`}</span>
            </span>
            <span className="text-muted ml-3">
              Precip:{" "}
              <span className="text-fg tnum">{hp.precipIn == null ? "—" : `${hp.precipIn.toFixed(2)}in`}</span>
            </span>
          </div>
        ) : (
          <p className="text-xs text-subtle">
            Hover for the week&apos;s attendance and Trexlertown weather. ✝ Easter · ✦ Christmas.
          </p>
        )}
      </div>
    </div>
  );
}

function Toggle({
  on,
  color,
  label,
  onClick,
  locked,
}: {
  on: boolean;
  color: string;
  label: string;
  onClick: () => void;
  locked?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={locked ? undefined : onClick}
      className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
        locked ? "cursor-default" : "cursor-pointer"
      } ${on ? "border-border-soft text-fg bg-bg-elev-2" : "border-border-softer text-muted hover:text-fg"}`}
    >
      <span
        className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
        style={{ background: color, opacity: on ? 1 : 0.4 }}
      />
      {label}
    </button>
  );
}
