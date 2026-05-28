import { PageSkeleton, TableSkeleton } from "@/components/PageSkeleton";

/** /people is mostly a giant table — paint a row-shaped skeleton so
 *  the visual rhythm matches what's actually about to render. */
export default function PeopleLoading() {
  return (
    <PageSkeleton title="People" active="People" breadcrumb="People">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="rounded-[10px] bg-bg-elev border border-border-soft p-4 h-24"
          />
        ))}
      </div>
      <div className="flex gap-3">
        {Array.from({ length: 5 }, (_, i) => (
          <div
            key={i}
            className="h-8 w-24 rounded-full bg-bg-elev-2/40"
          />
        ))}
      </div>
      <TableSkeleton rows={14} />
    </PageSkeleton>
  );
}
