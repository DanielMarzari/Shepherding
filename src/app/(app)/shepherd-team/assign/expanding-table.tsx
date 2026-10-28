"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ShepherdRow } from "@/lib/shepherd-assign";
import { AddConnection } from "../[personId]/add-connection";
import { BandwidthField } from "../[personId]/bandwidth-field";
import { OversightGrid } from "../[personId]/oversight-grid";
import { loadRowAction, type RowDetail } from "./row-actions";

/** Coverage by shepherd, with a shepherd's own page folded into the row.
 *
 *  The alternative to /shepherd-team/[personId]. Same table, but a name
 *  opens what they oversee underneath it rather than navigating away, so
 *  deciding who covers whom and seeing what that costs happen without
 *  losing the list you were reading.
 *
 *  One row is open at a time. Two open rows means two walls of tiles
 *  competing for the same screen, and the thing you came to compare —
 *  this shepherd against the rest of the table — is what gets pushed off
 *  it. A row re-fetches each time it opens rather than keeping what it
 *  last saw: editing bandwidth or removing a tile changes the very
 *  numbers it is showing, and a cache that has to be invalidated by every
 *  action inside the row is a worse trade than one query per open — which
 *  is the same query the standalone page runs anyway.
 *
 *  No form around the table, and no row of bandwidth inputs: an open row
 *  contains forms of its own — the bandwidth field, every tile's remove
 *  button, the picker — and a form inside a form is not valid HTML, so
 *  the browser drops the inner ones and the buttons silently stop
 *  working. Bandwidth is set in the open row, or for everybody at once on
 *  the bandwidth page.
 */
export function ExpandingTable({
  shepherds,
  isAdmin,
}: {
  shepherds: ShepherdRow[];
  isAdmin: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="rounded-lg border border-border-soft bg-bg-elev overflow-hidden">
      <div className="px-5 py-3 bg-bg-elev-2 border-b border-border-soft flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Coverage by shepherd</h2>
        <span className="text-xs text-subtle">
          click a name to open what they oversee, and set their bandwidth
          there
        </span>
      </div>

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
              <Row
                key={s.personId}
                s={s}
                isAdmin={isAdmin}
                open={openId === s.personId}
                onToggle={() =>
                  setOpenId((cur) => (cur === s.personId ? null : s.personId))
                }
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({
  s,
  isAdmin,
  open,
  onToggle,
}: {
  s: ShepherdRow;
  isAdmin: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const used = s.byRole + s.assigned;
  const max = s.bandwidth;
  const room = max - used;
  const denom = Math.max(max, 1);
  const pRole = Math.min(100, (s.byRole / denom) * 100);
  const pAss = Math.min(100 - pRole, (s.assigned / denom) * 100);

  return (
    <>
      {/* The whole row is the control, not a disclosure arrow beside the
          name: the row is what you are pointing at, so that is what should
          respond. Still a real button for the keyboard — it sits in the
          first cell, stretched over the row, so Tab and Enter work and a
          screen reader is told what it does. */}
      <tr
        onClick={onToggle}
        className={`border-b border-border-softer cursor-pointer ${
          open ? "bg-bg-elev-2/60" : "hover:bg-bg-elev-2/50"
        }`}
      >
        <td className="px-4 py-2.5">
          <span className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="w-7 h-7 rounded-full bg-bg-elev-2 border border-border-soft flex items-center justify-center text-[10px] font-semibold text-muted shrink-0"
            >
              {s.initials}
            </span>
            <button
              type="button"
              aria-expanded={open}
              aria-label={`${open ? "Close" : "Open"} what ${s.name} oversees`}
              className="font-medium text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
            >
              {s.name}
            </button>
          </span>
        </td>
        <td className="px-4 py-2.5">
          <span className="flex h-3.5 w-[210px] rounded overflow-hidden border border-border-soft">
            <span style={{ width: `${pRole}%`, background: "var(--accent)" }} />
            <span
              style={{
                width: `${pAss}%`,
                background:
                  "color-mix(in srgb, var(--accent) 45%, transparent)",
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
          <span className="tnum">
            {used} / {max}
          </span>
        </td>
        <td className="px-4 py-2.5 text-right">
          {room <= 0 ? (
            <span className="text-bad-soft-fg text-xs font-medium">full</span>
          ) : (
            <span
              className={`text-xs tnum ${
                room < 10 ? "text-warn-soft-fg" : "text-subtle"
              }`}
            >
              {room} free
            </span>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border-soft bg-bg">
          <td colSpan={6} className="p-0">
            <Detail personId={s.personId} isAdmin={isAdmin} />
          </td>
        </tr>
      )}
    </>
  );
}

/** The shepherd's own page, inlined. Fetches on first open. */
function Detail({
  personId,
  isAdmin,
}: {
  personId: string;
  isAdmin: boolean;
}) {
  const [data, setData] = useState<RowDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setFailed(false);
    loadRowAction(personId)
      .then((d) => {
        if (!live) return;
        if (d) setData(d);
        else setFailed(true);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [personId]);

  if (failed) {
    return (
      <p className="px-5 py-6 text-xs text-bad-soft-fg">
        Could not load this shepherd. Close the row and open it again.
      </p>
    );
  }

  if (!data) {
    // Reserves roughly the height the tiles will take, so the rows below
    // do not jump when it arrives.
    return (
      <div className="px-5 py-5 space-y-3" aria-busy="true">
        <div className="h-4 w-48 rounded bg-bg-elev-2" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-[104px] rounded-lg bg-bg-elev-2" />
          ))}
        </div>
      </div>
    );
  }

  const assigned = data.assignedPeople.length;
  const load = data.byRole + assigned;

  return (
    <div className="px-5 py-5 space-y-4 border-l-2 border-accent">
      <div className="flex flex-wrap items-start justify-between gap-4">
        {/* Two numbers, because there are two questions: who comes with
            the role, and who was handed to them. What the role is made of
            is the tiles below — breaking it into reach buckets here says
            the same thing twice, less clearly. */}
        <div className="flex flex-wrap gap-7">
          <Bucket n={data.byRole} label="shepherd through their role" />
          <Bucket n={assigned} label="assigned to them" />
        </div>
        <div className="flex items-start gap-5">
          {/* Its own form posts one bandwidth; the table's Save posts all
              25. Both write the same row, whichever you reach for. */}
          <BandwidthField
            shepherdPersonId={data.personId}
            bandwidth={data.bandwidth}
            bandwidthSet={data.bandwidthSet}
            isAdmin={isAdmin}
          />
          <Link
            href={`/shepherd-team/${data.personId}`}
            className="text-xs text-accent hover:underline whitespace-nowrap mt-1.5"
          >
            Open as a page &rarr;
          </Link>
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2.5">
          <h3 className="text-[13px] font-semibold">What they oversee</h3>
          <p className="text-[11px] text-subtle max-w-md">
            Each tile counts everyone in it. The tiles can add up to more
            than {data.byRole.toLocaleString()} &mdash; somebody in two of
            them is still one person.
          </p>
        </div>
        <OversightGrid
          shepherdPersonId={data.personId}
          connections={data.connections}
          assignedPeople={data.assignedPeople}
          isAdmin={isAdmin}
          addTile={
            <AddConnection
              shepherdPersonId={data.personId}
              shepherdName={data.name}
              targetsByKind={data.targetsByKind}
              counts={data.counts}
              connectedKeys={data.connections.map(
                (c) => `${c.kind}:${c.targetId}`,
              )}
              assignedPersonIds={data.assignedPeople.map((p) => p.personId)}
              load={load}
              bandwidth={data.bandwidth}
            />
          }
        />
        {data.connections.length === 0 && assigned === 0 && (
          <p className="text-xs text-subtle mt-3 max-w-xl leading-relaxed">
            Start with a roster rather than names: a group, a group type or a
            team means whoever joins it later is theirs too, without anybody
            remembering to come back here.
          </p>
        )}
      </div>
    </div>
  );
}

function Bucket({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <div className="text-xl font-semibold tnum">
        {n ? n.toLocaleString() : <span className="text-subtle">—</span>}
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
