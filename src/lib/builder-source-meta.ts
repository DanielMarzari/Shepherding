// Client-safe metadata for the builder's named data sources. The actual
// (server-only, decrypt-capable) implementations live in builder-sources.ts and
// are keyed by these same ids. The editor uses this list to offer sources.

export interface SourceMeta {
  id: string;
  label: string;
  /** What the source returns — shown in the editor + as the data hint. */
  description: string;
  /** Kinds this source's shape suits (for a gentle nudge; not enforced). */
  kinds?: string[];
}

export const SOURCE_META: SourceMeta[] = [
  {
    id: "people_directory",
    label: "People directory",
    description: "One row per person: Name, Classification, Membership, Groups, Teams, Last activity. Decrypted names.",
    kinds: ["table"],
  },
  {
    id: "falling_through_cracks",
    label: "Falling through the cracks",
    description: "People on a roster who've lapsed past your thresholds: Person, Context, Last touch, Days silent.",
    kinds: ["table"],
  },
  {
    id: "recent_movement",
    label: "Recent movement (14d)",
    description: "Recent membership changes: When, What. Decrypted names.",
    kinds: ["table"],
  },
  {
    id: "shepherd_workload",
    label: "Shepherd workload",
    description: "Top shepherds by flock size: Shepherd, Flock, Units led.",
    kinds: ["table", "leaderboard"],
  },
];

export const sourceMeta = (id: string | undefined): SourceMeta | undefined =>
  SOURCE_META.find((s) => s.id === id);
