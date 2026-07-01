import { PageSkeleton } from "@/components/PageSkeleton";

export default function BuilderLoading() {
  return (
    <PageSkeleton title="Page Builder" active="See more" breadcrumb="See more › Page Builder">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="h-40 rounded-xl bg-bg-elev-2/40" />
        <div className="h-40 rounded-xl bg-bg-elev-2/40" />
        <div className="h-40 rounded-xl bg-bg-elev-2/40" />
      </div>
    </PageSkeleton>
  );
}
