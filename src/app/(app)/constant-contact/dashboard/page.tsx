import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getStoredConstantContactCreds } from "@/lib/constant-contact";
import { getLastCcSyncRun } from "@/lib/constant-contact-sync";
import {
  getCampaignPerformance,
  getCcOverview,
  getConsentBreakdown,
  getNextStepEffectiveness,
  getTopEngaged,
  getTopLists,
} from "@/lib/constant-contact-read";

export const metadata = { title: "Email dashboard · Constant Contact" };

const pct = (x: number | null) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
const num = (x: number) => x.toLocaleString();

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="tnum text-2xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-[11px] text-subtle mt-0.5">{sub}</div>}
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

  return (
    <AppShell active="Constant Contact dashboard" breadcrumb="See more › Constant Contact › Dashboard">
      <div className="px-5 md:px-7 py-7 space-y-6 max-w-6xl">
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

            <Card className="p-5 space-y-3">
              <h2 className="text-sm font-semibold">Campaign performance</h2>
              {campaigns.length === 0 ? <p className="text-xs text-subtle">No campaign stats synced yet.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-muted text-left">
                      <th className="py-1 pr-3">Campaign</th><th className="py-1 pr-3 text-right">Sends</th>
                      <th className="py-1 pr-3 text-right">Open</th><th className="py-1 pr-3 text-right">Click</th>
                      <th className="py-1 pr-3 text-right">Bounce</th><th className="py-1 pr-3 text-right">Opt-out</th>
                    </tr></thead>
                    <tbody>
                      {campaigns.map((c, i) => (
                        <tr key={i} className="border-t border-border-soft/60">
                          <td className="py-1 pr-3 max-w-[280px] truncate">{c.name}</td>
                          <td className="py-1 pr-3 text-right tnum">{num(c.sends)}</td>
                          <td className="py-1 pr-3 text-right tnum">{pct(c.openRate)}</td>
                          <td className="py-1 pr-3 text-right tnum">{pct(c.clickRate)}</td>
                          <td className="py-1 pr-3 text-right tnum">{pct(c.bounceRate)}</td>
                          <td className="py-1 pr-3 text-right tnum">{pct(c.optOutRate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <div className="grid lg:grid-cols-2 gap-6 items-start">
              <Card className="p-5 space-y-3">
                <h2 className="text-sm font-semibold">Consent (permission to send)</h2>
                {consent.map((c) => (
                  <div key={c.permission} className="flex items-center justify-between text-xs">
                    <span className="text-muted">{c.permission}</span>
                    <span className="tnum">{num(c.count)}</span>
                  </div>
                ))}
                <h2 className="text-sm font-semibold pt-3 border-t border-border-soft">Lists (what people opted into)</h2>
                {lists.map((l, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-muted truncate max-w-[70%]">{l.name}</span>
                    <span className="tnum">{num(l.count)}</span>
                  </div>
                ))}
              </Card>

              <Card className="p-5 space-y-2">
                <h2 className="text-sm font-semibold">Most email-engaged people</h2>
                {engaged.length === 0 ? <p className="text-xs text-subtle">No per-contact engagement synced yet.</p> : (
                  <table className="w-full text-xs">
                    <thead><tr className="text-muted text-left"><th className="py-1 pr-3">Person</th><th className="py-1 pr-3 text-right">Opens</th><th className="py-1 pr-3 text-right">Clicks</th></tr></thead>
                    <tbody>
                      {engaged.map((p, i) => (
                        <tr key={i} className="border-t border-border-soft/60">
                          <td className="py-1 pr-3 truncate max-w-[220px]">{p.name}</td>
                          <td className="py-1 pr-3 text-right tnum">{num(p.opens)}</td>
                          <td className="py-1 pr-3 text-right tnum">{num(p.clicks)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
