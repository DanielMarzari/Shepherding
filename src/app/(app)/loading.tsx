import { PageSkeleton } from "@/components/PageSkeleton";

/** Default route-level loading.tsx for any /(app)/ route that doesn't
 *  have its own. Paints the full shell (real sidebar nav + body
 *  skeleton) the instant a navigation starts, so there's no blank
 *  flash between click and first paint regardless of how long the
 *  destination page's data fetching takes. */
export default function AppRouteLoading() {
  return <PageSkeleton statCount={4} contentRows={2} />;
}
