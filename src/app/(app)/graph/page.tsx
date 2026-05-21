import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { requireOrg } from "@/lib/auth";
import { buildRelationshipGraph } from "@/lib/graph-read";
import { RelationshipGraph } from "./RelationshipGraph";

export default async function GraphPage() {
  const session = await requireOrg();

  return (
    <AppShell active="See more" breadcrumb="See more › Relationship graph">
      <div className="px-5 md:px-7 py-7 space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Relationship graph
          </h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Every non-inactive person in the church as a node. A line is drawn
            wherever one person shepherds another — through group / team
            leadership or a care-roster assignment. Prominent lines lead to
            people who are <span className="text-fg">shepherded</span>; faint
            grey lines lead to people who are only{" "}
            <span className="text-fg">active</span>.
          </p>
        </div>

        <Suspense fallback={<GraphSkeleton />}>
          <GraphLoader orgId={session.orgId} />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function GraphLoader({ orgId }: { orgId: number }) {
  const data = buildRelationshipGraph(orgId);
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted tnum">
        {data.nodes.length.toLocaleString()} people ·{" "}
        {data.edges.length.toLocaleString()} relationships
        {data.skippedLargeContexts > 0 && (
          <>
            {" "}
            · {data.skippedLargeContexts.toLocaleString()} oversized
            groups/teams skipped
          </>
        )}
      </div>
      <RelationshipGraph data={data} />
    </div>
  );
}

function GraphSkeleton() {
  return (
    <div
      className="w-full rounded-xl border border-border-soft grid place-items-center"
      style={{ height: "76vh", background: "#0b0d13" }}
    >
      <div className="text-sm text-[#7c879c] animate-pulse">
        Building the relationship graph…
      </div>
    </div>
  );
}
