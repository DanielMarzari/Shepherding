import { PageSkeleton } from "@/components/PageSkeleton";

export default function ConstantContactLoading() {
  return (
    <PageSkeleton
      title="Constant Contact"
      active="Constant Contact"
      breadcrumb="Credentials › Constant Contact"
    >
      <div className="space-y-3">
        <div className="h-56 rounded-xl bg-bg-elev-2/40" />
        <div className="h-32 rounded-xl bg-bg-elev-2/40" />
      </div>
    </PageSkeleton>
  );
}
