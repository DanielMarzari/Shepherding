import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { INTEGRATIONS, getAllIntegrationStatus } from "@/lib/integrations";
import { IntegrationCard } from "./integration-card";

/** What works today, and how. Hand-written rather than derived because each
 *  line says HOW the data arrives, which is exactly what was wrong before:
 *  this page used to say PushPay and Subsplash "already work". */
const WORKING: Array<{ name: string; href: string; how: string }> = [
  { name: "PCO", href: "/pco", how: "API sync of people, groups, teams, check-ins and services." },
  { name: "Constant Contact", href: "/constant-contact", how: "API sync over OAuth: contacts, lists, campaigns, opens and clicks." },
  { name: "Spotify", href: "/spotify", how: "API sync of the church's music catalogue, for the Original Music report." },
  { name: "PushPay", href: "/pushpay", how: "CSV import, not an API connection. The All Donors and Transactions exports are uploaded by hand, and no published Output is waiting on an API." },
];

export default async function IntegrationCredentialsPage() {
  const session = await requireOrg();
  const status = getAllIntegrationStatus(session.orgId);
  const isAdmin = session.role === "admin";
  // Counted by name, not per connection: Apple and Google each fill half of
  // the same app-downloads Output, and summing per card counted it twice.
  const blockedOutputs = new Set(
    INTEGRATIONS.flatMap((d) => d.outputs.map((o) => o.replace(/\s*\(.*$/, ""))),
  ).size;

  return (
    <AppShell active="Credentials" breadcrumb="Settings › Credentials">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Credentials</h1>
          <p className="text-muted text-sm mt-1 max-w-3xl">
            Connections that do not exist yet. Each one says what it would
            measure, exactly where the credential comes from, and what is
            currently in the way, so a key can be saved the moment it turns up
            instead of the requirement being rediscovered later.
          </p>
          <p className="text-muted text-sm mt-2 max-w-3xl">
            A connection gets its own page and its own database table once its
            sync works; until then, its credentials are kept here.
          </p>
        </div>

        <Card className="p-5">
          <h2 className="text-sm font-semibold">What already works</h2>
          <ul className="mt-2 space-y-1.5 text-sm">
            {WORKING.map((w) => (
              <li key={w.name}>
                <Link href={w.href} className="text-accent hover:underline font-medium">
                  {w.name}
                </Link>{" "}
                <span className="text-muted">— {w.how}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-subtle mt-3">
            Subsplash has no integration yet. Its card is below with the other
            connections that have not been built.
          </p>
        </Card>

        <Card className="p-5">
          <p className="text-sm text-muted">
            <span className="font-medium text-fg">
              {blockedOutputs} published Outputs
            </span>{" "}
            are waiting on the connections below. Saving a credential here
            stores it securely; it does not build the sync — that is a separate
            piece of work, and each report page keeps saying the Output is
            unmeasured until it exists.
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
