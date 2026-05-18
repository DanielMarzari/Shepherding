import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Avatar, Card, CardHeader, LaneTag, Pill } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getSyncSettings } from "@/lib/pco";
import {
  type FlockMember,
  getShepherdDetail,
} from "@/lib/shepherds-read";

export default async function ShepherdDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireOrg();
  const settings = getSyncSettings(session.orgId);
  const { id } = await params;
  const shepherd = getShepherdDetail(
    session.orgId,
    id,
    settings.activityTrackingMonths,
  );
  if (!shepherd) notFound();

  const roleLabels: string[] = [];
  if (shepherd.groupsLed.length > 0) roleLabels.push("Group leader");
  if (shepherd.teamsLed.length > 0) roleLabels.push("Team leader");

  // Capacity heuristic: 12 is the default Care load before we'd warn.
  const capacity = 12;
  const overCapacity = shepherd.flockSize > capacity;
  const firstGroupName = shepherd.groupsLed[0]?.name;
  const firstTeamName = shepherd.teamsLed[0]?.name;
  const recentActivity =
    shepherd.groupsLed.reduce((s, g) => s + g.recentlyAttended, 0) +
    shepherd.teamsLed.reduce((s, t) => s + t.recentlyServed, 0);

  return (
    <AppShell active="Shepherds" breadcrumb={`Shepherds › ${shepherd.fullName}`}>
      <div className="px-5 md:px-7 py-7">
        {/* Header — name + role + facts + actions */}
        <div className="flex items-start justify-between mb-7 flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full grid place-items-center text-lg font-semibold text-white bg-gradient-to-br from-violet-500 to-pink-500">
              {shepherd.initials}
            </div>
            <div>
              <div className="text-muted text-xs mb-0.5">
                {roleLabels.length > 0 ? roleLabels.join(" · ") : "Shepherd"}
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {shepherd.fullName}
              </h1>
              <div className="flex items-center gap-3 mt-1.5 text-xs flex-wrap">
                {overCapacity && (
                  <Pill tone="warn">
                    Over capacity · {shepherd.flockSize}/{capacity}
                  </Pill>
                )}
                {firstGroupName && (
                  <span className="text-muted">• {firstGroupName} lead</span>
                )}
                {firstTeamName && (
                  <span className="text-muted">• {firstTeamName} team</span>
                )}
                <span className="text-subtle">
                  • Reports to <span className="italic">—</span>
                </span>
                <span className="text-subtle">
                  • Last contact median <span className="italic">—</span>
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <button
              className="px-2.5 py-1.5 rounded border border-border-soft text-muted cursor-not-allowed"
              disabled
              title="Coming soon"
            >
              Compose check-in
            </button>
            <button
              className="px-2.5 py-1.5 rounded border border-border-soft text-muted cursor-not-allowed"
              disabled
              title="Coming soon"
            >
              Suggest handoffs
            </button>
            <Link
              href={`/people/${shepherd.personId}`}
              className="px-2.5 py-1.5 rounded bg-accent text-[var(--accent-fg)] font-medium"
            >
              Open person profile
            </Link>
          </div>
        </div>

        {/* Stat strip — 6 cards. Real where we have it; em-dash placeholder otherwise. */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          <MiniStat
            label="Currently shepherding"
            value={shepherd.flockSize}
            sub={`of ${capacity} suggested capacity`}
            valueClass={overCapacity ? "text-warn-soft-fg" : ""}
          />
          <MiniStat label="Shepherded by" value="—" sub="hierarchy not synced yet" />
          <MiniStat
            label="In care · at risk"
            value="—"
            sub="risk model not wired up"
          />
          <MiniStat
            label="Avg time-to-touch"
            value="—"
            sub="touch tracking not wired up"
          />
          <MiniStat label="Handoffs · 90d" value="—" sub="handoff log not wired up" />
          <MiniStat
            label="Recent activity"
            value={recentActivity}
            sub={`${settings.activityTrackingMonths}mo · attends + serves`}
            valueClass="text-good-soft-fg"
          />
        </div>

        {/* Upward chain — placeholder until shepherd hierarchy is modelled. */}
        <Card className="p-5 mb-5">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-semibold">
              ↑ Who shepherds {shepherd.fullName.split(" ")[0]}
            </h2>
            <span className="text-xs text-subtle italic">
              hierarchy not synced yet
            </span>
          </div>
          <div className="flex items-stretch gap-3 flex-wrap lg:flex-nowrap">
            <div className="rounded border border-dashed border-border-soft p-4 flex-1 min-w-[200px] opacity-60">
              <div className="flex items-center gap-3">
                <Avatar initials="??" size="md" />
                <div>
                  <div className="font-medium text-muted">Primary shepherd</div>
                  <div className="text-xs text-subtle">tbd</div>
                </div>
              </div>
              <div className="text-xs text-subtle mt-3">
                Will be inferred from a future PCO list or manual mapping.
              </div>
            </div>
            <div className="hidden lg:grid place-items-center px-1">
              <svg width="20" height="20" viewBox="0 0 20 20" className="text-muted">
                <path
                  d="M5 5 L15 10 L5 15"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
            </div>
            <div className="rounded border-2 border-accent/40 bg-accent-soft-bg p-4 flex-1 min-w-[200px]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full grid place-items-center text-sm font-semibold text-white bg-gradient-to-br from-violet-500 to-pink-500">
                  {shepherd.initials}
                </div>
                <div>
                  <div className="font-medium">
                    {shepherd.fullName}{" "}
                    <span className="text-xs text-accent">(focus)</span>
                  </div>
                  <div className="text-xs text-muted">
                    {roleLabels.join(" · ") || "Shepherd"}
                  </div>
                </div>
              </div>
              <div className="text-xs text-muted mt-3">
                {shepherd.flockSize} people in their care
              </div>
              <div className="text-xs text-accent mt-1 font-medium">
                Active shepherd
              </div>
            </div>
          </div>
        </Card>

        {/* Downward flock — real */}
        <Card className="mb-5">
          <CardHeader
            title={`↓ Who ${shepherd.fullName.split(" ")[0]} shepherds`}
            right={
              <div className="flex items-center gap-3 text-xs text-muted flex-wrap">
                <span>{shepherd.flockSize} people</span>
                <span className="hidden md:inline text-subtle italic">
                  • sort + risk markers coming
                </span>
              </div>
            }
          />
          {shepherd.flock.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted">
              No one on their rosters yet.
            </div>
          ) : (
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {shepherd.flock.map((p) => (
                <FlockCard key={p.personId} person={p} />
              ))}
            </div>
          )}
        </Card>

        {/* Co-shepherded list + handoff history — both placeholders until
            we model shepherd↔shepherd relationships. */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
          <Card className="xl:col-span-7 p-5">
            <h2 className="text-sm font-semibold mb-1">
              People {shepherd.fullName.split(" ")[0]} co-shepherds
            </h2>
            <p className="text-xs text-muted mb-4">
              Flock members on rosters that have more than one leader.
              Co-shepherd identities aren&apos;t modelled yet, so we show the
              shared roster instead.
            </p>
            {(() => {
              const co = shepherd.flock.filter((p) => p.hasCoShepherd);
              if (co.length === 0) {
                return (
                  <div className="text-xs text-subtle italic py-4">
                    No co-shepherded people detected on these rosters.
                  </div>
                );
              }
              return (
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted">
                    <tr className="border-b border-border-soft">
                      <th className="text-left font-medium py-2">Person</th>
                      <th className="text-left font-medium py-2">Co-shepherd</th>
                      <th className="text-left font-medium py-2">
                        Shared roster
                      </th>
                      <th className="text-right font-medium py-2 tnum">
                        Since
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {co.slice(0, 8).map((p) => (
                      <tr
                        key={p.personId}
                        className="border-b border-border-softer"
                      >
                        <td className="py-2.5">{p.fullName}</td>
                        <td className="py-2.5 text-subtle italic">tbd</td>
                        <td className="py-2.5 text-muted">
                          {p.context ?? "—"}
                        </td>
                        <td className="py-2.5 text-right tnum text-subtle">—</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
          </Card>

          <Card className="xl:col-span-5 p-5">
            <h2 className="text-sm font-semibold mb-1">
              Handoff history · {shepherd.fullName.split(" ")[0]}
            </h2>
            <p className="text-xs text-muted mb-4">
              When they gave or received care of someone.
            </p>
            <ul className="space-y-3 text-sm text-subtle italic">
              <li>handoff log not wired up yet</li>
            </ul>
            <button
              className="mt-4 text-xs text-subtle italic cursor-not-allowed"
              disabled
            >
              Suggest reassignments to lower load →
            </button>
          </Card>
        </div>

        {/* Real-data rosters table — kept from prior version so admins can
            see exact group/team activity numbers. */}
        {(shepherd.groupsLed.length > 0 || shepherd.teamsLed.length > 0) && (
          <div className="mt-5 grid grid-cols-1 xl:grid-cols-2 gap-3">
            {shepherd.groupsLed.length > 0 && (
              <Card>
                <div className="px-5 py-3 border-b border-border-soft">
                  <h2 className="text-sm font-semibold">Groups they lead</h2>
                </div>
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted">
                    <tr className="border-b border-border-soft">
                      <th className="text-left font-medium px-5 py-2">Group</th>
                      <th className="text-right font-medium px-5 py-2">
                        Members
                      </th>
                      <th className="text-right font-medium px-5 py-2">
                        Co-leaders
                      </th>
                      <th className="text-right font-medium px-5 py-2">
                        Attended ({settings.activityTrackingMonths}mo)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shepherd.groupsLed.map((g) => (
                      <tr
                        key={g.id}
                        className="border-b border-border-softer hover:bg-bg-elev-2/60"
                      >
                        <td className="px-5 py-3 font-medium">
                          {g.name ?? `Group #${g.id}`}
                        </td>
                        <td className="px-5 py-3 text-right tnum">{g.members}</td>
                        <td className="px-5 py-3 text-right tnum text-muted">
                          {Math.max(0, g.leaders - 1)}
                        </td>
                        <td className="px-5 py-3 text-right tnum text-good-soft-fg">
                          {g.recentlyAttended}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
            {shepherd.teamsLed.length > 0 && (
              <Card>
                <div className="px-5 py-3 border-b border-border-soft">
                  <h2 className="text-sm font-semibold">Teams they lead</h2>
                </div>
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted">
                    <tr className="border-b border-border-soft">
                      <th className="text-left font-medium px-5 py-2">Team</th>
                      <th className="text-right font-medium px-5 py-2">
                        Members
                      </th>
                      <th className="text-right font-medium px-5 py-2">
                        Co-leaders
                      </th>
                      <th className="text-right font-medium px-5 py-2">
                        Served ({settings.activityTrackingMonths}mo)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shepherd.teamsLed.map((t) => (
                      <tr
                        key={t.id}
                        className="border-b border-border-softer hover:bg-bg-elev-2/60"
                      >
                        <td className="px-5 py-3 font-medium">
                          {t.name ?? `Team #${t.id}`}
                        </td>
                        <td className="px-5 py-3 text-right tnum">{t.members}</td>
                        <td className="px-5 py-3 text-right tnum text-muted">
                          {Math.max(0, t.leaders - 1)}
                        </td>
                        <td className="px-5 py-3 text-right tnum text-good-soft-fg">
                          {t.recentlyServed}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function MiniStat({
  label,
  value,
  sub,
  valueClass = "",
}: {
  label: string;
  value: string | number;
  sub: string;
  valueClass?: string;
}) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted mb-1">{label}</div>
      <div className={`tnum text-2xl font-semibold ${valueClass}`}>{value}</div>
      <div className="text-xs text-muted mt-0.5">{sub}</div>
    </Card>
  );
}

function FlockCard({ person }: { person: FlockMember }) {
  return (
    <Link
      href={`/people/${person.personId}`}
      className={`block rounded border border-border-soft p-3 hover:border-accent transition-colors ${
        person.isMinor ? "opacity-70" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Avatar initials={person.initials} size="sm" />
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{person.fullName}</div>
            <div className="text-xs text-muted truncate">
              {person.context ?? (person.hasCoShepherd ? "+1 co-shepherd" : "solo")}
            </div>
          </div>
        </div>
        <Pill tone="muted">{person.isMinor ? "MINOR" : "ADULT"}</Pill>
      </div>
      <div className="text-xs text-subtle mt-2.5 italic">
        Last seen · risk · — (not wired)
      </div>
      <div className="flex gap-1 mt-2 flex-wrap">
        {person.lanes.map((l) => (
          <LaneTag key={l} laneKey={l} short />
        ))}
      </div>
    </Link>
  );
}
