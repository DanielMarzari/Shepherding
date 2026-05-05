import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-[10px] bg-bg-elev border border-border-soft overflow-hidden ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  badge,
  right,
  className = "",
}: {
  title: ReactNode;
  badge?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`px-5 pt-4 pb-3 border-b border-border-soft flex items-center justify-between ${className}`}
    >
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {badge}
      </div>
      {right}
    </div>
  );
}

export function Stat({
  label,
  value,
  delta,
  valueTone = "default",
  highlight,
}: {
  label: string;
  value: string | number;
  delta?: string;
  valueTone?: "accent" | "warn" | "good" | "bad" | "default";
  highlight?: boolean;
}) {
  const valueClass =
    valueTone === "accent"
      ? "text-accent"
      : valueTone === "warn"
        ? "text-warn-soft-fg"
        : valueTone === "good"
          ? "text-good-soft-fg"
          : valueTone === "bad"
            ? "text-bad-soft-fg"
            : "";
  return (
    <div
      className={`rounded-[10px] bg-bg-elev border p-4 ${
        highlight ? "ring-1 ring-accent border-accent/30" : "border-border-soft"
      }`}
    >
      <div className="text-xs text-muted mb-1.5">{label}</div>
      <div className={`tnum text-2xl font-semibold ${valueClass}`}>{value}</div>
      {delta ? <div className="text-xs text-muted mt-1">{delta}</div> : null}
    </div>
  );
}

export function Pill({
  children,
  tone = "muted",
  className = "",
}: {
  children: ReactNode;
  tone?: "muted" | "accent" | "warn" | "good" | "bad";
  className?: string;
}) {
  const cls =
    tone === "accent"
      ? "bg-accent-soft-bg text-accent-soft-fg"
      : tone === "warn"
        ? "bg-warn-soft-bg text-warn-soft-fg"
        : tone === "good"
          ? "bg-good-soft-bg text-good-soft-fg"
          : tone === "bad"
            ? "bg-bad-soft-bg text-bad-soft-fg"
            : "bg-bg-elev-2 text-muted";
  return (
    <span
      className={`text-xs px-1.5 py-0.5 rounded font-medium ${cls} ${className}`}
    >
      {children}
    </span>
  );
}

export function LaneTag({
  laneKey,
  short = false,
}: {
  laneKey: "give" | "wors" | "outr" | "comm" | "serv";
  short?: boolean;
}) {
  const labels = {
    give: short ? "G" : "Giving",
    wors: short ? "W" : "Worship",
    outr: short ? "O" : "Outreach",
    comm: short ? "C" : "Community",
    serv: short ? "S" : "Serve",
  };
  const bgVar = `var(--lane-${laneKey}-bg)`;
  const fgVar = `var(--lane-${laneKey})`;
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${short ? "" : "uppercase tracking-wide"}`}
      style={{ background: bgVar, color: fgVar }}
    >
      {labels[laneKey]}
    </span>
  );
}

export function Avatar({
  initials,
  size = "md",
}: {
  initials: string;
  size?: "sm" | "md" | "lg";
}) {
  const dim =
    size === "sm" ? "w-8 h-8 text-xs" : size === "lg" ? "w-14 h-14 text-lg" : "w-10 h-10 text-sm";
  return (
    <div
      className={`${dim} rounded-full bg-bg-elev-2 grid place-items-center font-medium shrink-0`}
    >
      {initials}
    </div>
  );
}
