import { PageSkeleton, TableSkeleton } from "@/components/PageSkeleton";

export default function ShepherdTeamLoading() {
  return (
    <PageSkeleton
      title="Shepherd team"
      active="Shepherd team"
      breadcrumb="Leadership › Shepherd team"
      statCount={0}
    >
      <TableSkeleton rows={10} />
    </PageSkeleton>
  );
}
