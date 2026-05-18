import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getSyncSettings } from "@/lib/pco";
import { getShepherdDetail } from "@/lib/shepherds-read";

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
  const age =
    shepherd.birthYear != null
      ? new Date().getUTCFullYear() - shepherd.birthYear
      : null;

  return (
    <AppShell active="Shepherds" breadcrumb={`Shepherds › ${shepherd.fullName}`}>
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
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
              <div className="flex items-center gap-3 mt-1.5 text-xs flex-wrap text-muted">
                {shepherd.membershipType && <span>{shepherd.membershipType}</span>}
                {age != null && <span>· age {age}</span>}
                {shepherd.isParent && <span>· parent</span>}
                <Link
                  href={`/people/${shepherd.personId}`}
                  className="text-accent hover:underline ml-1"
                >
                  Open person profile →
                </Link>
              </div>
            </div>
          </div>
          <Link
            href="/shepherds"
            className="text-xs text-muted hover:text-fg underline"
          >
            ← All shepherds
          </Link>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Groups led</div>
            <div className="tnum text-2xl font-semibold">
              {shepherd.groupsLed.length}
            </div>
            <div className="text-xs text-muted mt-1">active group rosters</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Teams led</div>
            <div className="tnum text-2xl font-semibold">
              {shepherd.teamsLed.length}
            </div>
            <div className="text-xs text-muted mt-1">non-archived teams</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Flock size</div>
            <div className="tnum text-2xl font-semibold text-accent">
              {shepherd.flockSize.toLocaleString()}
            </div>
            <div className="text-xs text-muted mt-1">
              distinct people across rosters
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Recent activity</div>
            <div className="tnum text-2xl font-semibold text-good-soft-fg">
              {(
                shepherd.groupsLed.reduce((s, g) => s + g.recentlyAttended, 0) +
                shepherd.teamsLed.reduce((s, t) => s + t.recentlyServed, 0)
              ).toLocaleString()}
            </div>
            <div className="text-xs text-muted mt-1">
              distinct attendees/servers ({settings.activityTrackingMonths}mo)
            </div>
          </Card>
        </div>

        {shepherd.groupsLed.length > 0 && (
          <Card>
            <div className="px-5 py-3 border-b border-border-soft">
              <h2 className="text-sm font-semibold">Groups they lead</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-border-soft">
                  <th className="text-left font-medium px-5 py-2">Group</th>
                  <th className="text-right font-medium px-5 py-2">Members</th>
                  <th className="text-right font-medium px-5 py-2">
                    Co-leaders
                  </th>
                  <th className="text-right font-medium px-5 py-2">
                    Recently attended ({settings.activityTrackingMonths}mo)
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
                  <th className="text-right font-medium px-5 py-2">Members</th>
                  <th className="text-right font-medium px-5 py-2">
                    Co-leaders
                  </th>
                  <th className="text-right font-medium px-5 py-2">
                    Recently served ({settings.activityTrackingMonths}mo)
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
    </AppShell>
  );
}
