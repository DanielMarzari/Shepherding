import { PageSkeleton } from "@/components/PageSkeleton";

export default function SettingsLoading() {
  return (
    <PageSkeleton
      title="Settings & Integration"
      active="Settings & Integration"
      breadcrumb="Settings & Integration"
      statCount={0}
      contentRows={4}
    />
  );
}
