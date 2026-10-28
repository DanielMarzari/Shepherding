import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { requireOrg } from "@/lib/auth";
import {
  DEFAULT_BANDWIDTH,
  getAssignCapacity,
  getAssignShepherds,
} from "@/lib/shepherd-assign";
import { BandwidthTable } from "../assign/bandwidth-table";

/** Setting bandwidth, on its own page.
 *
 *  It lives apart from the assignment page because it is a different act:
 *  deciding what each shepherd has agreed to carry is a conversation with
 *  them, done once and revisited, not something you do in the middle of
 *  placing 4,000 people. The assignment page reads these numbers; this is
 *  where they are set.
 */
export default async function BandwidthPage() {
  const session = await requireOrg();
  const shepherds = getAssignShepherds(session.orgId);
  const cap = getAssignCapacity(session.orgId);
  const isAdmin = session.role === "admin";

  if (shepherds.length === 0) {
    return (
      <AppShell active="Bandwidth" breadcrumb="Shepherd team › Bandwidth">
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

  // Not knownAdults minus the team total: that nets one shepherd's
  // overload against another's free places. See freeRoom in
  // shepherd-assign for why the two are kept apart.
  const short = cap.uncovered;

  return (
    <AppShell active="Bandwidth" breadcrumb="Shepherd team › Bandwidth">
      <div className="px-5 md:px-7 py-7 space-y-5">
        <div>
          <div className="text-[10px] uppercase tracking-[.11em] text-subtle">
            Shepherd team
          </div>
          <h1 className="text-2xl font-semibold tracking-tight mt-1">
            Bandwidth
          </h1>
          <p className="text-muted text-sm mt-1.5 max-w-2xl leading-relaxed">
            How many people each shepherd is responsible for getting
            connected. Not how many they can befriend &mdash; there is no cap,
            and one role may carry 40 while another carries 400. Everyone
            starts at {DEFAULT_BANDWIDTH} until somebody says otherwise;
            clearing a box returns them to it.{" "}
            <Link
              href="/shepherd-team"
              className="text-accent hover:underline"
            >
              Set who they oversee &rarr;
            </Link>{" "}
            <Link
              href="/shepherd-team/assign"
              className="text-accent hover:underline"
            >
              Back to assignment &rarr;
            </Link>
          </p>
        </div>

        <div className="rounded-lg border border-border-soft bg-bg-elev p-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat n={cap.knownAdults} label="Known adults to cover" />
            <Stat
              n={cap.totalBandwidth}
              label={
                cap.bandwidthsSet === cap.shepherds
                  ? `team total, all ${cap.shepherds} set`
                  : `team total · ${cap.shepherds - cap.bandwidthsSet} of ${cap.shepherds} still on ${DEFAULT_BANDWIDTH}`
              }
            />
            <Stat
              n={cap.freeRoom}
              label="free places across the team"
              tone={cap.freeRoom > 0 ? "good" : undefined}
            />
            <Stat
              n={short}
              label={short > 0 ? "nobody has room for them" : "nobody uncovered"}
              tone={short > 0 ? "warn" : "good"}
            />
          </div>
          <p className="text-xs text-subtle mt-3.5 leading-relaxed">
            {short > 0 ? (
              <>
                Even using every free place, the team does not reach
                everyone in Known. An average of{" "}
                <strong className="text-fg tnum">{cap.neededAverage}</strong>{" "}
                each would cover it &mdash; but the honest answer may be that
                the team needs more people on it, not larger numbers on the
                same people.
              </>
            ) : (
              <>
                The team&rsquo;s bandwidth covers everyone in Known.
              </>
            )}
          </p>
        </div>

        <BandwidthTable shepherds={shepherds} isAdmin={isAdmin} alwaysEditing />
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
          tone === "warn"
            ? "text-warn-soft-fg"
            : tone === "good"
              ? "text-accent"
              : ""
        }`}
      >
        {n.toLocaleString()}
      </div>
      <div className="text-[11px] text-subtle leading-snug">{label}</div>
    </div>
  );
}
