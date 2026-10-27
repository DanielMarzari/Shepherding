import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Avatar, Card, Pill } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import {
  type DuplicatePairView,
  type DupPersonView,
  countDuplicatePairs,
  duplicatePairsStale,
  listDuplicatePairs,
} from "@/lib/audit-read";
import { DownloadPairsCsv } from "./download-pairs-csv";

interface SearchParams {
  confidence?: string;
  returning?: string;
  page?: string;
}

/** Pairs rendered at once. The whole table is 7,309 pairs; putting them all
 *  in one response took about thirty seconds of rendering, and because the
 *  server is single-threaded, every other page waited behind it. */
const PER_PAGE = 100;

export default async function DuplicateAuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireOrg();
  const params = await searchParams;
  const counts = countDuplicatePairs(session.orgId);
  const stale = duplicatePairsStale(session.orgId);

  const conf =
    params.confidence === "high" || params.confidence === "low"
      ? params.confidence
      : null;
  const returningOnly = params.returning === "1";
  const page = Math.max(1, Number(params.page) || 1);

  const matching = returningOnly
    ? counts.returning
    : conf === "high"
      ? counts.high
      : conf === "low"
        ? counts.low
        : counts.total;
  const pairs = listDuplicatePairs(session.orgId, {
    confidence: conf ?? undefined,
    returningOnly,
    limit: PER_PAGE,
    offset: (page - 1) * PER_PAGE,
  });
  const lastPage = Math.max(1, Math.ceil(matching / PER_PAGE));
  const qs = (n: number) => {
    const u = new URLSearchParams();
    if (conf) u.set("confidence", conf);
    if (returningOnly) u.set("returning", "1");
    if (n > 1) u.set("page", String(n));
    const q = u.toString();
    return `/audit/duplicates${q ? `?${q}` : ""}`;
  };

  return (
    <AppShell active="Duplicate audit" breadcrumb="Duplicate audit">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Duplicate audit
          </h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            People who likely appear twice — matched on an exact name (Jr/III
            suffixes stripped) <span className="text-fg">and</span> fuzzily,
            across misspelled or nickname names (Jon ↔ John) when a shared
            email, birthdate, or address ties them together. Each pair lists
            the reasons — matching email, birthdate, address — so you can tell
            a real duplicate from a parent/child or a couple sharing an inbox.
            We skip inactive-only pairs (nothing to act on) and call out{" "}
            <span className="text-fg">active + inactive</span> pairs, which
            often mean someone is coming back. Built during sync, so this
            page loads instantly.
          </p>
        </div>

        {stale && (
          <Card className="p-3 text-xs text-muted">
            These pairs were matched by an older version of the matcher. The
            nightly refresh rebuilds them; this page shows what it has rather
            than rebuilding now, which would read every person in the
            organization and hold every other page while it ran.
          </Card>
        )}

        <div className="flex items-end justify-between gap-3 flex-wrap text-xs">
          <span className="text-muted">
            {matching === 0
              ? "No pairs"
              : `${(((page - 1) * PER_PAGE) + 1).toLocaleString()}–${Math.min(page * PER_PAGE, matching).toLocaleString()} of ${matching.toLocaleString()} pair${matching === 1 ? "" : "s"}`}
            {conf ? ` · ${conf} confidence` : ""}
            {returningOnly ? " · possibly returning" : ""}
          </span>
          <DownloadPairsCsv
            confidence={conf}
            returningOnly={returningOnly}
            count={matching}
            filename={`audit-duplicates${conf ? `-${conf}` : ""}${returningOnly ? "-returning" : ""}.csv`}
          />
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <FilterChip
            label="All"
            count={counts.total}
            href="/audit/duplicates"
            active={!conf && !returningOnly}
          />
          <FilterChip
            label="High confidence"
            count={counts.high}
            href="/audit/duplicates?confidence=high"
            active={conf === "high" && !returningOnly}
            tone="warn"
          />
          <FilterChip
            label="Low confidence"
            count={counts.low}
            href="/audit/duplicates?confidence=low"
            active={conf === "low" && !returningOnly}
          />
          <FilterChip
            label="Possibly returning"
            count={counts.returning}
            href="/audit/duplicates?returning=1"
            active={returningOnly}
            tone="accent"
          />
        </div>

        {pairs.length === 0 ? (
          <Card className="p-10 text-center text-sm text-muted">
            No duplicate pairs
            {conf ? ` at ${conf} confidence` : ""}
            {returningOnly ? " among possibly-returning records" : ""}.
          </Card>
        ) : (
          <div className="space-y-3">
            {pairs.map((p) => (
              <PairCard key={`${p.a.pcoId}-${p.b.pcoId}`} p={p} />
            ))}
          </div>
        )}

        {lastPage > 1 && (
          <div className="flex items-center justify-between gap-3 text-xs">
            {page > 1 ? (
              <Link href={qs(page - 1)} className="text-accent hover:underline">
                &larr; Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="text-subtle tnum">
              Page {page.toLocaleString()} of {lastPage.toLocaleString()}
            </span>
            {page < lastPage ? (
              <Link href={qs(page + 1)} className="text-accent hover:underline">
                Next &rarr;
              </Link>
            ) : (
              <span />
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function PairCard({ p }: { p: DuplicatePairView }) {
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <PersonChip r={p.a} />
          <span className="text-subtle text-sm">↔</span>
          <PersonChip r={p.b} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {p.oneActiveOneInactive && (
            <span className="text-[11px] px-2 py-0.5 rounded-full border border-accent text-accent">
              may be returning
            </span>
          )}
          <Pill tone={p.confidence === "high" ? "warn" : "muted"}>
            {p.confidence === "high" ? "high confidence" : "low confidence"}
          </Pill>
        </div>
      </div>
      <ul className="space-y-1">
        {p.reasons.map((reason, i) => (
          <li key={i} className="text-xs text-muted flex items-start gap-2">
            <span className="text-subtle mt-0.5">·</span>
            <span>{reason}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PersonChip({ r }: { r: DupPersonView }) {
  return (
    <a
      href={`https://people.planningcenteronline.com/people/${r.pcoId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 group"
      title="Open in PCO"
    >
      <Avatar initials={r.initials} size="sm" />
      <div className="min-w-0">
        <div className="font-medium text-sm truncate group-hover:text-accent">
          {r.fullName}
          {r.inactive && (
            <Pill tone="muted" className="ml-2">
              inactive
            </Pill>
          )}
        </div>
        <div className="text-[11px] text-subtle">PCO #{r.pcoId}</div>
      </div>
    </a>
  );
}

function FilterChip({
  label,
  count,
  href,
  active,
  tone,
}: {
  label: string;
  count: number;
  href: string;
  active: boolean;
  tone?: "warn" | "accent";
}) {
  const baseTone =
    tone === "warn"
      ? "text-warn-soft-fg"
      : tone === "accent"
        ? "text-accent"
        : "text-muted";
  return (
    <Link
      href={href}
      className={`px-2.5 py-1 rounded-full border transition-colors ${
        active
          ? "bg-bg-elev-2 border-accent text-fg"
          : `border-border-soft ${baseTone} hover:border-accent hover:text-fg`
      }`}
    >
      {label} <span className="tnum">{count.toLocaleString()}</span>
    </Link>
  );
}
