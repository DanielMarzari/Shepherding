import { Card, CardHeader } from "@/components/ui";
import type { SyncSettings } from "@/lib/pco";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function SchedulePreview({ settings }: { settings: SyncSettings }) {
  const next = nextRuns(settings, 6);
  return (
    <Card className="h-full">
      <CardHeader
        title="Schedule preview"
        right={
          <span className="text-xs text-muted">
            {settings.enabled ? "next 6 runs" : "auto-sync off"}
          </span>
        }
      />
      <div className="p-5">
        <p className="text-xs text-muted mb-4">
          Computed from the schedule on the left. Reflects the moment auto-sync is active.
        </p>
        {!settings.enabled ? (
          <div className="rounded border border-border-soft px-4 py-6 text-center text-sm text-muted">
            Auto-sync is off. Toggle &ldquo;Run automatically&rdquo; on the left to schedule.
          </div>
        ) : (
          <ol className="space-y-2">
            {next.map((d, i) => (
              <li
                key={i}
                className="flex items-center justify-between rounded border border-border-soft px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-3">
                  <span className="text-xs text-muted tnum w-7">{i === 0 ? "next" : `+${i}`}</span>
                  <span className="font-medium">{formatRunDate(d)}</span>
                </span>
                <span className="text-xs text-muted tnum">
                  {String(d.getHours()).padStart(2, "0")}:00
                </span>
              </li>
            ))}
          </ol>
        )}

        <div className="mt-5 pt-4 border-t border-border-soft text-xs text-muted space-y-1.5">
          <Detail label="Frequency" value={labelFor(settings.frequency)} />
          <Detail
            label="Time"
            value={`${String(settings.runAtHour).padStart(2, "0")}:00 local`}
          />
          {settings.frequency === "weekly" && (
            <Detail label="Day" value={fullDow(settings.runAtDow)} />
          )}
          {settings.frequency === "monthly" && (
            <Detail label="Date" value={`${ordinal(settings.runAtDom)} of each month`} />
          )}
          <Detail
            label="Email on failure"
            value={settings.emailOnFailure ? "Yes" : "No"}
          />
          <Detail
            label="Auto-resolve conflicts"
            value={settings.autoResolveConflicts ? "Yes" : "No"}
          />
        </div>
      </div>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <span className="text-fg">{value}</span>
    </div>
  );
}

function labelFor(f: string) {
  if (f === "daily") return "Daily";
  if (f === "weekly") return "Weekly";
  if (f === "monthly") return "Monthly";
  return f;
}

function fullDow(n: number) {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][n] ?? "—";
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function formatRunDate(d: Date) {
  const today = new Date();
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (same(d, today)) return "Today";
  if (same(d, tomorrow)) return "Tomorrow";
  return `${DOW[d.getDay()]} · ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function nextRuns(s: SyncSettings, count: number): Date[] {
  const now = new Date();
  const runs: Date[] = [];
  const cursor = new Date(now);

  if (s.frequency === "daily") {
    cursor.setHours(s.runAtHour, 0, 0, 0);
    if (cursor <= now) cursor.setDate(cursor.getDate() + 1);
    for (let i = 0; i < count; i++) {
      runs.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
  } else if (s.frequency === "weekly") {
    cursor.setHours(s.runAtHour, 0, 0, 0);
    const offset = (s.runAtDow - cursor.getDay() + 7) % 7;
    cursor.setDate(cursor.getDate() + offset);
    if (cursor <= now) cursor.setDate(cursor.getDate() + 7);
    for (let i = 0; i < count; i++) {
      runs.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 7);
    }
  } else if (s.frequency === "monthly") {
    cursor.setDate(s.runAtDom);
    cursor.setHours(s.runAtHour, 0, 0, 0);
    if (cursor <= now) cursor.setMonth(cursor.getMonth() + 1);
    for (let i = 0; i < count; i++) {
      runs.push(new Date(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }
  return runs;
}
