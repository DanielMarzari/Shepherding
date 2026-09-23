import { Fragment } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Card, CardHeader, Pill, Stat } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { computeGivingImpact, type Overlay, type Reading } from "@/lib/giving-impact";
import { GivingWeeksChart } from "./giving-weeks-chart";

export const dynamic = "force-dynamic";

function fmtDate(iso: string): string {
  return new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
function shortDate(iso: string): string {
  return new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
function pct(x: number | null | undefined): string {
  if (x == null) return "—";
  const v = Math.round(x * 100);
  return (v > 0 ? "+" : "") + v + "%";
}
function pts(x: number | null | undefined): string {
  if (x == null) return "—";
  const v = Math.round(x * 100);
  return (v > 0 ? "+" : "") + v + " pts";
}

function ReadingRow({ label, r }: { label: string; r: Reading }) {
  return (
    <tr className="border-b border-border-soft/60 last:border-0 align-top">
      <td className="px-4 py-2 text-xs">{label}</td>
      <td className="px-4 py-2 text-xs text-muted whitespace-nowrap">{r.windowLabel}</td>
      {r.enough ? (
        <>
          <td className="px-4 py-2 text-xs tnum whitespace-nowrap">
            {pct(r.withMedian)} <span className="text-subtle">(n={r.nWith})</span>
          </td>
          <td className="px-4 py-2 text-xs tnum whitespace-nowrap">
            {pct(r.withoutMedian)} <span className="text-subtle">(n={r.nWithout})</span>
          </td>
          <td className="px-4 py-2 text-xs tnum font-medium whitespace-nowrap">
            {pts(r.contrast)}
            {r.lead && (
              <span className="ml-1.5 font-normal text-warn-soft-fg italic">a lead, not proof</span>
            )}
          </td>
        </>
      ) : (
        <td className="px-4 py-2 text-xs text-warn-soft-fg" colSpan={3}>
          n={r.nWith} marked / {r.nWithout} unmarked — too few to divide, so no percentage is shown.
        </td>
      )}
    </tr>
  );
}

function OverlayCard({ o }: { o: Overlay }) {
  return (
    <Card>
      <CardHeader
        title={o.title}
        badge={
          <Pill tone={o.verdict.tone === "blocked" ? "warn" : "muted"}>
            {o.markedSundays} of {o.candidateSundays} Sundays
          </Pill>
        }
      />
      <div className="px-5 py-4 space-y-3">
        <p className="text-xs text-muted leading-relaxed max-w-3xl">{o.what}</p>
        <div className="rounded-lg border border-border-soft bg-bg-elev-2/40 p-3">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                o.verdict.tone === "up"
                  ? "bg-accent"
                  : o.verdict.tone === "blocked"
                    ? "bg-warn-soft-fg"
                    : "bg-muted"
              }`}
            />
            <span className="text-sm font-medium">{o.verdict.title}</span>
          </div>
          <p className="text-xs text-muted mt-1 leading-relaxed">{o.verdict.detail}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-border-soft">
                <th className="font-medium px-4 py-2">What we counted</th>
                <th className="font-medium px-4 py-2">Window</th>
                <th className="font-medium px-4 py-2">Marked Sundays</th>
                <th className="font-medium px-4 py-2">Every other Sunday</th>
                <th className="font-medium px-4 py-2">Difference</th>
              </tr>
            </thead>
            <tbody>
              {o.metrics.map((m) => (
                <Fragment key={m.key}>
                  <ReadingRow
                    label={m.label + (m.role === "scheduled" ? " — cannot respond" : "")}
                    r={m.sameWeek}
                  />
                  <ReadingRow label="" r={m.fiveWeek} />
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {o.sundays.length > 0 && o.sundays.length <= 12 && (
          <p className="text-xs text-muted">
            Marked: {o.sundays.map((d) => shortDate(d)).join(", ")}.
          </p>
        )}
      </div>
    </Card>
  );
}

export default async function GivingImpactPage() {
  const session = await requireOrg();
  const d = computeGivingImpact(session.orgId);
  const windowLabel =
    d.firstGiftOn && d.lastGiftOn ? `${fmtDate(d.firstGiftOn)} – ${fmtDate(d.lastGiftOn)}` : "no gifts imported";
  const responding = d.sources.filter((s) => s.role === "responding").reduce((a, s) => a + s.gifts, 0);
  const scheduled = d.sources.filter((s) => s.role === "scheduled").reduce((a, s) => a + s.gifts, 0);
  const lagging = d.sources.filter((s) => s.role === "lagging").reduce((a, s) => a + s.gifts, 0);
  const b = d.brewBreak;
  const counts = d.announcers.map((a) => a.sundays.length).sort((x, y) => x - y);
  const medianSundays = counts.length
    ? (counts.length % 2
        ? counts[counts.length >> 1]
        : (counts[(counts.length >> 1) - 1] + counts[counts.length >> 1]) / 2) + " Sundays"
    : "no Sundays";
  const onceOnly = counts.filter((c) => c === 1).length;

  return (
    <AppShell active="Giving impact" breadcrumb="Next steps › Giving impact">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div className="flex items-baseline justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Giving impact</h1>
            <p className="text-muted text-sm mt-1 max-w-3xl">
              What we said about giving from the stage, and whether giving moved after it. Everything here is a
              count of <span className="text-fg font-medium">gifts and givers</span> — the PushPay Transactions
              export carries no amounts at all, so no figure on this page is, or stands in for, money. Nothing
              below is evidence of cause: campaigns, holidays, the school year and pay cycles move these same
              weeks.{" "}
              <Link href="/sermon-impact" className="text-accent-soft-fg hover:underline">
                Sermon impact
              </Link>{" "}
              and{" "}
              <Link href="/announcement-impact" className="text-accent-soft-fg hover:underline">
                Announcement impact
              </Link>{" "}
              ask the same question of other next steps, with the same method.
            </p>
          </div>
          <div className="text-right text-xs text-muted">
            <div className="text-fg font-medium">{windowLabel}</div>
            <div>
              {d.completeWeeks} complete weeks{" "}
              {d.partialWeeks.length > 0 && `· ${d.partialWeeks.length} part-weeks set aside`}
            </div>
          </div>
        </div>

        {!d.hasGifts ? (
          <Card className="p-8 text-center">
            <p className="text-sm text-muted">
              No PushPay Transactions export has been loaded yet, so there is nothing to line the stage up
              against.{" "}
              <Link href="/pushpay" className="text-accent-soft-fg hover:underline">
                Upload one →
              </Link>
            </p>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat
                label="Gifts in the window"
                value={d.gifts.toLocaleString("en-US")}
                delta={`${Math.round(d.giftsPerWeek ?? 0)} a week · never an amount`}
              />
              <Stat
                label="Responding gifts"
                value={responding.toLocaleString("en-US")}
                valueTone="accent"
                delta="Web, Text, Mobile, Kiosk — can answer a Sunday"
              />
              <Stat
                label="Recurring gifts"
                value={scheduled.toLocaleString("en-US")}
                delta="scheduled in advance — the control line"
              />
              <Stat
                label="Batch Entry gifts"
                value={lagging.toLocaleString("en-US")}
                valueTone="warn"
                delta="cash or cheque keyed in later — the date lags"
              />
            </div>

            <Card>
              <CardHeader
                title="Weekly giving activity"
                badge={<Pill tone="muted">gift counts</Pill>}
                right={
                  <span className="text-xs text-muted hidden sm:inline">
                    {d.firstWeek && d.lastWeek ? `${shortDate(d.firstWeek)} – ${shortDate(d.lastWeek)}` : ""}
                  </span>
                }
              />
              <div className="px-4 pt-4 pb-3">
                <GivingWeeksChart weeks={d.weeks} />
              </div>
              <div className="px-5 pb-4 text-xs text-muted leading-relaxed space-y-1.5 max-w-4xl">
                <p>
                  Three kinds of gift, and they must not be added together.{" "}
                  <span className="text-fg">Responding gifts</span>{" "}
                  (Web, Text Giving, Mobile, Kiosk) are the only ones that can answer something said on a
                  Sunday. <span className="text-fg">Recurring</span> was set up weeks or months earlier, so it
                  rides along as a control: when it moves in the same weeks as the responding line, the week
                  moved, not the ask. <span className="text-fg">Batch Entry</span> is cash or a cheque keyed in
                  by hand afterwards, so its date is the day someone typed it, not the day it was given — it is
                  real giving, but it cannot be read as a response to a date.
                </p>
                <p>
                  Shaded columns are part-weeks at the two ends of the export
                  {d.partialWeeks.length > 0 && ` (${d.partialWeeks.map((w) => shortDate(w)).join(" and ")})`}.
                  They are drawn so the chart does not appear to start and stop mid-air, and left out of every
                  norm and every comparison below.
                </p>
                {d.processingGifts > 0 && (
                  <p>
                    {d.processingGifts} gifts have not settled yet, and they sit in{" "}
                    {d.processingWeeks.length === 1 ? "one week" : `${d.processingWeeks.length} weeks`} of the
                    window ({d.processingWeeks.map((w) => shortDate(w)).join(", ")}) — gifts from earlier in
                    the year cleared long ago. They are counted anyway, because dropping them would shave only
                    those weeks and read as a fall in giving that is really a fall in clearing time.
                  </p>
                )}
              </div>
            </Card>

            <section className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold">Did giving move after we asked?</h2>
                <p className="text-xs text-muted max-w-4xl mt-1 leading-relaxed">
                  The same comparison the Sermon and Announcement pages make, function for function: total the
                  gifts in the window after a marked Sunday, divide by the{" "}
                  <span className="text-fg">median</span> total of the same-length stretches in the surrounding
                  half-year on each side — a local seasonal norm, so a January and an August Sunday are each
                  judged against their own time of year — then take the median of those ratios across Sundays.
                  Medians throughout, never an average of ratios. Two windows are shown for every overlay: the
                  Sunday itself and the six days after (giving can answer the same morning) and the five weeks
                  after (what the other two pages use). Both are always printed, so neither can be the one that
                  happened to look better. A difference here is a coincidence in time, never a cause — the
                  Recurring line is on every table as a partial check on exactly that.
                </p>
              </div>
              {d.overlays.map((o) => (
                <OverlayCard key={o.key} o={o} />
              ))}
              <p className="text-xs text-muted max-w-4xl leading-relaxed">
                Of the {d.sermonsClassified} Sundays inside this window whose sermon the classifier read,{" "}
                <span className="text-fg">{d.sermonsCalled}</span> recorded an actual call to give and{" "}
                {d.sermonsMentioned} mentioned giving without asking. {d.sermonsCalled} is a small number of
                Sundays; it is the number there is. Sermon transcripts also stop before the gifts do, so the
                last weeks of the chart have no sermon to line up against. The order of service is the opposite
                problem: {d.planSundaysWithGiving} of the {d.planSundays} Sundays that have a plan carry a
                giving item — {d.planGivingPlans} orders of service in all, because a Sunday can run more
                than one service — so
                there is effectively no Sunday without one to compare against. That is a fact about the
                service, not a shortcoming in the data, and it is why that overlay prints counts instead of a
                percentage.
              </p>
            </section>

            <Card>
              <CardHeader
                title="Brew Break"
                badge={<Pill tone="warn">one complete week</Pill>}
                right={
                  <span className="text-xs text-muted">
                    {b.sundays.length ? b.sundays.map((s) => shortDate(s)).join(" · ") : "not found"}
                  </span>
                }
              />
              <div className="px-5 py-4 space-y-3 text-sm">
                {b.week == null ? (
                  <p className="text-xs text-muted">
                    Nothing in the orders of service names a Brew Break inside the gift window.
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-muted leading-relaxed max-w-4xl">
                      <span className="text-fg font-medium">What it is, in the data.</span> The words appear in{" "}
                      {b.items} plan items in the whole synced history of the orders of service, on{" "}
                      {b.sundays.length} Sundays — {b.sundays.map((s) => fmtDate(s)).join(" and ")} — and never
                      before that.{" "}
                      {b.givingLine && (
                        <>
                          On {fmtDate(b.givingLine.sunday)} it sits in a line of the order of service that
                          reads{" "}
                          <span className="text-fg">&ldquo;{b.givingLine.text}&rdquo;</span> — the only place
                          in the data where Brew Break and giving are named together.{" "}
                        </>
                      )}
                      Gifts stop on{" "}
                      {d.lastGiftOn ? fmtDate(d.lastGiftOn) : "—"}, so there is exactly{" "}
                      <span className="text-fg">one complete week</span> after it started: the week of{" "}
                      {fmtDate(b.week)}.
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <Stat
                        label={`Responding gifts, week of ${shortDate(b.week)}`}
                        value={b.weekRespondingGifts ?? "—"}
                        delta={`from ${b.weekRespondingGivers ?? "—"} givers`}
                      />
                      <Stat
                        label="That week vs the local norm"
                        value={pct(b.upliftAllRows)}
                        delta="every gift row counted"
                      />
                      <Stat
                        label="Same week, settled gifts only"
                        value={pct(b.upliftSettledOnly)}
                        valueTone="warn"
                        delta={`drops the ${b.weekProcessingResponding ?? 0} responding gifts that week that have not cleared`}
                      />
                      <Stat
                        label={`Biggest week of the window`}
                        value={b.peakWeekGifts ?? "—"}
                        delta={
                          b.peakWeek
                            ? `week of ${shortDate(b.peakWeek)}${b.peakWeek < b.week ? " — before Brew Break" : ""}`
                            : ""
                        }
                      />
                    </div>
                    <p className="text-xs text-muted leading-relaxed max-w-4xl">
                      <span className="text-warn-soft-fg font-medium">Read those two middle numbers together.</span>{" "}
                      The same week reads {pct(b.upliftAllRows)} counting every gift and{" "}
                      {pct(b.upliftSettledOnly)} counting only the ones that have cleared the bank. A single
                      week whose answer changes sign on a bookkeeping choice is not an answer.
                    </p>

                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[560px]">
                        <thead>
                          <tr className="text-left text-xs text-muted border-b border-border-soft">
                            <th className="font-medium px-4 py-2">Sunday</th>
                            <th className="font-medium px-4 py-2">People checked in</th>
                            <th className="font-medium px-4 py-2">Responding gifts that day</th>
                            <th className="font-medium px-4 py-2">Gifts per 100 checked in</th>
                          </tr>
                        </thead>
                        <tbody>
                          {b.recent.map((r) => (
                            <tr
                              key={r.sunday}
                              className={`border-b border-border-soft/60 last:border-0 ${
                                r.sunday === b.week ? "bg-warn-soft-bg/40" : ""
                              }`}
                            >
                              <td className="px-4 py-2 text-xs whitespace-nowrap">
                                {shortDate(r.sunday)}
                                {r.sunday === b.week && (
                                  <span className="ml-1.5 text-warn-soft-fg font-medium">Brew Break</span>
                                )}
                              </td>
                              <td className="px-4 py-2 text-xs tnum">{r.checkedIn ?? "—"}</td>
                              <td className="px-4 py-2 text-xs tnum">{r.respondingGifts}</td>
                              <td className="px-4 py-2 text-xs tnum">
                                {r.per100 == null ? "—" : r.per100.toFixed(1)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-muted leading-relaxed max-w-4xl">
                      {b.per100N === 0 ? (
                        "No Sunday in the window has a check-in count, so there is nothing to divide by and the last column above is empty. "
                      ) : (
                        <>
                          Across the {b.per100N} Sundays of the window the median is{" "}
                          <span className="text-fg tnum">{b.per100Median?.toFixed(1) ?? "—"}</span> responding
                          gifts per 100 people checked in. The Brew Break Sunday sits at{" "}
                          <span className="text-fg tnum">{b.per100Brew?.toFixed(1) ?? "—"}</span>
                          {b.per100Verdict === "near"
                            ? ` — inside the ordinary Sunday-to-Sunday scatter, which runs ±${b.per100Mad?.toFixed(1)} around that median, so it is an unremarkable Sunday on this measure. `
                            : b.per100Verdict === "above"
                              ? ` — further above that median than the ordinary Sunday-to-Sunday scatter of ±${b.per100Mad?.toFixed(1)} accounts for. `
                              : b.per100Verdict === "below"
                                ? ` — further below that median than the ordinary Sunday-to-Sunday scatter of ±${b.per100Mad?.toFixed(1)} accounts for. `
                                : ", and there is no check-in count for that Sunday to compare it against. "}
                        </>
                      )}
                      {b.peakWeek && b.peakWeek < b.week
                        ? `The biggest giving week of the whole window (${b.peakWeekGifts} responding gifts) was the week of ${shortDate(b.peakWeek)} — before Brew Break, not after it. `
                        : ""}
                      <span className="text-warn-soft-fg">Check-in is not attendance:</span> on the{" "}
                      {b.checkinCoverageN} Sundays where the attendance sheet also has a count, check-in covers
                      a median {Math.round((b.checkinCoverage ?? 0) * 100)}% of the people in the room — it is
                      mostly children and volunteers. Use this column to compare Sundays with each other, never
                      as gifts per person present.
                    </p>
                    <p className="text-xs leading-relaxed max-w-4xl rounded-lg border border-warn-soft-bg bg-warn-soft-bg/40 p-3">
                      <span className="font-medium">One week cannot separate Brew Break from the late-summer
                      climb.</span>{" "}
                      {b.peakWeekIsWeekBefore
                        ? "Giving was already rising through August — the week before Brew Break was the highest of the whole window — and school"
                        : b.peakWeek && b.peakWeek < b.week
                          ? `Giving was already rising through the summer — the biggest week of the whole window (${shortDate(b.peakWeek)}) came before Brew Break — and school`
                          : "School"}{" "}
                      starting, the end of holidays and pay cycles all move these
                      same weeks every year. With one complete week, a sign that flips on whether still-clearing
                      gifts are counted, and no second year to compare against, there is nothing here that could
                      tell an effect from the season.{" "}
                      <span className="font-medium">What would settle it:</span> four to six complete weeks with
                      Brew Break running, from a fresh Transactions export — and the same stretch of last
                      year&rsquo;s calendar for the seasonal comparison this window is too short to make.
                    </p>
                  </>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Who gave the announcements"
                badge={<Pill tone="muted">{d.announcers.length} people · {d.announcerSundays.length} Sundays</Pill>}
              />
              <div className="px-5 py-4 space-y-3">
                <p className="text-xs leading-relaxed max-w-4xl rounded-lg border border-border-soft bg-bg-elev-2/40 p-3">
                  <span className="font-medium">This is not a ranking, and it cannot be turned into one.</span>{" "}
                  {d.announcers.length} people held the Announcements slot across {d.announcerSundays.length}{" "}
                  Sundays — a median of {medianSundays} each, and {onceOnly} of them on a single Sunday. At that
                  size the difference between any two people is noise: one unusual Sunday moves a
                  person&rsquo;s whole record. So
                  there is no average per person here, no ordering by any number, and no best or worst. What
                  follows is a record of who was on and what the week looked like, in date order, for people who
                  already know the context the numbers do not carry.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[620px]">
                    <thead>
                      <tr className="text-left text-xs text-muted border-b border-border-soft">
                        <th className="font-medium px-4 py-2">Sunday</th>
                        <th className="font-medium px-4 py-2">Announcements</th>
                        <th className="font-medium px-4 py-2">Responding gifts that week</th>
                        <th className="font-medium px-4 py-2">Givers</th>
                        <th className="font-medium px-4 py-2">Checked in</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.announcerSundays.map((s) => (
                        <tr key={s.sunday} className="border-b border-border-soft/60 last:border-0">
                          <td className="px-4 py-2 text-xs whitespace-nowrap">{shortDate(s.sunday)}</td>
                          <td className="px-4 py-2 text-xs">{s.names.join(", ")}</td>
                          <td className="px-4 py-2 text-xs tnum">{s.respondingGifts ?? "—"}</td>
                          <td className="px-4 py-2 text-xs tnum">{s.respondingGivers ?? "—"}</td>
                          <td className="px-4 py-2 text-xs tnum">{s.checkedIn ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div>
                  <h3 className="text-xs font-semibold mb-1.5">Everyone who held the slot, A–Z</h3>
                  <ul className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                    {d.announcers.map((a) => (
                      <li key={a.personId} className="text-xs text-muted">
                        <span className="text-fg font-medium">{a.name}</span> — n={a.sundays.length}{" "}
                        {a.sundays.length === 1 ? "Sunday" : "Sundays"}, responding gifts those weeks:{" "}
                        <span className="tnum">{a.weekGifts.map((g) => g ?? "—").join(", ")}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted mt-2 max-w-4xl leading-relaxed">
                    Listed alphabetically on purpose. The weekly numbers are printed in full rather than
                    averaged so the spread is visible: several of these people have a single Sunday, and a
                    single week is a week, not a track record.
                  </p>
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader title="What this page can and cannot tell you" />
              <div className="px-5 py-4 text-xs text-muted leading-relaxed space-y-2 max-w-4xl">
                <p>
                  <span className="text-fg font-medium">Counts, never money.</span> The Transactions export has
                  no amount column. Every figure above is a number of gifts, of givers, of Sundays or of
                  people. A week with more gifts is not necessarily a week with more given, and this page
                  cannot tell you which.
                </p>
                <p>
                  <span className="text-fg font-medium">The window is {windowLabel}</span> — {d.completeWeeks}{" "}
                  complete weeks. Anyone who gave before it has no row anywhere, so nothing here is a statement
                  about the church&rsquo;s giving as a whole, only about this stretch of it. The window is also
                  too short to hold a full seasonal cycle: every norm on this page is built from the same{" "}
                  {d.completeWeeks} weeks it is judging, so a trend that runs across the whole window — a summer
                  climb, a January start — is partly inside the norm itself and will read smaller than it is.
                </p>
                <p>
                  <span className="text-fg font-medium">Correlation is not cause.</span> Campaigns, holidays,
                  the school year, pay cycles, the weather and a single large household moving house all move
                  these same weekly numbers, and none of them are in this data. The recurring line is here as a
                  partial check on exactly that — it cannot respond to anything said, so when it rises with the
                  responding line, the week is what rose.
                </p>
                <p>
                  <span className="text-fg font-medium">Gifts are not people.</span> A distinct-giver count
                  counts PushPay giver profiles, and a household can hold two, so a weekly giver count runs a
                  little above the number of households giving.
                </p>
              </div>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
