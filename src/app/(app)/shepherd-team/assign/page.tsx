import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { requireOrg } from "@/lib/auth";
import {
  DEFAULT_BANDWIDTH,
  getAssignBuckets,
  getAssignCapacity,
  getAssignShepherds,
} from "@/lib/shepherd-assign";
import { BulkAssignButton } from "./bulk-button";
import { BandwidthTable } from "./bandwidth-table";

/** The assignment page.
 *
 *  Everyone in Known should be somebody's responsibility. Capacity sits at
 *  the top because on real data it is the binding constraint, not a
 *  footnote: 4,556 people across 25 shepherds is 182 each, and whether that
 *  is reasonable is a question only the church can answer — which is why
 *  bandwidth is set here rather than assumed.
 */
export default async function AssignPage() {
  const session = await requireOrg();
  const cap = getAssignCapacity(session.orgId);
  const buckets = getAssignBuckets(session.orgId);
  const shepherds = getAssignShepherds(session.orgId);
  const isAdmin = session.role === "admin";

  if (cap.shepherds === 0) {
    return (
      <AppShell active="Assignment" breadcrumb="Shepherd team › Assignment">
        <div className="px-5 md:px-7 py-7">
          <div className="rounded-lg border border-border-soft bg-bg-elev px-5 py-12 text-center">
            <h1 className="text-lg font-semibold">No shepherd team yet</h1>
            <p className="text-sm text-muted mt-2 max-w-md mx-auto leading-relaxed">
              This page reads the{" "}
              <span className="mono text-fg">REFERENCE - Shepherd Team</span>{" "}
              list from Planning Center. Create it there and run a sync, and
              everyone on it appears here.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  // Bar segments are a share of whichever is larger: what the team has
  // agreed to carry, or what there is to carry. Scaling to the bandwidth
  // alone would hide the overflow, which is the one thing worth seeing.
  const scale = Math.max(cap.totalBandwidth, cap.knownAdults, 1);
  const pct = (n: number) => `${((n / scale) * 100).toFixed(1)}%`;
  const unused = Math.max(
    0,
    cap.totalBandwidth - cap.byRole - cap.assigned,
  );

  return (
    <AppShell active="Assignment" breadcrumb="Shepherd team › Assignment">
      <div className="px-5 md:px-7 py-7 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[.11em] text-subtle">
              Shepherd team
            </div>
            <h1 className="text-2xl font-semibold tracking-tight mt-1">
              Assignment
            </h1>
            <p className="text-muted text-sm mt-1.5 max-w-2xl leading-relaxed">
              Everyone who is{" "}
              <strong className="text-fg">Known</strong>{" "}
              should be assigned to someone on the shepherd team.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/shepherd-team"
              className="shrink-0 px-3.5 py-2 rounded border border-border-soft text-[13px] hover:bg-bg-elev-2"
            >
              Set who they oversee &rarr;
            </Link>
            <Link
              href="/shepherd-team/bandwidth"
              className="shrink-0 px-3.5 py-2 rounded border border-border-soft text-[13px] hover:bg-bg-elev-2"
            >
              Set bandwidths &rarr;
            </Link>
          </div>
        </div>

        {/* Capacity */}
        <div className="rounded-lg border border-border-soft bg-bg-elev p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
            <h2 className="text-sm font-semibold">Capacity</h2>
            <span className="text-xs text-subtle max-w-xl text-right">
              Bandwidth is how many people you are responsible for getting
              connected — not how many you can befriend. Everyone starts at
              {" "}{DEFAULT_BANDWIDTH}; set it per shepherd, there is no cap.
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Stat n={cap.knownAdults} label="Known adults" />
            <Stat n={cap.shepherds} label="shepherds" />
            <Stat n={cap.evenSplit} label="each, split evenly" />
            <Stat
              n={cap.totalBandwidth}
              label={
                cap.bandwidthsSet === cap.shepherds
                  ? "team bandwidth as set"
                  : `team bandwidth · ${cap.shepherds - cap.bandwidthsSet} on the default`
              }
              tone={cap.beyond > 0 ? "warn" : "good"}
            />
          </div>

          <div
            className="flex h-7 rounded-md overflow-hidden border border-border-soft"
            role="img"
            aria-label={`${cap.byRole} by role, ${cap.assigned} assigned, ${unused} unused bandwidth, ${cap.beyond} beyond the team's bandwidth`}
          >
            <Seg w={pct(cap.byRole)} bg="var(--accent)" fg="var(--accent-fg)" n={cap.byRole} />
            <Seg w={pct(cap.assigned)} bg="color-mix(in srgb, var(--accent) 45%, transparent)" fg="var(--fg)" n={cap.assigned} />
            {unused > 0 && (
              <div
                style={{ width: pct(unused) }}
                className="bg-bg-elev-2 text-muted text-[11px] font-semibold flex items-center justify-center tnum"
              >
                {unused.toLocaleString()} unused
              </div>
            )}
            {cap.beyond > 0 && (
              <div
                style={{ width: pct(cap.beyond), background: "var(--bad-soft-fg)" }}
                className="text-[11px] font-bold flex items-center justify-center tnum text-bg"
              >
                {cap.beyond.toLocaleString()} beyond
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-4 mt-2 text-[11px] items-center">
            <Key bg="var(--accent)" label="by role" />
            <Key bg="color-mix(in srgb, var(--accent) 45%, transparent)" label="assigned" />
            <Key bg="var(--bg-elev-2)" label="unused" />
            {cap.beyond > 0 && (
              <Key bg="var(--bad-soft-fg)" label="beyond what the team has agreed to carry" />
            )}
            <span className="ml-auto text-muted">
              {cap.beyond > 0 ? (
                <>
                  Raise the average to{" "}
                  <strong className="tnum">{cap.neededAverage}</strong> and the
                  team covers everyone.
                </>
              ) : (
                <>The team&rsquo;s bandwidth covers everyone in Known.</>
              )}
            </span>
          </div>
        </div>

        {/* What needs deciding */}
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

        {/* Coverage by shepherd */}
        <BandwidthTable shepherds={shepherds} isAdmin={isAdmin} />
      </div>
    </AppShell>
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
