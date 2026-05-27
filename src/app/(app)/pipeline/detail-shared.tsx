import Link from "next/link";
import { Stat } from "@/components/ui";
import type {
  ConversionStats,
  PipelinePerson,
} from "@/lib/pipeline-read";

function fmtDays(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (n < 1.5) return `${n.toFixed(1)}d`;
  return `${Math.round(n)}d`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

export function DetailHeader({ stats }: { stats: ConversionStats }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <Stat
        label="Converters"
        value={stats.count.toLocaleString()}
        delta="people in this segment"
      />
      <Stat
        label="Median"
        value={fmtDays(stats.medianDays)}
        valueTone="accent"
        delta="50% faster than this"
      />
      <Stat
        label="Average"
        value={fmtDays(stats.avgDays)}
        delta="skewed by long tail"
      />
      <Stat
        label="Fastest"
        value={fmtDays(stats.minDays)}
        delta="first converter"
      />
      <Stat
        label="Slowest"
        value={fmtDays(stats.maxDays)}
        valueTone={stats.maxDays && stats.maxDays > 180 ? "warn" : "default"}
        delta="worst-case in window"
      />
    </div>
  );
}

export function DetailTable({
  people,
  startLabel,
  endLabel,
}: {
  people: PipelinePerson[];
  startLabel: string;
  endLabel: string;
}) {
  if (people.length === 0) {
    return (
      <p className="text-sm text-muted text-center py-8">
        No converters in this segment yet — once data flows in for this
        pipeline, names will appear here.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted">
          <tr className="border-b border-border-soft">
            <th className="text-left font-medium px-3 py-2">Person</th>
            <th className="text-left font-medium px-3 py-2">{startLabel}</th>
            <th className="text-left font-medium px-3 py-2">{endLabel}</th>
            <th className="text-right font-medium px-3 py-2">Days</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr
              key={p.personId}
              className="border-b border-border-softer hover:bg-bg-elev-2/60"
            >
              <td className="px-3 py-2">
                <Link
                  href={`/people/${p.personId}`}
                  className="font-medium hover:text-accent"
                >
                  {p.fullName}
                </Link>
              </td>
              <td className="px-3 py-2 text-muted tnum">
                {fmtDate(p.startAt)}
              </td>
              <td className="px-3 py-2 text-muted tnum">
                {fmtDate(p.endAt)}
              </td>
              <td className="px-3 py-2 text-right tnum">
                <span
                  className={
                    p.days > 180
                      ? "text-warn-soft-fg font-medium"
                      : p.days > 60
                        ? "text-fg font-medium"
                        : "text-muted"
                  }
                >
                  {fmtDays(p.days)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
