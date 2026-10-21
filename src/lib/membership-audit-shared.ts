/** Types and labels shared by the membership audit's query (server) and
 *  its view (client). Deliberately free of any database import: the view is
 *  a client component, and pulling membership-audit.ts into it would drag
 *  better-sqlite3 and node:fs into the browser bundle. */

export const LANE_KEYS = ["w", "s", "c", "g", "o"] as const;
export type LaneKey = (typeof LANE_KEYS)[number];

export const LANE_LABELS: Record<LaneKey, string> = {
  w: "Worship",
  s: "Serve",
  c: "Community",
  g: "Give",
  o: "Outreach",
};

/** person_activity.classification, relabelled. The stored values are
 *  "shepherded" | "active" | "present" | "inactive"; these are the words
 *  the page shows. Changing the display here changes it everywhere,
 *  without a migration. */
export const CONNECTION_LABELS: Record<string, string> = {
  shepherded: "Connected",
  active: "Active",
  present: "Seen",
  inactive: "Quiet",
};
export const CONNECTION_ORDER = ["shepherded", "active", "present", "inactive"];

export interface AuditPersonRow {
  pcoId: string;
  fullName: string;
  initials: string;
  lanes: Record<LaneKey, boolean>;
  laneCount: number;
  lastActivityAt: string | null;
  daysSince: number | null;
  connection: string | null;
  /** Data-hygiene notes. Deliberately separate from the lanes: these are
   *  records to fix in PCO, not people to pastor. */
  flags: string[];
}

export interface MembershipAudit {
  membershipType: string;
  total: number;
  rows: AuditPersonRow[];
  laneTotals: Record<LaneKey, number>;
  /** Index = number of lanes (0‒5). */
  bandTotals: number[];
  /** Every lane combination that actually occurs, commonest first. */
  combos: { key: string; count: number }[];
  connectionTotals: Record<string, number>;
  flaggedTotal: number;
  refreshedAt: string | null;
}

/** "3 days", "14 months", "2 yr 1 mo" — the column is scanned, not read,
 *  so it stays short and never shows a clock time. */
export function agoLabel(days: number | null): string {
  if (days === null) return "never";
  if (days === 0) return "today";
  if (days === 1) return "1 day";
  if (days < 31) return `${days} days`;
  const months = Math.floor(days / 30.44);
  if (months < 24) return `${months} month${months === 1 ? "" : "s"}`;
  const years = Math.floor(days / 365.25);
  const rem = Math.floor((days - years * 365.25) / 30.44);
  return rem === 0 ? `${years} yr` : `${years} yr ${rem} mo`;
}
