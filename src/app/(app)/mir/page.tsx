import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { listMirs } from "@/lib/mir-read";

export default async function MirListPage() {
  const session = await requireOrg();
  const mirs = listMirs(session.orgId);
  const isAdmin = session.role === "admin";

  return (
    <AppShell
      active="See more"
      breadcrumb="See more › Ministry Impact Reports"
    >
      <div className="px-5 md:px-7 py-7 space-y-6 max-w-4xl">
        <div className="flex items-baseline justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Ministry Impact Reports
            </h1>
            <p className="text-muted text-sm mt-1 max-w-2xl">
              Standard nonprofit logic-model docs — Resources → Activities →
              Outputs → Outcomes → Impact — describing what each ministry is
              actually accomplishing and for whom. Hand-edited today; PCO
              data will fill more of it in over time.
            </p>
          </div>
          {isAdmin && (
            <Link
              href="/mir/new"
              className="px-3 py-1.5 rounded-lg border border-accent text-accent hover:bg-accent hover:text-bg text-xs font-medium cursor-pointer"
            >
              + New report
            </Link>
          )}
        </div>

        {mirs.length === 0 ? (
          <Card className="p-10 text-center text-sm text-muted">
            No reports yet.{" "}
            {isAdmin && (
              <Link href="/mir/new" className="text-accent hover:underline">
                Create the first one
              </Link>
            )}
            .
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {mirs.map((m) => (
              <Link
                key={m.id}
                href={`/mir/${m.id}`}
                className="block group"
              >
                <Card className="p-5 group-hover:border-accent transition-colors">
                  <h2 className="font-semibold mb-1 group-hover:text-accent">
                    {m.title}
                  </h2>
                  {m.targetAudience && (
                    <p className="text-xs text-muted">
                      For: {m.targetAudience}
                    </p>
                  )}
                  {m.team && (
                    <p className="text-xs text-muted mt-0.5">
                      Team: {m.team}
                    </p>
                  )}
                  <p className="text-[11px] text-subtle tnum mt-2">
                    Updated {new Date(m.updatedAt).toLocaleDateString()}
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
