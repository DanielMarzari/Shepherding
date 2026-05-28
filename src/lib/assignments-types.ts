// Pure types + constants for shepherd assignments. No server-only
// imports, so client components can safely depend on this without
// pulling in better-sqlite3.

export type TargetKind =
  | "group"
  | "group_type"
  | "team"
  | "service_type"
  | "team_position"
  | "person"
  | "membership_type"
  | "shepherd_team"
  | "reference_list";

export interface TargetOption {
  id: string;
  name: string;
}

export interface Assignment {
  id: number;
  shepherdPersonId: string;
  targetKind: TargetKind;
  targetId: string;
  targetName: string;
  note: string | null;
  createdAt: string;
}

export const TARGET_KIND_LABELS: Record<TargetKind, string> = {
  group: "Group",
  group_type: "Group type",
  team: "Team",
  service_type: "Service type",
  team_position: "Team position",
  person: "Person",
  membership_type: "Membership type",
  shepherd_team: "Shepherd team",
  reference_list: "Reference list",
};

/** One-line hint describing who an assignment of each kind reaches.
 *  Shown in the add-assignment modal. */
export const TARGET_KIND_HINTS: Record<TargetKind, string> = {
  group: "Everyone in one specific group.",
  group_type: "The leaders of every group of this type.",
  team: "Everyone on one specific serving team.",
  service_type: "The leaders of every team under this service type.",
  team_position: "Everyone holding this position on a team.",
  person: "Another shepherd, one-to-one (peer hierarchy).",
  membership_type: "Everyone with this PCO membership type.",
  shepherd_team: "Everyone else on the shepherd team (team-leader role).",
  reference_list: "Everyone on a REFERENCE list — staff, elders, deacons, etc.",
};
