import { PageSkeleton } from "@/components/PageSkeleton";

export default function AnnouncementImpactLoading() {
  return (
    <PageSkeleton
      title="Announcement impact"
      active="Announcement impact"
      breadcrumb="Next steps › Announcement impact"
      statCount={0}
      contentRows={5}
    />
  );
}
