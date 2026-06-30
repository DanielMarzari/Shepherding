import { PageSkeleton } from "@/components/PageSkeleton";

export default function SubsplashLoading() {
  return (
    <PageSkeleton title="Subsplash" active="Subsplash" breadcrumb="Credentials › Subsplash">
      <div className="space-y-3">
        <div className="h-56 rounded-xl bg-bg-elev-2/40" />
        <div className="h-32 rounded-xl bg-bg-elev-2/40" />
      </div>
    </PageSkeleton>
  );
}
