import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { listBuilderPages } from "@/lib/builder";
import { createPageAction } from "./actions";

export default async function BuilderIndexPage() {
  const session = await requireOrg();
  const isAdmin = session.role === "admin";
  const pages = listBuilderPages(session.orgId);

  return (
    <AppShell active="See more" breadcrumb="See more › Page Builder">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Page Builder</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Compose your own dashboards from blocks — stat cards, bar charts,
            tables, and text — each powered by a read-only SQL query against the
            live database. Arrange them in a bento grid and share the page.
          </p>
        </div>

        {isAdmin && (
          <Card className="p-4">
            <form action={createPageAction} className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[220px]">
                <label className="text-xs text-muted block mb-1.5">New page title</label>
                <input
                  name="title"
                  required
                  placeholder="e.g. Elder board snapshot"
                  className="w-full bg-bg-elev-2 border border-border-soft rounded-lg px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-accent text-[var(--accent-fg)] text-sm font-semibold cursor-pointer"
              >
                Create page
              </button>
            </form>
          </Card>
        )}

        {pages.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-soft p-10 text-center text-sm text-muted">
            No custom pages yet.{isAdmin ? " Create one above to get started." : " An admin can create pages here."}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pages.map((p) => (
              <Link
                key={p.id}
                href={`/builder/${p.slug}`}
                className="rounded-xl border border-border-soft bg-bg-elev-2/40 p-5 hover:border-accent transition-colors group"
              >
                <div className="font-semibold group-hover:text-accent">{p.title}</div>
                {p.description && <p className="text-xs text-muted mt-1 line-clamp-2">{p.description}</p>}
                <div className="text-[11px] text-subtle mt-3">
                  {p.blockCount} block{p.blockCount === 1 ? "" : "s"} · updated {p.updatedAt.slice(0, 10)}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
