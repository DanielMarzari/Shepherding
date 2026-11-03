"use client";

import { useState } from "react";
import type { MembershipAudit, TenureStats } from "@/lib/membership-audit-shared";

/** The two pictures above the lanes strip. Both are read-only, like the
 *  strip: the dropdowns below are the filters, and a chart that also
 *  narrowed the table would do it while you were only trying to read it.
 *  Both describe the whole roster, as the strip does. */

const fmtYears = (y: number) => `${y.toFixed(1)} yr`;

/** Members by the quarter they were last seen, ten years back to now. One
 *  hue — it is one series — and every quarter gets a column, empty or not,
 *  so the axis is time and a gap reads as a gap. */
export function ActivityTimeline({ timeline }: { timeline: MembershipAudit["timeline"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...timeline.bins.map((b) => b.count));
  const h = hover === null ? null : timeline.bins[hover];

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <div className="text-[10px] uppercase tracking-wider text-subtle">
          Last activity, by quarter
        </div>
        <div className="text-[11px] text-subtle tnum">
          {timeline.earlier > 0 && <>Before {timeline.bins[0]?.year}: {timeline.earlier.toLocaleString()} · </>}
          Never: {timeline.never.toLocaleString()}
        </div>
      </div>
      <div
        className="relative"
        role="img"
        aria-label={`Members by the quarter of their last activity. ${timeline.bins
          .filter((b) => b.count > 0)
          .map((b) => `${b.label}: ${b.count}`)
          .join("; ")}. Earlier: ${timeline.earlier}. Never: ${timeline.never}.`}
        onMouseLeave={() => setHover(null)}
      >
        {h && hover !== null && (
          <div
            className="absolute -top-1 z-10 pointer-events-none rounded-md border border-border-soft bg-bg-elev px-2.5 py-1.5 shadow-lg text-[11px] whitespace-nowrap"
            style={{
              left: `${((hover + 0.5) / timeline.bins.length) * 100}%`,
              transform: `translate(${hover > timeline.bins.length * 0.8 ? "-100%" : hover < timeline.bins.length * 0.2 ? "0" : "-50%"}, -100%)`,
            }}
          >
            <div className="text-muted">{h.label}</div>
            <div className="font-semibold tnum text-fg">
              {h.count.toLocaleString()} {h.count === 1 ? "member" : "members"}
            </div>
          </div>
        )}
        <div className="flex items-end gap-[2px] h-20 border-b border-border-soft">
          {timeline.bins.map((b, i) => (
            // The column is the hit target, full height — bigger than a
            // short bar, so a quarter with three people is still easy to
            // hover.
            <div
              key={`${b.year}-${b.quarter}`}
              className="flex-1 h-full flex items-end cursor-default"
              onMouseEnter={() => setHover(i)}
            >
              <div
                className={`w-full rounded-t-[3px] transition-opacity ${
                  hover !== null && hover !== i ? "opacity-45" : ""
                } ${b.count === 0 ? "" : "bg-accent"}`}
                style={{ height: b.count === 0 ? 0 : `max(2px, ${(b.count / max) * 100}%)` }}
              />
            </div>
          ))}
        </div>
        <div className="flex gap-[2px] mt-1">
          {timeline.bins.map((b) => (
            <div key={`${b.year}-${b.quarter}`} className="flex-1 relative h-3.5">
              {b.quarter === 0 && (
                // Every other year on a phone: ten labels do not fit in
                // 350px, and half of them still place the axis.
                <span
                  className={`absolute left-0 text-[10px] text-subtle tnum whitespace-nowrap ${
                    b.year % 2 === 1 ? "hidden sm:inline" : ""
                  }`}
                >
                  {b.year}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** One box for everybody: years from their Original Membership Date to
 *  their last activity. Horizontal, so the axis reads as years left to
 *  right like the timeline above it. */
export function TenureBox({
  tenure,
  missingDate,
  neverActive,
}: {
  tenure: TenureStats | null;
  missingDate: number;
  neverActive: number;
}) {
  const [hover, setHover] = useState<"box" | number | null>(null);

  if (!tenure) {
    return (
      <div>
        <div className="text-[10px] uppercase tracking-wider text-subtle mb-1.5">
          Membership date to last activity
        </div>
        <p className="text-xs text-muted leading-relaxed">
          Waiting on PCO&rsquo;s <strong className="text-fg">Original Membership Date</strong>.
          It is synced from the next PCO sync on; until then nobody has a date to
          measure from.
        </p>
      </div>
    );
  }

  const lo = Math.min(0, Math.floor(tenure.min));
  const hi = Math.max(1, Math.ceil(tenure.max));
  const span = hi - lo;
  const step = span <= 8 ? 1 : span <= 20 ? 5 : 10;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);
  const x = (v: number) => `${((v - lo) / span) * 100}%`;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <div className="text-[10px] uppercase tracking-wider text-subtle">
          Membership date to last activity
        </div>
        <div className="text-[11px] text-subtle tnum">
          median <strong className="text-fg">{fmtYears(tenure.median)}</strong>
        </div>
      </div>
      <div
        className="relative h-20"
        role="img"
        aria-label={`Years from membership date to last activity, ${tenure.n} members: lowest ${fmtYears(tenure.min)}, first quartile ${fmtYears(tenure.q1)}, median ${fmtYears(tenure.median)}, third quartile ${fmtYears(tenure.q3)}, highest ${fmtYears(tenure.max)}.`}
        onMouseLeave={() => setHover(null)}
      >
        {/* gridlines at each tick, recessive */}
        {ticks.map((t) => (
          <div
            key={t}
            className="absolute top-0 bottom-0 w-px bg-border-softer"
            style={{ left: x(t) }}
          />
        ))}
        {/* whiskers */}
        <div
          className="absolute top-1/2 h-px bg-muted"
          style={{ left: x(tenure.lo), width: `calc(${x(tenure.q1)} - ${x(tenure.lo)})` }}
        />
        <div
          className="absolute top-1/2 h-px bg-muted"
          style={{ left: x(tenure.q3), width: `calc(${x(tenure.hi)} - ${x(tenure.q3)})` }}
        />
        {[tenure.lo, tenure.hi].map((v, i) => (
          <div
            key={i}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-px h-4 bg-muted"
            style={{ left: x(v) }}
          />
        ))}
        {/* the box: the middle half, with the median across it */}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-9 rounded border border-accent bg-accent-soft-bg cursor-default"
          style={{ left: x(tenure.q1), width: `calc(${x(tenure.q3)} - ${x(tenure.q1)})` }}
          onMouseEnter={() => setHover("box")}
        >
          <div
            className="absolute top-0 bottom-0 w-[2px] bg-accent -translate-x-1/2"
            style={{ left: `${((tenure.median - tenure.q1) / Math.max(1e-9, tenure.q3 - tenure.q1)) * 100}%` }}
          />
        </div>
        {/* outliers, each its own dot, ringed in the surface so a cluster
            stays countable */}
        {tenure.outliers.map((v, i) => (
          <div
            key={i}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-accent ring-2 ring-bg-elev cursor-default"
            style={{ left: x(v) }}
            onMouseEnter={() => setHover(i)}
          />
        ))}
        {hover !== null && (
          <div
            className="absolute -top-1 z-10 pointer-events-none rounded-md border border-border-soft bg-bg-elev px-2.5 py-1.5 shadow-lg text-[11px] whitespace-nowrap"
            style={{
              left: hover === "box" ? x(tenure.median) : x(tenure.outliers[hover]),
              transform: "translate(-50%, -100%)",
            }}
          >
            {hover === "box" ? (
              <div className="grid grid-cols-[auto_auto] gap-x-3 tnum">
                <span className="text-muted">Whiskers</span>
                <span className="text-fg text-right">
                  {fmtYears(tenure.lo)} – {fmtYears(tenure.hi)}
                </span>
                <span className="text-muted">Middle half</span>
                <span className="text-fg text-right">
                  {fmtYears(tenure.q1)} – {fmtYears(tenure.q3)}
                </span>
                <span className="text-muted">Median</span>
                <span className="text-fg font-semibold text-right">{fmtYears(tenure.median)}</span>
              </div>
            ) : (
              <span className="tnum text-fg">
                Outlier · {fmtYears(tenure.outliers[hover])}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="relative h-3.5 mt-1">
        {ticks.map((t, i) => (
          // The end labels sit inside the plot rather than centred over
          // its edge, where the last one was clipped onto a second line.
          <span
            key={t}
            className={`absolute text-[10px] text-subtle tnum whitespace-nowrap ${
              i === 0 && t === lo
                ? ""
                : i === ticks.length - 1 && t === hi
                  ? "-translate-x-full"
                  : "-translate-x-1/2"
            }`}
            style={{ left: x(t) }}
          >
            {t} yr
          </span>
        ))}
      </div>
      <p className="text-[11px] text-subtle mt-2 tnum">
        {tenure.n.toLocaleString()} members with both dates
        {missingDate > 0 && <> · {missingDate.toLocaleString()} have no membership date</>}
        {neverActive > 0 && <> · {neverActive.toLocaleString()} never active</>}
      </p>
    </div>
  );
}
