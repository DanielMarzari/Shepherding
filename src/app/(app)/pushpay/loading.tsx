import { PageSkeleton } from "@/components/PageSkeleton";

export default function PushpayLoading() {
  return (
    <PageSkeleton title="PushPay" active="PushPay" breadcrumb="Credentials › PushPay">
      <div className="space-y-3">
        <div className="h-48 rounded-xl bg-bg-elev-2/40" />
        <div className="h-32 rounded-xl bg-bg-elev-2/40" />
      </div>
    </PageSkeleton>
  );
}
