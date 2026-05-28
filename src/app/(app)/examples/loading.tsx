import { PageSkeleton } from "@/components/PageSkeleton";

export default function ExamplesLoading() {
  return (
    <PageSkeleton
      title="Examples"
      breadcrumb="Examples"
      statCount={0}
      contentRows={3}
    />
  );
}
