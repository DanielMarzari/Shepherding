"use client";

/** Shown on Home when the dashboards were rebuilt before the newest synced
 *  data landed (see getStaleSnapshotNotice). A client component only so the
 *  time renders in the viewer's timezone, as the refresh button's stamp does.
 *
 *  Tone and a clock glyph plus words carry the state, never the color alone. */
export function SnapshotStaleNotice({
  refreshedAt,
  isAdmin,
}: {
  refreshedAt: string | null;
  isAdmin: boolean;
}) {
  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-2 rounded border border-warn-soft-bg bg-warn-soft-bg/40 px-3 py-2 text-xs text-warn-soft-fg"
    >
      <span aria-hidden="true">◷</span>
      <p>
        <span className="font-medium">Dashboards may be behind.</span>{" "}
        {/* suppressHydrationWarning: the server formats in its timezone, the
            browser in the viewer's; the client value wins immediately. */}
        <span suppressHydrationWarning>
          They were last rebuilt{" "}
          {refreshedAt ? new Date(refreshedAt).toLocaleString() : "before the latest sync"}
        </span>
        , and newer synced data isn&apos;t reflected yet.{" "}
        {isAdmin
          ? "Use ↻ Refresh to rebuild them now."
          : // Not "after the next sync": the cron rebuilds them before
            // starting one, since the sync it starts may be killed too.
            "They rebuild automatically, usually within the hour."}
      </p>
    </div>
  );
}
