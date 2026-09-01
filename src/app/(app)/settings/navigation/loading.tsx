import { PageSkeleton } from "@/components/PageSkeleton";

export default function NavigationLoading() {
  return (
    <PageSkeleton
      title="Navigation"
      active="Navigation"
      breadcrumb="Settings & Integration › Navigation"
      statCount={0}
      contentRows={4}
    />
  );
}
