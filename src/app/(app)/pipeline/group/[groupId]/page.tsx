import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BackLink } from "@/components/BackLink";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getGroupPipelineDetail } from "@/lib/pipeline-read";
import { DetailHeader, DetailTable } from "../../detail-shared";

export default async function GroupPipelineDetailPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const session = await requireOrg();
  const { groupId } = await params;
  const data = getGroupPipelineDetail(
    session.orgId,
    decodeURIComponent(groupId),
  );
  if (!data.people.length && data.groupName === "(unknown group)") {
    notFound();
  }

  return (
    <AppShell
      active="See more"
      breadcrumb={`See more › Pipeline › ${data.groupName}`}
    >
      <div className="px-5 md:px-7 py-7 space-y-6 max-w-7xl">
        <div>
          <BackLink fallback="/pipeline">← Back to pipeline</BackLink>
        </div>

        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {data.groupName}
          </h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            {data.groupTypeName && (
              <>
                <span className="text-fg">{data.groupTypeName}</span> ·{" "}
              </>
            )}
            Everyone who applied to this group and later attended at least
            one event — sorted slowest first so the long tail is visible.
          </p>
        </div>

        <Card className="p-5 space-y-5">
          <DetailHeader stats={data.stats} />
          <DetailTable
            people={data.people}
            startLabel="Applied"
            endLabel="First attended"
          />
        </Card>

        <p className="text-xs text-muted">
          Click any name to open their profile.{" "}
          <Link href="/pipeline" className="text-accent hover:underline">
            Back to all pipelines
          </Link>
          .
        </p>
      </div>
    </AppShell>
  );
}
