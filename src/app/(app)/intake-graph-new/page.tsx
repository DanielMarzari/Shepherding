import { requireOrg } from "@/lib/auth";
import { renderBuilderRoute } from "../builder/render-route";

// Builder version of /intake-graph (Who knows who), staged at
// /intake-graph-new for review. Uses the interactive network chart; the
// original stays live until this is approved and promoted.
export default async function WhoKnowsWhoNewPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const session = await requireOrg();
  const { edit } = await searchParams;
  return renderBuilderRoute({
    session,
    slug: "who-knows-who",
    edit: edit === "1",
    seed: true,
    active: "See more",
    breadcrumb: "See more › Who knows who (new — in review)",
  });
}
