import { AppShell } from "@/components/AppShell";
import { Card, CardHeader, Pill } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import {
  getWeeklyAttendance,
  listImportedAttendanceFiles,
} from "@/lib/attendance-read";
import { listAttendanceSources } from "@/lib/attendance-sources-read";
import { buildAttendanceDistribution } from "@/lib/attendance-distribution";
import { getSyncSettings } from "@/lib/pco";
import { getClassificationCounts } from "@/lib/people-read";
import {
  addAttendanceSourceAction,
  removeAttendanceSourceAction,
  removeAttendanceImportAction,
} from "./actions";
import { AttendanceUploadForm } from "./upload-form";
import { AttendanceHistoryChart } from "./history-chart";
import { DistributionChart } from "./distribution-chart";

export default async function AttendancePage() {
  const session = await requireOrg();
  const settings = getSyncSettings(session.orgId);
  const counts = getClassificationCounts(session.orgId, settings.activityMonths);
  const sources = listAttendanceSources(session.orgId);
  const history = getWeeklyAttendance(session.orgId);
  const importedFiles = listImportedAttendanceFiles(session.orgId);
  // Weekly attendance is now DERIVED from the imported adult in-person
  // average (last 12 mo) — no longer a manually-entered number.
  const weekly = history.adult12moAvg;
  const isAdmin = session.role === "admin";

  const expected = counts.shepherded + counts.active + counts.present;
  const ratio = weekly && expected > 0 ? expected / weekly : null;
  const distribution =
    weekly != null ? buildAttendanceDistribution(expected, weekly) : null;

  return (
    <AppShell active="See more" breadcrumb="See more › Attendance">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Attendance</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Weekly attendance is taken straight from your imported in-person
            numbers — the average adult Sunday attendance over the last 12
            months. We use it to compute the average attendance frequency and
            simulate the distribution across your people.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Weekly attendance</div>
            <div className="tnum text-2xl font-semibold">
              {weekly == null ? <span className="text-subtle">—</span> : weekly.toLocaleString()}
            </div>
            <div className="text-xs text-muted mt-1">adults / week · in-person, 12 mo avg</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Expected attenders</div>
            <div className="tnum text-2xl font-semibold">{expected.toLocaleString()}</div>
            <div className="text-xs text-muted mt-1">shepherded + active + present</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Avg attendance ratio</div>
            <div className="tnum text-2xl font-semibold">
              {ratio == null ? (
                <span className="text-subtle">—</span>
              ) : (
                `1 / ${ratio.toFixed(1)}`
              )}
            </div>
            <div className="text-xs text-muted mt-1">expected ÷ weekly</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Avg interval</div>
            <div className="tnum text-2xl font-semibold">
              {ratio == null ? (
                <span className="text-subtle">—</span>
              ) : (
                `${ratio.toFixed(1)} weeks`
              )}
            </div>
            <div className="text-xs text-muted mt-1">between visits per person</div>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Weekly attendance history"
            badge={
              history.rows.length > 0 ? (
                <Pill tone="muted">
                  {history.rows.length.toLocaleString()} weeks
                </Pill>
              ) : null
            }
            right={
              history.earliest && history.latest ? (
                <span className="text-xs text-muted">
                  {history.earliest} → {history.latest} ·{" "}
                  {history.totalSourceFiles} file
                  {history.totalSourceFiles === 1 ? "" : "s"}
                </span>
              ) : null
            }
          />
          <div className="p-5 space-y-4">
            {history.rows.length === 0 ? (
              <p className="text-sm text-muted">
                No weekly history imported yet. Upload one or more{" "}
                <span className="text-fg">
                  &ldquo;Worship and Activities Attendance - YYYY QN.xlsx&rdquo;
                </span>{" "}
                files below and the chart will fill in.
              </p>
            ) : (
              <>
                {history.inPerson12moAvg != null && (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <Card className="p-3">
                      <div className="text-xs text-muted mb-1">
                        In-person · last 12 mo avg
                      </div>
                      <div className="tnum text-xl font-semibold">
                        {history.inPerson12moAvg.toLocaleString()}
                      </div>
                      {history.inPersonTrend12moDelta != null && (
                        <div
                          className={`text-[11px] mt-1 ${
                            history.inPersonTrend12moDelta > 0
                              ? "text-good-soft-fg"
                              : history.inPersonTrend12moDelta < 0
                                ? "text-warn-soft-fg"
                                : "text-muted"
                          }`}
                        >
                          {history.inPersonTrend12moDelta > 0 ? "↑" : "↓"}{" "}
                          {Math.abs(history.inPersonTrend12moDelta)}% vs
                          prior 12 mo
                        </div>
                      )}
                    </Card>
                    <Card className="p-3">
                      <div className="text-xs text-muted mb-1">
                        Peak Sunday · last 12 mo
                      </div>
                      <div className="tnum text-xl font-semibold">
                        {history.inPerson12moPeak?.toLocaleString() ?? "—"}
                      </div>
                      <div className="text-[11px] text-muted mt-1">
                        biggest single Sunday
                      </div>
                    </Card>
                    <Card className="p-3">
                      <div className="text-xs text-muted mb-1">
                        Data span
                      </div>
                      <div className="tnum text-xl font-semibold">
                        {history.rows.length.toLocaleString()}
                      </div>
                      <div className="text-[11px] text-muted mt-1">
                        Sundays imported
                      </div>
                    </Card>
                  </div>
                )}
                <AttendanceHistoryChart rows={history.rows} />
              </>
            )}
          </div>
        </Card>

        {distribution && distribution.buckets.length > 0 && (
          <Card>
            <CardHeader
              title="Simulated frequency distribution"
              right={
                <span className="text-xs text-muted">
                  weekly bucket {distribution.targetWeekly.toLocaleString()} ·
                  total {distribution.expected.toLocaleString()}
                </span>
              }
            />
            <div className="p-5">
              <p className="text-sm text-muted mb-5">
                Anchored at <span className="text-fg tnum">{distribution.targetWeekly.toLocaleString()}</span>{" "}
                people who attend every week, then geometrically tapering down through the
                less-frequent buckets so the column sums to{" "}
                <span className="text-fg tnum">{distribution.expected.toLocaleString()}</span>{" "}
                total. Decay ratio{" "}
                <span className="font-mono text-xs">r = {distribution.decayRatio.toFixed(2)}</span>.
                Implied weekly attendance from the curve:{" "}
                <span className="text-fg tnum">{distribution.impliedWeekly.toLocaleString()}</span>{" "}
                (higher than the &ldquo;every week&rdquo; bucket because some people in the
                tail still attend on any given week).
              </p>
              <DistributionChart distribution={distribution} />
            </div>
          </Card>
        )}

        <Card className="p-5">
          <h2 className="text-sm font-semibold mb-2">How the math works</h2>
          <p className="text-sm text-muted">
            With <span className="text-fg tnum">{expected.toLocaleString()}</span> expected
            attenders and{" "}
            <span className="text-fg tnum">
              {weekly != null ? weekly.toLocaleString() : "(no imported data yet)"}
            </span>{" "}
            actual weekly attenders, the average person attends about{" "}
            <span className="text-fg">
              {ratio == null ? "—" : `1 in every ${ratio.toFixed(1)} weeks`}
            </span>
            . A ratio close to 1 means people come most weeks; a ratio of 4+ suggests many
            of your &quot;expected&quot; people are spotty Sunday attenders.
          </p>
          <p className="text-sm text-muted mt-3">
            The distribution above is a model — once Sunday Check-Ins are synced, this
            simulated curve will be replaced by per-person attendance frequencies.
          </p>
        </Card>

        <Card>
          <CardHeader
            title="Data sources"
            right={
              <span className="text-xs text-muted">
                {sources.length} link{sources.length === 1 ? "" : "s"}
              </span>
            }
          />
          <div className="p-5 space-y-4">
            <p className="text-xs text-muted">
              Spreadsheets and docs that hold historical attendance data
              (e.g. SharePoint Excel files). Links go below; for the
              standard{" "}
              <span className="text-fg">
                Worship and Activities Attendance
              </span>{" "}
              quarterly files you can also drop the .xlsx into the
              importer to populate the chart above.
            </p>
            {isAdmin && (
              <div className="rounded-lg border border-border-soft bg-bg-elev-2/50 p-4">
                <div className="text-xs font-medium mb-2">
                  Import attendance .xlsx files
                </div>
                <p className="text-[11px] text-muted mb-3">
                  Multi-select supported. The parser scans for &ldquo;Total
                  In-Person Worship&rdquo;, kids / student / adult
                  subtotals, the Sunday live-stream count, and ABFs. Files
                  that don&apos;t match still upload — they just produce a
                  warning instead of throwing.
                </p>
                <AttendanceUploadForm />
              </div>
            )}

            {importedFiles.length > 0 && (
              <div>
                <div className="text-xs font-medium mb-2">
                  Imported files ({importedFiles.length})
                </div>
                <ul className="divide-y divide-border-softer rounded-lg border border-border-soft">
                  {importedFiles.map((f) => (
                    <li
                      key={f.sourceFile}
                      className="flex items-center gap-3 px-3.5 py-2.5 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium break-words">
                          {f.sourceFile}
                        </div>
                        <div className="text-[11px] text-subtle tnum">
                          {f.weeks} week{f.weeks === 1 ? "" : "s"} · {f.earliest} → {f.latest}
                        </div>
                      </div>
                      {isAdmin && (
                        <form action={removeAttendanceImportAction}>
                          <input
                            type="hidden"
                            name="sourceFile"
                            value={f.sourceFile}
                          />
                          <button
                            type="submit"
                            className="text-xs text-muted hover:text-warn-soft-fg cursor-pointer"
                            title={`Remove all ${f.weeks} weeks imported from this file`}
                          >
                            Remove
                          </button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {sources.length > 0 && (
              <ul className="divide-y divide-border-softer rounded-lg border border-border-soft">
                {sources.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-start gap-3 px-3.5 py-2.5 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium hover:text-accent break-words"
                      >
                        {s.label} ↗
                      </a>
                      <div className="text-[11px] text-subtle truncate">
                        {s.url}
                      </div>
                      {s.notes && (
                        <div className="text-xs text-muted mt-1">
                          {s.notes}
                        </div>
                      )}
                    </div>
                    {isAdmin && (
                      <form action={removeAttendanceSourceAction}>
                        <input type="hidden" name="id" value={s.id} />
                        <button
                          type="submit"
                          className="text-xs text-muted hover:text-warn-soft-fg cursor-pointer"
                          title="Remove this source"
                        >
                          Remove
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {isAdmin && (
              <form
                key={sources.length}
                action={addAttendanceSourceAction}
                className="grid grid-cols-1 sm:grid-cols-[1fr_2fr_auto] gap-2 text-sm"
              >
                <input
                  name="label"
                  required
                  maxLength={200}
                  placeholder="Label (e.g. 2023 Sunday attendance)"
                  className="bg-bg-elev-2 border border-border-soft rounded px-2.5 py-1.5 text-fg placeholder:text-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
                <input
                  name="url"
                  type="url"
                  required
                  maxLength={2000}
                  placeholder="https://..."
                  className="bg-bg-elev-2 border border-border-soft rounded px-2.5 py-1.5 text-fg placeholder:text-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg border border-accent text-accent hover:bg-accent hover:text-bg text-xs font-medium cursor-pointer"
                >
                  Add source
                </button>
                <input
                  name="notes"
                  maxLength={1000}
                  placeholder="Notes (optional)"
                  className="sm:col-span-3 bg-bg-elev-2 border border-border-soft rounded px-2.5 py-1.5 text-fg placeholder:text-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </form>
            )}
            {!isAdmin && sources.length === 0 && (
              <p className="text-sm text-muted">
                No sources added yet.
              </p>
            )}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

