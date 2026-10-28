import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Avatar } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import {
  TARGET_KIND_LABELS,
  type TargetKind,
  type TargetOption,
  listTargetOptions,
} from "@/lib/assignments-read";
import { getListByName } from "@/lib/lists-read";
import { SHEPHERD_TEAM_LIST } from "@/lib/shepherd-assign";
import { getOversight, optionReachCounts } from "@/lib/shepherd-oversight";
import { AddConnection } from "./add-connection";
import { BandwidthField } from "./bandwidth-field";
import { OversightGrid } from "./oversight-grid";

/** One shepherd: who they oversee, and whether that is too much.
 *
 *  A page rather than an expanding row on the team table. Twenty-five
 *  shepherds' connections, reach counts and pickable targets on one screen
 *  is a lot of work to do before anybody has clicked anything — here that
 *  work happens for the one person you opened, and the URL is something
 *  you can send them.
 */
export default async function ShepherdOversightPage({
  params,
}: {
  params: Promise<{ personId: string }>;
}) {
  const { personId } = await params;
  const session = await requireOrg();
  const o = getOversight(session.orgId, personId);
  if (!o) notFound();

  const isAdmin = session.role === "admin";
  const team = getListByName(session.orgId, SHEPHERD_TEAM_LIST);
  const onTeam = (team?.members ?? []).some((m) => m.personId === personId);

  const targetsByKind = Object.fromEntries(
    (Object.keys(TARGET_KIND_LABELS) as TargetKind[]).map((k) => [
      k,
      listTargetOptions(session.orgId, k),
    ]),
  ) as Record<TargetKind, TargetOption[]>;

  const assigned = o.assignedPeople.length;
  const load = o.byRole + assigned;
  const max = o.bandwidth;
  const room = max - load;
  const over = Math.max(0, load - max);

  const denom = Math.max(max, 1);
  const pRole = Math.min(100, (o.byRole / denom) * 100);
  const pAss = Math.min(100 - pRole, (assigned / denom) * 100);
  const pFree = Math.max(0, 100 - pRole - pAss);

  const connectedKeys = o.connections.map((c) => `${c.kind}:${c.targetId}`);

  return (
    <AppShell active="Shepherd team" breadcrumb={`Shepherd team › ${o.name}`}>
      <div className="px-5 md:px-7 py-7 space-y-6 max-w-5xl">
        <div>
          <div className="text-[10px] uppercase tracking-[.11em] text-subtle">
            <Link href="/shepherd-team" className="hover:underline">
              Shepherd team
            </Link>
          </div>

          <div className="flex items-start gap-4 flex-wrap mt-2">
            <Avatar initials={o.initials} size="lg" />
            <div className="flex-1 min-w-[220px]">
              <h1 className="text-2xl font-semibold tracking-tight">
                {o.name}
              </h1>
              <p className="text-sm text-muted mt-1">
                {o.connections.length === 0 && assigned === 0 ? (
                  "Nothing assigned yet."
                ) : (
                  <>
                    {o.connections.length.toLocaleString()} connection
                    {o.connections.length === 1 ? "" : "s"} ·{" "}
                    {o.byRole.toLocaleString()} distinct people ·{" "}
                    {assigned.toLocaleString()} named individually
                  </>
                )}
              </p>
              <p className="text-xs mt-1.5">
                <Link
                  href={`/people/${o.personId}`}
                  className="text-accent hover:underline"
                >
                  Their profile &rarr;
                </Link>
              </p>
            </div>

            <div className="flex items-start gap-7">
              <Stat n={o.byRole} label="oversees now" />
              <Stat n={assigned} label="assigned" />
              <BandwidthField
                shepherdPersonId={o.personId}
                bandwidth={max}
                bandwidthSet={o.bandwidthSet}
                isAdmin={isAdmin}
              />
            </div>
          </div>
        </div>

        {!onTeam && (
          <p className="rounded-lg border border-border-soft bg-bg-elev px-4 py-3 text-xs text-muted leading-relaxed">
            This person is not on the{" "}
            <span className="mono text-fg">{SHEPHERD_TEAM_LIST}</span> list in
            Planning Center, so they do not appear on the team page or count
            toward the team&rsquo;s bandwidth. Anything set here still saves.
          </p>
        )}

        {/* Load bar. Colour is doubled up with wording and the numbers
            beside it — the segments are never the only way to read this. */}
        <div className="flex items-center gap-4 flex-wrap">
          <span className="flex h-[18px] w-full max-w-[360px] rounded overflow-hidden border border-border-soft">
            <span style={{ width: `${pRole}%`, background: "var(--accent)" }} />
            <span
              style={{
                width: `${pAss}%`,
                background:
                  "repeating-linear-gradient(135deg, var(--accent) 0 3px, color-mix(in srgb, var(--accent) 40%, transparent) 3px 6px)",
              }}
            />
            <span style={{ width: `${pFree}%` }} className="bg-bg-elev-2" />
          </span>
          <span className="flex items-center gap-3.5 text-[11px] text-muted flex-wrap">
            <Key swatch="solid" label={`${o.byRole.toLocaleString()} by role`} />
            <Key swatch="hatch" label={`${assigned.toLocaleString()} assigned`} />
            {room > 0 && (
              <Key swatch="empty" label={`${room.toLocaleString()} free`} />
            )}
            {over > 0 && (
              <span className="text-warn-soft-fg font-medium">
                {over.toLocaleString()} over their bandwidth
              </span>
            )}
            {!o.bandwidthSet && (
              <span className="text-subtle">
                measured against the default &mdash; nobody has set theirs
              </span>
            )}
          </span>
        </div>

        <div className="border-t border-border-soft pt-5">
          <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
            <h2 className="text-sm font-semibold">What they oversee</h2>
            <p className="text-[11px] text-subtle max-w-md">
              Each tile counts everyone in it. Removing one removes that whole
              roster from their load. The tiles can add up to more than{" "}
              {o.byRole.toLocaleString()} &mdash; somebody in two of them is
              still one person.
            </p>
          </div>

          <OversightGrid
            shepherdPersonId={o.personId}
            connections={o.connections}
            assignedPeople={o.assignedPeople}
            isAdmin={isAdmin}
            addTile={
              <AddConnection
                shepherdPersonId={o.personId}
                shepherdName={o.name}
                targetsByKind={targetsByKind}
                counts={optionReachCounts(session.orgId)}
                connectedKeys={connectedKeys}
                assignedPersonIds={o.assignedPeople.map((p) => p.personId)}
                load={load}
                bandwidth={max}
              />
            }
          />

          {o.connections.length === 0 && assigned === 0 && (
            <p className="text-xs text-subtle mt-3 max-w-xl leading-relaxed">
              Start with a roster rather than names: a group, a group type or a
              team means whoever joins it later is theirs too, without anybody
              remembering to come back here.
            </p>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold tnum">{n.toLocaleString()}</div>
      <div className="text-[11px] text-subtle leading-snug">{label}</div>
    </div>
  );
}

function Key({
  swatch,
  label,
}: {
  swatch: "solid" | "hatch" | "empty";
  label: string;
}) {
  const style =
    swatch === "solid"
      ? { background: "var(--accent)" }
      : swatch === "hatch"
        ? {
            background:
              "repeating-linear-gradient(135deg, var(--accent) 0 3px, color-mix(in srgb, var(--accent) 40%, transparent) 3px 6px)",
          }
        : undefined;
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden="true"
        style={style}
        className={`w-2.5 h-2.5 rounded-sm border border-border-soft ${
          swatch === "empty" ? "bg-bg-elev-2" : ""
        }`}
      />
      <span className="tnum">{label}</span>
    </span>
  );
}
