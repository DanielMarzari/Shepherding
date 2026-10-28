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
