import { requireOrg } from "@/lib/auth";
import { renderBuilderRoute } from "../builder/render-route";

// This route now renders its editable Page Builder page in place (seeded from
// src/lib/builder-seeds.ts). The original hand-coded design is archived at
// reference/pages/groups.tsx and viewable at /groups-original.
export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const session = await requireOrg();
  const { edit } = await searchParams;
  return renderBuilderRoute({
    session,
    slug: "groups",
    edit: edit === "1",
    seed: true,
    active: "Groups",
    breadcrumb: "Groups",
  });
}
