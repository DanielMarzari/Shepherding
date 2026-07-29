import { requireOrg } from "@/lib/auth";
import { renderBuilderRoute } from "../../builder/render-route";

// Builder version of /audit/names (Name audit), staged at /audit/names-new for
// review. The original stays live until this is approved and promoted.
export default async function NameAuditNewPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const session = await requireOrg();
  const { edit } = await searchParams;
  return renderBuilderRoute({
    session,
    slug: "audit-names",
    edit: edit === "1",
    seed: true,
    active: "Name audit",
    breadcrumb: "Name audit (new — in review)",
  });
}
