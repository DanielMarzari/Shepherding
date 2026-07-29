import { requireOrg } from "@/lib/auth";
import { renderBuilderRoute } from "../builder/render-route";

// Builder version of /people, staged at /people-new for review. The original
// /people stays live until this is approved and promoted.
export default async function PeopleNewPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const session = await requireOrg();
  const { edit } = await searchParams;
  return renderBuilderRoute({
    session,
    slug: "people",
    edit: edit === "1",
    seed: true,
    active: "People",
    breadcrumb: "People (new — in review)",
  });
}
