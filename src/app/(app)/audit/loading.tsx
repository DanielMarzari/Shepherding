import { PageSkeleton } from "@/components/PageSkeleton";

export default function AuditLoading() {
  return (
    <PageSkeleton
      title="Data audit"
      active="See more"
      breadcrumb="See more › Audit"
      statCount={4}
      contentRows={3}
    />
  );
}
