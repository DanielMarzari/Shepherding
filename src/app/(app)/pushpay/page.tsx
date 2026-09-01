import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getStoredPushpayCreds } from "@/lib/pushpay";
import { getPushpayImport } from "@/lib/pushpay-import";
import { PushpayCredentialsCard } from "./credentials-card";
import { PushpayImportForm } from "./import-form";

export default async function PushpayPage() {
  const session = await requireOrg();
  const creds = getStoredPushpayCreds(session.orgId);
  const isAdmin = session.role === "admin";
  const last = getPushpayImport(session.orgId);

  return (
    <AppShell active="PushPay" breadcrumb="Giving › PushPay">
      <div className="px-5 md:px-7 py-7 space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">PushPay giving</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Drop your PushPay <span className="text-fg">All Donors</span> export
            and Shepherdly matches each donor to a person, marks giving as a
            completed next step, and powers the giving statistics pages. No API
            connection needed — just the CSV.
          </p>
        </div>

        {/* Import card */}
        <Card className="p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Import the donor export</h2>
            <p className="text-xs text-muted mt-1 leading-relaxed max-w-2xl">
              In PushPay, export{" "}
              <span className="text-fg">Donors → All Donors</span> as CSV
              (First/Last name, Email, Donor Stage, Giving Channel, Last Gift).
              Drop the file below. Re-importing a fresh export replaces the
              previous one and re-matches everyone.
            </p>
          </div>

          {isAdmin ? (
            <PushpayImportForm />
          ) : (
            <p className="text-xs text-subtle">
              Only admins can import giving data.
            </p>
          )}

          {last && (
            <div className="rounded-lg border border-border-soft bg-bg-elev px-3 py-2.5 text-xs">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-muted">
                  Last import:{" "}
                  <span className="text-fg font-medium">
                    {last.fileName ?? "—"}
                  </span>
                </span>
                <span className="text-subtle tnum shrink-0">
                  {last.importedAt
                    ? new Date(last.importedAt).toLocaleString()
                    : ""}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-subtle">
                <span>
                  <span className="text-fg tnum">
                    {last.total.toLocaleString()}
                  </span>{" "}
                  donors
                </span>
                <span>
                  <span className="text-good-soft-fg tnum">
                    {last.matched.toLocaleString()}
                  </span>{" "}
                  matched
                </span>
                <span>
                  <span className="text-warn-soft-fg tnum">
                    {last.ambiguous.toLocaleString()}
                  </span>{" "}
                  to review
                </span>
                <span>
                  <span className="tnum">{last.unmatched.toLocaleString()}</span>{" "}
                  unmatched
                </span>
              </div>
              {(last.ambiguous > 0 || last.unmatched > 0) && (
                <Link
                  href="/audit/pushpay"
                  className="mt-2 inline-block text-accent hover:underline font-medium"
                >
                  Reconcile PushPay connections →
                </Link>
              )}
            </div>
          )}

          <p className="text-[11px] text-subtle">
            Donor names, emails, and phone numbers are encrypted at rest with the
            app key — the same protection used for PCO and all PII. Matching uses
            one-way hashes, never plaintext.
          </p>
        </Card>

        {/* Where giving shows up */}
        <Card className="p-5">
          <h2 className="text-sm font-semibold mb-2">Where giving shows up</h2>
          <ul className="text-sm text-muted space-y-1.5 leading-relaxed list-disc pl-5">
            <li>
              <Link href="/lanes/give" className="text-accent hover:underline">
                Next steps → Give lane
              </Link>{" "}
              — everyone who has given is marked as having completed that step.
            </li>
            <li>
              <Link
                href="/audit/pushpay"
                className="text-accent hover:underline"
              >
                Audit → PushPay connections
              </Link>{" "}
              — assign donors we couldn&apos;t confidently match to a person.
            </li>
            <li>
              <Link href="/giving" className="text-accent hover:underline">
                Giving statistics
              </Link>{" "}
              — membership vs. giving, donor stages, funds, and location — a
              customizable Page Builder page.
            </li>
          </ul>
        </Card>

        {/* Optional API credentials — kept, but secondary */}
        <details className="group">
          <summary className="text-xs text-subtle cursor-pointer hover:text-muted select-none">
            Advanced: store PushPay API credentials (not required for CSV import)
          </summary>
          <div className="mt-3">
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
          </div>
        </details>
      </div>
    </AppShell>
  );
}
