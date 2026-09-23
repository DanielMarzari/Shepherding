import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getPushpayGivingSummary, getPushpayImport, listPushpayUploads } from "@/lib/pushpay-import";
import { PushpayImportForm } from "./import-form";
import { PushpayUploadList, type UploadView } from "./upload-list";

export default async function PushpayPage() {
  const session = await requireOrg();
  const isAdmin = session.role === "admin";
  const last = getPushpayImport(session.orgId);
  const giving = getPushpayGivingSummary(session.orgId);
  // Timestamps are formatted here, on the server, the way the last-import line
  // below already does it — the list itself is a client component and would
  // otherwise render one time zone on the server and another in the browser.
  const uploads: UploadView[] = listPushpayUploads(session.orgId).map((u) => ({
    ...u,
    importedLabel: new Date(u.importedAt).toLocaleString(),
  }));

  return (
    <AppShell active="PushPay" breadcrumb="Giving › PushPay">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">PushPay giving</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Drop a PushPay export — <span className="text-fg">Transactions</span>,
            one row per gift, or <span className="text-fg">All Donors</span>, one
            row per donor — and Shepherdly matches each giver to a person, marks
            giving as a completed next step, and powers the giving statistics
            pages. <span className="text-fg">Transactions is the giving
            source:</span> every figure on the Give lane, the giving page and
            the Finance report is built from those gifts, because only that
            export carries a stable Payer ID. It also carries each giver&apos;s
            name, email and phone, which are kept — encrypted — so a giver
            nobody could place automatically can be placed by hand, once, and
            stay placed. The All Donors list is kept for matching help alone.
            One drop zone takes either file; it reads the header to tell them
            apart. No API connection needed, and no amounts: neither export
            carries them, so nothing anywhere is money.
          </p>
        </div>

        {/* Import card */}
        <Card className="p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Import an export</h2>
            <p className="text-xs text-muted mt-1 leading-relaxed max-w-2xl">
              In PushPay, export{" "}
              <span className="text-fg">Transactions</span> as CSV for the
              window you want (Transaction ID, Received On, Source, Fund, Payer
              ID, Your ID, and the giver&apos;s name, email and mobile): gifts
              are <span className="text-fg">added</span> to the history, so each
              new window builds on the last, and a file already loaded can be
              uploaded again safely — gifts match on their Transaction ID and
              update in place. Or export{" "}
              <span className="text-fg">Donors → All Donors</span> (First/Last
              name, Email, Donor Stage, Giving Channel, Last Gift), which{" "}
              <span className="text-fg">replaces</span> the donor list and
              re-matches everyone. It has no donor id, so it only ever helped
              matching — the givers themselves, and anything placed by hand,
              live with the Transactions import. Every upload is listed under
              Datasets below, and can be removed from there.
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
                  {last.kind === "transactions" ? "gifts" : "donors"}
                </span>
                <span>
                  <span className="text-good-soft-fg tnum">
                    {last.matched.toLocaleString()}
                  </span>{" "}
                  matched
                </span>
                {/* These counts are GIFTS for a Transactions import, and a
                    gift is placed or it is not: whether the giver behind it
                    needs a human is counted per giver on PushPay connections,
                    not here, so this row is always 0 for transactions. */}
                {last.kind !== "transactions" && (
                  <span>
                    <span className="text-warn-soft-fg tnum">
                      {last.ambiguous.toLocaleString()}
                    </span>{" "}
                    to review
                  </span>
                )}
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
            Giver names, emails, and phone numbers are encrypted at rest with the
            app key — the same protection used for PCO and all PII. Matching uses
            one-way hashes, never plaintext, and the gift rows themselves carry
            no identity at all.
          </p>
        </Card>

        {/* Datasets: what has been uploaded, and how to take one back out */}
        <Card className="p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Datasets</h2>
            <p className="text-xs text-muted mt-1 leading-relaxed max-w-2xl">
              Every file that has been saved, newest first. A Transactions upload adds gifts
              to the history rather than replacing it, and export windows overlap, so removing
              one takes out only the gifts no other upload supplies: a gift another file also
              carried stays, holding whichever file wrote it last. An All Donors upload
              replaces the whole donor list, so removing it empties that list.
            </p>
          </div>

          {giving && giving.gifts > 0 && (
            <p className="text-xs text-muted tnum">
              In the database now:{" "}
              <span className="text-fg">{giving.gifts.toLocaleString()}</span> gifts from{" "}
              <span className="text-fg">{giving.payers.toLocaleString()}</span> giver profiles
              {giving.firstGiftOn && giving.lastGiftOn
                ? `, dated ${giving.firstGiftOn} to ${giving.lastGiftOn}`
                : ""}
              . {giving.linkedPayers.toLocaleString()} of those giver profiles are tied to a person.
            </p>
          )}

          <PushpayUploadList uploads={uploads} isAdmin={isAdmin} />

          {!isAdmin && uploads.length > 0 && (
            <p className="text-[11px] text-subtle">Only admins can remove a dataset.</p>
          )}
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
              — every giver in the Transactions export and which person their
              gifts belong to. Place the ones no rule could: their gifts, the
              rollups and the Give lane all move with them.
            </li>
            <li>
              <Link href="/giving" className="text-accent hover:underline">
                Giving statistics
              </Link>{" "}
              — who gives, how and how often, funds, and location, over the
              gift window the page prints at the top — a customizable Page
              Builder page. Gift and giver counts, never amounts.
            </li>
          </ul>
        </Card>

        <p className="text-xs text-subtle">
          PushPay is connected by these CSV exports, not by its API. If an API
          connection is ever built, its credentials go on the{" "}
          <Link href="/settings/integrations" className="text-accent hover:underline">
            Credentials page
          </Link>
          .
        </p>
      </div>
    </AppShell>
  );
}
