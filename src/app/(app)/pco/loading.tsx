import { PageSkeleton } from "@/components/PageSkeleton";

export default function PcoLoading() {
  return (
    <PageSkeleton
      title="PCO sync"
      active="PCO"
      breadcrumb="Credentials › PCO"
      statCount={0}
      contentRows={4}
    />
  );
}
