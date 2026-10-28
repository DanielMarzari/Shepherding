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

/** The audit shows the three-band vocabulary — Shepherded / Known /
 *  Unknown — while the row still carries the stored four-value
 *  classification. See classification.ts for why both exist. */
export {
  CLASSIFICATIONS,
  CLASS_DESCRIPTION,
  CLASS_LABEL,
  classLabel,
  classOf,
  type Classification,
} from "./classification";

/** Every warning the audit can raise, in the order the dropdown lists
 *  them. These strings ARE the values stored on a row's `flags`, so the
 *  list and the producer cannot drift. */
export const FLAG_TYPES = [
  "Deceased",
  "Moved out of area",
  "Inactive in PCO",
  "Possible duplicate",
  "Name looks wrong",
  "No name on record",
] as const;
export type FlagType = (typeof FLAG_TYPES)[number];

/** Last-activity buckets. Open-ended at both ends: `maxDays: null` means
 *  "and older", and `never` catches people the snapshot has no activity
 *  date for at all — which is not the same as "a very long time ago" and
 *  should not sort in with it. */
export const ACTIVITY_BUCKETS: {
  id: string;
  label: string;
  minDays: number;
  maxDays: number | null;
}[] = [
  { id: "30", label: "Last 30 days", minDays: 0, maxDays: 30 },
  { id: "90", label: "30 to 90 days", minDays: 30, maxDays: 90 },
  { id: "365", label: "90 days to a year", minDays: 90, maxDays: 365 },
  { id: "old", label: "Over a year", minDays: 365, maxDays: null },
];
export const NEVER_BUCKET = "never";

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
  /** Who this person is a possible duplicate OF. Shown beside the flag so
   *  the pair can be judged without opening two tabs. High-confidence
   *  pairs only, and a person can be in more than one. */
  duplicateOf: { pcoId: string; name: string }[];
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
  /** Totals rolled up into the three shown bands. */
  bandTotalsByName: Record<string, number>;
  flaggedTotal: number;
  refreshedAt: string | null;
  /** The org's activity window, in months — what every lane looks back over. */
  activityMonths: number;
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
