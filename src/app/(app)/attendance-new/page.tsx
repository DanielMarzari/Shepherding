import { requireOrg } from "@/lib/auth";
import { renderBuilderRoute } from "../builder/render-route";

// Builder version of /attendance (weekly-trend core), staged at /attendance-new
// for review. The original — with weather/forecast/preacher analytics — stays
// live until this is approved and promoted.
export default async function AttendanceNewPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const session = await requireOrg();
  const { edit } = await searchParams;
  return renderBuilderRoute({
    session,
    slug: "attendance",
    edit: edit === "1",
    seed: true,
    active: "Attendance",
    breadcrumb: "Attendance (new — in review)",
  });
}
