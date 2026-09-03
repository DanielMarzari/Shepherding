import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Avatar, Card, Pill, Stat } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import {
  type FitRow,
  type Requirement,
  SIGNAL_LABELS,
  type SignalKey,
  type TypeSummary,
  auditType,
  policyFor,
  summarizeOrg,
} from "@/lib/membership-fit";
import { DownloadFitCsvButton } from "./download-fit-csv";

export const dynamic = "force-dynamic";

interface SearchParams {
  /** Membership type name, "__unset__" for people with no type, or absent
   *  for the overview tab. */
  type?: string;
  /** Requirement id to filter the roster down to. */
  flag?: string;
  /** "1" to include people PCO has marked inactive. */
  inactive?: string;
}

const UNSET = "__unset__";

export default async function MembershipFitPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireOrg();
  const params = await searchParams;
  const summaries = summarizeOrg(session.orgId);
  const selected = params.type;

  return (
    <AppShell active="Membership fit" breadcrumb="Membership fit audit">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Membership fit audit
          </h1>
          <p className="text-muted text-sm mt-1 max-w-3xl">
            Every membership type asserts something about a person. This page
            checks that assertion against what they actually do — giving,
            groups, teams, serving, check-ins, events, forms — and flags the
            people whose label no longer matches. Read-only: fix the records in
            PCO.{" "}
            <Link href="/audit" className="text-accent hover:underline">
              Data hygiene lives on the main audit →
            </Link>
          </p>
        </div>

        <TypeTabs summaries={summaries} selected={selected} />

        {selected === undefined ? (
          <Overview summaries={summaries} />
        ) : (
          <TypeDetail
            orgId={session.orgId}
            typeParam={selected}
            flag={params.flag}
            showInactive={params.inactive === "1"}
          />
        )}
      </div>
    </AppShell>
  );
}

// ─── Tab strip ────────────────────────────────────────────────────────

function tabHref(type: string | null | undefined): string {
  if (type === undefined) return "/audit/membership-fit";
  const v = type === null ? UNSET : type;
  return `/audit/membership-fit?type=${encodeURIComponent(v)}`;
}

function TypeTabs({
  summaries,
  selected,
}: {
  summaries: TypeSummary[];
  selected: string | undefined;
}) {
  return (
    <div className="border-b border-border-soft -mx-5 md:-mx-7 px-5 md:px-7">
      <div className="flex gap-1 overflow-x-auto pb-px">
        <Tab
          href={tabHref(undefined)}
          active={selected === undefined}
          label="Overview"
        />
        {summaries.map((s) => {
          const value = s.membershipType ?? UNSET;
          return (
            <Tab
              key={value}
              href={tabHref(s.membershipType)}
              active={selected === value}
              label={s.label}
              count={s.total}
              flagged={s.audited ? s.flagged : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

function Tab({
  href,
  active,
  label,
  count,
  flagged,
}: {
  href: string;
  active: boolean;
  label: string;
  count?: number;
  flagged?: number;
}) {
  return (
    <Link
      href={href}
      className={`shrink-0 px-3 py-2 text-xs whitespace-nowrap border-b-2 -mb-px transition-colors ${
        active
          ? "border-accent text-fg font-semibold"
          : "border-transparent text-muted hover:text-fg hover:border-border-soft"
      }`}
    >
      {label}
      {count !== undefined && (
        <span className="ml-1.5 tnum text-subtle">{count.toLocaleString()}</span>
      )}
      {flagged !== undefined && flagged > 0 && (
        <span className="ml-1.5 tnum text-warn-soft-fg font-semibold">
          ⚑{flagged.toLocaleString()}
        </span>
      )}
    </Link>
  );
}

// ─── Overview tab ─────────────────────────────────────────────────────

function Overview({ summaries }: { summaries: TypeSummary[] }) {
  const audited = summaries.filter((s) => s.audited);
  const totalPeople = summaries.reduce((n, s) => n + s.total, 0);
  const totalFlagged = audited.reduce((n, s) => n + s.flagged, 0);
  const auditedPeople = audited.reduce((n, s) => n + s.total, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="People" value={totalPeople.toLocaleString()} />
        <Stat
          label="Membership types"
          value={summaries.length}
          delta={`${audited.length} with requirements`}
        />
        <Stat
          label="Under audit"
          value={auditedPeople.toLocaleString()}
          delta="in types that assert something"
        />
        <Stat
          label="Look misfiled"
          value={totalFlagged.toLocaleString()}
          valueTone="warn"
          delta={
            auditedPeople > 0
              ? `${((totalFlagged / auditedPeople) * 100).toFixed(0)}% of audited`
              : undefined
          }
          highlight
        />
      </div>

      <Card>
        <div className="px-5 pt-4 pb-3 border-b border-border-soft">
          <h2 className="text-sm font-semibold">Every membership type</h2>
          <p className="text-xs text-muted mt-1 max-w-3xl">
            Types with no participation requirement — partner and staff labels —
            are never flagged. They&apos;re listed so the roster is complete and
            so you can see what each one is doing.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-border-soft">
                <th className="text-left font-medium px-5 py-2">Type</th>
                <th className="text-right font-medium px-5 py-2">People</th>
                <th className="text-right font-medium px-5 py-2">Flagged</th>
                <th className="text-left font-medium px-5 py-2 w-48">
                  Share misfiled
                </th>
                <th className="text-left font-medium px-5 py-2">
                  What the label asserts
                </th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((s) => {
                const policy = policyFor(s.membershipType);
                return (
                  <tr
                    key={s.membershipType ?? UNSET}
                    className="border-b border-border-softer hover:bg-bg-elev-2/60 align-top"
                  >
                    <td className="px-5 py-3">
                      <Link
                        href={tabHref(s.membershipType)}
                        className="font-medium hover:text-accent"
                      >
                        {s.label}
                      </Link>
                      {!s.audited && (
                        <span className="ml-2 text-[10px] text-subtle italic">
                          {policy.systemOnly ? "system" : "no requirements"}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right tnum">
                      {s.total.toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-right tnum">
                      {s.audited ? (
                        <span
                          className={
                            s.flagged > 0 ? "text-warn-soft-fg font-semibold" : ""
                          }
                        >
                          {s.flagged.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {s.audited ? <MisfitBar pct={s.misfitPct} /> : null}
                    </td>
                    <td className="px-5 py-3 text-xs text-muted max-w-md">
                      {policy.meaning}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/** Share-misfiled bar. The number is always spelled out next to it — the bar
 *  is a scanning aid, never the only way to read the value. */
function MisfitBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-bg-elev-2 overflow-hidden min-w-16">
        <div
          className="h-full rounded-full bg-warn"
          style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }}
        />
      </div>
      <span className="tnum text-xs text-muted w-10 text-right">
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

// ─── Type detail tab ──────────────────────────────────────────────────

async function TypeDetail({
  orgId,
  typeParam,
  flag,
  showInactive,
}: {
  orgId: number;
  typeParam: string;
  flag: string | undefined;
  showInactive: boolean;
}) {
  const membershipType = typeParam === UNSET ? null : typeParam;
  const audit = auditType(orgId, membershipType);
  const label = membershipType ?? "(no type set)";

  if (audit.total === 0) {
    return (
      <Card>
        <div className="px-5 py-10 text-center text-sm text-muted">
          No people in &ldquo;{label}&rdquo;.
        </div>
      </Card>
    );
  }

  // Inactive people are hidden by default: on a roster where half the org is
  // marked inactive in PCO, leaving them in buries the live conversations.
  const afterInactive = showInactive
    ? audit.rows
    : audit.rows.filter((r) => !r.inactive);
  const visible = flag
    ? afterInactive.filter((r) => r.flags.some((f) => f.id === flag))
    : afterInactive.filter((r) => r.flags.length > 0);
  const hiddenInactive = audit.rows.filter(
    (r) => r.inactive && r.flags.length > 0,
  ).length;

  const enforced = audit.policy.requirements.filter((r) => r.kind !== "note");
  const activeFlagDetail = flag
    ? enforced.find((r) => r.id === flag)?.flagDetail
    : undefined;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="In this type" value={audit.total.toLocaleString()} />
        <Stat
          label="Look misfiled"
          value={audit.flaggedCount.toLocaleString()}
          valueTone={audit.flaggedCount > 0 ? "warn" : "default"}
          delta={
            audit.total > 0
              ? `${((audit.flaggedCount / audit.total) * 100).toFixed(0)}% of the type`
              : undefined
          }
          highlight={audit.flaggedCount > 0}
        />
        <Stat
          label="Gives"
          value={audit.signalCounts.giving.toLocaleString()}
          delta={`${audit.signalCounts.givingRecent.toLocaleString()} in the last year`}
        />
        <Stat
          label="Connected"
          value={(
            audit.signalCounts.group + audit.signalCounts.team
          ).toLocaleString()}
          delta={`${audit.signalCounts.group.toLocaleString()} in a group · ${audit.signalCounts.team.toLocaleString()} on a team`}
        />
      </div>

      <PolicyPanel
        label={label}
        meaning={audit.policy.meaning}
        requirements={audit.policy.requirements}
        flagCounts={audit.flagCounts}
        total={audit.total}
      />

      <SignalStrip counts={audit.signalCounts} total={audit.total} />

      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex flex-wrap gap-2 text-xs">
          <FilterChip
            label="All flagged"
            count={afterInactive.filter((r) => r.flags.length > 0).length}
            href={`${tabHref(membershipType)}${showInactive ? "&inactive=1" : ""}`}
            active={!flag}
          />
          {enforced.map((r) => (
            <FilterChip
              key={r.id}
              label={r.flagLabel ?? r.id}
              count={
                afterInactive.filter((row) =>
                  row.flags.some((f) => f.id === r.id),
                ).length
              }
              href={`${tabHref(membershipType)}&flag=${encodeURIComponent(r.id)}${
                showInactive ? "&inactive=1" : ""
              }`}
              active={flag === r.id}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          {hiddenInactive > 0 && (
            <Link
              href={`${tabHref(membershipType)}${
                flag ? `&flag=${encodeURIComponent(flag)}` : ""
              }${showInactive ? "" : "&inactive=1"}`}
              className="px-2.5 py-1 rounded border border-border-soft text-muted hover:text-fg text-xs"
            >
              {showInactive
                ? "Hide inactive"
                : `Show ${hiddenInactive.toLocaleString()} inactive`}
            </Link>
          )}
          <DownloadFitCsvButton
            rows={visible.map((r) => ({
              fullName: r.fullName,
              pcoId: r.pcoId,
              membershipType: label,
              status: r.status ?? "",
              flags: r.flags.map((f) => f.label).join("; "),
              suggested: r.suggested ?? "",
              signals: r.present.map((s) => SIGNAL_LABELS[s]).join("; "),
            }))}
            filename={`membership-fit-${label
              .replace(/[^a-z0-9]+/gi, "-")
              .toLowerCase()}${flag ? `-${flag}` : ""}.csv`}
          />
        </div>
      </div>

      {activeFlagDetail && (
        <p className="text-xs text-muted -mt-2 max-w-3xl">{activeFlagDetail}</p>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-border-soft">
                <th className="text-left font-medium px-5 py-2">Person</th>
                <th className="text-left font-medium px-5 py-2">
                  Why it doesn&apos;t fit
                </th>
                <th className="text-left font-medium px-5 py-2">
                  Activity on record
                </th>
                <th className="text-left font-medium px-5 py-2">Giving</th>
                <th className="text-right font-medium px-5 py-2">Check-ins</th>
                <th className="text-left font-medium px-5 py-2">
                  Probably belongs in
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-10 text-center text-sm text-muted"
                  >
                    {enforced.length === 0
                      ? "This type has no requirements — nobody can be misfiled out of it."
                      : "Nothing flagged. Every record in this type matches what the label claims."}
                  </td>
                </tr>
              ) : (
                visible.map((r) => <FitTr key={r.pcoId} r={r} />)
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function PolicyPanel({
  label,
  meaning,
  requirements,
  flagCounts,
  total,
}: {
  label: string;
  meaning: string;
  requirements: Requirement[];
  flagCounts: Record<string, number>;
  total: number;
}) {
  return (
    <Card>
      <div className="px-5 pt-4 pb-4">
        <h2 className="text-sm font-semibold">
          What &ldquo;{label}&rdquo; means
        </h2>
        <p className="text-sm text-muted mt-1.5 max-w-3xl">{meaning}</p>
        <h3 className="text-xs font-semibold text-muted mt-4 mb-2 uppercase tracking-wide">
          Requirements to stay in this category
        </h3>
        <ul className="space-y-2">
          {requirements.map((req) => {
            const violations = flagCounts[req.id] ?? 0;
            return (
              <li key={req.id} className="flex items-start gap-2.5 text-sm">
                <span className="shrink-0 mt-0.5 w-14 text-[10px] uppercase tracking-wide font-semibold text-subtle">
                  {req.kind === "must"
                    ? "Must"
                    : req.kind === "only"
                      ? "Only"
                      : req.kind === "temporary"
                        ? "Expires"
                        : "Note"}
                </span>
                <span
                  className={
                    req.kind === "note" ? "text-muted italic" : "text-fg"
                  }
                >
                  {req.text}
                  {req.kind !== "note" && (
                    <span className="ml-2 text-xs">
                      {violations > 0 ? (
                        <span className="text-warn-soft-fg font-semibold tnum">
                          {violations.toLocaleString()} fail
                          {total > 0
                            ? ` (${((violations / total) * 100).toFixed(0)}%)`
                            : ""}
                        </span>
                      ) : (
                        <span className="text-subtle">all pass</span>
                      )}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
          {requirements.length === 0 && (
            <li className="text-sm text-muted italic">
              Not audited — these are system records, not people.
            </li>
          )}
        </ul>
      </div>
    </Card>
  );
}

/** What this whole group actually does. Answers "is the label plausible at
 *  all?" before you start working individual rows. */
function SignalStrip({
  counts,
  total,
}: {
  counts: Record<SignalKey, number>;
  total: number;
}) {
  const shown: SignalKey[] = [
    "giving",
    "group",
    "team",
    "served",
    "checkin",
    "event",
    "form",
  ];
  return (
    <Card>
      <div className="px-5 py-4">
        <h3 className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">
          What this group actually does
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {shown.map((k) => {
            const n = counts[k];
            const pct = total > 0 ? (n / total) * 100 : 0;
            return (
              <div key={k}>
                <div className="tnum text-lg font-semibold">
                  {n.toLocaleString()}
                </div>
                <div className="text-[11px] text-muted capitalize">
                  {SIGNAL_LABELS[k]}
                </div>
                <div className="mt-1 h-1 rounded-full bg-bg-elev-2 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${Math.max(pct, n > 0 ? 2 : 0)}%` }}
                  />
                </div>
                <div className="text-[10px] text-subtle tnum mt-0.5">
                  {pct.toFixed(0)}%
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function FilterChip({
  label,
  count,
  href,
  active,
}: {
  label: string;
  count: number;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`px-2.5 py-1 rounded-full border transition-colors ${
        active
          ? "bg-bg-elev-2 border-accent text-fg font-medium"
          : "border-border-soft text-muted hover:border-accent hover:text-fg"
      }`}
    >
      {label} <span className="tnum">{count.toLocaleString()}</span>
    </Link>
  );
}

function FitTr({ r }: { r: FitRow }) {
  return (
    <tr className="border-b border-border-softer hover:bg-bg-elev-2/60 align-top">
      <td className="px-5 py-3">
        <a
          href={`https://people.planningcenteronline.com/people/${r.pcoId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 group"
          title="Open in PCO"
        >
          <Avatar initials={r.initials} size="sm" />
          <div className="min-w-0">
            <div className="font-medium truncate group-hover:text-accent">
              {r.fullName}{" "}
              <span className="text-[10px] text-subtle group-hover:text-accent">
                ↗
              </span>
            </div>
            <div className="text-xs text-muted">
              PCO #{r.pcoId}
              {r.inactive && (
                <span className="ml-1.5 italic text-warn-soft-fg">inactive</span>
              )}
              {r.isMinor && <span className="ml-1.5 italic">kid</span>}
            </div>
          </div>
        </a>
      </td>
      <td className="px-5 py-3">
        <div className="flex flex-wrap gap-1">
          {r.flags.map((f) => (
            <Pill key={f.id} tone="warn">
              {f.label}
            </Pill>
          ))}
        </div>
      </td>
      <td className="px-5 py-3">
        {r.present.length === 0 ? (
          <span className="text-xs text-subtle italic">nothing on record</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {r.present.map((s) => (
              <Pill key={s} tone="muted">
                {SIGNAL_LABELS[s]}
              </Pill>
            ))}
          </div>
        )}
      </td>
      <td className="px-5 py-3 text-xs text-muted whitespace-nowrap">
        {r.signals.giving ? (
          <>
            <div>{r.donorStage ?? "donor"}</div>
            <div className="text-subtle">
              {r.givingChannel ?? "—"}
              {r.lastGiftDate ? ` · ${r.lastGiftDate}` : ""}
            </div>
          </>
        ) : (
          <span className="text-subtle">—</span>
        )}
      </td>
      <td className="px-5 py-3 text-right tnum">
        {r.checkinCount > 0 ? (
          <>
            <div>{r.checkinCount.toLocaleString()}</div>
            {r.lastCheckinAt && (
              <div className="text-[10px] text-subtle">
                {new Date(r.lastCheckinAt).toLocaleDateString()}
              </div>
            )}
          </>
        ) : (
          <span className="text-subtle">—</span>
        )}
      </td>
      <td className="px-5 py-3">
        {r.suggested ? (
          <Pill tone="accent">{r.suggested}</Pill>
        ) : (
          <span className="text-xs text-subtle italic">review</span>
        )}
      </td>
    </tr>
  );
}
