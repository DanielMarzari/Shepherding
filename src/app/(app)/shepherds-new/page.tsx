import { requireOrg } from "@/lib/auth";
import { renderBuilderRoute } from "../builder/render-route";

// Builder version of /shepherds, staged at /shepherds-new for review. The
// original /shepherds stays live until this is approved and promoted.
export default async function ShepherdsNewPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const session = await requireOrg();
  const { edit } = await searchParams;
  return renderBuilderRoute({
    session,
    slug: "shepherds",
    edit: edit === "1",
    seed: true,
    active: "Shepherds",
    breadcrumb: "Shepherds (new — in review)",
  });
}
