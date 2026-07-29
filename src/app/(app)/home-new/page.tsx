import { requireOrg } from "@/lib/auth";
import { renderBuilderRoute } from "../builder/render-route";

// Builder version of the Home dashboard, staged at /home-new for review. The
// original "/" stays live until this is approved and promoted.
export default async function HomeNewPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const session = await requireOrg();
  const { edit } = await searchParams;
  return renderBuilderRoute({
    session,
    slug: "home",
    edit: edit === "1",
    seed: true,
    active: "Home",
    breadcrumb: "Home (new — in review)",
  });
}
