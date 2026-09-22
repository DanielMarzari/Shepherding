"use client";

import { useState } from "react";
import type { GivingWeek } from "@/lib/giving-impact";

// ---------------------------------------------------------------------------
// Weekly giving activity, with the three kinds of gift kept apart and the
// Sundays we said something marked underneath.
//
// COLOUR IS NEVER THE ONLY CUE. Every line carries a dash pattern and a label
// printed at its own right-hand end, and every marker carries a shape as well
// as a hue, so the chart reads without relying on telling two colours apart.
// The palette is blue against amber for the same reason — never a red/green
// or a blue/purple pair.
//
// The y axis is a COUNT OF GIFTS. There is no amount in the data and there is
// no amount on this chart.
// ---------------------------------------------------------------------------

const W = 940;
const H = 320;
const PAD_L = 42;
const PAD_R = 118; // room for the end-of-line labels
const PAD_T = 16;
const PAD_B = 54; // axis labels + the two marker rails

interface LineDef {
  key: keyof GivingWeek;
  label: string;
  color: string;
  dash?: string;
  width: number;
}

const LINES: LineDef[] = [
  { key: "respondingGifts", label: "Responding gifts", color: "var(--lane-wors)", width: 2.1 },
  {
    key: "respondingGivers",
    label: "Responding givers",
    color: "var(--lane-wors)",
    dash: "5 3",
    width: 1.2,
  },
  { key: "recurringGifts", label: "Recurring (control)", color: "var(--fg-muted)", width: 1.6 },
  {
    key: "batchGifts",
    label: "Batch Entry (lags)",
    color: "var(--lane-give)",
    dash: "1.5 3",
    width: 1.8,
  },
];

function shortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function GivingWeeksChart({ weeks }: { weeks: GivingWeek[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (weeks.length < 2) {
    return <div className="text-xs text-muted py-8 text-center">Not enough weeks to draw a trend.</div>;
  }

  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const stepX = innerW / (weeks.length - 1);
  const maxY = Math.max(
    1,
    ...weeks.flatMap((w) => LINES.map((l) => w[l.key] as number)),
  );
  const yTop = Math.ceil(maxY / 50) * 50;

  const xFor = (i: number) => PAD_L + i * stepX;
  const yFor = (v: number) => PAD_T + innerH - (v / yTop) * innerH;
  const path = (key: keyof GivingWeek) =>
    weeks.map((w, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(1)} ${yFor(w[key] as number).toFixed(1)}`).join(" ");

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yTop * f));
  const brewIdx = weeks.findIndex((w) => w.brewBreak);
  const hovered = hover == null ? null : weeks[hover];

  // Month boundaries for the x axis — one label per month beats 38 dates.
  const monthTicks: Array<{ i: number; label: string }> = [];
  let lastMonth = "";
  weeks.forEach((w, i) => {
    const m = w.sunday.slice(0, 7);
    if (m !== lastMonth) {
      lastMonth = m;
      monthTicks.push({
        i,
        label: new Date(w.sunday + "T00:00:00Z").toLocaleDateString("en-US", {
          month: "short",
          timeZone: "UTC",
        }),
      });
    }
  });

  const railSermon = PAD_T + innerH + 14;
  const railPlan = PAD_T + innerH + 24;

  // END-OF-LINE LABELS, PUSHED APART.
  //
  // Each label sits at the y of its line's last drawn week, and two lines can
  // land on the same value — responding gifts and responding givers coincide
  // in any week where no one gave twice, which is what the final part-week of
  // the loaded export does (95 and 95). Those two are also the only pair that
  // share a colour, so their labels ARE the cue that tells them apart: printed
  // on top of each other they leave a 2.1px solid and a 1.2px dashed line in
  // one hue and nothing else to read. So the labels are laid out in y order
  // with a minimum gap, and lifted back inside the plot if the stack runs off
  // the bottom. Only the label moves; the line is untouched.
  const LABEL_GAP = 11;
  const labelYs: number[] = (() => {
    const last = weeks[weeks.length - 1];
    const placed = LINES.map((l, i) => ({ i, y: yFor(last[l.key] as number) + 3 })).sort(
      (a, b) => a.y - b.y,
    );
    for (let k = 1; k < placed.length; k++) {
      const gap = placed[k].y - placed[k - 1].y;
      if (gap < LABEL_GAP) placed[k].y = placed[k - 1].y + LABEL_GAP;
    }
    const overflow = placed[placed.length - 1].y - (PAD_T + innerH);
    if (overflow > 0) for (const p of placed) p.y -= overflow;
    const out = new Array<number>(LINES.length).fill(0);
    for (const p of placed) out[p.i] = p.y;
    return out;
  })();

  function move(e: React.MouseEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    if (vx < PAD_L - 8 || vx > W - PAD_R + 8) {
      setHover(null);
      return;
    }
    setHover(Math.max(0, Math.min(weeks.length - 1, Math.round((vx - PAD_L) / stepX))));
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="Gifts per week by source, with the Sundays we spoke about giving marked"
        onMouseMove={move}
        onMouseLeave={() => setHover(null)}
        style={{ cursor: "crosshair", display: "block" }}
      >
        {/* partial weeks — drawn, but excluded from every comparison */}
        {weeks.map((w, i) =>
          w.complete ? null : (
            <rect
              key={`p-${w.sunday}`}
              x={xFor(i) - stepX / 2}
              y={PAD_T}
              width={stepX}
              height={innerH}
              fill="var(--fg-muted)"
              opacity={0.09}
            />
          ),
        )}

        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={yFor(t)}
              y2={yFor(t)}
              stroke="var(--border-soft)"
              strokeDasharray="2 3"
              strokeWidth={0.6}
            />
            <text x={PAD_L - 6} y={yFor(t) + 3} textAnchor="end" fontSize={9} fill="var(--fg-subtle)">
              {t}
            </text>
          </g>
        ))}

        {monthTicks.map((m) => (
          <text
            key={m.i}
            x={xFor(m.i)}
            y={PAD_T + innerH + 40}
            textAnchor="middle"
            fontSize={9}
            fill="var(--fg-subtle)"
          >
            {m.label}
          </text>
        ))}

        {/* Brew Break — a rule the eye finds without the legend */}
        {brewIdx >= 0 && (
          <g>
            <line
              x1={xFor(brewIdx)}
              x2={xFor(brewIdx)}
              y1={PAD_T}
              y2={PAD_T + innerH}
              stroke="var(--lane-give)"
              strokeWidth={1.6}
            />
            <text
              x={xFor(brewIdx) - 5}
              y={PAD_T + 10}
              textAnchor="end"
              fontSize={9.5}
              fill="var(--lane-give)"
              fontWeight={600}
            >
              Brew Break
            </text>
          </g>
        )}

        {hovered && (
          <line
            x1={xFor(hover!)}
            x2={xFor(hover!)}
            y1={PAD_T}
            y2={PAD_T + innerH}
            stroke="var(--fg-muted)"
            strokeWidth={0.8}
            strokeDasharray="3 3"
          />
        )}

        {LINES.map((l, i) => (
          <g key={l.key as string}>
            <path
              d={path(l.key)}
              fill="none"
              stroke={l.color}
              strokeWidth={l.width}
              strokeDasharray={l.dash}
              strokeLinejoin="round"
            />
            <text x={W - PAD_R + 6} y={labelYs[i]} fontSize={9} fill={l.color} fontWeight={600}>
              {l.label}
            </text>
          </g>
        ))}

        {hovered &&
          LINES.map((l) => (
            <circle
              key={`h-${l.key as string}`}
              cx={xFor(hover!)}
              cy={yFor(hovered[l.key] as number)}
              r={3}
              fill={l.color}
            />
          ))}

        {/* marker rails: a filled triangle for a sermon that asked, a hollow
            tick for a giving item in the order of service */}
        {weeks.map((w, i) =>
          w.sermonCalledGiving ? (
            <polygon
              key={`s-${w.sunday}`}
              points={`${xFor(i)},${railSermon - 5} ${xFor(i) - 4},${railSermon + 2} ${xFor(i) + 4},${railSermon + 2}`}
              fill="var(--lane-wors)"
            />
          ) : null,
        )}
        {weeks.map((w, i) =>
          w.planHadGivingItem ? (
            <line
              key={`g-${w.sunday}`}
              x1={xFor(i)}
              x2={xFor(i)}
              y1={railPlan - 3}
              y2={railPlan + 3}
              stroke="var(--fg-muted)"
              strokeWidth={1.4}
            />
          ) : null,
        )}
        <text x={W - PAD_R + 6} y={railSermon + 3} fontSize={8.5} fill="var(--lane-wors)">
          ▲ sermon asked
        </text>
        <text x={W - PAD_R + 6} y={railPlan + 3} fontSize={8.5} fill="var(--fg-muted)">
          | giving in plan
        </text>
      </svg>

      <div className="min-h-[34px] mt-1 text-xs">
        {hovered ? (
          <span className="text-muted">
            <span className="text-fg font-medium">{shortDate(hovered.sunday)}</span> week ·{" "}
            <span className="text-fg tnum">{hovered.respondingGifts}</span> responding gifts from{" "}
            <span className="text-fg tnum">{hovered.respondingGivers}</span> givers ·{" "}
            <span className="tnum">{hovered.recurringGifts}</span> recurring ·{" "}
            <span className="tnum">{hovered.batchGifts}</span> Batch Entry ·{" "}
            <span className="tnum">{hovered.totalGifts}</span> gifts in all
            {!hovered.complete && <span className="text-warn-soft-fg"> · part-week, left out of every norm</span>}
            {hovered.processingGifts > 0 && (
              <span> · {hovered.processingGifts} still clearing</span>
            )}
            {hovered.sermonCalledGiving && <span className="text-accent-soft-fg"> · sermon asked</span>}
            {hovered.brewBreak && <span className="text-warn-soft-fg"> · Brew Break in the plan</span>}
          </span>
        ) : (
          <span className="text-subtle">
            Hover any week. Counts of gifts and givers — the export carries no amounts, so nothing here is money.
          </span>
        )}
      </div>
    </div>
  );
}
