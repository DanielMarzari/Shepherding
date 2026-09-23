import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import {
  countPayersByStatus,
  getPayerIdentityCoverage,
  getPushpayGivingSummary,
  listPayersByStatus,
} from "@/lib/pushpay-import";
import { RematchButton, ReviewList } from "./reconcile-list";

interface SearchParams {
  status?: string;
}

const TABS: Array<{ key: string; label: string }> = [
  { key: "ambiguous", label: "Needs review" },
  { key: "unmatched", label: "No match found" },
  { key: "manual", label: "Matched by hand" },
  // Automatic matches are here so a giver placed on the WRONG person can still
  // be found and corrected. Without this tab they are in no tab at all: the
  // three above are the work, and 1,121 of the 1,669 givers are not in them.
  { key: "matched", label: "Matched automatically" },
];

export default async function PushpayConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireOrg();
  const params = await searchParams;
  const counts = countPayersByStatus(session.orgId);
  const coverage = getPayerIdentityCoverage(session.orgId);
  const giving = getPushpayGivingSummary(session.orgId);

  function tabCount(k: string): number {
    return k === "manual"
      ? counts.manual
      : k === "unmatched"
        ? counts.unmatched
        : k === "matched"
          ? counts.matched
          : counts.ambiguous;
  }

  // Land on a tab that has something in it. "Needs review" first, because a
  // giver whose details fit two people is the judgement only a human can make
  // — but when there is nothing there, opening on it shows an empty page while
  // hundreds sit one tab over, which is exactly the "I go to that page and
  // zero show up" this whole change exists to fix.
  const firstNonEmpty =
    TABS.find((t) => tabCount(t.key) > 0)?.key ?? "ambiguous";
  const status =
    params.status && TABS.some((t) => t.key === params.status)
      ? params.status
      : firstNonEmpty;
  // Nothing to query while no import has stored a giver's name.
  const givers = coverage.withIdentity > 0 ? listPayersByStatus(session.orgId, status, 500) : [];

  // The queue's own "no person yet" total, which should equal the giving
  // page's "Unlinked givers". It only can for givers an import has named.
  const toPlace = counts.ambiguous + counts.unmatched;
  const missingIdentity = coverage.unlinked - coverage.unlinkedWithIdentity;

  return (
    <AppShell active="PushPay connections" breadcrumb="Audit › PushPay connections">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">PushPay connections</h1>
          <p className="text-muted text-sm mt-1 max-w-3xl">
            Every giver in the imported PushPay{" "}
            <span className="text-fg">Transactions</span> export, and which
            person in Planning Center their gifts belong to. Most are placed
            automatically — by the export&apos;s{" "}
            <span className="text-fg">Your ID</span> column, which carries the
            PCO person id, or by name, email and phone.{" "}
            <span className="text-fg">Needs review</span> is a giver whose
            details fit more than one person (a shared household inbox, or two
            people with one name); <span className="text-fg">No match found</span>{" "}
            is a giver nobody fits. Place those by hand and their gifts move
            with them. The last tab holds everyone the matcher placed on its
            own, so a giver it put on the wrong person can be found and moved.
          </p>
          <p className="text-muted text-sm mt-2 max-w-3xl">
            A giver here is one{" "}
            <span className="text-fg">PushPay giver profile</span>, not a
            person: a household can hold two, and both can point at the same
            PCO record. A profile is keyed by PushPay&apos;s Payer ID, which
            never changes, so a match made here is kept through every later
            upload — nothing has to recognise them again.
          </p>
        </div>

        {/* What the gifts behind this queue cover */}
        <Card className="p-4">
          <div className="text-sm font-medium mb-1">The gifts behind this list</div>
          <p className="text-xs text-muted max-w-3xl">
            {giving && giving.gifts > 0 ? (
              <>
                The loaded gifts run from{" "}
                <span className="text-fg">{giving.firstGiftOn ?? "?"}</span> to{" "}
                <span className="text-fg">{giving.lastGiftOn ?? "?"}</span>:{" "}
                {giving.gifts.toLocaleString()} gifts from{" "}
                {giving.payers.toLocaleString()} giver profiles, of which{" "}
                <span className="text-fg">
                  {(giving.payers - giving.linkedPayers).toLocaleString()}
                </span>{" "}
                have no person attached. Neither PushPay export carries an
                amount, so every figure here and on the giving pages is a count
                of gifts or of givers.
              </>
            ) : (
              <>
                No Transactions export has been imported yet, so there are no
                gifts and no givers to place.
              </>
            )}{" "}
            <Link href="/pushpay" className="text-accent hover:underline">
              Import on PushPay →
            </Link>
          </p>
        </Card>

        {coverage.payers === 0 ? (
          <Card className="p-6">
            <p className="text-sm text-muted">
              No PushPay gifts imported yet.{" "}
              <Link href="/pushpay" className="text-accent hover:underline">
                Import the Transactions export →
              </Link>
            </p>
          </Card>
        ) : coverage.withIdentity === 0 ? (
          <NoIdentitiesYet unlinked={coverage.unlinked} payers={coverage.payers} />
        ) : (
          <>
            {missingIdentity > 0 && <PartialIdentities missing={missingIdentity} unlinked={coverage.unlinked} />}

            {session.role === "admin" && (
              <div className="rounded-xl border border-border-soft p-4">
                <div className="text-sm font-medium mb-1">Match again</div>
                <p className="text-xs text-muted mb-3 max-w-2xl">
                  Re-runs matching over the givers already stored, with the
                  latest people from Planning Center. No re-upload needed.
                  Anything you have placed by hand is left exactly as it is.
                </p>
                <RematchButton />
              </div>
            )}

            {/* Progress */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <SummaryStat label="Matched automatically" value={counts.matched} />
              <SummaryStat label="Matched by hand" value={counts.manual} />
              <SummaryStat label="Needs review" value={counts.ambiguous} emphasize />
              <SummaryStat label="No match found" value={counts.unmatched} />
            </div>

            <p className="text-xs text-subtle max-w-3xl">
              {toPlace.toLocaleString()} giver
              {toPlace === 1 ? "" : "s"} here still need a person
              {missingIdentity === 0 ? (
                <>
                  {" "}
                  — the same number the giving page counts as{" "}
                  <span className="text-muted">Unlinked givers</span>.
                </>
              ) : (
                <>
                  {" "}
                  out of the {coverage.unlinked.toLocaleString()} the giving
                  page counts as{" "}
                  <span className="text-muted">Unlinked givers</span>; the other{" "}
                  {missingIdentity.toLocaleString()} have no name on file yet.
                </>
              )}
            </p>

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
                    <span className={`ml-1.5 tnum ${activeTab ? "text-bg/80" : "text-subtle"}`}>
                      {tabCount(t.key).toLocaleString()}
                    </span>
                  </Link>
                );
              })}
            </div>

            <ReviewList givers={givers} status={status} />

            {givers.length >= 500 && (
              <p className="text-xs text-subtle">
                Showing the first 500, biggest givers first. Place some, then
                reload for more.
              </p>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

/** The honest empty state. Gifts are loaded and hundreds of givers have no
 *  person, but no import has stored a name for any of them, so there is
 *  genuinely nothing to list — and that is fixable in one upload. Saying
 *  "nothing to review" here would be the same lie the page used to tell. */
function NoIdentitiesYet({ unlinked, payers }: { unlinked: number; payers: number }) {
  return (
    <Card className="p-6 border-accent">
      <h2 className="text-sm font-semibold">
        Nothing to show yet — and that is not the same as nothing to do
      </h2>
      <div className="text-sm text-muted mt-2 space-y-2 max-w-3xl">
        <p>
          {payers.toLocaleString()} giver profiles sit behind the gifts already
          loaded, and{" "}
          <span className="text-fg">{unlinked.toLocaleString()} of them have no person attached</span>
          . None can be listed here, because none of them has a name on file:
          gifts store no identity at all, and the names only started being kept
          — per giver, encrypted — with this version of the import.
        </p>
        <p>
          <span className="text-fg">Re-upload the Transactions export</span> on
          the PushPay page and every giver in it appears here, with the people
          they might be. It is safe to upload a file that is already loaded: the
          import matches gifts on their Transaction ID and updates them in
          place, so no gift is duplicated and no history is lost — it simply
          fills in the identities.
        </p>
        <p>
          Export it with the <span className="text-fg">Your ID</span> column
          included — that is the column carrying the PCO person id, and without
          it the import cannot tell who a giver is and will refuse the file. A
          long export can also be uploaded a few months at a time: each one
          adds to the same history, and the givers in it appear here.
        </p>
      </div>
      <Link
        href="/pushpay"
        className="mt-4 inline-block text-sm text-accent hover:underline font-medium"
      >
        Go to PushPay and upload the Transactions export →
      </Link>
    </Card>
  );
}

/** Some givers are named and some are not: an export covering an earlier
 *  window was loaded before identities were kept, and has not been re-supplied. */
function PartialIdentities({ missing, unlinked }: { missing: number; unlinked: number }) {
  return (
    <Card className="p-4">
      <div className="text-sm font-medium mb-1">Some givers still have no name on file</div>
      <p className="text-xs text-muted max-w-3xl">
        {missing.toLocaleString()} of the {unlinked.toLocaleString()} givers
        with no person were last carried by an export imported before names
        were kept, so they cannot be listed below. Upload the Transactions
        export covering their gifts again — it is an upsert, so nothing is
        duplicated — and they will join the queue.{" "}
        <Link href="/pushpay" className="text-accent hover:underline">
          Import on PushPay →
        </Link>
      </p>
    </Card>
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
