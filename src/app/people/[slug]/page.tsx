import { AppShell } from "@/components/AppShell";
import { Avatar, Card, CardHeader, LaneTag, Pill } from "@/components/ui";
import {
  PEOPLE_PROFILES,
  PEOPLE_PROFILE_SLUGS,
  type LaneKey,
  type PersonProfile,
} from "@/lib/mock";
import Link from "next/link";
import { notFound } from "next/navigation";

export function generateStaticParams() {
  return PEOPLE_PROFILE_SLUGS.map((slug) => ({ slug }));
}

export default async function PersonProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const person = PEOPLE_PROFILES[slug];
  if (!person) notFound();

  return (
    <AppShell active="People" breadcrumb={`People › ${person.name}`}>
      <div className="px-5 md:px-7 py-7">
        {/* Header */}
        <div className="flex items-start justify-between mb-7 flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <Avatar initials={person.initials} size="lg" />
            <div>
              <div className="text-muted text-xs mb-0.5">
                {person.household} · joined {person.joinedDate} · age {person.age}
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">{person.name}</h1>
              <div className="flex items-center gap-3 mt-1.5 text-xs flex-wrap">
                <Pill tone={person.status === "fading" ? "warn" : person.status === "newcomer" ? "accent" : "good"}>
                  {person.status === "fading"
                    ? "At risk · fading"
                    : person.status === "newcomer"
                      ? "Newcomer"
                      : "Active"}
                </Pill>
                <span className="text-muted">{person.summary}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <button className="px-2.5 py-1.5 rounded border border-border-soft text-muted hover:text-fg">
              Log touchpoint
            </button>
            <button className="px-2.5 py-1.5 rounded border border-border-soft text-muted hover:text-fg">
              Hand off ▾
            </button>
            <button className="px-2.5 py-1.5 rounded bg-accent text-[var(--accent-fg)] font-medium">
              Open in PCO
            </button>
          </div>
        </div>

        {/* Other profiles for navigation */}
        <div className="mb-6 flex items-center gap-2 text-xs flex-wrap">
          <span className="text-muted">Sample profiles:</span>
          {PEOPLE_PROFILE_SLUGS.map((s) => (
            <Link
              key={s}
              href={`/people/${s}`}
              className={`px-2.5 py-1 rounded-full border ${
                s === slug
                  ? "bg-bg-elev-2 text-fg border-border-soft"
                  : "border-border-soft text-muted hover:text-fg hover:bg-bg-elev-2/60"
              }`}
            >
              {PEOPLE_PROFILES[s].name}
            </Link>
          ))}
        </div>

        {/* Stat strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Tenure</div>
            <div className="tnum text-2xl font-semibold">{person.tenureYears} yr</div>
            <div className="text-xs text-muted mt-1">since {person.joinedDate}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Last Sunday</div>
            <div className="text-base font-medium">{person.lastSunday}</div>
            <div className="text-xs text-muted mt-1">via Check-Ins</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Last touchpoint</div>
            <div className="text-base font-medium">{person.lastTouch}</div>
            <div className="text-xs text-muted mt-1">
              {person.shepherds.length === 0 ? "no primary shepherd" : "logged by shepherd"}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Lanes active</div>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {person.laneTenure.length > 0 ? (
                person.laneTenure.map((lt) => <LaneTag key={lt.lane} laneKey={lt.lane} short />)
              ) : (
                <LaneTag laneKey="none" short />
              )}
            </div>
            <div className="text-xs text-muted mt-2">
              {person.laneTenure.length} of 5 lanes
            </div>
          </Card>
        </div>

        {/* Journey timeline */}
        <Card className="mb-5 p-5">
          <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
            <h2 className="text-sm font-semibold">Lane journey</h2>
            <div
              className={`text-xs font-medium ${
                person.noteTone === "warn"
                  ? "text-warn-soft-fg"
                  : person.noteTone === "good"
                    ? "text-accent"
                    : "text-muted"
              }`}
            >
              {person.note}
            </div>
          </div>
          <p className="text-xs text-muted mb-7">
            Lanes added (or lost) in chronological order, scaled to {person.tenureYears} years at the church.
          </p>
          <Journey points={person.journey} />
        </Card>

        {/* Two-col: Lane tenure + Shepherding */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-5">
          <Card>
            <CardHeader title="Lane tenure" />
            <ul className="divide-y divide-border-softer">
              {person.laneTenure.length === 0 ? (
                <li className="px-5 py-6 text-sm text-muted text-center">
                  No active lanes. Last lane lost {person.lastSunday}.
                </li>
              ) : (
                person.laneTenure.map((lt) => (
                  <li key={lt.lane} className="px-5 py-3.5">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <LaneTag laneKey={lt.lane} />
                        <span className="text-sm">since {lt.entered}</span>
                      </div>
                      <span className="text-xs text-muted tnum">{lt.months}mo</span>
                    </div>
                    <div className="text-xs text-muted">{lt.intensity}</div>
                  </li>
                ))
              )}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Shepherding" />
            <div className="px-5 py-4">
              <div className="text-xs text-muted uppercase tracking-wider mb-2">
                Shepherded by
              </div>
              {person.shepherds.length === 0 ? (
                <p className="text-sm text-warn-soft-fg">— no primary shepherd assigned —</p>
              ) : (
                <ul className="space-y-2">
                  {person.shepherds.map((s) => (
                    <li key={s.name} className="flex items-center gap-3">
                      <Avatar initials={initials(s.name)} size="sm" />
                      <div className="flex-1">
                        <div className="text-sm font-medium">{s.name}</div>
                        <div className="text-xs text-muted">{s.role}</div>
                      </div>
                      <span className="text-xs text-muted tnum">since {s.since}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {person.shepherdsOf.length > 0 && (
              <div className="px-5 py-4 border-t border-border-softer">
                <div className="text-xs text-muted uppercase tracking-wider mb-2">
                  Shepherds (informally)
                </div>
                <ul className="space-y-2">
                  {person.shepherdsOf.map((s) => (
                    <li key={s.name} className="flex items-center gap-3">
                      <Avatar initials={initials(s.name)} size="sm" />
                      <div className="flex-1">
                        <div className="text-sm font-medium">{s.name}</div>
                        <div className="text-xs text-muted">{s.tag}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="px-5 py-4 border-t border-border-softer grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-muted uppercase tracking-wider mb-2">Groups</div>
                {person.groups.length === 0 ? (
                  <p className="text-xs text-muted">— none —</p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {person.groups.map((g) => (
                      <li key={g.name}>
                        <div>{g.name}</div>
                        <div className="text-xs text-muted">
                          {g.role} · since {g.since}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="text-xs text-muted uppercase tracking-wider mb-2">Teams</div>
                {person.teams.length === 0 ? (
                  <p className="text-xs text-muted">— none —</p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {person.teams.map((t) => (
                      <li key={t.name}>
                        <div>{t.name}</div>
                        <div className="text-xs text-muted">
                          {t.role} · since {t.since}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Card>
        </div>

        {/* Activity + Notes */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Card>
            <CardHeader
              title="Activity"
              right={<span className="text-xs text-muted">last 30 days</span>}
            />
            <ul>
              {person.activity.map((a, i) => (
                <li
                  key={i}
                  className="px-5 py-3 border-b border-border-softer last:border-0 flex items-start gap-3 text-sm"
                >
                  <span className="text-xs text-muted tnum w-14 shrink-0">{a.when}</span>
                  <span className="text-xs uppercase text-muted tracking-wider w-24 shrink-0">
                    {a.type}
                  </span>
                  <span
                    className="text-fg flex-1"
                    dangerouslySetInnerHTML={{ __html: a.text }}
                  />
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader
              title="Pastoral notes"
              right={
                <button className="text-xs text-accent hover:underline">+ Add note</button>
              }
            />
            {person.notes.length === 0 ? (
              <div className="px-5 py-6 text-sm text-muted">No notes yet.</div>
            ) : (
              <ul>
                {person.notes.map((n, i) => (
                  <li
                    key={i}
                    className="px-5 py-4 border-b border-border-softer last:border-0"
                  >
                    <div className="flex items-baseline justify-between mb-1.5">
                      <span className="text-sm font-medium">{n.author}</span>
                      <span className="text-xs text-muted tnum">{n.when}</span>
                    </div>
                    <p className="text-sm text-fg leading-relaxed">{n.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
}

function Journey({
  points,
}: {
  points: { lane: LaneKey | null; label: string; date: string; at: number }[];
}) {
  return (
    <div className="relative h-16">
      <div className="absolute inset-0 flex items-center">
        <div className="h-px bg-border-soft w-full" />
      </div>
      {points.map((p, i) => (
        <div key={i} className="absolute" style={{ left: `${p.at}%` }}>
          <div className="-translate-x-1/2 text-center">
            <div
              className="w-3 h-3 rounded-full mx-auto mt-[26px]"
              style={{
                background: p.lane ? `var(--lane-${p.lane})` : "transparent",
                border: p.lane ? "none" : "1px solid var(--fg-subtle)",
              }}
            />
            <div className="text-[10px] mt-2 text-fg whitespace-nowrap">{p.label}</div>
            <div className="text-[10px] text-muted whitespace-nowrap">{p.date}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
