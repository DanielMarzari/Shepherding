import { PageSkeleton } from "@/components/PageSkeleton";

export default function AttendanceLoading() {
  return (
    <PageSkeleton
      title="Attendance"
      active="See more"
      breadcrumb="See more › Attendance"
      statCount={4}
      contentRows={3}
    />
  );
}
