"use client";

import { useMemo, useState } from "react";
import {
  SortableTable,
  type SortableColumn,
} from "@/components/SortableTable";
import {
  SENIORS_ACTIVITY_BUCKETS,
  SENIORS_NEVER_BUCKET,
  SENIOR_LANE_KEYS,
  SENIOR_LANE_LABELS,
  STANDING_LABEL,
  STANDING_NOTE,
  type AgeSource,
  type EmailSource,
  type EventSource,
  type SeniorLaneKey,
  type SeniorRow,
  type Standing,
  type WorkingList,
} from "@/lib/seniors-audit-shared";
import { downloadCsv } from "./csv";

type Tab = "list" | "email" | "age" | "events";

const SOURCE_LABEL: Record<string, string> = {
  E: "on the mailing list",
  A: "old enough on file",
  R: "registered or on a roster",
};

const ORDER: Standing[] = [
  "at_events",
  "reads_email",
  "ignores_email",
  "active_elsewhere",
  "not_involved",
];

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
  const [lanes, setLanes] = useState<SeniorLaneKey[]>([]);
  const [bucket, setBucket] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return working.rows.filter((r) => {
      if (only && r.standing !== only) return false;
      // Every ticked lane must be true: "worship AND serve" is the useful
      // question, not "worship OR serve", which is nearly everybody.
      if (lanes.length && !lanes.every((k) => r.lanes[k])) return false;
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
  }, [working.rows, only, lanes, bucket, q]);

  const columns: SortableColumn<SeniorRow>[] = [
    {
      key: "name",
      label: "Person",
      align: "left",
      sortValue: (r) => r.name.toLowerCase(),
      render: (r) =>
        r.personId ? (
          <a
            href={`/people/${r.personId}`}
            className="font-medium hover:text-accent"
          >
            {r.name}
          </a>
        ) : (
          <span className="text-muted italic">
            {r.name}
            <span className="text-[11px] text-subtle ml-1.5 not-italic">
              no PCO record — only a hashed address is stored
            </span>
          </span>
        ),
    },
    {
      key: "sources",
      label: "Where from",
      align: "left",
      className: "w-[120px]",
      sortValue: (r) => r.sources.slice().sort().join(""),
      render: (r) => (
        <span className="flex gap-1">
          {(["E", "A", "R"] as const).map((sk) =>
            r.sources.includes(sk) ? (
              <span
                key={sk}
                title={SOURCE_LABEL[sk]}
                className="w-5 h-5 rounded border border-accent/50 text-accent text-[10px] font-bold flex items-center justify-center"
              >
                {sk}
              </span>
            ) : (
              <span
                key={sk}
                aria-hidden="true"
                className="w-5 h-5 rounded border border-border-softer text-subtle text-[10px] flex items-center justify-center"
              >
                ·
              </span>
            ),
          )}
        </span>
      ),
    },
    {
      key: "lanes",
      label: "Activity",
      align: "left",
      className: "w-[190px]",
      title: "Worship · Serve · Community · Give · Outreach · Email",
      sortValue: (r) => r.laneCount,
      render: (r) => (
        <span className="flex gap-1">
          {SENIOR_LANE_KEYS.map((k) => (
            <span
              key={k}
              title={`${SENIOR_LANE_LABELS[k]}${r.lanes[k] ? "" : " — no"}`}
              className={`w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center border ${
                r.lanes[k]
                  ? "border-accent/50 text-accent bg-accent-soft-bg/30"
                  : "border-border-softer text-subtle"
              }`}
            >
              {r.lanes[k] ? SENIOR_LANE_LABELS[k][0] : "·"}
            </span>
          ))}
        </span>
      ),
    },
    {
      key: "last",
      label: "Last seen",
      align: "right",
      className: "w-[110px]",
      sortValue: (r) => (r.daysSince === null ? null : r.daysSince),
      render: (r) =>
        r.daysSince === null ? (
          <span className="text-subtle text-xs">never</span>
        ) : (
          <span className="text-xs tnum text-muted">{r.daysSince}d</span>
        ),
    },
    {
      key: "standing",
      label: "Standing",
      align: "left",
      sortValue: (r) => ORDER.indexOf(r.standing),
      render: (r) => (
        <>
          <span className="text-xs text-muted">
            {STANDING_LABEL[r.standing]}
          </span>
          {r.events.length > 0 && (
            <span className="text-[11px] text-subtle ml-1.5">
              {r.events.slice(0, 2).join(", ")}
              {r.events.length > 2 && ` +${r.events.length - 2}`}
            </span>
          )}
        </>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      {!working.eventsConfigured && (
        <p className="rounded-lg border border-warn-soft-fg/40 bg-bg-elev px-4 py-3 text-xs text-muted leading-relaxed">
          No seniors events are marked yet, so nobody can land in{" "}
          <strong className="text-fg">
            {STANDING_LABEL.at_events.toLowerCase()}
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
            In every lane
          </span>
          {SENIOR_LANE_KEYS.map((k) => (
            <Chip
              key={k}
              on={lanes.includes(k)}
              onClick={() =>
                setLanes((cur) =>
                  cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k],
                )
              }
              label={SENIOR_LANE_LABELS[k]}
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
        {(only || lanes.length > 0 || bucket) && (
          <button
            type="button"
            onClick={() => {
              setOnly(null);
              setLanes([]);
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
        <ExportButton
          label="Export this list"
          onClick={() =>
            downloadCsv(
              "seniors-collected-list.csv",
              [
                "Name",
                "On the mailing list",
                "Old enough",
                "At an event",
                ...SENIOR_LANE_KEYS.map((k) => SENIOR_LANE_LABELS[k]),
                "Lanes",
                "Days since last activity",
                "Standing",
                "Events",
                "PCO link",
              ],
              rows.map((r) => [
                r.name,
                r.sources.includes("E") ? "yes" : "",
                r.sources.includes("A") ? "yes" : "",
                r.sources.includes("R") ? "yes" : "",
                ...SENIOR_LANE_KEYS.map((k) => (r.lanes[k] ? "yes" : "")),
                r.laneCount,
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
      />
    </div>
  );
}

// ── the three sources ────────────────────────────────────────────────

function EmailTab({ email }: { email: EmailSource }) {
  const openRate = email.sends > 0 ? (email.opens / email.sends) * 100 : 0;
  const [q, setQ] = useState("");
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
          <a href={`/people/${r.personId}`} className="font-medium hover:text-accent">
            {r.name}
          </a>
        ) : (
          <span className="text-muted italic">
            no PCO match
            <span className="text-[11px] text-subtle ml-1.5 not-italic">
              only a hashed address is stored
            </span>
          </span>
        ),
    },
    {
      key: "opened",
      label: "Opened",
      align: "right",
      className: "w-[120px]",
      sortValue: (r) => r.opened,
      render: (r) => (
        <span className={`tnum text-xs ${r.opened === 0 ? "text-subtle" : ""}`}>
          {r.opened} / {r.sent}
        </span>
      ),
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
          <Stat n={email.matched} label="matched to a PCO person" />
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
              The {email.unmatched} with no PCO match cannot be named here:
              the database keeps an HMAC of each address and never the
              address itself, so there is nothing to display but the fact
              of them. Matching them means adding them to PCO.
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
        onExport={() =>
          downloadCsv(
            "seniors-email-list.csv",
            ["Name", "Matched to PCO", "Opened", "Sent", "Last opened", "PCO link"],
            rows.map((r) => [
              r.name ?? "(no PCO match)",
              r.personId ? "yes" : "",
              r.opened,
              r.sent,
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
        initialSortKey="opened"
        initialSortDir="desc"
        emptyMessage="Nobody matches that."
      />
    </div>
  );
}

function AgeTab({ age }: { age: AgeSource }) {
  const [q, setQ] = useState("");
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
    {
      key: "born",
      label: "Born",
      align: "right",
      className: "w-[90px]",
      sortValue: (r) => r.birthYear,
      render: (r) => <span className="tnum text-xs text-muted">{r.birthYear}</span>,
    },
    {
      key: "cls",
      label: "Classified",
      align: "left",
      className: "w-[140px]",
      sortValue: (r) => r.classification,
      render: (r) => (
        <span className="text-xs text-muted capitalize">{r.classification}</span>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border-soft bg-bg-elev p-5">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Stat n={age.count} label={`known to be ${age.ageMin} or older`} />
          <Stat n={age.inactive} label="left out — inactive in PCO" />
          <Stat n={age.rows.length} label="on the list below" />
        </div>
        <p className="text-[11px] text-subtle mt-3.5 leading-relaxed max-w-3xl">
          Born {age.bornOnOrBefore} or earlier, still active in PCO, not
          deceased. {age.noBirthYear.toLocaleString()} people have no birth
          year on file and are not counted here either way.
        </p>
      </div>

      <ListHeader
        q={q}
        setQ={setQ}
        shown={rows.length}
        total={age.rows.length}
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
      />
    </div>
  );
}

function EventsTab({ events, years }: { events: EventSource; years: number }) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return events.rows;
    return events.rows.filter(
      (r) =>
        r.name.toLowerCase().includes(needle) ||
        r.events.some((e) => e.toLowerCase().includes(needle)),
    );
  }, [events.rows, q]);

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
      key: "cls",
      label: "Classified",
      align: "left",
      className: "w-[130px]",
      sortValue: (r) => r.classification,
      render: (r) => (
        <span className="text-xs text-muted capitalize">{r.classification}</span>
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
      className: "w-[90px]",
      sortValue: (r) => r.events.length,
      render: (r) => <span className="tnum text-xs">{r.events.length}</span>,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border-soft bg-bg-elev p-5">
        <Stat n={events.people} label="distinct people across everything marked" />
        <ul className="mt-4 space-y-1.5">
          {events.events.map((e) => (
            <li
              key={e.id}
              className="flex items-center gap-3 text-[13px] border-b border-border-softer pb-1.5"
            >
              <span className="min-w-0 flex-1 truncate">{e.name}</span>
              <span className="text-xs text-muted tnum shrink-0">
                {e.people.toLocaleString()} people
              </span>
            </li>
          ))}
        </ul>
      </div>

      <ListHeader
        q={q}
        setQ={setQ}
        shown={rows.length}
        total={events.rows.length}
        onExport={() =>
          downloadCsv(
            "seniors-event-attendees.csv",
            ["Name", "Classified", "Events", "How many", "PCO link"],
            rows.map((r) => [
              r.name,
              r.classification,
              r.events.join("; "),
              r.events.length,
              `https://people.planningcenteronline.com/people/${r.personId}`,
            ]),
          )
        }
      />
      <SortableTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.personId}
        initialSortKey="count"
        initialSortDir="desc"
        emptyMessage="Nobody matches that."
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
}: {
  q: string;
  setQ: (v: string) => void;
  shown: number;
  total: number;
  onExport: () => void;
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
      <ExportButton label="Export this list" onClick={onExport} disabled={shown === 0} />
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

function Chip({
  on,
  onClick,
  label,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
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
