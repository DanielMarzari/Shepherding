import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getStoredSubsplashCreds } from "@/lib/subsplash";
import { SubsplashCredentialsCard } from "./credentials-card";

export default async function SubsplashPage() {
  const session = await requireOrg();
  const creds = getStoredSubsplashCreds(session.orgId);
  const isAdmin = session.role === "admin";

  return (
    <AppShell active="Subsplash" breadcrumb="Credentials › Subsplash">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Subsplash</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Connect the Faith Church app (Subsplash) so app engagement — opens,
            content watched, push interactions — can feed the engagement model
            as intent signals, and so we can surface each person&apos;s next step
            in-app. Right now this only stores your credentials securely — the
            sync isn&apos;t built yet.
          </p>
        </div>

        <SubsplashCredentialsCard
          initial={{
            hasCreds: creds.hasCreds,
            apiKeyLast4: creds.apiKeyLast4,
            clientSecretLast4: creds.clientSecretLast4,
            appIdLast4: creds.appIdLast4,
            updatedAt: creds.updatedAt,
          }}
          isAdmin={isAdmin}
        />

        <Card className="p-5">
          <h2 className="text-sm font-semibold mb-2">What&apos;s next</h2>
          <ul className="text-sm text-muted space-y-1.5 leading-relaxed list-disc pl-5">
            <li>
              Confirm API access tier and whether the Engagement API exposes
              per-person events (vs. aggregate analytics).
            </li>
            <li>
              Pull app opens, content consumption, and push tokens into
              person_activity as new intent signals.
            </li>
            <li>
              Push each person&apos;s pathway + next-step call-to-action back
              into the app.
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
