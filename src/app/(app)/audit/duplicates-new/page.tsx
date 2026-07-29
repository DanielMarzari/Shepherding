import { requireOrg } from "@/lib/auth";
import { renderBuilderRoute } from "../../builder/render-route";

// Builder version of /audit/duplicates, staged at /audit/duplicates-new for
// review. The original stays live until this is approved and promoted.
export default async function DuplicatesNewPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const session = await requireOrg();
  const { edit } = await searchParams;
  return renderBuilderRoute({
    session,
    slug: "audit-duplicates",
    edit: edit === "1",
    seed: true,
    active: "Duplicate audit",
    breadcrumb: "Duplicate audit (new — in review)",
  });
}
