import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { INTEGRATIONS, getAllIntegrationStatus } from "@/lib/integrations";
import { IntegrationCard } from "./integration-card";

export default async function IntegrationCredentialsPage() {
  const session = await requireOrg();
  const status = getAllIntegrationStatus(session.orgId);
  const isAdmin = session.role === "admin";
  const blockedOutputs = INTEGRATIONS.reduce((n, d) => n + d.outputs.length, 0);

  return (
    <AppShell active="Credentials" breadcrumb="Settings › Credentials">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Credentials</h1>
          <p className="text-muted text-sm mt-1 max-w-3xl">
            Connections that would fill a published Ministry Impact Report Output
            but do not exist yet. Each one says what it would measure, exactly
            where the credential comes from, and what is currently in the way —
            so a key can be saved the moment it turns up, instead of the
            requirement being rediscovered later.
          </p>
        </div>

        <Card className="p-5">
          <p className="text-sm text-muted">
            <span className="font-medium text-fg">
              {blockedOutputs} published Outputs
            </span>{" "}
            across the two Communications reports are waiting on the four
            connections below. Saving a credential here stores it securely; it
            does not build the sync — that is a separate piece of work, and each
            report page keeps saying the Output is unmeasured until it exists.
          </p>
          <p className="text-xs text-subtle mt-2">
            Integrations that already work — PCO, PushPay, Constant Contact,
            Subsplash and Spotify — each have their own page under Settings ›
            Integrations.
          </p>
        </Card>

        <div className="space-y-4">
          {INTEGRATIONS.map((d) => (
            <IntegrationCard
              key={d.provider}
              isAdmin={isAdmin}
              integration={{
                provider: d.provider,
                name: d.name,
                what: d.what,
                where: d.where,
                blocker: d.blocker,
                outputs: d.outputs,
                fields: d.fields.map((f) => ({
                  key: f.key,
                  label: f.label,
                  help: f.help,
                  multiline: f.multiline,
                  optional: f.optional,
                })),
                stored: status[d.provider] ?? [],
              }}
            />
          ))}
        </div>
      </div>
    </AppShell>
  );
}
