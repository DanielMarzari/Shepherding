/** Shared between the seniors audit's queries and its page.
 *
 *  No server-only import here on purpose: the page prints these labels and
 *  is handed these shapes, so both halves have to be able to reach them.
 *  The queries themselves stay in seniors-audit.ts.
 */

/** How far back opens are counted. A year covers the ministry's whole
 *  calendar, so somebody who only reads the Christmas letter still shows
 *  as reading something. */
export const OPEN_WINDOW_MONTHS = 12;

/** How far back the event picker looks. */
export const EVENT_PICKER_YEARS = 2;

/** Where a person came from. Lettered because the table shows all three
 *  at once and "1 / 2 / 3" says nothing about which is which. */
export type SeniorSource = "E" | "A" | "R";

/** The five next-steps lanes, plus email engagement as a sixth.
 *
 *  Email is not a lane anywhere else in the app, and it is not one here
 *  either in any real sense — but on this page it answers the same
 *  question the others do ("is there a sign of life in this direction"),
 *  and the ministry's only channel is the mailing list. Keeping the keys
 *  the same as the membership audit's means a row reads identically on
 *  both pages. */
export const SENIOR_LANE_KEYS = ["w", "s", "c", "g", "o", "e"] as const;
export type SeniorLaneKey = (typeof SENIOR_LANE_KEYS)[number];

export const SENIOR_LANE_LABELS: Record<SeniorLaneKey, string> = {
  w: "Worship",
  s: "Serve",
  c: "Community",
  g: "Give",
  o: "Outreach",
  e: "Email",
};

/** Opened at least one of the emails sent in the window. Receiving one is
 *  not engagement — that is the whole point of the distinction. */
export const EMAIL_LANE: SeniorLaneKey = "e";

/** How long ago somebody last did anything, bucketed. Same buckets as the
 *  membership audit so the two pages agree on what "recent" means. */
export const SENIORS_ACTIVITY_BUCKETS: {
  id: string;
  label: string;
  maxMonths: number | null;
}[] = [
  { id: "3", label: "Last 3 months", maxMonths: 3 },
  { id: "9", label: "Last 9 months", maxMonths: 9 },
  { id: "12", label: "Last year", maxMonths: 12 },
  { id: "old", label: "Over a year ago", maxMonths: null },
];
export const SENIORS_NEVER_BUCKET = "never";

/** The ladder, most involved first. It is about involvement in the
 *  seniors ministry, not about being a senior: somebody busy elsewhere in
 *  the church who has never come to a seniors event is a different
 *  problem from somebody nobody has seen at all. */
export type Standing =
  | "at_events"
  | "reads_email"
  | "ignores_email"
  | "active_elsewhere"
  | "not_involved";

export const STANDING_LABEL: Record<Standing, string> = {
  at_events: "Comes to seniors events",
  reads_email: "Reads the emails",
  ignores_email: "Gets the emails, never opens them",
  active_elsewhere: "Active in church, not in seniors",
  not_involved: "Not involved anywhere",
};

export const STANDING_NOTE: Record<Standing, string> = {
  at_events: "Registered for or on the roster of something you marked as seniors.",
  reads_email: "On the list and has opened at least one email in the last year.",
  ignores_email:
    "On the list and has opened nothing in a year — reached on paper only.",
  active_elsewhere:
    "Old enough, and active in the church by other signals, but never invited into this.",
  not_involved:
    "Old enough, and nothing in the last year says they are still with you.",
};

export interface SeniorRow {
  personId: string | null;
  name: string;
  sources: SeniorSource[];
  standing: Standing;
  /** The six lanes. Email is true when they have opened one. */
  lanes: Record<SeniorLaneKey, boolean>;
  laneCount: number;
  /** When the snapshot last saw them do anything, and how long ago. */
  lastActivityAt: string | null;
  daysSince: number | null;
  /** Emails sent to them, and how many they opened, in the window. */
  sent: number;
  opened: number;
  /** Seniors events they registered for or are on the roster of. */
  events: string[];
  /** Their classification, for the "active elsewhere" case. */
  classification: string;
  /** True when PCO has them inactive. Kept out by default. */
  inactive: boolean;
}

export interface EmailSource {
  lists: Array<{ id: string; name: string; contacts: number }>;
  contacts: number;
  matched: number;
  unmatched: number;
  campaigns: number;
  sends: number;
  opens: number;
  /** Contacts who opened at least one email in the window. */
  openers: number;
  /** Distinct people the lists reach, as rows. An unmatched contact has no
   *  personId and no name: the database keeps only an HMAC of the address,
   *  never the address, so there is nothing to show but the fact of them. */
  rows: Array<{
    contactId: string;
    email: string | null;
    personId: string | null;
    name: string | null;
    sent: number;
    opened: number;
    lastOpenedAt: string | null;
  }>;
}

export interface AgeSource {
  ageMin: number;
  bornOnOrBefore: number;
  /** Alive, active in PCO, old enough. The number Dan asks for. */
  count: number;
  /** Excluded because PCO has them inactive — shown as a number only. */
  inactive: number;
  /** No birth year at all. One line, not a panel: the list is a floor. */
  noBirthYear: number;
  rows: Array<{
    personId: string;
    name: string;
    classification: string;
    birthYear: number;
  }>;
}

export interface EventSource {
  /** Nothing ticked yet — the page says so rather than guessing. */
  configured: boolean;
  people: number;
  events: Array<{ kind: string; id: string; name: string; people: number }>;
  /** The distinct people behind that count, with what they turned up to. */
  rows: Array<{
    personId: string;
    name: string;
    classification: string;
    events: string[];
  }>;
}

export interface PickerOption {
  kind: "signup" | "checkin_event" | "group_type" | "group";
  id: string;
  name: string;
  /** Distinct people it would bring in. */
  people: number;
  /** When it last ran, for the two-year window. */
  when: string | null;
  selected: boolean;
}

export interface SeniorsSelection {
  ccLists: string[];
  signups: string[];
  checkinEvents: string[];
  groupTypes: string[];
  groups: string[];
  ageMin: number;
}


export interface WorkingList {
  rows: SeniorRow[];
  /** Counts per standing, over the rows returned. */
  byStanding: Record<Standing, number>;
  /** Old enough, no email, no event — the reason the page exists. */
  neverInvited: number;
  eventsConfigured: boolean;
}
