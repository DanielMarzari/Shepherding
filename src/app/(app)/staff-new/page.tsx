import { requireOrg } from "@/lib/auth";
import { renderBuilderRoute } from "../builder/render-route";

// Builder version of /staff, staged at /staff-new for review.
export default async function StaffNewPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const session = await requireOrg();
  const { edit } = await searchParams;
  return renderBuilderRoute({
    session,
    slug: "staff",
    edit: edit === "1",
    seed: true,
    active: "Staff",
    breadcrumb: "Staff (new — in review)",
  });
}
