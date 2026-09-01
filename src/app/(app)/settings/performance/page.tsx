import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getPerfSuggestions } from "@/lib/perf-suggestions";
import { PerfBoard } from "./perf-board";

export default async function PerformancePage() {
  const session = await requireOrg();
  const suggestions = getPerfSuggestions(session.orgId);
  const applied = suggestions.filter((s) => s.status === "applied").length;
  const open = suggestions.filter((s) => s.status === "pending" || s.status === "approved").length;

  return (
    <AppShell active="Performance" breadcrumb="Settings & Integration › Performance">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Performance</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Why pages are slow, and what to do about it. Claude profiled the
            database and the builder render path; each item below names what&apos;s
            slow, its complexity before → after, and the fix. The{" "}
            <span className="text-fg">Safe</span> ones (which can&apos;t change any
            displayed number) are already applied. Approve any others and Claude
            will implement them; dismiss the ones you don&apos;t want.
          </p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle">
            <span>
              <span className="text-good-soft-fg tnum">{applied}</span> applied
            </span>
            <span>
              <span className="text-fg tnum">{open}</span> open
            </span>
            <span className="text-subtle">
              Tip: open any builder page&apos;s <span className="text-fg">edit</span> mode
              to see its live per-query timings and big-O.
            </span>
          </div>
        </div>

        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-1.5">The root cause</h2>
          <p className="text-xs text-muted leading-relaxed max-w-3xl">
            Builder pages run each block&apos;s query one after another on a single
            database connection, so a page&apos;s load time is the{" "}
            <span className="text-fg">sum</span> of every block. The big wins are
            (1) not recomputing the same heavy aggregate several times per page,
            and (2) not decrypting all ~33k people on every render. A 33k-row
            database should render in ~1–2s, not ~10s — the items below close
            that gap.
          </p>
        </Card>

        <PerfBoard suggestions={suggestions} isAdmin={session.role === "admin"} />
      </div>
    </AppShell>
  );
}
