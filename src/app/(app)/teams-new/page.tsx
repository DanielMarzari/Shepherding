import { requireOrg } from "@/lib/auth";
import { renderBuilderRoute } from "../builder/render-route";

// Builder version of /teams, staged at /teams-new for review. The original
// /teams stays live until this is approved and promoted to the primary route.
export default async function TeamsNewPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const session = await requireOrg();
  const { edit } = await searchParams;
  return renderBuilderRoute({
    session,
    slug: "teams",
    edit: edit === "1",
    seed: true,
    active: "Teams",
    breadcrumb: "Teams (new — in review)",
  });
}
