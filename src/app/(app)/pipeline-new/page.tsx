import { requireOrg } from "@/lib/auth";
import { renderBuilderRoute } from "../builder/render-route";

// Builder version of /pipeline (the group pipeline), staged at /pipeline-new
// for review. Wraps getGroupPipeline; the serving pipeline + the original stay
// live until this is approved and promoted.
export default async function PipelineNewPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const session = await requireOrg();
  const { edit } = await searchParams;
  return renderBuilderRoute({
    session,
    slug: "group-pipeline",
    edit: edit === "1",
    seed: true,
    active: "Pipeline",
    breadcrumb: "Pipeline (new — in review)",
  });
}
