import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getStoredConstantContactCreds } from "@/lib/constant-contact";
import { ConstantContactCredentialsCard } from "./credentials-card";

export default async function ConstantContactPage() {
  const session = await requireOrg();
  const creds = getStoredConstantContactCreds(session.orgId);
  const isAdmin = session.role === "admin";

  return (
    <AppShell active="Constant Contact" breadcrumb="Credentials › Constant Contact">
      <div className="px-5 md:px-7 py-7 space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Constant Contact</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Connect Constant Contact so we can send targeted, personalized email
            to the right people and read back who opened and clicked. Right now
            this only stores your credentials securely — the email sync
            isn&apos;t built yet.
          </p>
        </div>

        <ConstantContactCredentialsCard
          initial={{
            hasCreds: creds.hasCreds,
            apiKeyLast4: creds.apiKeyLast4,
            appSecretLast4: creds.appSecretLast4,
            refreshTokenLast4: creds.refreshTokenLast4,
            updatedAt: creds.updatedAt,
          }}
          isAdmin={isAdmin}
        />

        <Card className="p-5">
          <h2 className="text-sm font-semibold mb-2">What&apos;s next</h2>
          <ul className="text-sm text-muted space-y-1.5 leading-relaxed list-disc pl-5">
            <li>
              Complete the OAuth2 flow and show the connected Constant Contact
              account.
            </li>
            <li>
              Push targeted segments (e.g. &ldquo;next step = group, Center
              campus&rdquo;) out as campaigns.
            </li>
            <li>
              Pull per-contact opens / clicks / bounces back as engagement
              signals to close the loop on the engagement model.
            </li>
          </ul>
          <p className="text-xs text-subtle mt-3">
            Credentials are encrypted at rest with the app key — the same
            protection used for PCO and all PII.
          </p>
        </Card>
      </div>
    </AppShell>
  );
}
