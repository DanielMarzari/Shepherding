"use client";

import { useActionState, useState } from "react";
import { TARGET_KIND_LABELS, type TargetKind } from "@/lib/assignments-types";
import type { AssignedPerson, Connection } from "@/lib/shepherd-oversight";
import {
  removeConnectionAction,
  unassignPersonAction,
  type OversightState,
} from "./actions";

/** Tone per kind. Colour alone never carries the meaning — every tile
 *  also prints the kind in words. */
const KIND_TONE: Record<TargetKind, string> = {
  group: "text-accent border-accent/40",
  group_type: "text-accent border-accent/40",
  team: "text-warn-soft-fg border-warn-soft-fg/40",
  service_type: "text-warn-soft-fg border-warn-soft-fg/40",
  team_position: "text-warn-soft-fg border-warn-soft-fg/40",
  person: "text-muted border-border-soft",
  membership_type: "text-accent border-accent/40",
  shepherd_team: "text-muted border-border-soft",
  reference_list: "text-muted border-border-soft",
};

/** How many named-person tiles to show before folding the rest away. The
 *  names are already here — this only keeps the page from becoming a wall
 *  of 300 identical tiles. */
const PEOPLE_SHOWN = 11;

export function OversightGrid({
  shepherdPersonId,
  connections,
  assignedPeople,
  isAdmin,
  addTile,
}: {
  shepherdPersonId: string;
  connections: Connection[];
  assignedPeople: AssignedPerson[];
  isAdmin: boolean;
  /** The "+ Add a connection" tile, rendered by the server so the picker's
   *  option lists aren't duplicated into this component. */
  addTile: React.ReactNode;
}) {
  const [showAllPeople, setShowAllPeople] = useState(false);
  const people = showAllPeople
    ? assignedPeople
    : assignedPeople.slice(0, PEOPLE_SHOWN);
  const hidden = assignedPeople.length - people.length;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {connections.map((c) => (
          <Tile
            key={`c${c.id}`}
            kindLabel={TARGET_KIND_LABELS[c.kind]}
            tone={KIND_TONE[c.kind]}
            count={c.reach}
            title={c.targetName}
            detail={c.note ? `${c.detail} · ${c.note}` : c.detail}
            isAdmin={isAdmin}
            remove={
              <RemoveConnection id={c.id} shepherdPersonId={shepherdPersonId} />
            }
          />
        ))}

        {people.map((p) => (
          <Tile
            key={`p${p.personId}`}
            kindLabel="Person"
            tone={KIND_TONE.person}
            count={1}
            title={p.name}
            detail={
              p.source === "manual"
                ? "named individually"
                : `assigned by ${p.source === "bulk" ? "bulk assign" : p.source}`
            }
            href={`/people/${p.personId}`}
            isAdmin={isAdmin}
            remove={
              <Unassign
                personId={p.personId}
                shepherdPersonId={shepherdPersonId}
              />
            }
          />
        ))}

        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setShowAllPeople(true)}
            className="rounded-lg border border-border-soft bg-bg-elev-2/40 text-sm text-muted hover:text-fg hover:border-accent transition-colors cursor-pointer min-h-[104px] flex flex-col items-center justify-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="tnum text-lg font-semibold text-fg">
              +{hidden.toLocaleString()}
            </span>
            <span className="text-xs">more named individually</span>
          </button>
        )}

        {isAdmin && addTile}
      </div>

      {showAllPeople && assignedPeople.length > PEOPLE_SHOWN && (
        <button
          type="button"
          onClick={() => setShowAllPeople(false)}
          className="text-xs text-accent hover:underline cursor-pointer"
        >
          Collapse the named individuals
        </button>
      )}
    </div>
  );
}

function Tile({
  kindLabel,
  tone,
  count,
  title,
  detail,
  href,
  isAdmin,
  remove,
}: {
  kindLabel: string;
  tone: string;
  count: number;
  title: string;
  detail: string;
  href?: string;
  isAdmin: boolean;
  remove: React.ReactNode;
}) {
  return (
    <div className="group relative rounded-lg border border-border-soft bg-bg-elev p-3.5 min-h-[104px] flex flex-col">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span
          className={`px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-wider font-medium ${tone}`}
        >
          {kindLabel}
        </span>
        <span className="tnum text-base font-semibold">
          {count.toLocaleString()}
        </span>
      </div>
      <div className="font-medium text-[13px] leading-snug pr-5">
        {href ? (
          <a href={href} className="hover:text-accent">
            {title}
          </a>
        ) : (
          title
        )}
      </div>
      <div className="text-[11px] text-subtle mt-auto pt-1.5">{detail}</div>
      {isAdmin && (
        <div className="absolute top-2.5 right-2.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          {remove}
        </div>
      )}
    </div>
  );
}

function RemoveConnection({
  id,
  shepherdPersonId,
}: {
  id: number;
  shepherdPersonId: string;
}) {
  const [, action, pending] = useActionState<OversightState | null, FormData>(
    removeConnectionAction,
    null,
  );
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="shepherdPersonId" value={shepherdPersonId} />
      <RemoveButton pending={pending} label="Remove this connection" />
    </form>
  );
}

function Unassign({
  personId,
  shepherdPersonId,
}: {
  personId: string;
  shepherdPersonId: string;
}) {
  const [, action, pending] = useActionState<OversightState | null, FormData>(
    unassignPersonAction,
    null,
  );
  return (
    <form action={action}>
      <input type="hidden" name="personId" value={personId} />
      <input type="hidden" name="shepherdPersonId" value={shepherdPersonId} />
      <RemoveButton pending={pending} label="Unassign this person" />
    </form>
  );
}

function RemoveButton({
  pending,
  label,
}: {
  pending: boolean;
  label: string;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={label}
      title={label}
      className="w-5 h-5 rounded border border-border-soft bg-bg text-[11px] leading-none text-muted hover:text-bad-soft-fg hover:border-bad-soft-fg cursor-pointer disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {pending ? "·" : "×"}
    </button>
  );
}
