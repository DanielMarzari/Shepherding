import type { ReactNode } from "react";
import { AppShellSkeleton } from "@/components/AppShell";

/** Generic page skeleton for use in route-level loading.tsx files.
 *  Paints the title row + a configurable mix of stat cards, body
 *  cards, and table rows so navigations show meaningful structure
 *  immediately while the real page runs its data fetches.
 *
 *  Pages with bespoke layouts pass `children` to render their own
 *  skeleton inside the shell; the defaults cover the common
 *  "header + stat strip + content card" shape. */
export function PageSkeleton({
  title,
  breadcrumb,
  active,
  statCount = 4,
  contentRows = 2,
  children,
}: {
  title?: string;
  breadcrumb?: string;
  active?: string;
  /** How many top stat tiles to paint. 0 hides the row. */
  statCount?: number;
  /** How many full-width body cards to paint after the stats. */
  contentRows?: number;
  /** Custom body — overrides the default stats + content rows. */
  children?: ReactNode;
}) {
  return (
    <AppShellSkeleton active={active} breadcrumb={breadcrumb}>
      <div className="px-5 md:px-7 py-7 space-y-6 animate-pulse">
        <div>
          {title ? (
            <h1 className="text-2xl font-semibold tracking-tight text-muted/70">
              {title}
            </h1>
          ) : (
            <div className="h-7 w-48 bg-bg-elev-2/60 rounded" />
          )}
          <div className="h-3 w-72 bg-bg-elev-2/40 rounded mt-2" />
        </div>
        {children ?? (
          <>
            {statCount > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Array.from({ length: statCount }, (_, i) => (
                  <div
                    key={i}
                    className="rounded-[10px] bg-bg-elev border border-border-soft p-4 h-24"
                  />
                ))}
              </div>
            )}
            {Array.from({ length: contentRows }, (_, i) => (
              <div
                key={i}
                className="rounded-[10px] bg-bg-elev border border-border-soft h-64"
              />
            ))}
          </>
        )}
      </div>
    </AppShellSkeleton>
  );
}

/** Tabular skeleton for /people and similar list pages. */
export function TableSkeleton({ rows = 12 }: { rows?: number }) {
  return (
    <div className="rounded-[10px] bg-bg-elev border border-border-soft overflow-hidden">
      <div className="h-10 border-b border-border-soft" />
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="h-12 border-b border-border-softer last:border-0 flex items-center px-5 gap-3"
        >
          <div className="w-7 h-7 rounded-full bg-bg-elev-2/60" />
          <div className="h-3 w-40 bg-bg-elev-2/60 rounded" />
          <div className="h-3 w-24 bg-bg-elev-2/40 rounded ml-auto" />
        </div>
      ))}
    </div>
  );
}
