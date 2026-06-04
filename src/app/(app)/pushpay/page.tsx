import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getStoredPushpayCreds } from "@/lib/pushpay";
import { PushpayCredentialsCard } from "./credentials-card";

export default async function PushpayPage() {
  const session = await requireOrg();
  const creds = getStoredPushpayCreds(session.orgId);
  const isAdmin = session.role === "admin";

  return (
    <AppShell active="PushPay" breadcrumb="Credentials › PushPay">
      <div className="px-5 md:px-7 py-7 space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">PushPay</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Connect your PushPay giving account so giving can be lined up
            against attendance and engagement. Right now this only stores
            your credentials securely — the giving sync isn&apos;t built yet.
          </p>
        </div>

        <PushpayCredentialsCard
          initial={{
            hasCreds: creds.hasCreds,
            clientIdLast4: creds.clientIdLast4,
            clientSecretLast4: creds.clientSecretLast4,
            orgKeyLast4: creds.orgKeyLast4,
            updatedAt: creds.updatedAt,
          }}
          isAdmin={isAdmin}
        />

        <Card className="p-5">
          <h2 className="text-sm font-semibold mb-2">What&apos;s next</h2>
          <ul className="text-sm text-muted space-y-1.5 leading-relaxed list-disc pl-5">
            <li>
              Verify the credentials against PushPay&apos;s API and show the
              connected organization.
            </li>
            <li>Pull giving transactions and funds on a schedule.</li>
            <li>
              Match givers to PCO people, then surface giving vs. attendance
              and per-attender giving trends on the Attendance page.
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
