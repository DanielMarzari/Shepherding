import type { CategoryProjection } from "@/lib/attendance-forecast";

/** Projection table: each category's latest yearly average and its
 *  linear-trend projection for 2026 and 2027, with the per-year trend. */
export function ProjectionTable({ categories }: { categories: CategoryProjection[] }) {
  if (categories.length === 0) {
    return <p className="text-xs text-subtle">Not enough yearly history to project yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs tnum border-collapse">
        <thead>
          <tr className="text-muted">
            <th className="text-left font-medium py-1 pr-3">Category</th>
            <th className="text-right font-medium py-1 px-2">Latest</th>
            <th className="text-right font-medium py-1 px-2 border-l border-border-soft">2026 proj.</th>
            <th className="text-right font-medium py-1 px-2">2027 proj.</th>
            <th className="text-right font-medium py-1 pl-3">Trend /yr</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((c) => {
            const up = c.perYearPct != null && c.perYearPct > 0;
            const down = c.perYearPct != null && c.perYearPct < 0;
            return (
              <tr key={c.key} className="border-t border-border-soft/60">
                <td className="text-left py-1 pr-3 font-medium">{c.label}</td>
                <td className="text-right py-1 px-2 text-muted">
                  {c.latestAvg != null ? c.latestAvg.toLocaleString() : "·"}
                  {c.latestYear != null && <span className="text-subtle ml-1">({c.latestYear})</span>}
                </td>
                <td className="text-right py-1 px-2 border-l border-border-soft text-fg">
                  {c.proj2026 != null ? c.proj2026.toLocaleString() : "·"}
                </td>
                <td className="text-right py-1 px-2 text-fg font-medium">
                  {c.proj2027 != null ? c.proj2027.toLocaleString() : "·"}
                </td>
                <td className={`text-right py-1 pl-3 ${up ? "text-good-soft-fg" : down ? "text-warn-soft-fg" : "text-muted"}`}>
                  {c.perYearPct != null ? `${up ? "▲" : down ? "▼" : "→"} ${Math.abs(c.perYearPct)}%` : "·"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
