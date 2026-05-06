import { AppShell } from "@/components/AppShell";
import { Avatar, Card, CardHeader, LaneTag, Pill } from "@/components/ui";
import { ALL_PEOPLE, STATS } from "@/lib/mock";
import Link from "next/link";

export default function PeoplePage() {
  const sorted = [...ALL_PEOPLE].sort((a, b) => {
    // Push high-risk and unshepherded to the top, then by name.
    const ar = a.risk ?? -1;
    const br = b.risk ?? -1;
    if (ar !== br) return br - ar;
    return a.name.localeCompare(b.name);
  });

  const counts = {
    active: ALL_PEOPLE.filter((p) => p.status === "active").length,
    fading: ALL_PEOPLE.filter((p) => p.status === "fading").length,
    newcomer: ALL_PEOPLE.filter((p) => p.status === "newcomer").length,
    inactive: ALL_PEOPLE.filter((p) => p.status === "inactive").length,
  };

  return (
    <AppShell active="People" breadcrumb="People">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div className="flex items-baseline justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">People</h1>
            <p className="text-muted text-sm mt-1">
              Everyone the system knows about — sorted with at-risk and unshepherded at the top.
            </p>
          </div>
          <div className="hidden md:flex items-center gap-2 text-xs">
            <button className="px-2.5 py-1.5 rounded border border-border-soft text-muted">
              Sort · Risk DESC
            </button>
            <button className="px-2.5 py-1.5 rounded border border-border-soft text-muted">
              Filter · All
            </button>
            <button className="px-2.5 py-1.5 rounded bg-accent text-[var(--accent-fg)] font-medium">
              + Add manually
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Total in system</div>
            <div className="tnum text-2xl font-semibold">{ALL_PEOPLE.length}</div>
            <div className="text-xs text-muted mt-1">{STATS.active} active · church-wide</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Active</div>
            <div className="tnum text-2xl font-semibold text-good-soft-fg">{counts.active}</div>
            <div className="text-xs text-muted mt-1">on a healthy rhythm</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Fading</div>
            <div className="tnum text-2xl font-semibold text-warn-soft-fg">{counts.fading}</div>
            <div className="text-xs text-muted mt-1">attendance dropping</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Newcomers</div>
            <div className="tnum text-2xl font-semibold text-accent">{counts.newcomer}</div>
            <div className="text-xs text-muted mt-1">first 6 months</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Inactive</div>
            <div className="tnum text-2xl font-semibold">{counts.inactive}</div>
            <div className="text-xs text-muted mt-1">no engagement 6mo+</div>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Everyone"
            right={<span className="text-xs text-muted">{ALL_PEOPLE.length} people</span>}
          />
          <table className="w-full text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-border-soft">
                <th className="text-left font-medium px-5 py-2">Person</th>
                <th className="text-left font-medium px-5 py-2 hidden md:table-cell">Lanes</th>
                <th className="text-left font-medium px-5 py-2 hidden lg:table-cell">Shepherd</th>
                <th className="text-left font-medium px-5 py-2 hidden lg:table-cell">Last seen</th>
                <th className="text-right font-medium px-5 py-2 hidden xl:table-cell">Tenure</th>
                <th className="text-right font-medium px-5 py-2">Status</th>
                <th className="text-right font-medium px-5 py-2 hidden md:table-cell">Risk</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <PersonRowEl key={p.name} p={p} />
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </AppShell>
  );
}

function PersonRowEl({ p }: { p: (typeof ALL_PEOPLE)[number] }) {
  const cells = (
    <>
      <td className="px-5 py-2.5">
        <div className="flex items-center gap-3">
          <Avatar initials={p.initials} size="sm" />
          <span className="font-medium">{p.name}</span>
        </div>
      </td>
      <td className="px-5 py-2.5 hidden md:table-cell">
        <div className="flex gap-1 flex-wrap">
          {p.lanes.length === 0 ? (
            <LaneTag laneKey="none" short />
          ) : (
            p.lanes.map((l) => <LaneTag key={l} laneKey={l} short />)
          )}
        </div>
      </td>
      <td className="px-5 py-2.5 hidden lg:table-cell text-muted">
        {p.shepherd ?? <span className="text-warn-soft-fg">— none —</span>}
      </td>
      <td className="px-5 py-2.5 hidden lg:table-cell text-muted">{p.lastSeen}</td>
      <td className="px-5 py-2.5 text-right hidden xl:table-cell text-muted tnum">{p.tenure}</td>
      <td className="px-5 py-2.5 text-right">
        <Pill
          tone={
            p.status === "fading"
              ? "warn"
              : p.status === "newcomer"
                ? "accent"
                : p.status === "inactive"
                  ? "muted"
                  : "good"
          }
        >
          {p.status}
        </Pill>
      </td>
      <td className="px-5 py-2.5 text-right hidden md:table-cell tnum">
        {p.risk == null ? (
          <span className="text-subtle">—</span>
        ) : p.risk >= 80 ? (
          <span className="text-warn-soft-fg">High · {p.risk}</span>
        ) : p.risk >= 60 ? (
          <span className="text-warn-soft-fg">Med · {p.risk}</span>
        ) : (
          <span className="text-muted">Low · {p.risk}</span>
        )}
      </td>
    </>
  );
  if (p.slug) {
    return (
      <tr className="border-b border-border-softer hover:bg-bg-elev-2/60">
        <td colSpan={7} className="p-0">
          <Link href={`/people/${p.slug}`} className="block">
            <table className="w-full">
              <tbody>
                <tr>{cells}</tr>
              </tbody>
            </table>
          </Link>
        </td>
      </tr>
    );
  }
  return <tr className="border-b border-border-softer hover:bg-bg-elev-2/60">{cells}</tr>;
}
