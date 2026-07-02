import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Card, CardHeader } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getCcSyncSettings, getStoredConstantContactCreds, listRecentCcSyncs } from "@/lib/constant-contact";
import { getCcOverview } from "@/lib/constant-contact-read";
import { ConstantContactCredentialsCard } from "./credentials-card";
import { CcScheduleCard } from "./schedule-card";
import { CcSyncButton } from "./sync-button";

const CC_ERRORS: Record<string, string> = {
  admin_only: "Only admins can connect Constant Contact.",
  no_api_key: "Save your API key first, then click Connect.",
  bad_state: "The authorization link was invalid — please click Connect again.",
  state_mismatch: "The authorization link didn’t match — please click Connect again.",
  expired: "The authorization link expired — please click Connect again.",
  access_denied: "Authorization was declined in Constant Contact.",
};
const FREQ: Record<string, string> = { daily: "daily", weekly: "weekly", monthly: "monthly" };

export default async function ConstantContactPage({
  searchParams,
}: {
  searchParams: Promise<{ cc_connected?: string; cc_error?: string }>;
}) {
  const session = await requireOrg();
  const creds = getStoredConstantContactCreds(session.orgId);
  const settings = getCcSyncSettings(session.orgId);
  const recent = listRecentCcSyncs(session.orgId);
  const overview = creds.connected ? getCcOverview(session.orgId) : null;
  const isAdmin = session.role === "admin";
  const sp = await searchParams;
  const connectedNotice = sp.cc_connected === "1";
  const errorNotice = sp.cc_error ? (CC_ERRORS[sp.cc_error] ?? `Couldn’t connect: ${sp.cc_error}`) : null;
  const lastRun = recent[0];
  const records = overview ? overview.contacts + overview.campaigns + overview.activityRows : 0;

  return (
    <AppShell active="Constant Contact" breadcrumb="Credentials › Constant Contact">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-muted text-xs mb-1">Constant Contact · email marketing</div>
            <h1 className="text-2xl font-semibold tracking-tight">Sync settings</h1>
            <p className="text-muted text-sm mt-1 max-w-2xl">
              Connect Constant Contact, then sync contacts, lists, campaigns, and
              engagement — joined to your PCO people by email.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {creds.connected && (
              <Link href="/constant-contact/dashboard" className="text-xs px-3 py-1.5 rounded-lg border border-border-soft text-muted hover:text-fg cursor-pointer">Email dashboard →</Link>
            )}
            {creds.connected && (
              <Link href="/constant-contact/explore" className="text-xs px-3 py-1.5 rounded-lg border border-border-soft text-muted hover:text-fg cursor-pointer">Explore →</Link>
            )}
            {creds.connected && isAdmin && <CcSyncButton />}
          </div>
        </div>

        {connectedNotice && (
          <div className="rounded-lg border border-good-soft-bg bg-good-soft-bg/30 px-4 py-2.5 text-sm text-good-soft-fg">
            Connected to Constant Contact — the app will manage the access tokens from here.
          </div>
        )}
        {errorNotice && (
          <div className="rounded-lg border border-warn-soft-bg bg-warn-soft-bg/30 px-4 py-2.5 text-sm text-warn-soft-fg">{errorNotice}</div>
        )}

        {/* Status strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Connection</div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${creds.connected ? "bg-good" : creds.hasCreds ? "bg-warn" : "bg-subtle"}`} />
              <span className="font-medium">{creds.connected ? "Connected" : creds.hasCreds ? "Not authorized" : "No API key"}</span>
            </div>
            <div className="text-xs text-muted mt-1">{creds.verifiedAt ? `since ${creds.verifiedAt.slice(0, 10)}` : "add credentials below"}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Last sync</div>
            <div className="font-medium">{lastRun ? new Date(lastRun.startedAt).toLocaleDateString() : "—"}</div>
            <div className="text-xs text-muted mt-1">{lastRun ? `${lastRun.status} · ${lastRun.requests.toLocaleString()} calls` : "never"}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Auto sync</div>
            <div className="font-medium">{settings.enabled ? FREQ[settings.frequency] : "Disabled"}</div>
            <div className="text-xs text-muted mt-1">{settings.enabled ? `at ${String(settings.runAtHour).padStart(2, "0")}:00 UTC` : "enable below"}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Records synced</div>
            <div className="tnum text-2xl font-semibold">{records.toLocaleString()}</div>
            <div className="text-xs text-muted mt-1">contacts + campaigns + activity</div>
          </Card>
        </div>

        {/* Credentials | How to connect */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
          <div className="xl:col-span-2">
            <ConstantContactCredentialsCard
              initial={{
                hasCreds: creds.hasCreds,
                connected: creds.connected,
                apiKeyLast4: creds.apiKeyLast4,
                appSecretLast4: creds.appSecretLast4,
                verifiedAt: creds.verifiedAt,
                updatedAt: creds.updatedAt,
              }}
              isAdmin={isAdmin}
            />
          </div>
          <Card className="p-5">
            <h2 className="text-sm font-semibold mb-3">How to connect</h2>
            <ol className="text-sm text-muted space-y-3 leading-relaxed list-decimal pl-5">
              <li>
                In your Constant Contact V3 app settings, add this <strong>exact</strong> Redirect URI and save:
                <code className="mt-1.5 block w-full break-all rounded-md bg-bg-elev-2 border border-border-soft px-2.5 py-1.5 text-xs text-fg">https://shepherdly.danmarzari.com/constant-contact/callback</code>
              </li>
              <li>Paste your <strong>API Key</strong> and <strong>App Secret</strong>, then <strong>Save credentials</strong>.</li>
              <li>Click <strong>Connect Constant Contact</strong> and approve access.</li>
              <li>You&apos;ll return here marked <strong>Connected</strong>; then use <strong>Sync now</strong> or turn on auto-sync.</li>
            </ol>
          </Card>
        </div>

        {/* Schedule | Recent syncs */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-stretch">
          <div className="xl:col-span-2">
            <CcScheduleCard initial={settings} isAdmin={isAdmin} />
          </div>
          <Card className="h-full">
            <CardHeader title="Recent syncs" />
            {recent.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-muted">No syncs yet.</div>
            ) : (
              <ul className="divide-y divide-border-soft">
                {recent.map((r) => {
                  let d: Record<string, unknown> = {};
                  try { d = r.details ? JSON.parse(r.details) : {}; } catch { /* ignore */ }
                  const contacts = typeof d.contacts === "number" ? d.contacts : null;
                  const act = d.activity && typeof d.activity === "object" ? (d.activity as { rows?: number }).rows ?? null : null;
                  return (
                    <li key={r.id} className="px-5 py-3 text-sm">
                      <div className="flex items-baseline justify-between">
                        <span className="tnum text-xs text-muted">{new Date(r.startedAt).toLocaleString()}</span>
                        <span className={`text-xs font-medium ${r.status === "ok" ? "text-good-soft-fg" : r.status === "error" ? "text-warn-soft-fg" : "text-muted"}`}>{r.status}</span>
                      </div>
                      <div className="text-[11px] text-subtle mt-0.5">
                        {r.requests.toLocaleString()} API calls
                        {contacts != null && ` · ${contacts.toLocaleString()} contacts`}
                        {act != null && ` · ${act.toLocaleString()} activity rows`}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <p className="text-xs text-muted">
          <span className="text-fg">Privacy:</span> credentials + the OAuth refresh token are AES-256-GCM
          encrypted at rest. We store only a one-way hash of each email (never the address), used to link
          Constant Contact contacts to PCO people.
        </p>
      </div>
    </AppShell>
  );
}
