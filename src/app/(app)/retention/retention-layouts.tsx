"use client";

import { useState } from "react";
import type { RetentionYear, MonthCell } from "@/lib/retention-read";

const MONTH_FULL = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Retention by join year, with each year's 12-month sub-cohorts as a
 *  mini bar graph. Toggle between a compact "Rows" list and a
 *  "Cards" small-multiples grid. */
export function RetentionLayouts({ years }: { years: RetentionYear[] }) {
  const [layout, setLayout] = useState<"rows" | "cards">("rows");

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-1.5">
          {(["rows", "cards"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLayout(l)}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${
                layout === l
                  ? "border-accent bg-bg-elev-2 text-fg"
                  : "border-border-soft text-muted hover:text-fg"
              }`}
            >
              {l === "rows" ? "Rows" : "Cards"}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-subtle">
          bars = each month&apos;s retention · striped = ongoing
        </span>
      </div>

      {layout === "rows" ? (
        <div className="divide-y divide-border-softer">
          {years.map((y) => (
            <YearRow key={y.year} y={y} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {years.map((y) => (
            <YearCard key={y.year} y={y} />
          ))}
        </div>
      )}
    </div>
  );
}

function YearRow({ y }: { y: RetentionYear }) {
  return (
    <div className="flex items-center gap-4 py-3 hover:bg-bg-elev-2/40 transition-colors px-1 rounded">
      <span className="tnum text-sm font-semibold w-12 shrink-0">{y.year}</span>
      <span
        className={`tnum text-sm font-semibold w-16 shrink-0 ${
          y.pending ? "text-subtle" : ""
        }`}
      >
        {y.pending ? "ongoing" : `${y.pct}%`}
      </span>
      <div className="flex-1 min-w-0">
        <MiniBars months={y.months} height={28} />
      </div>
      <span className="tnum text-xs text-muted w-24 text-right shrink-0">
        {y.joined.toLocaleString()} joined
      </span>
    </div>
  );
}

function YearCard({ y }: { y: RetentionYear }) {
  return (
    <div className="rounded-xl border border-border-soft bg-bg-elev-2/40 p-4 hover:border-accent/50 transition-colors">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <span className="text-sm font-semibold tnum">{y.year}</span>
        <span
          className={`tnum text-sm font-semibold ${
            y.pending ? "text-subtle" : "text-accent"
          }`}
        >
          {y.pending ? "ongoing" : `${y.pct}%`}
        </span>
      </div>
      <MiniBars months={y.months} height={48} />
      <div className="text-[11px] text-muted mt-2 tnum">
        {y.joined.toLocaleString()} joined
        {!y.pending && (
          <span className="text-subtle">
            {" "}
            · {y.retained.toLocaleString()} active
          </span>
        )}
      </div>
    </div>
  );
}

/** 12 mini bars (Jan..Dec), height = that month's retention %. Striped
 *  for ongoing months, faint for months with no joins. Native title for
 *  the hover tooltip. */
function MiniBars({ months, height }: { months: MonthCell[]; height: number }) {
  const W = 168;
  const H = height;
  const gap = 2;
  const barW = (W - gap * 11) / 12;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      preserveAspectRatio="none"
      role="img"
      aria-label="Monthly retention"
    >
      <defs>
        <pattern
          id="ret-mini-pending"
          patternUnits="userSpaceOnUse"
          width="4"
          height="4"
          patternTransform="rotate(45)"
        >
          <rect width="4" height="4" fill="var(--bg-elev-2)" />
          <line x1="0" y1="0" x2="0" y2="4" stroke="var(--muted)" strokeWidth="1.5" opacity="0.55" />
        </pattern>
      </defs>
      {/* baseline */}
      <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} stroke="rgba(140,150,170,0.2)" strokeWidth={0.5} />
      {months.map((m, i) => {
        const x = i * (barW + gap);
        const label = `${MONTH_FULL[i]}: ${
          !m.hasData
            ? "no joins"
            : m.pending
              ? `ongoing (${m.joined} joined)`
              : `${m.pct}% retained (${m.retained}/${m.joined})`
        }`;
        if (!m.hasData) {
          return (
            <g key={i}>
              <rect x={x} y={H - 2} width={barW} height={2} fill="rgba(140,150,170,0.25)" />
              <title>{label}</title>
            </g>
          );
        }
        if (m.pending) {
          return (
            <g key={i}>
              <rect x={x} y={2} width={barW} height={H - 2} fill="url(#ret-mini-pending)" opacity={0.7} />
              <title>{label}</title>
            </g>
          );
        }
        const h = Math.max(1, ((m.pct / 100) * (H - 2)));
        return (
          <g key={i}>
            <rect x={x} y={H - h} width={barW} height={h} fill="var(--accent)" opacity={0.85} rx={0.5} />
            <title>{label}</title>
          </g>
        );
      })}
    </svg>
  );
}
