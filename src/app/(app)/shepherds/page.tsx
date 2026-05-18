import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Avatar, Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { listShepherds } from "@/lib/shepherds-read";

export default async function ShepherdsPage() {
  const session = await requireOrg();
  const shepherds = listShepherds(session.orgId);

  const totalGroupsLed = shepherds.reduce((s, x) => s + x.groupsLed.length, 0);
  const totalTeamsLed = shepherds.reduce((s, x) => s + x.teamsLed.length, 0);

  return (
    <AppShell active="Shepherds" breadcrumb="Shepherds">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div className="flex items-baseline justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Shepherds</h1>
            <p className="text-muted text-sm mt-1">
              {shepherds.length === 0
                ? "No one is flagged as a leader yet. Sync Groups + Teams from PCO and the list will populate."
                : `${shepherds.length.toLocaleString()} people leading ${totalGroupsLed} group${totalGroupsLed === 1 ? "" : "s"} + ${totalTeamsLed} team${totalTeamsLed === 1 ? "" : "s"}.`}
            </p>
          </div>
          <Link
            href="/shepherds/example"
            className="text-xs text-muted hover:text-fg underline"
          >
            View design preview (mock data) →
          </Link>
        </div>

        {shepherds.length > 0 && (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted">
                  <tr className="border-b border-border-soft">
                    <th className="text-left font-medium px-5 py-2">Shepherd</th>
                    <th className="text-left font-medium px-5 py-2">Groups led</th>
                    <th className="text-left font-medium px-5 py-2">Teams led</th>
                    <th className="text-right font-medium px-5 py-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {shepherds.map((s) => (
                    <tr
                      key={s.personId}
                      className="border-b border-border-softer hover:bg-bg-elev-2/60"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar initials={s.initials} />
                          <div>
                            <Link
                              href={`/people/${s.personId}`}
                              className="font-medium hover:text-accent"
                            >
                              {s.fullName}
                            </Link>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-muted">
                        {s.groupsLed.length === 0 ? (
                          <span className="text-subtle">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {s.groupsLed.map((g) => (
                              <span
                                key={g.id}
                                className="text-xs px-2 py-0.5 rounded-full bg-bg-elev-2 text-fg"
                              >
                                {g.name ?? `#${g.id}`}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-muted">
                        {s.teamsLed.length === 0 ? (
                          <span className="text-subtle">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {s.teamsLed.map((t) => (
                              <span
                                key={t.id}
                                className="text-xs px-2 py-0.5 rounded-full bg-bg-elev-2 text-fg"
                              >
                                {t.name ?? `#${t.id}`}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right tnum">
                        {s.totalLed}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
