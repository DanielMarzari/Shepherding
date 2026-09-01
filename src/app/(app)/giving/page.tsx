import { requireOrg } from "@/lib/auth";
import { renderBuilderRoute } from "../builder/render-route";

// Giving statistics — an editable Page Builder page (seeded from
// src/lib/builder-seeds.ts) so admins can rearrange the widgets or add their
// own SQL blocks. Data comes from the imported PushPay donor set.
export default async function GivingPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const session = await requireOrg();
  const { edit } = await searchParams;
  return renderBuilderRoute({
    session,
    slug: "giving",
    edit: edit === "1",
    seed: true,
    active: "Giving statistics",
    breadcrumb: "See more › Giving statistics",
  });
}
