"use client";

import { useMemo, useState } from "react";
import {
  STANDING_LABEL,
  STANDING_NOTE,
  type AgeSource,
  type EmailSource,
  type EventSource,
  type SeniorRow,
  type Standing,
  type WorkingList,
} from "@/lib/seniors-audit-shared";

type Tab = "list" | "email" | "age" | "events";

const SOURCE_LABEL: Record<string, string> = {
  E: "on the mailing list",
  A: "old enough on file",
  R: "registered or on a roster",
};

/** The ladder, in the order the ministry would work it. */
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
          The list
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

      {tab === "list" && <WorkingTab working={working} />}
      {tab === "email" && <EmailTab email={email} />}
      {tab === "age" && <AgeTab age={age} />}
      {tab === "events" && <EventsTab events={events} years={years} />}
    </div>
  );
}

// ── the list ─────────────────────────────────────────────────────────

function WorkingTab({ working }: { working: WorkingList }) {
  const [only, setOnly] = useState<Standing | null>(null);
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return working.rows.filter(
      (r) =>
        (!only || r.standing === only) &&
        (!needle || r.name.toLowerCase().includes(needle)),
    );
  }, [working.rows, only, q]);

  return (
    <div className="space-y-3">
      {!working.eventsConfigured && (
        <p className="rounded-lg border border-warn-soft-fg/40 bg-bg-elev px-4 py-3 text-xs text-muted leading-relaxed">
          No seniors events are marked yet, so nobody can land in{" "}
          <strong className="text-fg">
            {STANDING_LABEL.at_events.toLowerCase()}
          </strong>
          . Open <strong className="text-fg">What counts as seniors</strong>{" "}
          above and tick the registrations, events or groups that belong to
          this ministry. Until then this list is email and age only.
        </p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
        {ORDER.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setOnly((cur) => (cur === s ? null : s))}
            aria-pressed={only === s}
            title={STANDING_NOTE[s]}
            className={`text-left rounded-lg border p-3 cursor-pointer transition-colors ${
              only === s
                ? "border-accent bg-accent-soft-bg/30"
                : "border-border-soft bg-bg-elev hover:border-accent"
            }`}
          >
            <div className="text-xl font-semibold tnum">
              {working.byStanding[s].toLocaleString()}
            </div>
            <div className="text-[11px] text-subtle leading-snug mt-0.5">
              {STANDING_LABEL[s]}
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

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a name…"
          aria-label="Find a name"
          className="bg-bg-elev border border-border-soft rounded px-3 py-1.5 text-[13px] w-full max-w-xs"
        />
        {only && (
          <button
            type="button"
            onClick={() => setOnly(null)}
            className="text-xs text-accent hover:underline cursor-pointer"
          >
            Clear filter
          </button>
        )}
        <span className="text-xs text-subtle tnum ml-auto">
          {rows.length.toLocaleString()} of{" "}
          {working.rows.length.toLocaleString()}
        </span>
      </div>

      <Table rows={rows} />
    </div>
  );
}

function Table({ rows }: { rows: SeniorRow[] }) {
  const [limit, setLimit] = useState(200);
  const shown = rows.slice(0, limit);

  return (
    <div className="rounded-lg border border-border-soft bg-bg-elev overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-[13px]">
          <thead>
            <tr className="bg-bg-elev-2">
              <Th>Person</Th>
              <Th w="w-[150px]">Where from</Th>
              <Th w="w-[110px]" right>Emails opened</Th>
              <Th>Standing</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.personId ?? r.name}
                className="border-b border-border-softer hover:bg-bg-elev-2/50"
              >
                <td className="px-4 py-2">
                  {r.personId ? (
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
                        on the list, no PCO record
                      </span>
                    </span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <span className="flex gap-1">
                    {(["E", "A", "R"] as const).map((s) =>
                      r.sources.includes(s) ? (
                        <span
                          key={s}
                          title={SOURCE_LABEL[s]}
                          className="w-5 h-5 rounded border border-accent/50 text-accent text-[10px] font-bold flex items-center justify-center"
                        >
                          {s}
                        </span>
                      ) : (
                        <span
                          key={s}
                          aria-hidden="true"
                          className="w-5 h-5 rounded border border-border-softer text-subtle text-[10px] flex items-center justify-center"
                        >
                          ·
                        </span>
                      ),
                    )}
                  </span>
                </td>
                <td className="px-4 py-2 text-right tnum">
                  {r.sources.includes("E") ? (
                    <span className={r.opened === 0 ? "text-subtle" : ""}>
                      {r.opened} / {r.sent}
                    </span>
                  ) : (
                    <span className="text-subtle">—</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <span className="text-xs text-muted">
                    {STANDING_LABEL[r.standing]}
                  </span>
                  {r.events.length > 0 && (
                    <span className="text-[11px] text-subtle ml-1.5">
                      {r.events.slice(0, 2).join(", ")}
                      {r.events.length > 2 && ` +${r.events.length - 2}`}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted">
                  Nobody matches that.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > shown.length && (
        <button
          type="button"
          onClick={() => setLimit((n) => n + 500)}
          className="w-full px-4 py-2.5 text-xs text-accent hover:bg-bg-elev-2 cursor-pointer border-t border-border-soft"
        >
          Show more &mdash; {(rows.length - shown.length).toLocaleString()} left
        </button>
      )}
    </div>
  );
}

// ── the three sources ────────────────────────────────────────────────

function EmailTab({ email }: { email: EmailSource }) {
  const openRate = email.sends > 0 ? (email.opens / email.sends) * 100 : 0;
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border-soft bg-bg-elev p-5">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Stat n={email.contacts} label="contacts on the lists" />
          <Stat n={email.matched} label="matched to a PCO person" />
          <Stat
            n={email.unmatched}
            label="no PCO match — cannot reach the list below"
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
          written to, and it is the only thing any of these sources can say
          about whether a person is still paying attention.
          {email.unmatched > 0 && (
            <>
              {" "}
              The {email.unmatched} with no PCO match are usually a spouse
              sharing an inbox, or an address never added to PCO. They are
              worth adding: until then nothing else on this page can see
              them.
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
    </div>
  );
}

function AgeTab({ age }: { age: AgeSource }) {
  return (
    <div className="rounded-lg border border-border-soft bg-bg-elev p-5">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Stat n={age.count} label={`known to be ${age.ageMin} or older`} />
        <Stat
          n={age.inactive}
          label="left out — inactive in PCO"
        />
        <Stat n={age.rows.length} label="on the list below" />
      </div>
      <p className="text-[11px] text-subtle mt-3.5 leading-relaxed max-w-3xl">
        Born {age.bornOnOrBefore} or earlier, still active in PCO, not
        deceased. {age.noBirthYear.toLocaleString()} people have no birth
        year on file and are not counted here either way.
      </p>
    </div>
  );
}

function EventsTab({ events, years }: { events: EventSource; years: number }) {
  if (!events.configured) {
    return (
      <div className="rounded-lg border border-border-soft bg-bg-elev px-5 py-10 text-center">
        <h3 className="text-sm font-semibold">Nothing marked yet</h3>
        <p className="text-sm text-muted mt-2 max-w-lg mx-auto leading-relaxed">
          Open <strong className="text-fg">What counts as seniors</strong>{" "}
          above and tick the registrations from the last {years} years, the
          check-in events, or the groups that belong to this ministry. This
          stays empty until you do, because guessing from names gets it
          wrong: &ldquo;SIA&rdquo; matches SE Asia and Malaysia, and
          &ldquo;senior&rdquo; matches the high-school senior trip.
        </p>
      </div>
    );
  }
  return (
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
  );
}

// ── bits ─────────────────────────────────────────────────────────────

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

function Th({
  children,
  w = "",
  right,
}: {
  children: React.ReactNode;
  w?: string;
  right?: boolean;
}) {
  return (
    <th
      className={`${right ? "text-right" : "text-left"} px-4 py-2.5 border-b border-border-soft text-[10px] uppercase tracking-wider text-subtle font-medium ${w}`}
    >
      {children}
    </th>
  );
}
