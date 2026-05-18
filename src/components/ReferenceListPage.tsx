import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Avatar, Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getListByName, listReferenceListNames } from "@/lib/lists-read";

/** Shared scaffolding for any page that surfaces a single REFERENCE list
 *  by name. /staff and /shepherd-team are thin wrappers around this. */
export async function ReferenceListPage({
  listName,
  navActive,
  breadcrumb,
  heading,
  subhead,
}: {
  listName: string;
  navActive: string;
  breadcrumb: string;
  heading: string;
  subhead: string;
}) {
  const session = await requireOrg();
  const list = getListByName(session.orgId, listName);
  const synced = listReferenceListNames(session.orgId);

  return (
    <AppShell active={navActive} breadcrumb={breadcrumb}>
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
          <p className="text-muted text-sm mt-1">{subhead}</p>
        </div>

        {!list ? (
          <Card className="p-10 text-center">
            <h3 className="font-semibold mb-2">List not synced yet</h3>
            <p className="text-sm text-muted max-w-md mx-auto">
              Shepherding looks for a PCO People list named{" "}
              <span className="font-mono text-fg">{listName}</span>. Check that
              the list exists in PCO, has been refreshed there, and that the
              People entity is enabled on{" "}
              <Link href="/pco" className="text-accent hover:underline">
                /pco
              </Link>
              .
              {synced.length > 0 && (
                <>
                  <br />
                  <span className="text-xs">
                    Synced REFERENCE lists right now: {synced.join(" · ")}
                  </span>
                </>
              )}
            </p>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card className="p-4">
                <div className="text-xs text-muted mb-1.5">Members</div>
                <div className="tnum text-2xl font-semibold">
                  {list.members.length.toLocaleString()}
                </div>
                <div className="text-xs text-muted mt-1">
                  matched to a PCO person row
                </div>
              </Card>
              <Card className="p-4">
                <div className="text-xs text-muted mb-1.5">PCO total</div>
                <div className="tnum text-2xl font-semibold">
                  {list.totalPeople.toLocaleString()}
                </div>
                <div className="text-xs text-muted mt-1">
                  as reported by PCO at last refresh
                </div>
              </Card>
              <Card className="p-4">
                <div className="text-xs text-muted mb-1.5">Adults</div>
                <div className="tnum text-2xl font-semibold">
                  {list.members
                    .filter((m) => !m.isMinor)
                    .length.toLocaleString()}
                </div>
                <div className="text-xs text-muted mt-1">is_minor = 0</div>
              </Card>
              <Card className="p-4">
                <div className="text-xs text-muted mb-1.5">Last refreshed</div>
                <div className="font-medium">
                  {list.refreshedAt
                    ? new Date(list.refreshedAt).toLocaleString()
                    : "—"}
                </div>
                <div className="text-xs text-muted mt-1">
                  inside PCO (Run-list timestamp)
                </div>
              </Card>
            </div>

            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted">
                    <tr className="border-b border-border-soft">
                      <th className="text-left font-medium px-5 py-2">Name</th>
                      <th className="text-left font-medium px-5 py-2">
                        Membership
                      </th>
                      <th className="text-left font-medium px-5 py-2">
                        Demographics
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.members.map((m) => {
                      const age =
                        m.birthYear != null
                          ? new Date().getUTCFullYear() - m.birthYear
                          : null;
                      return (
                        <tr
                          key={m.personId}
                          className="border-b border-border-softer hover:bg-bg-elev-2/60"
                        >
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-3">
                              <Avatar initials={m.initials} />
                              <Link
                                href={`/people/${m.personId}`}
                                className="font-medium hover:text-accent"
                              >
                                {m.fullName}
                              </Link>
                            </div>
                          </td>
                          <td className="px-5 py-3 text-muted">
                            {m.membershipType ?? (
                              <span className="text-subtle">—</span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-muted text-xs">
                            {age != null ? <>age {age} · </> : null}
                            {m.isMinor && <span>minor · </span>}
                            {m.isParent && <span>parent</span>}
                            {!m.isMinor && !m.isParent && age == null && (
                              <span className="text-subtle">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
