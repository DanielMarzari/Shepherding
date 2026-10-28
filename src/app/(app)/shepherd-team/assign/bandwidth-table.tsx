"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { ShepherdRow } from "@/lib/shepherd-assign";
import { saveBandwidthAction, type AssignState } from "./actions";

/** Coverage by shepherd, and the only place bandwidth is set.
 *
 *  Deliberately no "claim a group" action here. Recording what somebody
 *  already oversees through a group or team is a different job — it feeds
 *  the By role column, and a name in this table links straight to the page
 *  where that is done. This page assigns individuals.
 */
export function BandwidthTable({
  shepherds,
  isAdmin,
  /** The bandwidth page itself opens straight into the inputs — on that
   *  page setting bandwidth IS the task, so making someone press an edit
   *  button first is a step that buys nothing. */
  alwaysEditing = false,
}: {
  shepherds: ShepherdRow[];
  isAdmin: boolean;
  alwaysEditing?: boolean;
}) {
  const editing = alwaysEditing;
  const [state, action, pending] = useActionState<AssignState | null, FormData>(
    saveBandwidthAction,
    null,
  );

  return (
    <form action={action} className="rounded-lg border border-border-soft bg-bg-elev overflow-hidden">
      <div className="px-5 py-3 bg-bg-elev-2 border-b border-border-soft flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Coverage by shepherd</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-subtle">
            by role = already oversees them through a group or team
          </span>
          {isAdmin &&
            (editing ? (
              <button
                type="submit"
                disabled={pending}
                className="px-3 py-1 rounded bg-accent text-[var(--accent-fg)] text-xs font-medium disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save bandwidths"}
              </button>
            ) : (
              <Link
                href="/shepherd-team/bandwidth"
                className="px-3 py-1 rounded border border-border-soft text-xs hover:bg-bg"
              >
                Set bandwidths &rarr;
              </Link>
            ))}
        </div>
      </div>

      {state?.message && (
        <p
          className={`px-5 py-2 text-xs border-b border-border-soft ${
            state.status === "error" ? "text-bad-soft-fg" : "text-good-soft-fg"
          }`}
        >
          {state.message}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-[13px]">
          <thead>
            <tr className="bg-bg-elev-2">
              <Th>Shepherd</Th>
              <Th w="w-[240px]">Load</Th>
              <Th w="w-[100px]" right>By role</Th>
              <Th w="w-[100px]" right>Assigned</Th>
              <Th w="w-[140px]" right>Bandwidth</Th>
              <Th w="w-[110px]" right>Room</Th>
            </tr>
          </thead>
          <tbody>
            {shepherds.map((s) => (
              <Row key={s.personId} s={s} editing={editing} />
            ))}
          </tbody>
        </table>
      </div>
    </form>
  );
}

function Row({ s, editing }: { s: ShepherdRow; editing: boolean }) {
  const used = s.byRole + s.assigned;
  const max = s.bandwidth;
  const room = max - used;
  const denom = Math.max(max, 1);
  const pRole = Math.min(100, (s.byRole / denom) * 100);
  const pAss = Math.min(100 - pRole, (s.assigned / denom) * 100);

  return (
    <tr className="border-b border-border-softer hover:bg-bg-elev-2/50">
      <td className="px-4 py-2.5">
        <span className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="w-7 h-7 rounded-full bg-bg-elev-2 border border-border-soft flex items-center justify-center text-[10px] font-semibold text-muted shrink-0"
          >
            {s.initials}
          </span>
          <Link
            href={`/shepherd-team/${s.personId}`}
            className="font-medium text-accent hover:underline"
          >
            {s.name}
          </Link>
        </span>
      </td>
      <td className="px-4 py-2.5">
        <span className="flex h-3.5 w-[210px] rounded overflow-hidden border border-border-soft">
          <span style={{ width: `${pRole}%`, background: "var(--accent)" }} />
          <span
            style={{
              width: `${pAss}%`,
              background: "color-mix(in srgb, var(--accent) 45%, transparent)",
            }}
          />
          <span
            style={{ width: `${Math.max(0, 100 - pRole - pAss)}%` }}
            className="bg-bg-elev-2"
          />
        </span>
      </td>
      <td className="px-4 py-2.5 text-right tnum font-semibold">
        {s.byRole || <span className="text-subtle">—</span>}
      </td>
      <td className="px-4 py-2.5 text-right tnum">{s.assigned}</td>
      <td className="px-4 py-2.5 text-right">
        {editing ? (
          <input
            type="number"
            min={0}
            name={`bw_${s.personId}`}
            defaultValue={max}
            placeholder={String(max)}
            className="w-[92px] bg-bg border border-border-soft rounded px-2 py-1 text-[13px] text-right tnum"
          />
        ) : (
          <span className="tnum">
            {used} / {max}
          </span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right">
        {room <= 0 ? (
          <span className="text-bad-soft-fg text-xs font-medium">full</span>
        ) : (
          <span
            className={`text-xs tnum ${room < 10 ? "text-warn-soft-fg" : "text-subtle"}`}
          >
            {room} free
          </span>
        )}
      </td>
    </tr>
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
