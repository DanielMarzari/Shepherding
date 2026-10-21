"use client";

import { useActionState, useMemo, useState } from "react";
import { saveOutreachLaneAction, type FilterSaveState } from "./actions";
import { formatLastEvent } from "./filter-helpers";

interface TeamStat {
  serviceTypeId: string | null;
  name: string | null;
  teams: number;
  members: number;
  archivedAt: string | null;
  lastEventAt: string | null;
}

interface TagStat {
  tagId: string;
  tagName: string | null;
  groupId: string;
  groupName: string | null;
  people: number;
}

interface GroupStat {
  groupTypeId: string | null;
  name: string | null;
  groups: number;
  members: number;
  lastEventAt: string | null;
  allArchived: boolean;
}

/** The Outreach lane, unlike the other four, is a list rather than a rule.
 *  Worship / Serve / Community / Give are derived — a group membership IS
 *  community. PCO has no outreach field, so this page is where the lane
 *  gets its definition: tick the service types and group types that are
 *  outreach ministries, and the nightly snapshot does the rest.
 *
 *  Note these are INCLUDE lists, the opposite of every other tab here. The
 *  copy says so in several places on purpose — a tick meaning "count this"
 *  next to a tab where a tick means "drop this" is a trap worth spelling
 *  out rather than relying on the reader to notice. */
export function OutreachLaneForm({
  teamStats,
  groupStats,
  tagStats,
  initialServiceTypes,
  initialGroupTypes,
  initialTags,
  isAdmin,
}: {
  teamStats: TeamStat[];
  groupStats: GroupStat[];
  tagStats: TagStat[];
  initialServiceTypes: string[];
  initialGroupTypes: string[];
  initialTags: string[];
  isAdmin: boolean;
}) {
  const [svc, setSvc] = useState<Set<string>>(new Set(initialServiceTypes));
  const [grp, setGrp] = useState<Set<string>>(new Set(initialGroupTypes));
  const [tags, setTags] = useState<Set<string>>(new Set(initialTags));
  const [showArchived, setShowArchived] = useState(false);
  const [state, action, pending] = useActionState<FilterSaveState | null, FormData>(
    saveOutreachLaneAction,
    null,
  );

  const visibleTeams = useMemo(
    () => (showArchived ? teamStats : teamStats.filter((s) => !s.archivedAt)),
    [teamStats, showArchived],
  );
  const visibleGroups = useMemo(
    () => (showArchived ? groupStats : groupStats.filter((s) => !s.allArchived)),
    [groupStats, showArchived],
  );
  const archivedCount =
    teamStats.filter((s) => s.archivedAt).length +
    groupStats.filter((s) => s.allArchived).length;

  // Tags arrive already ordered by group then name; fold them into their
  // groups so the picker reads the way Services presents them.
  const tagGroups = useMemo(() => {
    const out: Array<{ id: string; name: string; tags: TagStat[] }> = [];
    for (const t of tagStats) {
      const last = out[out.length - 1];
      if (last && last.id === t.groupId) last.tags.push(t);
      else out.push({ id: t.groupId, name: t.groupName ?? "(unnamed group)", tags: [t] });
    }
    return out;
  }, [tagStats]);

  const picked = svc.size + grp.size + tags.size;

  function toggle(
    set: Set<string>,
    setter: (next: Set<string>) => void,
    id: string,
  ) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  return (
    <form action={action}>
      <div className="px-5 py-4 border-b border-border-soft">
        <p className="text-sm text-muted leading-relaxed max-w-3xl">
          Tick everything that counts as outreach — individual serving tags,
          whole serving teams, or whole group types.{" "}
          <strong className="text-fg font-medium">
            These are the ones to include
          </strong>{" "}
          — the other tabs on this page work the other way round, where a tick
          means exclude. Anyone on a team or in a group of a ticked type lands
          in the Outreach lane on the next snapshot refresh.
        </p>
        <p className="text-sm text-muted leading-relaxed max-w-3xl mt-2">
          Serving tags are the finest grain and usually the right one:
          ticking <em>ESL Volunteer</em> names the people who do that, where
          ticking its whole service type would sweep in everyone rostered to
          it. The three lists are combined, and nobody is counted twice.
        </p>
        <p className="text-sm text-muted leading-relaxed max-w-3xl mt-2">
          Tick nothing and the lane stays empty for everyone. That is
          deliberate: an empty lane the audit can explain beats one guessed
          from team names, which would break the first time somebody renames
          a team.
        </p>
      </div>

      {archivedCount > 0 && (
        <div className="px-5 py-2 border-b border-border-soft flex items-center justify-end">
          <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="accent-[var(--accent)] w-3.5 h-3.5"
            />
            Show {archivedCount} archived
          </label>
        </div>
      )}

      <div className="px-5 py-2.5 bg-bg-elev border-b border-border-soft">
        <h3 className="text-xs uppercase tracking-wider text-subtle font-medium">
          Serving tags
        </h3>
      </div>
      {tagGroups.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-muted">
          No Services tags synced yet — they arrive with the next sync.
        </div>
      ) : (
        tagGroups.map((g) => (
          <div key={g.id}>
            <div className="px-5 py-2 bg-bg-elev/40 border-b border-border-softer">
              <span className="text-xs text-muted font-medium">{g.name}</span>
            </div>
            <ul className="divide-y divide-border-softer">
              {g.tags.map((t) => {
                const on = tags.has(t.tagId);
                return (
                  <li
                    key={t.tagId}
                    className={`px-5 py-2.5 flex items-center justify-between gap-4 transition-colors ${
                      on ? "bg-accent-soft-bg/20" : ""
                    }`}
                  >
                    <label
                      className={`flex items-center gap-3 flex-1 min-w-0 ${
                        isAdmin ? "cursor-pointer" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        name="outreach_tag"
                        value={t.tagId}
                        checked={on}
                        onChange={() => toggle(tags, setTags, t.tagId)}
                        disabled={!isAdmin}
                        className="accent-[var(--accent)] w-4 h-4 shrink-0"
                      />
                      <span className="truncate">{t.tagName ?? "(unnamed)"}</span>
                    </label>
                    <div className="flex items-center gap-3 text-xs text-muted shrink-0 tnum">
                      <span>{t.people.toLocaleString()} tagged</span>
                      {on && <span className="text-accent font-medium">outreach</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}

      <div className="px-5 py-2.5 bg-bg-elev border-y border-border-soft">
        <h3 className="text-xs uppercase tracking-wider text-subtle font-medium">
          Serving teams
        </h3>
      </div>
      <ul className="divide-y divide-border-softer">
        {visibleTeams.map((s) => {
          const id = s.serviceTypeId;
          const label = s.name ?? "(no type)";
          const on = !!id && svc.has(id);
          return (
            <li
              key={id ?? label}
              className={`px-5 py-3 flex items-center justify-between gap-4 transition-colors ${
                on ? "bg-accent-soft-bg/20" : s.archivedAt ? "opacity-60" : ""
              }`}
            >
              <label
                className={`flex items-center gap-3 flex-1 min-w-0 ${
                  isAdmin && id !== null ? "cursor-pointer" : ""
                }`}
              >
                <input
                  type="checkbox"
                  name="outreach_service_type"
                  value={id ?? ""}
                  checked={on}
                  onChange={() => id && toggle(svc, setSvc, id)}
                  disabled={!isAdmin || id === null}
                  className="accent-[var(--accent)] w-4 h-4 shrink-0"
                />
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {label}
                    {s.archivedAt && (
                      <span className="ml-2 text-xs text-muted font-normal">
                        archived
                      </span>
                    )}
                  </div>
                </div>
              </label>
              <div className="flex items-center gap-3 text-xs text-muted shrink-0 tnum">
                <span title="Most recent plan in this type">
                  {formatLastEvent(s.lastEventAt)}
                </span>
                <span>{s.teams.toLocaleString()} teams</span>
                <span>{s.members.toLocaleString()} serving</span>
                {on && (
                  <span className="text-accent font-medium">outreach</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="px-5 py-2.5 bg-bg-elev border-y border-border-soft">
        <h3 className="text-xs uppercase tracking-wider text-subtle font-medium">
          Groups
        </h3>
      </div>
      <ul className="divide-y divide-border-softer">
        {visibleGroups.map((s) => {
          const id = s.groupTypeId;
          const label = s.name ?? "(no type)";
          const on = !!id && grp.has(id);
          return (
            <li
              key={id ?? label}
              className={`px-5 py-3 flex items-center justify-between gap-4 transition-colors ${
                on ? "bg-accent-soft-bg/20" : s.allArchived ? "opacity-60" : ""
              }`}
            >
              <label
                className={`flex items-center gap-3 flex-1 min-w-0 ${
                  isAdmin && id !== null ? "cursor-pointer" : ""
                }`}
              >
                <input
                  type="checkbox"
                  name="outreach_group_type"
                  value={id ?? ""}
                  checked={on}
                  onChange={() => id && toggle(grp, setGrp, id)}
                  disabled={!isAdmin || id === null}
                  className="accent-[var(--accent)] w-4 h-4 shrink-0"
                />
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {label}
                    {s.allArchived && (
                      <span className="ml-2 text-xs text-muted font-normal">
                        archived
                      </span>
                    )}
                  </div>
                </div>
              </label>
              <div className="flex items-center gap-3 text-xs text-muted shrink-0 tnum">
                <span title="Last meeting in this type">
                  {formatLastEvent(s.lastEventAt)}
                </span>
                <span>{s.groups.toLocaleString()} groups</span>
                <span>{s.members.toLocaleString()} members</span>
                {on && (
                  <span className="text-accent font-medium">outreach</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="px-5 py-3 border-t border-border-soft flex items-center justify-between gap-4">
        <div className="text-xs">
          {state?.status === "saved" && (
            <span className="text-good-soft-fg">{state.message}</span>
          )}
          {state?.status === "error" && (
            <span className="text-bad-soft-fg">{state.message}</span>
          )}
          {!state && (
            <span className="text-muted">
              {picked === 0
                ? "Nothing is tagged as outreach — the lane is empty for everyone."
                : `${picked} type${picked === 1 ? "" : "s"} count as outreach. Takes effect on the next snapshot refresh.`}
            </span>
          )}
        </div>
        <button
          type="submit"
          disabled={!isAdmin || pending}
          className="px-3 py-1.5 rounded bg-accent text-[var(--accent-fg)] text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? "Saving…" : "Save outreach lane"}
        </button>
      </div>
    </form>
  );
}
