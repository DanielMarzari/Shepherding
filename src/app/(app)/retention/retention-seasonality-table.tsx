import type { MonthSeasonality } from "@/lib/retention-read";

/** Retention by join month, broken out per YEAR with 3-yr / 5-yr / all-time
 *  averages — so a single outlier year (e.g. a post-COVID reopening month)
 *  is visible instead of being pooled away. Cells that sit far from the
 *  month's 5-year average are tinted. */
export function RetentionSeasonalityTable({ seasonality }: { seasonality: MonthSeasonality[] }) {
  const years = [...new Set(seasonality.flatMap((m) => m.years.map((y) => y.year)))].sort((a, b) => a - b);
  if (years.length === 0) return null;

  const cell = (pct: number | null, ref: number | null) => {
    if (pct == null) return <span className="text-subtle">·</span>;
    const outlier = ref != null && Math.abs(pct - ref) >= 15;
    return (
      <span className={outlier ? "text-warn-soft-fg font-medium" : "text-fg"} title={outlier ? `Outlier vs the month's 5-yr avg (${ref}%)` : undefined}>
        {pct}%
      </span>
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs tnum border-collapse">
        <thead>
          <tr className="text-muted">
            <th className="text-left font-medium py-1 pr-3 sticky left-0 bg-bg">Month</th>
            {years.map((y) => (
              <th key={y} className="text-right font-medium py-1 px-2">{y}</th>
            ))}
            <th className="text-right font-medium py-1 px-2 border-l border-border-soft">3-yr</th>
            <th className="text-right font-medium py-1 px-2">5-yr</th>
            <th className="text-right font-medium py-1 pl-2">All</th>
          </tr>
        </thead>
        <tbody>
          {seasonality.map((m) => {
            const byYear = new Map(m.years.map((y) => [y.year, y.pct]));
            const ref = m.avg5 ?? m.pct;
            return (
              <tr key={m.month} className="border-t border-border-soft/60">
                <td className="text-left py-1 pr-3 text-muted sticky left-0 bg-bg">{m.label}</td>
                {years.map((y) => (
                  <td key={y} className="text-right py-1 px-2">{cell(byYear.get(y) ?? null, ref)}</td>
                ))}
                <td className="text-right py-1 px-2 border-l border-border-soft">{m.avg3 != null ? `${m.avg3}%` : "·"}</td>
                <td className="text-right py-1 px-2">{m.avg5 != null ? `${m.avg5}%` : "·"}</td>
                <td className="text-right py-1 pl-2 text-fg">{m.cohorts > 0 ? `${m.pct}%` : "·"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
