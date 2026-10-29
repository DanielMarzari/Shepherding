"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  SortableTable,
  sortRows,
  type SortableColumn,
} from "@/components/SortableTable";
import {
  SENIORS_ACTIVITY_BUCKETS,
  SENIORS_NEVER_BUCKET,
  SENIOR_SIGNALS,
  SIGNAL_LABEL,
  SIGNAL_NOTE,
  STANDING_LABEL,
  STANDING_NOTE,
  STANDING_ORDER,
  humanAge,
  shortDate,
  type AgeSource,
  type EmailSource,
  type EventSource,
  type SeniorRow,
  type SeniorSignal,
  type Standing,
  type WorkingList,
} from "@/lib/seniors-audit-shared";
import { downloadCsv } from "./csv";
import { printDocument, type PrintColumn, type PrintRow } from "./print";

type Tab = "list" | "email" | "age" | "events";

/** Spelled out rather than lettered. "E / A / R" needed a legend, and a
 *  legend on every row is a column that does not pay for itself. */
const SOURCE_LABEL: Record<string, string> = {
  E: "Email",
  A: "Age",
  R: "Events",
};

const SOURCE_NOTE: Record<string, string> = {
  E: "On one of the seniors mailing lists",
  A: "Old enough, by the birth year on file",
  R: "Registered for or on the roster of a seniors event",
};

const ORDER = STANDING_ORDER;

const NOT_IN_PCO =
  "Not in PCO. The name is Constant Contact's: nobody in PCO has this address, and the name points to no one there — or to more than one person.";
const BY_NAME =
  "Matched to PCO by name: the address on the mailing list is not on their PCO record, but this is the only person in PCO with the name.";
const FLAG_LEGEND =
  "Not in PCO — the name comes from the mailing list; nobody in PCO has the address, and the name points to no one there, or to more than one person.";

type Sort = { key: string; dir: "asc" | "desc" };

export function AuditView({
  working,
  email,
  age,
  events,
  years,
}: {
  working: WorkingList;
  email: EmailSource;
  age: AgeSource;
  events: EventSource;
  years: number;
}) {
  const [tab, setTab] = useState<Tab>("list");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5 border-b border-border-soft">
        <TabButton on={tab === "list"} onClick={() => setTab("list")}>
          Collected list
          <Count n={working.rows.length} />
        </TabButton>
        <TabButton on={tab === "email"} onClick={() => setTab("email")}>
          Email
          <Count n={email.contacts} />
        </TabButton>
        <TabButton on={tab === "age"} onClick={() => setTab("age")}>
          {age.ageMin}+
          <Count n={age.count} />
        </TabButton>
        <TabButton on={tab === "events"} onClick={() => setTab("events")}>
          Events
          <Count n={events.people} />
        </TabButton>
      </div>

      {tab === "list" && <CollectedTab working={working} />}
      {tab === "email" && <EmailTab email={email} />}
      {tab === "age" && <AgeTab age={age} />}
      {tab === "events" && <EventsTab events={events} years={years} />}
    </div>
  );
}

// ── the collected list ───────────────────────────────────────────────

function CollectedTab({ working }: { working: WorkingList }) {
  const [only, setOnly] = useState<Standing | null>(null);
  const [signals, setSignals] = useState<SeniorSignal[]>([]);
  const [bucket, setBucket] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "name", dir: "asc" });

  // Everything but the Summary filter: the split printout takes every
  // category, but still only the people the other filters leave.
  const unsplit = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return working.rows.filter((r) => {
      // Every ticked lane must be true: "worship AND serve" is the useful
      // question, not "worship OR serve", which is nearly everybody.
      if (signals.length && !signals.every((k) => r.signals[k])) return false;
      if (bucket) {
        if (bucket === SENIORS_NEVER_BUCKET) {
          if (r.daysSince !== null) return false;
        } else {
          const def = SENIORS_ACTIVITY_BUCKETS.find((b) => b.id === bucket);
          if (!def) return false;
          if (r.daysSince === null) return false;
          if (def.maxMonths === null) {
            if (r.daysSince <= 365) return false;
          } else if (r.daysSince > def.maxMonths * 30) return false;
        }
      }
      if (needle && !r.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [working.rows, signals, bucket, q]);
  const rows = useMemo(
    () => (only ? unsplit.filter((r) => r.standing === only) : unsplit),
    [unsplit, only],
  );

  const columns: SortableColumn<SeniorRow>[] = [
    {
      key: "name",
      label: "Person",
      align: "left",
      className: "w-auto",
      sortValue: (r) => r.name.toLowerCase(),
      render: (r) =>
        r.personId ? (
          <a
            href={`/people/${r.personId}`}
            className="font-medium hover:text-accent"
            title={r.nameMatch ? BY_NAME : undefined}
          >
            {r.name}
          </a>
        ) : (
          <NotInPco name={r.name} />
        ),
    },
    {
      key: "sources",
      label: "Where from",
      align: "left",
      className: "w-[210px]",
      sortValue: (r) => r.sources.slice().sort().join(""),
      render: (r) => (
        <span className="flex flex-wrap gap-1 items-center">
          {(["E", "A", "R"] as const)
            .filter((sk) => r.sources.includes(sk))
            .map((sk) => (
              <span
                key={sk}
                title={SOURCE_NOTE[sk]}
                className="px-1.5 py-0.5 rounded border border-accent/40 text-accent text-[10px] font-medium"
              >
                {SOURCE_LABEL[sk]}
              </span>
            ))}
        </span>
      ),
    },
    {
      key: "signals",
      label: "Activity",
      align: "left",
      className: "w-[170px]",
      sortValue: (r) => Number(r.signals.pco) * 2 + Number(r.signals.email),
      render: (r) => (
        <span className="flex gap-1.5">
          {SENIOR_SIGNALS.map((k) => (
            <span
              key={k}
              title={SIGNAL_NOTE[k]}
              className={`px-1.5 py-0.5 rounded text-[10px] border ${
                r.signals[k]
                  ? "border-accent/50 text-accent bg-accent-soft-bg/30 font-medium"
                  : "border-border-softer text-subtle line-through"
              }`}
            >
              {SIGNAL_LABEL[k]}
            </span>
          ))}
        </span>
      ),
    },
    {
      key: "last",
      label: "Last seen",
      align: "right",
      className: "w-[110px] whitespace-nowrap",
      title:
        "The most recent thing we can see — a PCO activity date, or an email they opened, whichever is later.",
      sortValue: (r) => (r.daysSince === null ? null : r.daysSince),
      render: (r) => (
        <span
          className={`text-xs tnum ${
            r.daysSince === null ? "text-subtle" : "text-muted"
          }`}
          title={r.lastActivityAt ?? "nothing recorded"}
        >
          {humanAge(r.daysSince)}
        </span>
      ),
    },
    {
      key: "standing",
      label: "Summary",
      align: "left",
      sortValue: (r) => ORDER.indexOf(r.standing),
      render: (r) => (
        <span className="text-xs text-muted">{STANDING_LABEL[r.standing]}</span>
      ),
    },
  ];

  function printCollected(mode: "view" | "split") {
    const split = mode === "split";
    // A single category needs no Summary column: it is the heading.
    const oneCategory = split || only !== null;
    const cols: PrintColumn[] = [
      { label: "Person" },
      { label: "Where from", width: "1.6in" },
      { label: "PCO activity", width: "0.8in", align: "center" },
      { label: "Opens email", width: "0.8in", align: "center" },
      { label: "Last seen", width: "0.75in", align: "right" },
      ...(oneCategory ? [] : [{ label: "Summary", width: "2in" }]),
    ];
    const toPrint = (r: SeniorRow): PrintRow => ({
      cells: [
        r.name,
        (["E", "A", "R"] as const)
          .filter((sk) => r.sources.includes(sk))
          .map((sk) => SOURCE_LABEL[sk])
          .join(" · "),
        "",
        "",
        humanAge(r.daysSince),
        ...(oneCategory ? [] : [STANDING_LABEL[r.standing]]),
      ],
      ticks: { 2: r.signals.pco, 3: r.signals.email },
      flag: !r.personId,
    });
    const ordered = sortRows(split ? unsplit : rows, columns, sort.key, sort.dir);

    const meta: string[] = [];
    const b = [
      ...SENIORS_ACTIVITY_BUCKETS,
      { id: SENIORS_NEVER_BUCKET, label: "Never" },
    ].find((x) => x.id === bucket);
    if (b) meta.push(`Active in: ${b.label}`);
    if (signals.length) meta.push(`Has: ${signals.map((k) => SIGNAL_LABEL[k]).join(" and ")}`);
    if (q.trim()) meta.push(`Name contains “${q.trim()}”`);

    if (split) {
      const groups = ORDER.map((sv) => ({
        sv,
        rows: ordered.filter((r) => r.standing === sv),
      })).filter((g) => g.rows.length > 0);
      printDocument({
        title: "Seniors audit — by summary",
        subtitle: "The collected list, one category per section",
        meta,
        overview: groups.map((g) => ({ label: STANDING_LABEL[g.sv], count: g.rows.length })),
        columns: cols,
        sections: groups.map((g) => ({
          heading: STANDING_LABEL[g.sv],
          note: STANDING_NOTE[g.sv],
          rows: g.rows.map(toPrint),
        })),
        pagePerSection: true,
        flagLegend: FLAG_LEGEND,
      });
      return;
    }
    printDocument({
      title: only ? `Seniors audit — ${STANDING_LABEL[only]}` : "Seniors audit — collected list",
      subtitle: only ? STANDING_NOTE[only] : "Everyone from the mailing list, the age list and the events, in one list",
      meta,
      columns: cols,
      sections: [{ rows: ordered.map(toPrint) }],
      flagLegend: FLAG_LEGEND,
    });
  }

  return (
    <div className="space-y-3">
      {!working.eventsConfigured && (
        <p className="rounded-lg border border-warn-soft-fg/40 bg-bg-elev px-4 py-3 text-xs text-muted leading-relaxed">
          No seniors events are marked yet, so nobody can land in{" "}
          <strong className="text-fg">
            {STANDING_LABEL.in_ministry.toLowerCase()}
          </strong>
          . Tick them under <strong className="text-fg">What counts as
          seniors</strong> above.
        </p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
        {ORDER.map((sv) => (
          <button
            key={sv}
            type="button"
            onClick={() => setOnly((cur) => (cur === sv ? null : sv))}
            aria-pressed={only === sv}
            title={STANDING_NOTE[sv]}
            className={`text-left rounded-lg border p-3 cursor-pointer transition-colors ${
              only === sv
                ? "border-accent bg-accent-soft-bg/30"
                : "border-border-soft bg-bg-elev hover:border-accent"
            }`}
          >
            <div className="text-xl font-semibold tnum">
              {working.byStanding[sv].toLocaleString()}
            </div>
            <div className="text-[11px] text-subtle leading-snug mt-0.5">
              {STANDING_LABEL[sv]}
            </div>
          </button>
        ))}
      </div>

      <p className="text-xs text-muted leading-relaxed max-w-3xl">
        <strong className="text-fg tnum">
          {working.neverInvited.toLocaleString()}
        </strong>{" "}
        people are old enough and have never had an email or been to an
        event. They are not lost &mdash; most are active in the church in
        other ways. They have just never been asked.
      </p>

      <div className="rounded-lg border border-border-soft bg-bg-elev px-4 py-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-subtle mr-1">
            Active in
          </span>
          {SENIORS_ACTIVITY_BUCKETS.map((b) => (
            <Chip
              key={b.id}
              on={bucket === b.id}
              onClick={() => setBucket((c) => (c === b.id ? null : b.id))}
              label={b.label}
            />
          ))}
          <Chip
            on={bucket === SENIORS_NEVER_BUCKET}
            onClick={() =>
              setBucket((c) =>
                c === SENIORS_NEVER_BUCKET ? null : SENIORS_NEVER_BUCKET,
              )
            }
            label="Never"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-subtle mr-1">
            Summary
          </span>
          {ORDER.map((sv) => (
            <Chip
              key={sv}
              on={only === sv}
              onClick={() => setOnly((cur) => (cur === sv ? null : sv))}
              label={STANDING_LABEL[sv]}
              title={STANDING_NOTE[sv]}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-subtle mr-1">
            Has
          </span>
          {SENIOR_SIGNALS.map((k) => (
            <Chip
              key={k}
              on={signals.includes(k)}
              onClick={() =>
                setSignals((cur) =>
                  cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k],
                )
              }
              label={SIGNAL_LABEL[k]}
              title={SIGNAL_NOTE[k]}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a name…"
          aria-label="Find a name"
          className="bg-bg-elev border border-border-soft rounded px-3 py-1.5 text-[13px] w-full max-w-xs"
        />
        {(only || signals.length > 0 || bucket) && (
          <button
            type="button"
            onClick={() => {
              setOnly(null);
              setSignals([]);
              setBucket(null);
            }}
            className="text-xs text-accent hover:underline cursor-pointer"
          >
            Clear filters
          </button>
        )}
        <span className="text-xs text-subtle tnum ml-auto">
          {rows.length.toLocaleString()} of{" "}
          {working.rows.length.toLocaleString()}
        </span>
        <PdfMenu
          disabled={rows.length === 0}
          options={[
            {
              label: "What's in view",
              hint: `${rows.length.toLocaleString()} people, as filtered and sorted now`,
              onClick: () => printCollected("view"),
            },
            {
              label: "By summary category",
              hint: "One section per category, each starting on a new page",
              onClick: () => printCollected("split"),
              disabled: unsplit.length === 0,
            },
          ]}
        />
        <ExportButton
          label="Export CSV"
          onClick={() =>
            downloadCsv(
              "seniors-collected-list.csv",
              [
                "Name",
                "In PCO",
                "From email",
                "From age",
                "From events",
                "Mailing lists",
                "Active in person",
                "Opens email",
                "Last seen",
                "Days since last activity",
                "Summary",
                "Events",
                "PCO link",
              ],
              rows.map((r) => [
                r.name,
                r.personId ? (r.nameMatch ? "yes, by name" : "yes") : "",
                r.sources.includes("E") ? "yes" : "",
                r.sources.includes("A") ? "yes" : "",
                r.sources.includes("R") ? "yes" : "",
                r.lists.join("; "),
                r.signals.pco ? "yes" : "",
                r.signals.email ? "yes" : "",
                humanAge(r.daysSince),
                r.daysSince,
                STANDING_LABEL[r.standing],
                r.events.join("; "),
                r.personId
                  ? `https://people.planningcenteronline.com/people/${r.personId}`
                  : "",
              ]),
            )
          }
          disabled={rows.length === 0}
        />
      </div>

      <SortableTable
        rows={rows}
        columns={columns}
        rowKey={(r, i) => r.personId ?? `contact-${i}`}
        initialSortKey="name"
        initialSortDir="asc"
        emptyMessage="Nobody matches that."
        tableClassName="table-fixed"
        onSortChange={(key, dir) => setSort({ key, dir })}
      />
    </div>
  );
}

// ── the three sources ────────────────────────────────────────────────

function EmailTab({ email }: { email: EmailSource }) {
  const openRate = email.sends > 0 ? (email.opens / email.sends) * 100 : 0;
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "openRate", dir: "desc" });
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return email.rows;
    return email.rows.filter((r) => (r.name ?? "").toLowerCase().includes(needle));
  }, [email.rows, q]);

  const columns: SortableColumn<EmailSource["rows"][number]>[] = [
    {
      key: "name",
      label: "Person",
      align: "left",
      sortValue: (r) => (r.name ?? "~").toLowerCase(),
      render: (r) =>
        r.personId ? (
          <a
            href={`/people/${r.personId}`}
            className="font-medium hover:text-accent"
            title={r.nameMatch ? BY_NAME : undefined}
          >
            {r.name}
          </a>
        ) : (
          <NotInPco name={r.name ?? "(no name on the contact)"} />
        ),
    },
    {
      key: "openRate",
      label: "Open rate",
      align: "right",
      className: "w-[110px]",
      title: "Emails opened as a share of those sent to them in the window",
      sortValue: (r) => (r.sent > 0 ? r.opened / r.sent : -1),
      render: (r) => <Rate n={r.opened} of={r.sent} />,
    },
    {
      key: "clickRate",
      label: "Click rate",
      align: "right",
      className: "w-[110px]",
      title: "Emails where they clicked a link, as a share of those sent",
      sortValue: (r) => (r.sent > 0 ? r.clicked / r.sent : -1),
      render: (r) => <Rate n={r.clicked} of={r.sent} />,
    },
    {
      key: "last",
      label: "Last opened",
      align: "right",
      className: "w-[130px]",
      sortValue: (r) => r.lastOpenedAt ?? null,
      render: (r) => (
        <span className="text-xs text-muted tnum">
          {r.lastOpenedAt ? r.lastOpenedAt.slice(0, 10) : "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border-soft bg-bg-elev p-5">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Stat n={email.contacts} label="contacts on the lists" />
          <Stat
            n={email.matched}
            label={
              email.matchedByName > 0
                ? `matched to a PCO person, ${email.matchedByName.toLocaleString()} of them by name`
                : "matched to a PCO person"
            }
          />
          <Stat
            n={email.unmatched}
            label="no PCO match"
            tone={email.unmatched > 0 ? "warn" : undefined}
          />
          <Stat n={email.campaigns} label="emails sent, last 12 months" />
          <div>
            <div className="text-2xl font-semibold tnum">
              {openRate.toFixed(0)}%
            </div>
            <div className="text-[11px] text-subtle leading-snug">
              opened, across {email.sends.toLocaleString()} sends
            </div>
          </div>
        </div>
        <p className="text-xs text-subtle mt-3.5 leading-relaxed max-w-3xl">
          <strong className="text-fg tnum">{email.openers.toLocaleString()}</strong>{" "}
          of {email.contacts.toLocaleString()} opened at least one in the
          year. That split is what separates reading from merely being
          written to.
          {email.unmatched > 0 && (
            <>
              {" "}
              The {email.unmatched.toLocaleString()} with no PCO match are
              named from Constant Contact&rsquo;s own record of them and
              marked with the warning sign. Nobody in PCO has their address,
              and nobody has their name either &mdash; or more than one
              person does, and there is no telling which.{" "}
              {email.unnamed > 0
                ? `${email.unnamed} have no name there either — those are an address and nothing else.`
                : "All of them have a name."}{" "}
              Their addresses are not shown anywhere: we store an HMAC of
              each one and never the address itself.
            </>
          )}
        </p>
        {email.lists.length > 0 && (
          <p className="text-[11px] text-subtle mt-2">
            Lists counted:{" "}
            {email.lists.map((l) => `${l.name} (${l.contacts})`).join(" · ")}
          </p>
        )}
      </div>

      <ListHeader
        q={q}
        setQ={setQ}
        shown={rows.length}
        total={email.rows.length}
        onPdf={() =>
          printDocument({
            title: "Seniors audit — mailing list",
            subtitle: `Everyone on the seniors lists, with what they opened in the last year`,
            meta: [
              ...email.lists.map((l) => l.name),
              ...(q.trim() ? [`Name contains “${q.trim()}”`] : []),
            ],
            columns: [
              { label: "Person" },
              { label: "Open rate", width: "0.9in", align: "right" },
              { label: "Click rate", width: "0.9in", align: "right" },
              { label: "Last opened", width: "1in", align: "right" },
            ],
            sections: [
              {
                rows: sortRows(rows, columns, sort.key, sort.dir).map((r) => ({
                  cells: [
                    r.name ?? "(no name on the contact)",
                    r.sent > 0 ? `${Math.round((r.opened / r.sent) * 100)}%` : "—",
                    r.sent > 0 ? `${Math.round((r.clicked / r.sent) * 100)}%` : "—",
                    shortDate(r.lastOpenedAt),
                  ],
                  flag: !r.personId,
                })),
              },
            ],
            flagLegend: FLAG_LEGEND,
          })
        }
        onExport={() =>
          downloadCsv(
            "seniors-email-list.csv",
            [
              "Name",
              "In PCO",
              "Lists",
              "Sent",
              "Opened",
              "Open rate",
              "Clicked",
              "Click rate",
              "Last opened",
              "PCO link",
            ],
            rows.map((r) => [
              r.name ?? "(no name on the contact)",
              r.personId ? (r.nameMatch ? "yes, by name" : "yes") : "",
              r.lists.join("; "),
              r.sent,
              r.opened,
              r.sent > 0 ? `${Math.round((r.opened / r.sent) * 100)}%` : "",
              r.clicked,
              r.sent > 0 ? `${Math.round((r.clicked / r.sent) * 100)}%` : "",
              r.lastOpenedAt ? r.lastOpenedAt.slice(0, 10) : "",
              r.personId
                ? `https://people.planningcenteronline.com/people/${r.personId}`
                : "",
            ]),
          )
        }
      />
      <SortableTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.contactId}
        initialSortKey="openRate"
        initialSortDir="desc"
        emptyMessage="Nobody matches that."
        onSortChange={(key, dir) => setSort({ key, dir })}
      />
    </div>
  );
}

function AgeTab({ age }: { age: AgeSource }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "name", dir: "asc" });
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return age.rows;
    return age.rows.filter((r) => r.name.toLowerCase().includes(needle));
  }, [age.rows, q]);

  const columns: SortableColumn<AgeSource["rows"][number]>[] = [
    {
      key: "name",
      label: "Person",
      align: "left",
      sortValue: (r) => r.name.toLowerCase(),
      render: (r) => (
        <a href={`/people/${r.personId}`} className="font-medium hover:text-accent">
          {r.name}
        </a>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border-soft bg-bg-elev p-5">
        <Stat
          n={age.count}
          label={`seniors, ${age.ageMin} or older, in the database`}
        />
        <p className="text-[11px] text-subtle mt-3.5 leading-relaxed max-w-3xl">
          Born {age.bornOnOrBefore} or earlier, and still active in PCO.{" "}
          {age.noBirthYear.toLocaleString()} people have no birth year on
          file and are not counted &mdash; some of them are certainly old
          enough, so this is a floor rather than a count.
        </p>
      </div>

      <ListHeader
        q={q}
        setQ={setQ}
        shown={rows.length}
        total={age.rows.length}
        onPdf={() =>
          printDocument({
            title: `Seniors audit — ${age.ageMin} and older`,
            subtitle: `Born ${age.bornOnOrBefore} or earlier, and active in PCO`,
            meta: q.trim() ? [`Name contains “${q.trim()}”`] : [],
            columns: [
              { label: "Person" },
              { label: "Born", width: "0.8in", align: "right" },
            ],
            sections: [
              {
                rows: sortRows(rows, columns, sort.key, sort.dir).map((r) => ({
                  cells: [r.name, String(r.birthYear)],
                })),
              },
            ],
          })
        }
        onExport={() =>
          downloadCsv(
            `seniors-${age.ageMin}-plus.csv`,
            ["Name", "Born", "Classified", "PCO link"],
            rows.map((r) => [
              r.name,
              r.birthYear,
              r.classification,
              `https://people.planningcenteronline.com/people/${r.personId}`,
            ]),
          )
        }
      />
      <SortableTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.personId}
        initialSortKey="name"
        initialSortDir="asc"
        emptyMessage="Nobody matches that."
        onSortChange={(key, dir) => setSort({ key, dir })}
      />
    </div>
  );
}

function EventsTab({ events, years }: { events: EventSource; years: number }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "last", dir: "desc" });
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return events.rows;
    return events.rows.filter(
      (r) =>
        r.name.toLowerCase().includes(needle) ||
        r.events.some((e) => e.toLowerCase().includes(needle)),
    );
  }, [events.rows, q]);

  const repeat = events.rows.filter((r) => r.events.length > 1).length;

  if (!events.configured) {
    return (
      <div className="rounded-lg border border-border-soft bg-bg-elev px-5 py-10 text-center">
        <h3 className="text-sm font-semibold">Nothing marked yet</h3>
        <p className="text-sm text-muted mt-2 max-w-lg mx-auto leading-relaxed">
          Open <strong className="text-fg">What counts as seniors</strong>{" "}
          above and tick the events from the last {years} years that belong
          to this ministry. Nothing is counted until you do.
        </p>
      </div>
    );
  }

  const columns: SortableColumn<EventSource["rows"][number]>[] = [
    {
      key: "name",
      label: "Person",
      align: "left",
      sortValue: (r) => r.name.toLowerCase(),
      render: (r) => (
        <a href={`/people/${r.personId}`} className="font-medium hover:text-accent">
          {r.name}
        </a>
      ),
    },
    {
      key: "events",
      label: "What they came to",
      align: "left",
      sortValue: (r) => r.events[0]?.toLowerCase() ?? "",
      render: (r) => (
        <span className="flex flex-wrap gap-1.5">
          {r.events.map((e) => (
            <span
              key={e}
              className="px-1.5 py-0.5 rounded border border-border-soft text-[11px] text-muted"
            >
              {e}
            </span>
          ))}
        </span>
      ),
    },
    {
      key: "count",
      label: "Events",
      align: "right",
      className: "w-[80px]",
      sortValue: (r) => r.events.length,
      render: (r) => <span className="tnum text-xs">{r.events.length}</span>,
    },
    {
      key: "last",
      label: "Last one",
      align: "right",
      className: "w-[100px] whitespace-nowrap",
      title:
        "The most recent of those events. Registrations date from the signup, check-ins from the service, group rosters from the last attendance recorded.",
      sortValue: (r) => r.lastAttendedAt ?? null,
      render: (r) => (
        <span
          className="text-xs tnum text-muted whitespace-nowrap"
          title={r.lastAttendedAt ?? "no date on any of them"}
        >
          {shortDate(r.lastAttendedAt)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      {/* No list of the events themselves: they were chosen above, and
          repeating them here is the same information twice. The numbers
          are what the tab is for. */}
      <div className="rounded-lg border border-border-soft bg-bg-elev p-5">
        <div className="flex flex-wrap gap-x-7 gap-y-3">
          <Stat n={events.people} label="people have been to a seniors event" />
          <Stat n={events.events.length} label="events marked as seniors" />
          <Stat n={repeat} label="came to more than one" />
        </div>
      </div>

      <ListHeader
        q={q}
        setQ={setQ}
        shown={rows.length}
        total={events.rows.length}
        onPdf={() =>
          printDocument({
            title: "Seniors audit — event attendees",
            subtitle: "Everyone registered for, or on the roster of, a seniors event",
            meta: q.trim() ? [`Matching “${q.trim()}”`] : [],
            columns: [
              { label: "Person", width: "2.1in" },
              { label: "What they came to" },
              { label: "Events", width: "0.6in", align: "right" },
              { label: "Last one", width: "0.75in", align: "right" },
            ],
            sections: [
              {
                rows: sortRows(rows, columns, sort.key, sort.dir).map((r) => ({
                  cells: [
                    r.name,
                    r.events.join(" · "),
                    String(r.events.length),
                    shortDate(r.lastAttendedAt),
                  ],
                })),
              },
            ],
          })
        }
        onExport={() =>
          downloadCsv(
            "seniors-event-attendees.csv",
            ["Name", "Events", "How many", "Last one", "PCO link"],
            rows.map((r) => [
              r.name,
              r.events.join("; "),
              r.events.length,
              r.lastAttendedAt ? r.lastAttendedAt.slice(0, 10) : "",
              `https://people.planningcenteronline.com/people/${r.personId}`,
            ]),
          )
        }
      />
      <SortableTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.personId}
        initialSortKey="last"
        initialSortDir="desc"
        emptyMessage="Nobody matches that."
        onSortChange={(key, dir) => setSort({ key, dir })}
      />
    </div>
  );
}

// ── bits ─────────────────────────────────────────────────────────────

function ListHeader({
  q,
  setQ,
  shown,
  total,
  onExport,
  onPdf,
}: {
  q: string;
  setQ: (v: string) => void;
  shown: number;
  total: number;
  onExport: () => void;
  onPdf: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Find a name…"
        aria-label="Find a name"
        className="bg-bg-elev border border-border-soft rounded px-3 py-1.5 text-[13px] w-full max-w-xs"
      />
      <span className="text-xs text-subtle tnum ml-auto">
        {shown.toLocaleString()} of {total.toLocaleString()}
      </span>
      <ExportButton label="PDF" onClick={onPdf} disabled={shown === 0} />
      <ExportButton label="Export CSV" onClick={onExport} disabled={shown === 0} />
    </div>
  );
}

/** A name with nothing in PCO behind it: the name, and a sign that says so.
 *  The sign carries the explanation on hover rather than a sentence on
 *  every row. */
function NotInPco({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted" title={NOT_IN_PCO}>
      <span className="font-medium">{name}</span>
      <svg
        viewBox="0 0 16 16"
        className="w-3.5 h-3.5 shrink-0 text-warn-soft-fg"
        aria-label="Not in PCO"
        role="img"
      >
        <path
          d="M8 1.5 15 14H1z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M8 6v3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="8" cy="11.6" r=".95" fill="currentColor" />
      </svg>
    </span>
  );
}

/** Two ways to print the list, behind one button. */
function PdfMenu({
  options,
  disabled,
}: {
  options: Array<{ label: string; hint: string; onClick: () => void; disabled?: boolean }>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        className="px-3 py-1.5 rounded border border-border-soft text-xs hover:bg-bg-elev-2 cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
      >
        PDF
        <span className="text-[9px] text-subtle" aria-hidden>
          ▼
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1.5 z-20 w-72 rounded-lg border border-border-soft bg-bg-elev shadow-lg p-1"
        >
          {options.map((o) => (
            <button
              key={o.label}
              type="button"
              role="menuitem"
              disabled={o.disabled}
              onClick={() => {
                setOpen(false);
                o.onClick();
              }}
              className="w-full text-left rounded px-3 py-2 hover:bg-bg-elev-2 cursor-pointer disabled:opacity-50 disabled:cursor-default"
            >
              <div className="text-[13px] font-medium">{o.label}</div>
              <div className="text-[11px] text-subtle leading-snug mt-0.5">{o.hint}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ExportButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-3 py-1.5 rounded border border-border-soft text-xs hover:bg-bg-elev-2 cursor-pointer disabled:opacity-50"
    >
      {label}
    </button>
  );
}

/** A percentage with the raw pair behind it on hover. The percentage is
 *  what you compare between people; the counts are what you check when a
 *  percentage looks implausible, which at a denominator of 12 it often
 *  does. */
function Rate({ n, of }: { n: number; of: number }) {
  if (of === 0) return <span className="text-subtle text-xs">—</span>;
  const pct = Math.round((n / of) * 100);
  return (
    <span
      className={`tnum text-xs ${pct === 0 ? "text-subtle" : "text-muted"}`}
      title={`${n} of ${of}`}
    >
      {pct}%
    </span>
  );
}

function Chip({
  on,
  onClick,
  label,
  title,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={title}
      className={`px-2.5 py-1 rounded-full border text-[11px] cursor-pointer transition-colors ${
        on
          ? "border-accent bg-accent-soft-bg/40 text-fg font-medium"
          : "border-border-soft text-muted hover:text-fg"
      }`}
    >
      {label}
    </button>
  );
}

function TabButton({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`px-3.5 py-2 text-[13px] font-medium cursor-pointer border-b-2 -mb-px flex items-center ${
        on ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

function Count({ n }: { n: number }) {
  return (
    <span className="text-[11px] text-subtle tnum ml-1.5">
      {n.toLocaleString()}
    </span>
  );
}

function Stat({
  n,
  label,
  tone,
}: {
  n: number;
  label: string;
  tone?: "warn";
}) {
  return (
    <div>
      <div
        className={`text-2xl font-semibold tnum ${
          tone === "warn" ? "text-warn-soft-fg" : ""
        }`}
      >
        {n.toLocaleString()}
      </div>
      <div className="text-[11px] text-subtle leading-snug">{label}</div>
    </div>
  );
}
