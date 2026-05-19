// Pure types + constants for shepherd assignments. No server-only
// imports, so client components can safely depend on this without
// pulling in better-sqlite3.

export type TargetKind =
  | "group"
  | "group_type"
  | "team"
  | "service_type"
  | "team_position"
  | "person";

export interface TargetOption {
  id: string;
  name: string;
}

export const TARGET_KIND_LABELS: Record<TargetKind, string> = {
  group: "Group",
  group_type: "Group type",
  team: "Team",
  service_type: "Service type",
  team_position: "Team position",
  person: "Person",
};
