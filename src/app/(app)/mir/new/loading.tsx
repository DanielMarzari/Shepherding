import { PageSkeleton } from "@/components/PageSkeleton";

export default function MirNewLoading() {
  return (
    <PageSkeleton
      title="New ministry impact report"
      active="See more"
      breadcrumb="See more › MIR › New"
      statCount={0}
      contentRows={2}
    />
  );
}
