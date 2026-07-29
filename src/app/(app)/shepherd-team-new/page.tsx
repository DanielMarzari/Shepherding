import { requireOrg } from "@/lib/auth";
import { renderBuilderRoute } from "../builder/render-route";

// Builder version of /shepherd-team, staged at /shepherd-team-new for review.
// The original /shepherd-team stays live until this is approved and promoted.
export default async function ShepherdTeamNewPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const session = await requireOrg();
  const { edit } = await searchParams;
  return renderBuilderRoute({
    session,
    slug: "shepherd-team",
    edit: edit === "1",
    seed: true,
    active: "Shepherd team",
    breadcrumb: "Shepherd team (new — in review)",
  });
}
