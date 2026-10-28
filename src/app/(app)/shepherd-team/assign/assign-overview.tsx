import Link from "next/link";
import {
  DEFAULT_BANDWIDTH,
  type AssignBuckets,
  type AssignCapacity,
} from "@/lib/shepherd-assign";
import { BulkAssignButton } from "./bulk-button";

/** The top of the assignment page: what the team can carry, and what is
 *  left to decide.
 *
 *  Pulled out of the page so the two versions of the coverage table below
 *  it — one that links out to a shepherd's own page, one that expands in
 *  place — are compared against an identical header rather than against
 *  two copies of this that have quietly drifted apart.
 */
export function CapacityCard({ cap }: { cap: AssignCapacity }) {
  // The bar measures the people, not the bandwidth: everyone in Known,
  // split into those somebody already has, those a free place could take
  // today, and those nobody on the team has room for.
  const scale = Math.max(cap.knownAdults, 1);
  const pct = (n: number) => `${((n / scale) * 100).toFixed(1)}%`;
  // Free places are only worth showing up to the number of people left to
  // place — room beyond that is not coverage of anybody.
  const placeable = Math.min(cap.freeRoom, cap.unassigned);

  return (
    <div className="rounded-lg border border-border-soft bg-bg-elev p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold">Capacity</h2>
        <span className="text-xs text-subtle max-w-xl text-right">
          Bandwidth is how many people you are responsible for getting
          connected — not how many you can befriend. Everyone starts at{" "}
          {DEFAULT_BANDWIDTH}; set it per shepherd, there is no cap.
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat n={cap.knownAdults} label="Known adults" />
        <Stat n={cap.unassigned} label="nobody assigned to them yet" />
        <Stat
          n={cap.freeRoom}
          label="free places to assign into"
          tone={cap.freeRoom > 0 ? "good" : undefined}
        />
        <Stat
          n={cap.uncovered}
          label={
            cap.uncovered > 0
              ? "nobody has room for them"
              : "everyone can be covered"
          }
          tone={cap.uncovered > 0 ? "warn" : "good"}
        />
      </div>

      <div
        className="flex h-7 rounded-md overflow-hidden border border-border-soft"
        role="img"
        aria-label={`Of ${cap.knownAdults} known adults: ${cap.assigned} assigned to a shepherd, ${placeable} could be assigned into a free place today, ${cap.uncovered} nobody has room for`}
      >
        <Seg
          w={pct(cap.assigned)}
          bg="var(--accent)"
          fg="var(--accent-fg)"
          n={cap.assigned}
        />
        {placeable > 0 && (
          <div
            style={{ width: pct(placeable) }}
            className="bg-bg-elev-2 text-muted text-[11px] font-semibold flex items-center justify-center tnum"
          >
            {placeable.toLocaleString()} room for
          </div>
        )}
        {cap.uncovered > 0 && (
          <div
            style={{ width: pct(cap.uncovered), background: "var(--bad-soft-fg)" }}
            className="text-[11px] font-bold flex items-center justify-center tnum text-bg"
          >
            {cap.uncovered.toLocaleString()} no room
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-4 mt-2 text-[11px] items-center">
        <Key bg="var(--accent)" label="assigned to a shepherd" />
        <Key bg="var(--bg-elev-2)" label="a free place could take them today" />
        {cap.uncovered > 0 && (
          <Key bg="var(--bad-soft-fg)" label="nobody on the team has room" />
        )}
        <span className="ml-auto text-muted">
          {cap.uncovered > 0 ? (
            <>
              An average bandwidth of{" "}
              <strong className="tnum">{cap.neededAverage}</strong> would cover
              everyone.
            </>
          ) : (
            <>The team has room for everyone in Known.</>
          )}
        </span>
      </div>

      <p className="text-xs text-subtle mt-3 leading-relaxed max-w-3xl">
        Being assigned is not being shepherded. Everyone counted here is
        Known, which means nobody is caring for them yet; an assignment is
        somebody taking responsibility for getting them into a group or onto
        a team, where they will be. They stop being Known when that lands,
        not when the assignment is made.
      </p>

      {cap.shepherdsOver > 0 && (
        <p className="text-xs text-subtle mt-3 leading-relaxed max-w-3xl">
          Separately,{" "}
          <strong className="text-fg tnum">{cap.shepherdsOver}</strong>{" "}
          {cap.shepherdsOver === 1 ? "shepherd carries" : "shepherds carry"}{" "}
          more than their own bandwidth &mdash;{" "}
          <strong className="text-fg tnum">
            {cap.overCommitted.toLocaleString()}
          </strong>{" "}
          people above it in total. That is a question about how those
          ministries are structured, and it does not reduce what the rest of
          the team can take on: the free places above are already counted per
          shepherd, so nobody&rsquo;s overload cancels out anybody
          else&rsquo;s room.
        </p>
      )}
    </div>
  );
}

export function WhatNeedsDeciding({
  buckets,
  isAdmin,
}: {
  buckets: AssignBuckets;
  isAdmin: boolean;
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold mb-2.5">What needs deciding</h2>
      <div className="space-y-2.5">
        <Step
          i={1}
          n={buckets.uncontested}
          title="Claimed by exactly one shepherd"
          sub="Nobody else named them. One button and they are done."
          tone="good"
        >
          <BulkAssignButton count={buckets.uncontested} isAdmin={isAdmin} />
        </Step>
        <Step
          i={2}
          n={buckets.contested}
          title="Contested"
          sub="Two or more shepherds named the same person."
          tone="warn"
        >
          <Link
            href="/shepherd-team/assign/contested"
            className="shrink-0 px-3 py-1.5 rounded border border-border-soft text-xs hover:bg-bg-elev-2"
          >
            Start deciding
          </Link>
        </Step>
        <Step
          i={3}
          n={buckets.pool}
          title="Nobody has named"
          sub="Assign one at a time, or let the whole lot go at once."
        >
          <Link
            href="/shepherd-team/assign/pool"
            className="shrink-0 px-3 py-1.5 rounded border border-border-soft text-xs hover:bg-bg-elev-2"
          >
            Open the pool
          </Link>
        </Step>
      </div>
    </div>
  );
}

export function NoTeamYet() {
  return (
    <div className="rounded-lg border border-border-soft bg-bg-elev px-5 py-12 text-center">
      <h1 className="text-lg font-semibold">No shepherd team yet</h1>
      <p className="text-sm text-muted mt-2 max-w-md mx-auto leading-relaxed">
        This page reads the{" "}
        <span className="mono text-fg">REFERENCE - Shepherd Team</span> list
        from Planning Center. Create it there and run a sync, and everyone on
        it appears here.
      </p>
    </div>
  );
}

function Stat({
  n,
  label,
  tone,
}: {
  n: number;
  label: string;
  tone?: "good" | "warn";
}) {
  return (
    <div>
      <div
        className={`text-2xl font-semibold tnum ${
          tone === "warn" ? "text-warn-soft-fg" : tone === "good" ? "text-accent" : ""
        }`}
      >
        {n.toLocaleString()}
      </div>
      <div className="text-[11px] text-subtle">{label}</div>
    </div>
  );
}

function Seg({ w, bg, fg, n }: { w: string; bg: string; fg: string; n: number }) {
  if (n === 0) return null;
  return (
    <div
      style={{ width: w, background: bg, color: fg }}
      className="text-[10px] font-bold flex items-center justify-center tnum overflow-hidden"
    >
      {n.toLocaleString()}
    </div>
  );
}

function Key({ bg, label }: { bg: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-subtle">
      <span
        aria-hidden="true"
        className="w-2.5 h-2.5 rounded-sm border border-border-soft"
        style={{ background: bg }}
      />
      {label}
    </span>
  );
}

function Step({
  i,
  n,
  title,
  sub,
  tone,
  children,
}: {
  i: number;
  n: number;
  title: string;
  sub: string;
  tone?: "good" | "warn";
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border-soft bg-bg-elev p-4 flex items-center gap-5">
      <div className="w-9 h-9 rounded-full bg-bg-elev-2 flex items-center justify-center text-sm font-semibold shrink-0">
        {i}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2.5">
          <span
            className={`text-2xl font-semibold tnum ${
              tone === "good"
                ? "text-accent"
                : tone === "warn"
                  ? "text-warn-soft-fg"
                  : ""
            }`}
          >
            {n.toLocaleString()}
          </span>
          <span className="text-[13px] font-medium">{title}</span>
        </div>
        <p className="text-xs text-subtle mt-0.5">{sub}</p>
      </div>
      {children}
    </div>
  );
}
