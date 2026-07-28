import { requireOrg } from "@/lib/auth";
import { renderBuilderRoute } from "../builder/render-route";

// This route now renders its editable Page Builder page in place (seeded on
// first visit from src/lib/builder-seeds.ts). The original hand-coded design is
// archived at reference/pages/checkins.tsx.
export default async function CheckinsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const session = await requireOrg();
  const { edit } = await searchParams;
  return renderBuilderRoute({
    session,
    slug: "checkins",
    edit: edit === "1",
    seed: true,
    active: "Check-ins",
    breadcrumb: "Check-ins",
  });
}
