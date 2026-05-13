import type { ReactNode } from "react";

/** A simple shared chart palette. Picks a stable accent + 5 distinct hues
 *  rotating around the wheel — keeps adjacent slices/bars distinguishable
 *  without leaning on hard-to-read greens-on-greens. */
const PALETTE = [
  "var(--accent)",
  "var(--good-soft-fg)",
  "var(--warn-soft-fg)",
  "var(--bad-soft-fg)",
  "var(--lane-comm, #7c3aed)",
  "var(--lane-care, #f59e0b)",
  "var(--muted)",
];

export interface ChartDatum {
  label: string;
  count: number;
}

interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

/** Lightweight chart wrapper — keeps the look consistent across pages. */
export function ChartCard({ title, subtitle, children }: ChartCardProps) {
  return (
    <div className="rounded-xl border border-border-soft bg-bg-elev p-4">
      <div className="mb-2">
        <div className="text-sm font-semibold">{title}</div>
        {subtitle && (
          <div className="text-xs text-muted mt-0.5">{subtitle}</div>
        )}
      </div>
      {children}
    </div>
  );
}

// ─── Pie (donut) ───────────────────────────────────────────────────────

/** Donut chart with up to `maxSlices`-1 named segments plus a rolled-up
 *  "Other" segment. Renders 180px square SVG + an inline legend. */
export function PieChart({
  data,
  maxSlices = 6,
}: {
  data: ChartDatum[];
  maxSlices?: number;
}) {
  const total = data.reduce((s, d) => s + d.count, 0);
  if (total === 0) {
    return (
      <div className="text-xs text-muted py-6 text-center">No data</div>
    );
  }
  const sorted = [...data].sort((a, b) => b.count - a.count);
  const visible = sorted.slice(0, maxSlices - 1);
  const restCount = sorted
    .slice(maxSlices - 1)
    .reduce((s, d) => s + d.count, 0);
  const slices = restCount > 0 ? [...visible, { label: "Other", count: restCount }] : visible;

  // SVG params
  const size = 180;
  const r = 70;
  const cx = size / 2;
  const cy = size / 2;
  const innerR = 42;

  let angle = -Math.PI / 2;
  const paths: Array<{ d: string; color: string; label: string; pct: number }> = [];
  slices.forEach((slice, i) => {
    const pct = slice.count / total;
    const sweep = pct * Math.PI * 2;
    const next = angle + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const x1 = cx + Math.cos(angle) * r;
    const y1 = cy + Math.sin(angle) * r;
    const x2 = cx + Math.cos(next) * r;
    const y2 = cy + Math.sin(next) * r;
    const xi1 = cx + Math.cos(angle) * innerR;
    const yi1 = cy + Math.sin(angle) * innerR;
    const xi2 = cx + Math.cos(next) * innerR;
    const yi2 = cy + Math.sin(next) * innerR;
    paths.push({
      d: `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${innerR} ${innerR} 0 ${large} 0 ${xi1} ${yi1} Z`,
      color: PALETTE[i % PALETTE.length],
      label: slice.label,
      pct,
    });
    angle = next;
  });

  return (
    <div className="flex items-center gap-4">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label="Pie chart"
        className="shrink-0"
      >
        {paths.map((p, i) => (
          <path key={i} d={p.d} fill={p.color} stroke="var(--bg-elev)" strokeWidth="1.5" />
        ))}
        <text
          x={cx}
          y={cy + 2}
          textAnchor="middle"
          fontSize="14"
          fontWeight="600"
          fill="var(--fg)"
        >
          {total.toLocaleString()}
        </text>
        <text
          x={cx}
          y={cy + 16}
          textAnchor="middle"
          fontSize="9"
          fill="var(--muted)"
        >
          total
        </text>
      </svg>
      <ul className="space-y-1 text-xs min-w-0 flex-1">
        {slices.map((s, i) => {
          const pct = (s.count / total) * 100;
          return (
            <li key={s.label} className="flex items-center gap-2 min-w-0">
              <span
                className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ background: PALETTE[i % PALETTE.length] }}
              />
              <span className="truncate text-fg min-w-0 flex-1">{s.label}</span>
              <span className="tnum text-muted shrink-0">
                {s.count.toLocaleString()}{" "}
                <span className="text-subtle">({Math.round(pct)}%)</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Bar (vertical) ────────────────────────────────────────────────────

/** Simple vertical bar chart for small categorical data (e.g. gender). */
export function BarChart({ data }: { data: ChartDatum[] }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  if (total === 0) {
    return <div className="text-xs text-muted py-6 text-center">No data</div>;
  }
  const max = Math.max(...data.map((d) => d.count));
  const height = 140;
  return (
    <div className="flex items-end justify-around gap-3 h-[180px] pb-1">
      {data.map((d, i) => {
        const barH = max > 0 ? (d.count / max) * height : 0;
        const pct = total > 0 ? (d.count / total) * 100 : 0;
        return (
          <div
            key={d.label}
            className="flex flex-col items-center gap-1 flex-1 min-w-0"
          >
            <div className="text-xs tnum font-medium text-fg">
              {d.count.toLocaleString()}
            </div>
            <div className="text-[10px] text-subtle">
              {Math.round(pct)}%
            </div>
            <div
              className="w-full max-w-[60px] rounded-t transition-all"
              style={{
                height: `${barH}px`,
                background: PALETTE[i % PALETTE.length],
              }}
              role="presentation"
            />
            <div className="text-xs text-muted text-center truncate w-full">
              {d.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Distribution curve (smooth area) ─────────────────────────────────

/** Smooth area chart — quadratic Bezier through bucket midpoints. Used
 *  for the age distribution. Unknown bucket is rendered separately as a
 *  small note rather than skewing the curve. */
export function DistributionCurve({ data }: { data: ChartDatum[] }) {
  const known = data.filter((d) => d.label !== "Unknown");
  const unknown = data.find((d) => d.label === "Unknown")?.count ?? 0;
  const total = known.reduce((s, d) => s + d.count, 0);
  if (total === 0) {
    return <div className="text-xs text-muted py-6 text-center">No data</div>;
  }

  const width = 380;
  const height = 140;
  const padX = 24;
  const padY = 10;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const max = Math.max(...known.map((d) => d.count));

  const points = known.map((d, i) => {
    const x = padX + (i / (known.length - 1)) * innerW;
    const y = padY + innerH - (d.count / max) * innerH;
    return { x, y, d };
  });

  // Smooth path using quadratic Beziers through midpoints.
  let path = `M ${points[0].x} ${padY + innerH}`;
  path += ` L ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const mx = (p0.x + p1.x) / 2;
    const my = (p0.y + p1.y) / 2;
    path += ` Q ${p0.x} ${p0.y}, ${mx} ${my}`;
  }
  path += ` L ${points[points.length - 1].x} ${points[points.length - 1].y}`;
  path += ` L ${points[points.length - 1].x} ${padY + innerH} Z`;

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        role="img"
        aria-label="Distribution curve"
      >
        <path d={path} fill="var(--accent)" fillOpacity="0.18" stroke="var(--accent)" strokeWidth="2" />
        {points.map((p) => (
          <circle key={p.d.label} cx={p.x} cy={p.y} r="2.5" fill="var(--accent)" />
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-subtle tnum mt-1">
        {known.map((d) => (
          <span key={d.label}>{d.label}</span>
        ))}
      </div>
      {unknown > 0 && (
        <div className="text-[10px] text-subtle mt-1">
          {unknown.toLocaleString()} unknown (no birthdate on file)
        </div>
      )}
    </div>
  );
}
