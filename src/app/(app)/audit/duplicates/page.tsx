import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Avatar, Card, Pill } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import {
  type DuplicatePairView,
  type DupPersonView,
  listDuplicatePairs,
} from "@/lib/audit-read";
import { DownloadCsvButton } from "../download-csv";

interface SearchParams {
  confidence?: string;
  returning?: string;
}

export default async function DuplicateAuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireOrg();
  const params = await searchParams;
  const all = listDuplicatePairs(session.orgId);

  const highCount = all.filter((p) => p.confidence === "high").length;
  const lowCount = all.filter((p) => p.confidence === "low").length;
  const returningCount = all.filter((p) => p.oneActiveOneInactive).length;

  const conf =
    params.confidence === "high" || params.confidence === "low"
      ? params.confidence
      : null;
  const returningOnly = params.returning === "1";
  const pairs = all.filter(
    (p) =>
      (!conf || p.confidence === conf) &&
      (!returningOnly || p.oneActiveOneInactive),
  );

  // The CSV export is a flat name + PCO-link list of everyone in a pair.
  const csvSeen = new Set<string>();
  const csvRows: Array<{ pcoId: string; fullName: string }> = [];
  for (const p of pairs) {
    for (const person of [p.a, p.b]) {
      if (csvSeen.has(person.pcoId)) continue;
      csvSeen.add(person.pcoId);
      csvRows.push({ pcoId: person.pcoId, fullName: person.fullName });
    }
  }

  return (
    <AppShell active="Duplicate audit" breadcrumb="Duplicate audit">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Duplicate audit
          </h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            People who share a name (suffixes like Jr/III stripped before
            matching), paired up with the reasons we think they&apos;re the
            same person — matching email, birthdate, address, and so on. We
            skip inactive-only pairs (nothing to act on) and call out{" "}
            <span className="text-fg">active + inactive</span> pairs, which
            often mean someone is coming back. Built during sync, so this
            page loads instantly.
          </p>
        </div>

        <div className="flex items-end justify-between gap-3 flex-wrap text-xs">
          <span className="text-muted">
            {pairs.length.toLocaleString()} pair{pairs.length === 1 ? "" : "s"}
            {conf ? ` · ${conf} confidence` : ""}
            {returningOnly ? " · possibly returning" : ""}
          </span>
          <DownloadCsvButton
            rows={csvRows}
            filename={`audit-duplicates${conf ? `-${conf}` : ""}.csv`}
          />
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <FilterChip
            label="All"
            count={all.length}
            href="/audit/duplicates"
            active={!conf && !returningOnly}
          />
          <FilterChip
            label="High confidence"
            count={highCount}
            href="/audit/duplicates?confidence=high"
            active={conf === "high" && !returningOnly}
            tone="warn"
          />
          <FilterChip
            label="Low (likely household)"
            count={lowCount}
            href="/audit/duplicates?confidence=low"
            active={conf === "low" && !returningOnly}
          />
          <FilterChip
            label="Possibly returning"
            count={returningCount}
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
            {p.confidence === "high" ? "high confidence" : "low — likely household"}
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
