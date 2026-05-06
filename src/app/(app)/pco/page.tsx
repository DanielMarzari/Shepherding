import { AppShell } from "@/components/AppShell";
import { Card, CardHeader } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import {
  getStoredCreds,
  getSyncEntities,
  getSyncSettings,
  listRecentSyncs,
  SYNC_ENTITIES,
} from "@/lib/pco";
import { CredentialsCard } from "./credentials-card";
import { ScheduleCard } from "./schedule-card";
import { SyncNowButton } from "./sync-now-button";
import { WhatToSyncCard } from "./what-to-sync-card";

const FREQ_LABEL: Record<string, string> = {
  daily: "daily",
  weekly: "weekly",
  monthly: "monthly",
};

const DOW_LABEL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function PCOSettingsPage() {
  const session = await requireOrg();
  const creds = getStoredCreds(session.orgId);
  const settings = getSyncSettings(session.orgId);
  const entityToggles = getSyncEntities(session.orgId);
  const recentSyncs = listRecentSyncs(session.orgId);

  const lastSyncLabel = recentSyncs[0]?.startedAt
    ? new Date(recentSyncs[0].startedAt).toLocaleString()
    : "—";

  const enabledCount = SYNC_ENTITIES.filter((e) =>
    e.required ? true : entityToggles[e.key],
  ).length;

  return (
    <AppShell active="PCO" breadcrumb="PCO › Sync settings">
      <div className="px-5 md:px-7 py-7 space-y-6">
        {/* Heading + Sync now */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-muted text-xs mb-1">PCO · Planning Center Online</div>
            <h1 className="text-2xl font-semibold tracking-tight">Sync settings</h1>
            <p className="text-muted text-sm mt-1 max-w-2xl">
              Connect your Planning Center account, choose what to pull, and set the
              schedule. Shepherding never writes back to PCO — your source of truth stays
              untouched.
            </p>
          </div>
          {creds.hasCreds && session.role === "admin" && <SyncNowButton />}
        </div>

        {/* Status strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
              {recentSyncs[0]?.changes != null
                ? `${recentSyncs[0].changes} changes`
                : "—"}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Auto sync</div>
            <div className="font-medium">
              {settings.enabled ? FREQ_LABEL[settings.frequency] : "Disabled"}
            </div>
            <div className="text-xs text-muted mt-1">
              {settings.enabled
                ? scheduleSummary(
                    settings.frequency,
                    settings.runAtHour,
                    settings.runAtDow,
                    settings.runAtDom,
                  )
                : "enable below"}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Sync entities · enabled</div>
            <div className="tnum text-2xl font-semibold">
              {enabledCount}
              <span className="text-muted text-sm font-normal">
                {" "}
                / {SYNC_ENTITIES.length}
              </span>
            </div>
            <div className="text-xs text-muted mt-1">configure below</div>
          </Card>
        </div>

        {/* Credentials + Instructions — heights tend to match, so OK side-by-side.
            Each subsequent section is full width to avoid empty grid cells. */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
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
          <PCOInstructionsPanel />
        </div>

        {/* What to sync — full width, separate section */}
        <WhatToSyncCard
          initial={entityToggles}
          entities={SYNC_ENTITIES}
          isAdmin={session.role === "admin"}
        />

        {/* Auto-sync schedule — full width, separate section, below What to sync */}
        <ScheduleCard initial={settings} isAdmin={session.role === "admin"} />

        {/* Recent syncs — full width at the bottom */}
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
            <div className="px-5 py-10 text-center text-sm text-muted">
              No syncs yet. Save credentials and enable auto-sync — or click{" "}
              <span className="text-fg font-medium">Sync now</span> at the top.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-border-soft">
                  <th className="text-left font-medium px-5 py-2">When</th>
                  <th className="text-left font-medium px-5 py-2">Trigger</th>
                  <th className="text-left font-medium px-5 py-2">Status</th>
                  <th className="text-right font-medium px-5 py-2 tnum">Changes</th>
                </tr>
              </thead>
              <tbody>
                {recentSyncs.map((r) => (
                  <tr key={r.id} className="border-b border-border-softer hover:bg-bg-elev-2/60">
                    <td className="px-5 py-2.5 tnum text-muted">
                      {new Date(r.startedAt).toLocaleString()}
                    </td>
                    <td className="px-5 py-2.5 text-muted">{r.trigger}</td>
                    <td className="px-5 py-2.5">
                      {r.status === "ok" ? (
                        <span className="text-good-soft-fg font-medium">OK</span>
                      ) : (
                        <span className="text-warn-soft-fg font-medium">
                          Partial · {r.warning ?? ""}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-right tnum">{r.changes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <p className="text-xs text-muted">
          <span className="text-fg">Privacy:</span> credentials are AES-256-GCM encrypted at
          rest. Shepherding only reads the entities you enable. We never write back to PCO,
          never store giving amounts, and never share data outside your church.
        </p>
      </div>
    </AppShell>
  );
}

function scheduleSummary(
  freq: string,
  hour: number,
  dow: number,
  dom: number,
): string {
  const t = `${String(hour).padStart(2, "0")}:00`;
  if (freq === "daily") return `every day at ${t}`;
  if (freq === "weekly") return `every ${DOW_LABEL[dow]} at ${t}`;
  if (freq === "monthly") return `${ordinal(dom)} of each month at ${t}`;
  return "—";
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function PCOInstructionsPanel() {
  return (
    <Card className="p-5">
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
          copy it now before leaving the page.
        </li>
        <li>
          Paste both into the form on the left, click{" "}
          <span className="font-medium">Test connection</span>, then{" "}
          <span className="font-medium">Save credentials</span>.
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
          <span className="font-mono text-xs">
            https://shepherdly.danmarzari.com/api/webhooks/pco
          </span>
          .
        </li>
        <li>
          Copy the <span className="font-medium">Authenticity Secret</span> PCO generates
          and paste it into the optional field on the left.
        </li>
      </ol>

      <p className="mt-5 text-xs text-muted">
        You can rotate the token any time — Shepherding stores its own copy of every record
        it has pulled, so nothing is lost.
      </p>
    </Card>
  );
}
