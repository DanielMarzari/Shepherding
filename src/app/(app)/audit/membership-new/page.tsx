import { requireOrg } from "@/lib/auth";
import { renderBuilderRoute } from "../../builder/render-route";

// Builder version of /audit (Membership audit), staged at /audit/membership-new
// for review. The original stays live until this is approved and promoted.
export default async function MembershipAuditNewPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const session = await requireOrg();
  const { edit } = await searchParams;
  return renderBuilderRoute({
    session,
    slug: "audit-membership",
    edit: edit === "1",
    seed: true,
    active: "Membership audit",
    breadcrumb: "Membership audit (new — in review)",
  });
}
