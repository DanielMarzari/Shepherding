import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getStoredConstantContactCreds } from "@/lib/constant-contact";
import { ConstantContactCredentialsCard } from "./credentials-card";

const CC_ERRORS: Record<string, string> = {
  admin_only: "Only admins can connect Constant Contact.",
  no_api_key: "Save your API key first, then click Connect.",
  bad_state: "The authorization link was invalid — please click Connect again.",
  state_mismatch: "The authorization link didn’t match — please click Connect again.",
  expired: "The authorization link expired — please click Connect again.",
  access_denied: "Authorization was declined in Constant Contact.",
};

export default async function ConstantContactPage({
  searchParams,
}: {
  searchParams: Promise<{ cc_connected?: string; cc_error?: string }>;
}) {
  const session = await requireOrg();
  const creds = getStoredConstantContactCreds(session.orgId);
  const isAdmin = session.role === "admin";
  const sp = await searchParams;
  const connectedNotice = sp.cc_connected === "1";
  const errorNotice = sp.cc_error ? (CC_ERRORS[sp.cc_error] ?? `Couldn’t connect: ${sp.cc_error}`) : null;

  return (
    <AppShell active="Constant Contact" breadcrumb="Credentials › Constant Contact">
      <div className="px-5 md:px-7 py-7 space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Constant Contact</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Connect Constant Contact so we can send targeted, personalized email
            to the right people and read back who opened and clicked. Save your
            API key, then click Connect to authorize.
          </p>
        </div>

        {connectedNotice && (
          <div className="rounded-lg border border-good-soft-bg bg-good-soft-bg/30 px-4 py-2.5 text-sm text-good-soft-fg">
            Connected to Constant Contact — the app will manage the access tokens from here.
          </div>
        )}
        {errorNotice && (
          <div className="rounded-lg border border-warn-soft-bg bg-warn-soft-bg/30 px-4 py-2.5 text-sm text-warn-soft-fg">
            {errorNotice}
          </div>
        )}

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

        <Card className="p-5">
          <h2 className="text-sm font-semibold mb-3">How to connect</h2>
          <ol className="text-sm text-muted space-y-3 leading-relaxed list-decimal pl-5">
            <li>
              In your Constant Contact V3 app settings, add this <strong>exact</strong> Redirect URI and save:
              <code className="mt-1.5 block w-full break-all rounded-md bg-bg-elev-2 border border-border-soft px-2.5 py-1.5 text-xs text-fg">
                https://shepherdly.danmarzari.com/constant-contact/callback
              </code>
            </li>
            <li>
              In the card above, paste your <strong>API Key</strong> (client ID) and click <strong>Save credentials</strong>.
              Leave <strong>App Secret</strong> blank unless your app uses the confidential Authorization-Code flow (a PKCE app needs no secret).
            </li>
            <li>
              Click <strong>Connect Constant Contact</strong> — you&apos;ll be taken to Constant Contact to approve access.
            </li>
            <li>
              Approve, and you&apos;ll be sent back here with the status set to <strong>Connected</strong>. The app manages the access tokens from then on.
            </li>
          </ol>

          <h3 className="text-xs font-semibold mt-5 mb-2 text-muted uppercase tracking-wide">If a red error appears</h3>
          <ul className="text-xs text-subtle space-y-1.5 leading-relaxed list-disc pl-5">
            <li><strong>redirect_uri mismatch</strong> — the URI in step 1 doesn&apos;t match exactly (watch for a trailing slash).</li>
            <li><strong>invalid_client</strong> / client authentication required — your app needs a secret: reveal the App Secret in Constant Contact, paste it above, save, and click <strong>Reconnect</strong>.</li>
            <li><strong>invalid_scope</strong> — the app is missing required scopes (contact_data, campaign_data, offline_access); enable them in Constant Contact.</li>
          </ul>

          <p className="text-xs text-subtle mt-4">
            Once connected, the next build is the email sync: push targeted
            segments out as campaigns and pull opens / clicks / bounces back as
            engagement signals. Credentials are encrypted at rest with the app
            key — the same protection used for PCO and all PII.
          </p>
        </Card>
      </div>
    </AppShell>
  );
}
