import { requireOrg } from "@/lib/auth";
import { renderBuilderRoute } from "../builder/render-route";

// Builder version of /map (Member map), staged at /map-new for review. The
// interactive original stays live until this is approved and promoted.
export default async function MemberMapNewPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const session = await requireOrg();
  const { edit } = await searchParams;
  return renderBuilderRoute({
    session,
    slug: "member-map",
    edit: edit === "1",
    seed: true,
    active: "See more",
    breadcrumb: "See more › Member map (new — in review)",
  });
}
