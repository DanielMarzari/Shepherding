import { AppShell } from "@/components/AppShell";
import { Card, CardHeader } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getStoredCreds, getSyncSettings, listRecentSyncs } from "@/lib/pco";
import { CredentialsCard } from "./credentials-card";
import { SyncScheduleCard } from "./sync-schedule-card";

const FREQ_LABEL: Record<string, string> = {
  "15m": "every 15 min",
  "30m": "every 30 min",
  hourly: "hourly",
  daily: "daily",
  weekly: "weekly (Sundays)",
  monthly: "monthly (1st of month)",
};

export default async function PCOSettingsPage() {
  const session = await requireOrg();
  const creds = getStoredCreds(session.orgId);
  const settings = getSyncSettings(session.orgId);
  const recentSyncs = listRecentSyncs(session.orgId);

  const lastSyncLabel = recentSyncs[0]?.startedAt
    ? new Date(recentSyncs[0].startedAt).toLocaleString()
    : "—";

  return (
    <AppShell active="PCO" breadcrumb="PCO › Sync settings">
      <div className="px-5 md:px-7 py-7 max-w-6xl">
        <div className="mb-7">
          <div className="text-muted text-xs mb-1">PCO · Planning Center Online</div>
          <h1 className="text-2xl font-semibold tracking-tight">Sync settings</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Connect your Planning Center account, choose what to pull, and set the schedule.
            Shepherding never writes back to PCO — your source of truth stays untouched.
          </p>
        </div>

        {/* Status strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Connection</div>
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${creds.hasCreds ? "bg-good" : "bg-subtle"}`}
              />
              <span className="font-medium">
                {creds.hasCreds ? "Connected" : "Not connected"}
              </span>
            </div>
            <div className="text-xs text-muted mt-1">
              {creds.organizationName ?? "Add credentials below"}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Last sync</div>
            <div className="font-medium">{lastSyncLabel}</div>
            <div className="text-xs text-muted mt-1">
              {recentSyncs[0]?.changes ? `${recentSyncs[0].changes} changes` : "—"}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Auto sync</div>
            <div className="font-medium">
              {settings.enabled ? FREQ_LABEL[settings.frequency] : "Disabled"}
            </div>
            <div className="text-xs text-muted mt-1">
              {settings.enabled
                ? `runs at ${String(settings.runAtHour).padStart(2, "0")}:00 local`
                : "enable below"}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Sync runs · last 30d</div>
            <div className="tnum text-2xl font-semibold">{recentSyncs.length}</div>
            <div className="text-xs text-muted mt-1">
              {recentSyncs.filter((r) => r.status !== "ok").length} with warnings
            </div>
          </Card>
        </div>

        {/* Credentials + instructions */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mb-5">
          <div className="xl:col-span-2">
            <CredentialsCard
              initial={{
                appIdLast4: creds.appIdLast4,
                secretLast4: creds.secretLast4,
                webhookSecretLast4: creds.webhookSecretLast4,
                organizationName: creds.organizationName,
                verifiedAt: creds.verifiedAt,
                hasCreds: creds.hasCreds,
              }}
              isAdmin={session.role === "admin"}
            />
          </div>
          <div>
            <PCOInstructionsPanel />
          </div>
        </div>

        {/* Schedule + recent syncs */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          <div className="xl:col-span-2">
            <SyncScheduleCard initial={settings} isAdmin={session.role === "admin"} />
          </div>
          <Card>
            <CardHeader
              title="Recent syncs"
              right={
                recentSyncs.length > 0 ? (
                  <button className="text-xs text-accent hover:underline">View all →</button>
                ) : null
              }
            />
            {recentSyncs.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-muted">
                No syncs yet. Save credentials and enable auto-sync to start.
              </div>
            ) : (
              <ul className="divide-y divide-border-softer">
                {recentSyncs.map((r) => (
                  <li key={r.id} className="px-5 py-3 text-sm">
                    <div className="flex items-baseline justify-between mb-0.5">
                      <span className="tnum text-xs text-muted">
                        {new Date(r.startedAt).toLocaleString()}
                      </span>
                      <span
                        className={
                          r.status === "ok"
                            ? "text-good-soft-fg text-xs font-medium"
                            : "text-warn-soft-fg text-xs font-medium"
                        }
                      >
                        {r.status === "ok" ? "OK" : "Partial"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted text-xs">{r.trigger}</span>
                      <span className="tnum text-xs">{r.changes} changes</span>
                    </div>
                    {r.warning && (
                      <div className="text-xs text-warn-soft-fg mt-0.5">{r.warning}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <p className="mt-6 text-xs text-muted">
          <span className="text-fg">Privacy:</span> credentials are AES-256-GCM encrypted at
          rest. Shepherding only reads the entities you enable. We never write back to PCO,
          never store giving amounts, and never share data outside your church.
        </p>
      </div>
    </AppShell>
  );
}

function PCOInstructionsPanel() {
  return (
    <Card className="p-5 xl:sticky xl:top-4">
      <h2 className="text-sm font-semibold mb-3">How to get a PCO token</h2>
      <ol className="space-y-3 text-sm text-fg list-decimal list-inside">
        <li>
          Go to{" "}
          <a
            href="https://api.planningcenteronline.com/personal_access_tokens"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline break-all"
          >
            api.planningcenteronline.com/personal_access_tokens
          </a>{" "}
          while signed in to PCO.
        </li>
        <li>
          Click <span className="font-medium">New Personal Access Token</span>.
        </li>
        <li>
          Name it <span className="font-mono text-xs">Shepherding</span> so you remember
          what it&apos;s for.
        </li>
        <li>
          Copy the <span className="font-medium">Application ID</span> and{" "}
          <span className="font-medium">Secret</span>. The Secret is shown <em>once</em> —
          paste it here before leaving the page.
        </li>
        <li>
          Paste both into the form on the left, click{" "}
          <span className="font-medium">Test connection</span>, then{" "}
          <span className="font-medium">Save</span>.
        </li>
      </ol>

      <h2 className="text-sm font-semibold mt-6 mb-3">Webhook secret (optional)</h2>
      <ol className="space-y-3 text-sm text-fg list-decimal list-inside">
        <li>
          In PCO, open <span className="font-medium">Webhooks</span> for your app and
          click <span className="font-medium">New Webhook Subscription</span>.
        </li>
        <li>
          Subscribe to events like{" "}
          <span className="font-mono text-xs">people.v2.events.person.updated</span> and{" "}
          <span className="font-mono text-xs">groups.v2.events.membership.created</span>.
        </li>
        <li>
          Set the URL to{" "}
          <span className="font-mono text-xs">https://shepherdly.danmarzari.com/api/webhooks/pco</span>.
        </li>
        <li>
          Copy the <span className="font-medium">Authenticity Secret</span> PCO generates
          and paste it into the optional field on the left. Used to verify the webhook
          signature on every push.
        </li>
      </ol>

      <p className="mt-5 text-xs text-muted">
        You can rotate the token any time — Shepherding stores its own copy of every record
        it has pulled, so nothing is lost.
      </p>
    </Card>
  );
}
