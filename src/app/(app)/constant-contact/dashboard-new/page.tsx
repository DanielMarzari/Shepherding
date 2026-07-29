import { requireOrg } from "@/lib/auth";
import { renderBuilderRoute } from "../../builder/render-route";

// Builder version of /constant-contact/dashboard (Email dashboard), staged at
// /constant-contact/dashboard-new for review. All from the synced cc_* tables;
// the original stays live until this is approved and promoted.
export default async function EmailDashboardNewPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const session = await requireOrg();
  const { edit } = await searchParams;
  return renderBuilderRoute({
    session,
    slug: "email-dashboard",
    edit: edit === "1",
    seed: true,
    active: "See more",
    breadcrumb: "See more › Email dashboard (new — in review)",
  });
}
