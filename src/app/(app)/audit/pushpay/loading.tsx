import { PageSkeleton } from "@/components/PageSkeleton";

export default function PushpayConnectionsLoading() {
  return (
    <PageSkeleton
      title="PushPay connections"
      active="PushPay connections"
      breadcrumb="Audit › PushPay connections"
      statCount={4}
      contentRows={4}
    />
  );
}
