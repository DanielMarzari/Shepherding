import { PageSkeleton } from "@/components/PageSkeleton";

export default function MembershipFitLoading() {
  return (
    <PageSkeleton
      title="Membership fit audit"
      active="Membership fit"
      breadcrumb="See more › Membership fit audit"
      statCount={4}
      contentRows={4}
    />
  );
}
