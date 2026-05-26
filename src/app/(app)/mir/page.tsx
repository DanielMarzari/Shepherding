import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { listMirs } from "@/lib/mir-read";
import { uploadMirPdfAction } from "./actions";

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
              actually accomplishing and for whom. Each report has one Lead
              and one Sponsor from the church staff.
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

        {isAdmin && (
          <Card className="p-5">
            <h2 className="text-sm font-semibold mb-1">Import from PDF</h2>
            <p className="text-xs text-muted mb-3">
              Upload a MIR PDF and we&apos;ll extract the Target audience,
              Team, Resources, Activities, Outputs, Outcomes, and Impact
              sections. If a report with the same title already exists, its
              contents are overwritten. Lead and Sponsor are matched to
              REFERENCE - Church Staff by name — if either can&apos;t be
              matched you&apos;ll need to set them in the form before saving
              again.
            </p>
            <form
              action={uploadMirPdfAction}
              className="flex flex-wrap items-center gap-2 text-sm"
              encType="multipart/form-data"
            >
              <input
                type="file"
                name="file"
                required
                accept="application/pdf,.pdf"
                className="text-sm text-fg file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-border-soft file:bg-bg-elev-2 file:text-fg file:cursor-pointer file:hover:border-accent"
              />
              <button
                type="submit"
                className="px-3 py-1.5 rounded-lg border border-accent text-accent hover:bg-accent hover:text-bg text-xs font-medium cursor-pointer"
              >
                Upload PDF
              </button>
            </form>
          </Card>
        )}

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
                  <p className="text-xs text-muted mt-0.5">
                    Lead:{" "}
                    {m.lead ? (
                      m.lead.name
                    ) : (
                      <span className="text-warn-soft-fg">not assigned</span>
                    )}{" "}
                    · Sponsor:{" "}
                    {m.sponsor ? (
                      m.sponsor.name
                    ) : (
                      <span className="text-warn-soft-fg">not assigned</span>
                    )}
                  </p>
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
