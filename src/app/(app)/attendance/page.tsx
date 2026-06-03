import { AppShell } from "@/components/AppShell";
import { Card, CardHeader, Pill } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import {
  getWeeklyAttendance,
  listImportedAttendanceFiles,
} from "@/lib/attendance-read";
import { listAttendanceSources } from "@/lib/attendance-sources-read";
import { buildAttendanceDistribution } from "@/lib/attendance-distribution";
import { loadWeatherForWeeks } from "@/lib/weather-trexlertown";
import { analyzeSeasonalTrends } from "@/lib/attendance-seasonal";
import {
  getPreacherByWeek,
  analyzePreachers,
  analyzePreacherTrends,
} from "@/lib/attendance-preacher";
import { analyzeFamilyTrends } from "@/lib/attendance-family";
import { getSyncSettings } from "@/lib/pco";
import { getClassificationCounts } from "@/lib/people-read";
import {
  addAttendanceSourceAction,
  removeAttendanceSourceAction,
  removeAttendanceImportAction,
} from "./actions";
import { AttendanceUploadForm } from "./upload-form";
import { AttendanceHistoryChart } from "./history-chart";
import { AttendanceWeatherChart } from "./weather-chart";
import { PreacherChart } from "./preacher-chart";
import { FamilyChart } from "./family-chart";
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

  // Weather overlay + seasonal-trend analysis (second chart).
  const weather = await loadWeatherForWeeks(
    history.rows.map((r) => r.week_date),
  );
  const seasonal = analyzeSeasonalTrends(history.rows, weather);
  const weatherCells = history.rows.map((r) => {
    const w = weather.get(r.week_date);
    return {
      tmaxF: w?.tmaxF ?? null,
      tminF: w?.tminF ?? null,
      rainIn: w?.rainIn ?? null,
      snowIn: w?.snowIn ?? null,
    };
  });
  const hasWeather = weatherCells.some((w) => w.tmaxF != null);

  // Preacher overlay (LIVE service) — third chart.
  const preacherByWeek = getPreacherByWeek(
    session.orgId,
    history.rows.map((r) => r.week_date),
  );
  const preacher = analyzePreachers(history.rows, preacherByWeek);
  const preacherTrends = analyzePreacherTrends(history.rows, preacher.perWeek);
  const hasPreacher = preacher.stats.length > 0;

  // Adults vs. kids (family) chart + trends.
  const family = analyzeFamilyTrends(history.rows);
  const hasFamily = history.rows.some(
    (r) => r.kids_total != null || r.adult_total != null,
  );

  const expected = counts.shepherded + counts.active + counts.present;
  const ratio = weekly && expected > 0 ? expected / weekly : null;
  const distribution =
    weekly != null ? buildAttendanceDistribution(expected, weekly) : null;
  // Variability as a % of the mean (the normal week-to-week swing).
  const stdDevPct =
    seasonal.weeklyMean && seasonal.weeklyStdDev != null
      ? Math.round((seasonal.weeklyStdDev / seasonal.weeklyMean) * 100)
      : null;

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
            <div className="text-xs text-muted mb-1.5">Avg increase / year</div>
            <div
              className={`tnum text-2xl font-semibold ${
                seasonal.yearlyGrowthPct == null
                  ? ""
                  : seasonal.yearlyGrowthPct > 0
                    ? "text-good-soft-fg"
                    : seasonal.yearlyGrowthPct < 0
                      ? "text-warn-soft-fg"
                      : ""
              }`}
            >
              {seasonal.yearlyGrowthPct == null ? (
                <span className="text-subtle">—</span>
              ) : (
                `${seasonal.yearlyGrowthPct >= 0 ? "+" : ""}${seasonal.yearlyGrowthPct}%`
              )}
            </div>
            <div className="text-xs text-muted mt-1">5-year trend</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Avg variability</div>
            <div className="tnum text-2xl font-semibold">
              {seasonal.weeklyStdDev == null ? (
                <span className="text-subtle">—</span>
              ) : (
                `±${Math.round(seasonal.weeklyStdDev).toLocaleString()}`
              )}
            </div>
            <div className="text-xs text-muted mt-1">
              {stdDevPct == null
                ? "normal weekly swing (1σ)"
                : `±${stdDevPct}% · normal weekly swing (1σ)`}
            </div>
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
                {seasonal.seasonalInsights.length > 0 && (
                  <div className="pt-1">
                    <h3 className="text-sm font-semibold mb-2">
                      Patterns we spotted
                    </h3>
                    <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {seasonal.seasonalInsights.map((ins, i) => (
                        <li
                          key={i}
                          className="rounded-lg border border-border-soft bg-bg-elev-2/40 p-3"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-block w-1.5 h-1.5 rounded-full ${
                                ins.tone === "up"
                                  ? "bg-good-soft-fg"
                                  : ins.tone === "down"
                                    ? "bg-warn-soft-fg"
                                    : "bg-muted"
                              }`}
                            />
                            <span className="text-sm font-medium">
                              {ins.title}
                            </span>
                          </div>
                          <p className="text-xs text-muted mt-1 leading-relaxed">
                            {ins.detail}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </Card>

        {history.rows.length > 0 && (
          <Card>
            <CardHeader
              title="Attendance vs. Weather (Trexlertown, PA)"
              badge={
                seasonal.weatherInsights.length > 0 ? (
                  <Pill tone="muted">
                    {seasonal.weatherInsights.length} trend
                    {seasonal.weatherInsights.length === 1 ? "" : "s"}
                  </Pill>
                ) : null
              }
              right={
                !hasWeather ? (
                  <span className="text-xs text-muted">
                    weather backfilling…
                  </span>
                ) : null
              }
            />
            <div className="p-5 space-y-5">
              {!hasWeather && (
                <p className="text-xs text-muted">
                  Historical weather for Trexlertown is fetched from the
                  Open-Meteo archive and cached. If the line is missing,
                  reload in a moment — the first load backfills the full
                  span.
                </p>
              )}
              <AttendanceWeatherChart
                rows={history.rows}
                weather={weatherCells}
                markers={seasonal.markers}
              />
              {seasonal.weatherInsights.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">
                    What the weather accounts for
                  </h3>
                  <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {seasonal.weatherInsights.map((ins, i) => (
                      <li
                        key={i}
                        className="rounded-lg border border-border-soft bg-bg-elev-2/40 p-3"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-block w-1.5 h-1.5 rounded-full ${
                              ins.tone === "up"
                                ? "bg-good-soft-fg"
                                : ins.tone === "down"
                                  ? "bg-warn-soft-fg"
                                  : "bg-muted"
                            }`}
                          />
                          <span className="text-sm font-medium">
                            {ins.title}
                          </span>
                        </div>
                        <p className="text-xs text-muted mt-1 leading-relaxed">
                          {ins.detail}
                        </p>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-subtle mt-2">
                    Trends compare each pattern against the typical week
                    (median ={" "}
                    {seasonal.baseline != null
                      ? seasonal.baseline.toLocaleString()
                      : "—"}{" "}
                    in person).
                  </p>
                </div>
              )}
            </div>
          </Card>
        )}

        {hasFamily && (
          <Card>
            <CardHeader
              title="Adults vs. Kids"
              badge={
                family.insights.length > 0 ? (
                  <Pill tone="muted">
                    {family.insights.length} trend
                    {family.insights.length === 1 ? "" : "s"}
                  </Pill>
                ) : null
              }
            />
            <div className="p-5 space-y-4">
              <FamilyChart rows={history.rows} kidsShare={family.kidsShare} />
              {family.insights.length > 0 && (
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {family.insights.map((ins, i) => (
                    <li
                      key={i}
                      className="rounded-lg border border-border-soft bg-bg-elev-2/40 p-3"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block w-1.5 h-1.5 rounded-full ${
                            ins.tone === "up"
                              ? "bg-good-soft-fg"
                              : ins.tone === "down"
                                ? "bg-warn-soft-fg"
                                : "bg-muted"
                          }`}
                        />
                        <span className="text-sm font-medium">{ins.title}</span>
                      </div>
                      <p className="text-xs text-muted mt-1 leading-relaxed">
                        {ins.detail}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        )}

        {hasPreacher && (
          <Card>
            <CardHeader
              title="Attendance by preacher (LIVE service)"
              badge={
                <Pill tone="muted">
                  {preacher.stats.length} preacher
                  {preacher.stats.length === 1 ? "" : "s"}
                </Pill>
              }
            />
            <div className="p-5 space-y-4">
              <PreacherChart
                rows={history.rows}
                perWeek={preacher.perWeek}
                stats={preacher.stats}
              />
              {preacherTrends.insights.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">
                    Does the preacher move attendance?
                  </h3>
                  <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {preacherTrends.insights.map((ins, i) => (
                      <li
                        key={i}
                        className="rounded-lg border border-border-soft bg-bg-elev-2/40 p-3"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-block w-1.5 h-1.5 rounded-full ${
                              ins.tone === "up"
                                ? "bg-good-soft-fg"
                                : ins.tone === "down"
                                  ? "bg-warn-soft-fg"
                                  : "bg-muted"
                            }`}
                          />
                          <span className="text-sm font-medium">
                            {ins.title}
                          </span>
                        </div>
                        <p className="text-xs text-muted mt-1 leading-relaxed">
                          {ins.detail}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-[11px] text-subtle">
                Preacher is taken from PCO Services — the person in a
                preaching / teaching / speaker position on each Sunday&apos;s
                plan, preferring the LIVE service when a date has several.
                Averages exclude weeks flagged as exceptions. η² is the share
                of attendance variation explained by who preached (0 = no
                effect, 1 = entirely the preacher).
              </p>
            </div>
          </Card>
        )}

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

