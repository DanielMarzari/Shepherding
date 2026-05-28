import { PageSkeleton, TableSkeleton } from "@/components/PageSkeleton";

export default function GroupsLoading() {
  return (
    <PageSkeleton title="Groups" active="Groups" breadcrumb="Groups">
      <TableSkeleton rows={14} />
    </PageSkeleton>
  );
}
