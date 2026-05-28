import { PageSkeleton } from "@/components/PageSkeleton";

export default function MirLoading() {
  return (
    <PageSkeleton
      title="Ministry impact reports"
      active="See more"
      breadcrumb="See more › MIR"
      statCount={0}
      contentRows={3}
    />
  );
}
