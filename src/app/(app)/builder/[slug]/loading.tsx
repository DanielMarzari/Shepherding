import { PageSkeleton } from "@/components/PageSkeleton";

// The parent builder/loading.tsx says "See more › Page Builder", which is right
// for the page-builder index but wrong for a custom page that lives in a hub
// layer — a Ministry Impact Report would flash the wrong location every load.
// A skeleton can't read params, so it stays neutral rather than guessing; the
// real breadcrumb arrives with the page (see defaultBreadcrumb in render-route).
export default function BuilderPageLoading() {
  return (
    <PageSkeleton title="" breadcrumb="" active="" statCount={0} contentRows={0}>
      <div className="space-y-6">
        <div className="h-7 w-64 rounded bg-bg-elev-2/40" />
        <div className="h-28 rounded-xl bg-bg-elev-2/40" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="lg:col-span-2 h-64 rounded-xl bg-bg-elev-2/40" />
          ))}
        </div>
      </div>
    </PageSkeleton>
  );
}
