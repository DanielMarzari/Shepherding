import { PageSkeleton } from "@/components/PageSkeleton";

export default function MirDetailLoading() {
  return (
    <PageSkeleton
      active="See more"
      breadcrumb="See more › MIR › …"
      statCount={0}
      contentRows={4}
    />
  );
}
