import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getStoredConstantContactCreds } from "@/lib/constant-contact";
import { getLastCcSyncRun } from "@/lib/constant-contact-sync";
import {
  getActiveNeverOpen,
  getAllChurchTiers,
  getBounceOptoutOverTime,
  getCampaignGroupPerf,
  getCampaignPerformance,
  getCcOverview,
  getClicksByCategory,
  getConsentBreakdown,
  getCtor,
  getEngagedCcCoverage,
  getEngagedNotInGroup,
  getNextStepEffectiveness,
  getOpensByDow,
  getRateOverTime,
  getReachGapPeople,
  getSubscriberGrowth,
  getTopEngaged,
  getTopLists,
  getWinBack,
  type PersonRow,
} from "@/lib/constant-contact-read";
import { CcChart, CcSeriesChart } from "./charts";
import { SortableTable } from "./sortable-table";

export const metadata = { title: "Email dashboard · Constant Contact" };

const pct = (x: number | null) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
const num = (x: number) => x.toLocaleString();
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="tnum text-2xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-[11px] text-subtle mt-0.5">{sub}</div>}
    </Card>
  );
}

function PeopleCard({ title, subtitle, people }: { title: string; subtitle: string; people: PersonRow[] }) {
  return (
    <Card className="p-4">
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-[11px] text-subtle mb-2">{subtitle}</div>
      {people.length === 0 ? (
        <p className="text-xs text-subtle">None (or not synced yet).</p>
      ) : (
        <ul className="space-y-1">
          {people.slice(0, 12).map((p, i) => (
            <li key={i} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate">{p.name}</span>
              <span className="text-subtle shrink-0">{p.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default async function CcDashboardPage() {
  const session = await requireOrg();
  const creds = getStoredConstantContactCreds(session.orgId);
  const isAdmin = session.role === "admin";

  if (!creds.connected) {
    return (
      <AppShell active="Constant Contact dashboard" breadcrumb="See more › Constant Contact › Dashboard">
        <div className="px-5 md:px-7 py-7 max-w-3xl">
          <Card className="p-6 text-sm text-muted">
            Connect Constant Contact first.{" "}
            <Link href="/constant-contact" className="text-accent hover:underline">Go to Constant Contact →</Link>
          </Card>
        </div>
      </AppShell>
    );
  }

  const overview = getCcOverview(session.orgId);
  const lastRun = getLastCcSyncRun(session.orgId);
  const empty = overview.contacts === 0;

  const effect = empty ? null : getNextStepEffectiveness(session.orgId);
  const campaigns = empty ? [] : getCampaignPerformance(session.orgId);
  const consent = empty ? [] : getConsentBreakdown(session.orgId);
  const lists = empty ? [] : getTopLists(session.orgId);
  const engaged = empty ? [] : getTopEngaged(session.orgId);
  const coverage = empty ? null : getEngagedCcCoverage(session.orgId);
  const tiers = empty ? null : getAllChurchTiers(session.orgId);
  const clicksByCat = empty ? [] : getClicksByCategory(session.orgId);
  const campaignBar = campaigns
    .filter((c) => c.openRate != null)
    .slice(0, 12)
    .map((c) => ({ label: clip(c.name, 22), value: Math.round((c.openRate ?? 0) * 1000) / 10 }));

  const ctor = empty ? null : getCtor(session.orgId);
  const rateOverTime = empty ? { columns: [], rows: [] } : getRateOverTime(session.orgId);
  const subGrowth = empty ? [] : getSubscriberGrowth(session.orgId);
  const opensByDow = empty ? [] : getOpensByDow(session.orgId);
  const bounceTrend = empty ? { columns: [], rows: [] } : getBounceOptoutOverTime(session.orgId);
  const campaignGroups = empty ? [] : getCampaignGroupPerf(session.orgId);
  const reachGap = empty ? [] : getReachGapPeople(session.orgId);
  const neverOpen = empty ? [] : getActiveNeverOpen(session.orgId);
  const engagedNotInGroup = empty ? [] : getEngagedNotInGroup(session.orgId);
  const winBack = empty ? { count: 0, people: [] } : getWinBack(session.orgId);

  return (
    <AppShell active="Constant Contact dashboard" breadcrumb="See more › Constant Contact › Dashboard">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Email dashboard</h1>
            <p className="text-muted text-sm mt-1 max-w-2xl">
              Constant Contact engagement, joined to PCO people by email — what
              people get, what they opted into, how they engage, and whether
              engaged people take next steps.
            </p>
          </div>
          {isAdmin && (
            <Link href="/constant-contact" className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-border-soft text-muted hover:text-fg cursor-pointer">
              Sync settings →
            </Link>
          )}
        </div>

        <div className="text-xs text-subtle">
          {lastRun
            ? `Last sync: ${lastRun.status}${lastRun.finishedAt ? ` at ${lastRun.finishedAt.slice(0, 16).replace("T", " ")}` : " (running…)"} · ${num(lastRun.requests)} API calls`
            : "Never synced yet — run a sync from Sync settings."}
        </div>

        {empty ? (
          <Card className="p-8 text-center text-sm text-muted">
            No Constant Contact data yet. {isAdmin ? "Click Sync now to pull contacts, lists, campaigns, and engagement." : "Ask an admin to run a sync."}
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <Kpi label="Contacts" value={num(overview.contacts)} />
              <Kpi label="Linked to PCO" value={num(overview.linked)} sub={overview.contacts ? `${pct(overview.linked / overview.contacts)} of contacts` : undefined} />
              <Kpi label="Lists" value={num(overview.lists)} />
              <Kpi label="Campaigns" value={num(overview.campaigns)} sub={`${num(overview.campaignsWithStats)} with stats`} />
              <Kpi label="Engaged people" value={num(overview.engagedPeople)} sub="opened or clicked" />
            </div>

            {effect && (effect.engagedTotal > 0 || effect.notEngagedTotal > 0) && (
              <Card className="p-5 space-y-3">
                <div>
                  <h2 className="text-sm font-semibold">Do email-engaged people take next steps more?</h2>
                  <p className="text-xs text-subtle mt-0.5">Share of linked people who are shepherded or active (a proxy for taking next steps), engaged with our email vs not.</p>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="rounded-lg border border-border-soft p-4">
                    <div className="text-xs text-muted">Engaged with email</div>
                    <div className="tnum text-3xl font-semibold mt-1">{pct(effect.engagedActivePct)}</div>
                    <div className="text-[11px] text-subtle mt-0.5">active / shepherded · of {num(effect.engagedTotal)} people</div>
                  </div>
                  <div className="rounded-lg border border-border-soft p-4">
                    <div className="text-xs text-muted">Not engaged</div>
                    <div className="tnum text-3xl font-semibold mt-1">{pct(effect.notEngagedActivePct)}</div>
                    <div className="text-[11px] text-subtle mt-0.5">active / shepherded · of {num(effect.notEngagedTotal)} people</div>
                  </div>
                </div>
                {effect.engagedActivePct != null && effect.notEngagedActivePct != null && (
                  <p className="text-xs text-muted">
                    Email-engaged people are{" "}
                    <span className="font-semibold text-fg">{((effect.engagedActivePct - effect.notEngagedActivePct) * 100).toFixed(1)} pts</span>{" "}
                    {effect.engagedActivePct >= effect.notEngagedActivePct ? "more" : "less"} likely to be active/shepherded. (Correlation, not causation — but a useful signal for where to invest email.)
                  </p>
                )}
              </Card>
            )}

            <div className="grid lg:grid-cols-2 gap-6 items-start">
              <Card className="p-5 space-y-1.5">
                <h2 className="text-sm font-semibold">Engaged church people — reachable by email?</h2>
                <p className="text-xs text-subtle">Shepherded / active / present in PCO, and whether they&apos;re in Constant Contact.</p>
                <CcChart type="donut" data={coverage?.data ?? []} />
                {coverage && coverage.gap > 0 && (
                  <p className="text-xs text-muted"><span className="font-semibold text-fg">{num(coverage.gap)}</span> engaged people aren&apos;t in Constant Contact — an email-reach gap.</p>
                )}
              </Card>
              <Card className="p-5 space-y-1.5">
                <h2 className="text-sm font-semibold">{tiers?.listName ? `“${clip(tiers.listName, 28)}” subscribers` : "Subscribers"} by engagement</h2>
                <p className="text-xs text-subtle">Clicked vs opened vs dormant, from synced tracking.</p>
                <CcChart type="pie" data={tiers?.data ?? []} />
              </Card>
            </div>

            <div className="grid lg:grid-cols-2 gap-6 items-start">
              <Card className="p-5 space-y-1.5">
                <h2 className="text-sm font-semibold">Open rate by recent campaign</h2>
                <p className="text-xs text-subtle">Unique opens ÷ sends, most recent sends.</p>
                <CcChart type="bar" data={campaignBar} height={300} />
              </Card>
              <Card className="p-5 space-y-2">
                <h2 className="text-sm font-semibold">Clicks by destination</h2>
                <p className="text-xs text-subtle">Where clicks go — registrations, groups, socials, app, giving…</p>
                <SortableTable
                  columns={[{ key: "category", label: "Destination" }, { key: "clicks", label: "Clicks", align: "right", format: "num" }]}
                  rows={clicksByCat}
                  initial={{ key: "clicks", dir: "desc" }}
                />
              </Card>
            </div>

            <div>
              <h2 className="text-sm font-semibold mb-2">Reach &amp; assimilation — action lists</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <PeopleCard title="Engaged, not in CC" subtitle="add these to email" people={reachGap} />
                <PeopleCard title="In CC, never opens" subtitle="reachable but tuning out" people={neverOpen} />
                <PeopleCard title="Engaged, no group/team" subtitle="warm next-step targets" people={engagedNotInGroup} />
                <PeopleCard title={`Win-back — ${num(winBack.count)}`} subtitle="6+ months, no opens" people={winBack.people} />
              </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-6 items-start">
              <Card className="p-5 space-y-2">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-sm font-semibold">Open &amp; click rate over time</h2>
                  {ctor?.ctor != null && <span className="text-xs text-muted">CTOR {pct(ctor.ctor)}</span>}
                </div>
                <CcSeriesChart type="line" columns={rateOverTime.columns} rows={rateOverTime.rows} />
              </Card>
              <Card className="p-5 space-y-2">
                <h2 className="text-sm font-semibold">Opens by day of week</h2>
                <CcChart type="bar" data={opensByDow} />
              </Card>
            </div>

            <div className="grid lg:grid-cols-2 gap-6 items-start">
              <Card className="p-5 space-y-2">
                <h2 className="text-sm font-semibold">New subscribers by month</h2>
                <CcChart type="bar" data={subGrowth} />
              </Card>
              <Card className="p-5 space-y-2">
                <h2 className="text-sm font-semibold">Bounces &amp; opt-outs by month</h2>
                <CcSeriesChart type="bar" columns={bounceTrend.columns} rows={bounceTrend.rows} />
              </Card>
            </div>

            <div className="grid lg:grid-cols-2 gap-6 items-start">
              <Card className="p-5 space-y-2">
                <h2 className="text-sm font-semibold">Consent (permission to send)</h2>
                <CcChart type="donut" data={consent.map((c) => ({ label: c.permission, value: c.count }))} />
              </Card>
              <Card className="p-5 space-y-2">
                <h2 className="text-sm font-semibold">Performance by campaign group</h2>
                <p className="text-xs text-subtle">Instant Access, Women&apos;s / Men&apos;s Ministry, Small Groups, Prayer, Guest Follow-Up, Faith Kids…</p>
                <SortableTable
                  columns={[
                    { key: "category", label: "Group" },
                    { key: "campaigns", label: "Campaigns", align: "right", format: "num" },
                    { key: "sends", label: "Sends", align: "right", format: "num" },
                    { key: "openRate", label: "Open", align: "right", format: "pct" },
                    { key: "clickRate", label: "Click", align: "right", format: "pct" },
                  ]}
                  rows={campaignGroups}
                  initial={{ key: "sends", dir: "desc" }}
                />
              </Card>
            </div>

            <Card className="p-5 space-y-3">
              <h2 className="text-sm font-semibold">Campaign performance</h2>
              <SortableTable
                columns={[
                  { key: "name", label: "Campaign" },
                  { key: "sends", label: "Sends", align: "right", format: "num" },
                  { key: "open", label: "Open", align: "right", format: "pct" },
                  { key: "click", label: "Click", align: "right", format: "pct" },
                  { key: "bounce", label: "Bounce", align: "right", format: "pct" },
                  { key: "optout", label: "Opt-out", align: "right", format: "pct" },
                ]}
                rows={campaigns.map((c) => ({ name: c.name, sends: c.sends, open: c.openRate, click: c.clickRate, bounce: c.bounceRate, optout: c.optOutRate }))}
                initial={{ key: "sends", dir: "desc" }}
              />
            </Card>

            <div className="grid lg:grid-cols-2 gap-6 items-start">
              <Card className="p-5 space-y-3">
                <h2 className="text-sm font-semibold">Lists (what people opted into)</h2>
                <SortableTable
                  columns={[{ key: "name", label: "List" }, { key: "count", label: "Members", align: "right", format: "num" }]}
                  rows={lists}
                  initial={{ key: "count", dir: "desc" }}
                />
              </Card>

              <Card className="p-5 space-y-2">
                <h2 className="text-sm font-semibold">Most email-engaged people</h2>
                <SortableTable
                  columns={[{ key: "name", label: "Person" }, { key: "opens", label: "Opens", align: "right", format: "num" }, { key: "clicks", label: "Clicks", align: "right", format: "num" }]}
                  rows={engaged}
                  initial={{ key: "opens", dir: "desc" }}
                />
              </Card>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
