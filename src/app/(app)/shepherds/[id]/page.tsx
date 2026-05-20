import { redirect } from "next/navigation";

/** Shepherd profiles and person profiles are now a single page.
 *  /people/[id] is the canonical profile — it already carries the
 *  shepherding relationships ("People X co-shepherds", "Who shepherds
 *  X") plus group / team / check-in history. This route is kept only
 *  so old links and bookmarks still resolve. */
export default async function ShepherdProfileRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/people/${id}`);
}
