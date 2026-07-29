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
  {
    id: "staff_directory",
    label: "Staff directory",
    description: "People on the 'REFERENCE - Church Staff' list: Name, Membership, Engagement.",
    kinds: ["table"],
  },
  {
    id: "shepherds_directory",
    label: "Shepherds directory",
    description: "Every group/team leader: Shepherd, Status (needs mapping / lead pastor / overseen), Groups led, Teams led, Overseen by. Decrypted names.",
    kinds: ["table"],
  },
  {
    id: "shepherds_overview",
    label: "Shepherds overview (counts)",
    description: "One row of the three headline counts: Shepherds, Overseen, Needs mapping. Pair with a list-format stat.",
    kinds: ["stat"],
  },
  {
    id: "shepherd_team_directory",
    label: "Shepherd team directory",
    description: "The 'REFERENCE - Shepherd Team' list with each member's four-bucket reach: Shepherd, Membership, Staff, Vol leaders, Congregants, Care, Total reach. Decrypted names.",
    kinds: ["table"],
  },
  {
    id: "duplicate_pairs",
    label: "Duplicate pairs",
    description: "Likely-duplicate people: Person A, Person B, Confidence, Signals, Returning?. Honors a :confidence param (high/low). Decrypted names.",
    kinds: ["table"],
  },
  {
    id: "duplicate_overview",
    label: "Duplicate audit (counts)",
    description: "One row of the headline counts: Pairs, High, Low, Returning. Pair with a list-format stat.",
    kinds: ["stat"],
  },
];

export const sourceMeta = (id: string | undefined): SourceMeta | undefined =>
  SOURCE_META.find((s) => s.id === id);
