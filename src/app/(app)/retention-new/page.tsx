import { requireOrg } from "@/lib/auth";
import { renderBuilderRoute } from "../builder/render-route";

// Builder version of /retention, staged at /retention-new for review. Wraps
// the same getRetention math; the original stays live until this is approved.
export default async function RetentionNewPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const session = await requireOrg();
  const { edit } = await searchParams;
  return renderBuilderRoute({
    session,
    slug: "retention",
    edit: edit === "1",
    seed: true,
    active: "Retention",
    breadcrumb: "Retention (new — in review)",
  });
}
