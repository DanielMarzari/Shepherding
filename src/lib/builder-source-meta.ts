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
    description: "Every group/team leader: Shepherd, Status (needs mapping / lead pastor / overseen), Groups led, Teams led, Overseen by. Groups/Teams/Overseen are newline-joined name lists — mark them as chip columns. Decrypted names.",
    kinds: ["table"],
  },
  {
    id: "shepherds_overview",
    label: "Shepherds overview (counts)",
    description: "One row of the three headline counts: Shepherds, Overseen, Needs mapping. Read a column with a stat's Value-column setting (0/1/2).",
    kinds: ["stat"],
  },
  {
    id: "shepherd_team_directory",
    label: "Shepherd team directory",
    description: "The 'REFERENCE - Shepherd Team' list with each member's assignments (chip column) + four-bucket reach: Shepherd, Membership, Assignments, Staff, Vol leaders, Congregants, Care, Total reach. Decrypted names.",
    kinds: ["table"],
  },
  {
    id: "duplicate_pairs",
    label: "Duplicate pairs (PCO cards)",
    description: "Likely-duplicate people as People/PCO cards: each row is a pair (both link to PCO), matching signals as the note, confidence + returning as tags. Honors a :confidence param (high/low). Decrypted names.",
    kinds: ["linkcard"],
  },
  {
    id: "duplicate_overview",
    label: "Duplicate audit (counts)",
    description: "One row of the headline counts: Pairs, High, Low, Returning. Read a column with a stat's Value-column setting (0/1/2/3).",
    kinds: ["stat"],
  },
  {
    id: "membership_audit",
    label: "Membership audit (PCO cards)",
    description: "Flagged rows in one membership type as People/PCO cards (deceased, inactive, junk names, duplicates…). Honors :membership_type (default Member) and an optional :flag.",
    kinds: ["linkcard"],
  },
  {
    id: "membership_audit_overview",
    label: "Membership audit (counts)",
    description: "Two counts for the selected type: Flagged, Scanned. Honors :membership_type. Read a column via a stat's Value-column setting.",
    kinds: ["stat"],
  },
  {
    id: "name_audit",
    label: "Name audit (PCO cards)",
    description: "Junk / weird names across the org as People/PCO cards, tagged by issue.",
    kinds: ["linkcard"],
  },
  {
    id: "relationship_graph",
    label: "Relationship graph (network)",
    description: "Group/team co-membership + oversight as network edges (Source, Target, Weight). Use with a Network chart. Capped at 2,500 edges. Decrypted names.",
    kinds: ["chart"],
  },
  {
    id: "relationship_graph_overview",
    label: "Relationship graph (counts)",
    description: "One row: People, Connections, Shepherded, Active. Read a column via a stat's Value-column setting.",
    kinds: ["stat"],
  },
  {
    id: "intake_graph",
    label: "Who-knows-who (network)",
    description: "Intake marks as network edges (Source, Target, Weight). :source = know (active) or present. Use with a Network chart. Decrypted names.",
    kinds: ["chart"],
  },
];

export const sourceMeta = (id: string | undefined): SourceMeta | undefined =>
  SOURCE_META.find((s) => s.id === id);
