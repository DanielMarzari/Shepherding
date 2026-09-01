import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import {
  countDonorsByStatus,
  getPushpayImport,
  listDonorsByStatus,
} from "@/lib/pushpay-import";
import { ReconcileList, RematchButton } from "./reconcile-list";

interface SearchParams {
  status?: string;
}

const TABS: Array<{ key: string; label: string }> = [
  { key: "ambiguous", label: "Needs review" },
  { key: "unmatched", label: "Unmatched" },
  { key: "manual", label: "Reconciled" },
];

export default async function PushpayConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireOrg();
  const params = await searchParams;
  const meta = getPushpayImport(session.orgId);
  const counts = countDonorsByStatus(session.orgId);

  const status =
    params.status && TABS.some((t) => t.key === params.status)
      ? params.status
      : "ambiguous";
  const donors = listDonorsByStatus(session.orgId, status, 500);

  const tabCount = (k: string) =>
    k === "manual" ? counts.manual : k === "unmatched" ? counts.unmatched : counts.ambiguous;

  return (
    <AppShell active="PushPay connections" breadcrumb="Audit › PushPay connections">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            PushPay connections
          </h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Donors from the PushPay export that we couldn&apos;t confidently tie
            to one person. <span className="text-fg">Needs review</span> are
            donors matching more than one person (a shared household email, or
            two people with the same name); <span className="text-fg">Unmatched</span>{" "}
            found no person at all. Assign each to the right PCO record — that
            marks them as having given and feeds the giving stats. Search by
            <span className="text-fg"> name, email, or phone</span> to find the
            right person — the best way to place organizations and odd names.
          </p>
        </div>

        {meta && session.role === "admin" && (
          <div className="rounded-xl border border-border-soft p-4">
            <div className="text-sm font-medium mb-1">Auto-match again</div>
            <p className="text-xs text-muted mb-3 max-w-2xl">
              Re-runs matching on the current import with the latest PCO data —
              now including phone numbers — and auto-resolves same-name
              duplicates to the one active record. Your manual assignments are
              kept.
            </p>
            <RematchButton />
          </div>
        )}

        {!meta ? (
          <Card className="p-6">
            <p className="text-sm text-muted">
              No PushPay data imported yet.{" "}
              <Link href="/pushpay" className="text-accent hover:underline">
                Import the donor export →
              </Link>
            </p>
          </Card>
        ) : (
          <>
            {/* Progress summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <SummaryStat label="Matched automatically" value={counts.matched} />
              <SummaryStat label="Reconciled by hand" value={counts.manual} />
              <SummaryStat label="Still to review" value={counts.ambiguous} emphasize />
              <SummaryStat label="Unmatched" value={counts.unmatched} />
            </div>

            {/* Tabs */}
            <div className="flex flex-wrap gap-2 border-b border-border-soft pb-2">
              {TABS.map((t) => {
                const activeTab = t.key === status;
                return (
                  <Link
                    key={t.key}
                    href={`/audit/pushpay?status=${t.key}`}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      activeTab
                        ? "bg-accent text-bg"
                        : "text-muted hover:text-fg hover:bg-bg-elev-2"
                    }`}
                  >
                    {t.label}
                    <span
                      className={`ml-1.5 tnum ${activeTab ? "text-bg/80" : "text-subtle"}`}
                    >
                      {tabCount(t.key).toLocaleString()}
                    </span>
                  </Link>
                );
              })}
            </div>

            <ReconcileList donors={donors} status={status} />

            {donors.length >= 500 && (
              <p className="text-xs text-subtle">
                Showing the first 500. Assign some, then reload for more.
              </p>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function SummaryStat({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: number;
  emphasize?: boolean;
}) {
  return (
    <Card className={`p-4 ${emphasize && value > 0 ? "border-accent" : ""}`}>
      <div className="text-2xl font-semibold tnum">{value.toLocaleString()}</div>
      <div className="text-xs text-muted mt-0.5">{label}</div>
    </Card>
  );
}
