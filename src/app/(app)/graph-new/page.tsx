import { requireOrg } from "@/lib/auth";
import { renderBuilderRoute } from "../builder/render-route";

// Builder version of /graph (Relationship graph), staged at /graph-new for
// review. Uses the interactive network chart; the original stays live until
// this is approved and promoted.
export default async function RelationshipGraphNewPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const session = await requireOrg();
  const { edit } = await searchParams;
  return renderBuilderRoute({
    session,
    slug: "relationship-graph",
    edit: edit === "1",
    seed: true,
    active: "See more",
    breadcrumb: "See more › Relationship graph (new — in review)",
  });
}
