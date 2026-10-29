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
/** Two signals, not five lanes.
 *
 *  Elsewhere the lanes answer "which direction is this person growing in".
 *  Here the question is blunter — is there any sign of this person at all,
 *  and does it reach them. Which of worship, serve, community, give or
 *  outreach it came from does not change what the ministry does next, so
 *  they collapse into one. The five are still on the person's own page.
 */
export const SENIOR_SIGNALS = ["pco", "email"] as const;
export type SeniorSignal = (typeof SENIOR_SIGNALS)[number];

export const SIGNAL_LABEL: Record<SeniorSignal, string> = {
  pco: "PCO activity",
  email: "Email activity",
};

export const SIGNAL_NOTE: Record<SeniorSignal, string> = {
  pco: "PCO shows them in a group, on a team, giving, serving or at worship.",
  email: "Opened at least one of the ministry's emails in the last year. Receiving one does not count.",
};

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
  | "in_ministry"
  | "reads_email"
  | "active_elsewhere"
  | "ignores_email"
  | "gone_quiet"
  | "nothing_recorded";

/** Most actionable first. Reading down is roughly the order a ministry
 *  would work the list: the people already with you, then the warm ones,
 *  then the ones worth an invitation, then the ones there is nothing to be
 *  done about. */
export const STANDING_ORDER: Standing[] = [
  "in_ministry",
  "reads_email",
  "active_elsewhere",
  "ignores_email",
  "gone_quiet",
  "nothing_recorded",
];

export const STANDING_LABEL: Record<Standing, string> = {
  in_ministry: "In the seniors ministry",
  reads_email: "Reads the emails, not at events",
  active_elsewhere: "Active in church, not in seniors",
  ignores_email: "Gets the emails, never opens them",
  gone_quiet: "No activity for over a year",
  nothing_recorded: "Nothing recorded",
};

export const STANDING_NOTE: Record<Standing, string> = {
  in_ministry:
    "Registered for, or on the roster of, something you marked as a seniors event. Already with you.",
  reads_email:
    "On the mailing list and opened at least one email in the last year, but has not come to anything. The warmest group that is not yet in the room.",
  active_elsewhere:
    "Old enough, and PCO shows them active somewhere in the church — a group, a team, giving, serving — but they are on no seniors list and at no seniors event. Nobody has invited them.",
  ignores_email:
    "On the mailing list and has opened nothing in a year. Reached on paper only; another email is unlikely to be what changes that.",
  gone_quiet:
    "PCO has activity for them, but the most recent is over a year old. Probably no longer attending.",
  nothing_recorded:
    "No activity recorded at all. That is not proof they have gone — it may mean nothing they do gets recorded in PCO — but there is nothing here to work from.",
};

export interface SeniorRow {
  personId: string | null;
  name: string;
  sources: SeniorSource[];
  standing: Standing;
  /** Any of the five PCO lanes, and whether they open the email. */
  signals: Record<SeniorSignal, boolean>;
  /** Which mailing lists they are on, by name. Empty when none. */
  lists: string[];
  /** When the snapshot last saw them do anything, and how long ago. */
  lastActivityAt: string | null;
  daysSince: number | null;
  /** Emails sent to them, how many they opened and clicked, in the window. */
  sent: number;
  opened: number;
  clicked: number;
  /** The last email of the ministry's they opened. */
  lastOpenedAt: string | null;
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
    personId: string | null;
    /** Constant Contact's own name for the contact, which is all we have
     *  for anybody not matched to PCO. Null when CC has none either. */
    name: string | null;
    /** Which of the chosen lists they are on. */
    lists: string[];
    sent: number;
    opened: number;
    clicked: number;
    lastOpenedAt: string | null;
  }>;
  /** Unmatched contacts for whom Constant Contact has no name either —
   *  genuinely nothing to go on. */
  unnamed: number;
}

export interface AgeSource {
  ageMin: number;
  bornOnOrBefore: number;
  /** Everybody old enough, before anybody is taken out. */
  total: number;
  /** Alive, active in PCO, old enough — total minus inactive. */
  count: number;
  /** Taken out of `total` because PCO has them inactive or deceased. */
  inactive: number;
  /** No birth year at all. One line, not a panel: the list is a floor. */
  noBirthYear: number;
  rows: Array<{
    personId: string;
    name: string;
    /** Kept for the CSV; the table shows names only. */
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
    /** The most recent of those events, as a date. Null when none of the
     *  sources carries a date for them. */
    lastAttendedAt: string | null;
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

/** "9y 7m", "3m", "12d" — a number of days is unreadable past a few
 *  hundred, and 3,493 of them tells nobody anything. */
export function humanAge(days: number | null): string {
  if (days === null) return "never";
  if (days < 31) return `${days}d`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months}m`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem === 0 ? `${years}y` : `${years}y ${rem}m`;
}

/** dd/mm/yy. Short enough that the column never wraps mid-date, which is
 *  what an ISO string does in 110 pixels. */
export function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
}
