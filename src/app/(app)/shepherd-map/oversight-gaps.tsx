"use client";

import { useMemo, useState } from "react";
import type { OversightGap, OversightGaps } from "@/lib/oversight-gaps";
import type { ShepherdPerson } from "@/lib/assignments-read";
import { addAssignmentAction } from "./actions";

/** Teams and groups with nobody connected to them.
 *
 *  Not a list of people who are uncared for — every roster has staff
 *  oversight in real life. It is a list of oversight we have not written
 *  down, which is why each row ends in a shepherd picker rather than a
 *  link somewhere else: the gap and the fix are the same row.
 *
 *  Biggest first, since one connection to a 90-person team is worth more
 *  than a dozen to groups of three. Connecting a whole type closes every
 *  row under it at once, which the count beside each type is there to
 *  make obvious.
 */
export function OversightGapList({
  gaps,
  shepherds,
  isAdmin,
}: {
  gaps: OversightGaps;
  shepherds: ShepherdPerson[];
  isAdmin: boolean;
}) {
  const [tab, setTab] = useState<"team" | "group">(
    gaps.teams.length >= gaps.groups.length ? "team" : "group",
  );
  const rows = tab === "team" ? gaps.teams : gaps.groups;

  // Types with more than one unconnected roster under them: one
  // connection there does the work of several here.
  const byType = useMemo(() => {
    const m = new Map<string, { name: string; n: number; people: number }>();
    for (const r of rows) {
      if (!r.typeId) continue;
      const cur = m.get(r.typeId) ?? {
        name: r.typeName ?? "(untyped)",
        n: 0,
        people: 0,
      };
      cur.n++;
      cur.people += r.people;
      m.set(r.typeId, cur);
    }
    return [...m.entries()]
      .filter(([, v]) => v.n > 1)
      .sort((a, b) => b[1].people - a[1].people);
  }, [rows]);

  const total = gaps.teams.length + gaps.groups.length;
  if (total === 0) {
    return (
      <div className="rounded-lg border border-border-soft bg-bg-elev px-5 py-4 text-sm text-muted">
        Every live team and group has somebody connected to it. Anyone on a
        roster can be traced to the shepherd who oversees it.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border-soft bg-bg-elev overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border-soft">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">
            Oversight we have not written down
          </h2>
          <span className="text-xs text-subtle tnum">
            {gaps.teams.length} of {gaps.liveTeams} teams ·{" "}
            {gaps.groups.length} of {gaps.liveGroups} groups
          </span>
        </div>
        <p className="text-xs text-muted mt-1.5 leading-relaxed max-w-3xl">
          These rosters have nobody on the shepherd team connected to them,
          directly or through their type. Everyone on them is still being
          shepherded &mdash; every team and group has staff oversight &mdash;
          but the system cannot say by whom, so{" "}
          <strong className="text-fg tnum">
            {gaps.peopleAffected.toLocaleString()}
          </strong>{" "}
          people cannot be traced back to a shepherd. Connecting the roster
          here is what fixes that.
        </p>
      </div>

      {byType.length > 0 && (
        <div className="px-5 py-3 bg-bg-elev-2 border-b border-border-soft">
          <p className="text-[11px] text-subtle leading-relaxed">
            <span className="text-fg font-medium">Quickest route:</span>{" "}
            {byType.slice(0, 4).map(([id, v], i) => (
              <span key={id}>
                {i > 0 && " · "}
                <span className="text-fg">{v.name}</span> covers {v.n}{" "}
                {tab === "team" ? "teams" : "groups"} ({v.people.toLocaleString()}{" "}
                people)
              </span>
            ))}
            {byType.length > 4 && ` · and ${byType.length - 4} more`}
            . Connect the {tab === "team" ? "service type" : "group type"}{" "}
            itself on a shepherd&rsquo;s card below and every row under it
            closes at once.
          </p>
        </div>
      )}

      <div className="px-5 pt-3 flex gap-1.5">
        <Tab
          on={tab === "team"}
          onClick={() => setTab("team")}
          label={`Teams (${gaps.teams.length})`}
        />
        <Tab
          on={tab === "group"}
          onClick={() => setTab("group")}
          label={`Groups (${gaps.groups.length})`}
        />
      </div>

      <ul className="px-5 py-3 space-y-1.5 max-h-[420px] overflow-y-auto">
        {rows.map((r) => (
          <GapRow key={`${r.kind}:${r.id}`} r={r} shepherds={shepherds} isAdmin={isAdmin} />
        ))}
        {rows.length === 0 && (
          <li className="text-xs text-subtle py-2">
            Every live {tab} has somebody connected to it.
          </li>
        )}
      </ul>
    </div>
  );
}

function GapRow({
  r,
  shepherds,
  isAdmin,
}: {
  r: OversightGap;
  shepherds: ShepherdPerson[];
  isAdmin: boolean;
}) {
  return (
    <li className="flex items-center gap-3 flex-wrap rounded border border-border-softer bg-bg px-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="text-[13px] font-medium">{r.name}</span>
        {r.typeName && (
          <span className="text-[11px] text-subtle ml-2">{r.typeName}</span>
        )}
      </span>
      <span
        className={`text-[11px] tnum shrink-0 ${
          r.people === 0 ? "text-subtle" : "text-muted"
        }`}
      >
        {r.people === 0 ? "nobody on it" : `${r.people.toLocaleString()} people`}
      </span>
      {isAdmin && (
        <form action={addAssignmentAction} className="flex items-center gap-1.5 shrink-0">
          <input type="hidden" name="targetKind" value={r.kind} />
          <input type="hidden" name="targetId" value={r.id} />
          <select
            name="shepherdPersonId"
            required
            defaultValue=""
            aria-label={`Who oversees ${r.name}`}
            className="bg-bg-elev border border-border-soft rounded px-2 py-1 text-[12px] max-w-[190px]"
          >
            <option value="" disabled>
              Overseen by…
            </option>
            {shepherds.map((s) => (
              <option key={s.personId} value={s.personId}>
                {s.fullName}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="px-2.5 py-1 rounded bg-accent text-[var(--accent-fg)] text-[12px] font-medium cursor-pointer"
          >
            Connect
          </button>
        </form>
      )}
    </li>
  );
}

function Tab({
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
      className={`px-3 py-1.5 rounded-t text-xs font-medium cursor-pointer border-b-2 ${
        on
          ? "border-accent text-fg"
          : "border-transparent text-muted hover:text-fg"
      }`}
    >
      {label}
    </button>
  );
}
