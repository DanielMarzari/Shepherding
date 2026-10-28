import { PageSkeleton } from "@/components/PageSkeleton";

export default function MembershipAuditLoading() {
  return (
    <PageSkeleton
      title="Membership audit"
      active="See more"
      breadcrumb="See more › Membership audit"
      statCount={4}
      contentRows={3}
    />
  );
}
