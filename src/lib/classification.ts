/** The congregation vocabulary, in one place.
 *
 *  `person_activity.classification` stores four values. What the app SHOWS
 *  is three, because two of the stored four answer the same pastoral
 *  question:
 *
 *    shepherded  →  Shepherded   in a group or team context
 *    active      →  Known        not shepherded, but we can see them
 *    present     →  Unknown      the only trace is a staff edit to their record
 *    inactive    →  Unknown      nothing at all inside the activity window
 *
 *  The stored four are kept deliberately. "present" and "inactive" are the
 *  difference between "somebody touched this record" and "nothing has
 *  happened", which is diagnostic even though it is not worth a separate
 *  word on screen — and the falling-through-the-cracks list depends on it
 *  (`classification != 'inactive'` is what makes somebody still-on-a-roster
 *  but lapsed findable). Collapsing at the storage layer would throw that
 *  away for a cosmetic gain.
 *
 *  No file should hard-code these words again. Import from here.
 */

/** What is written to person_activity.classification. */
export type Classification = "shepherded" | "active" | "present" | "inactive";

/** What a person is called on screen. */
export type ConnectionBand = "shepherded" | "known" | "unknown";

export const CLASSIFICATIONS: Classification[] = [
  "shepherded",
  "active",
  "present",
  "inactive",
];

/** Most connected first. Every band is reachable and the three together
 *  cover every stored value, so nobody falls outside the vocabulary. */
export const CONNECTION_BANDS: ConnectionBand[] = [
  "shepherded",
  "known",
  "unknown",
];

export const BAND_OF: Record<Classification, ConnectionBand> = {
  shepherded: "shepherded",
  active: "known",
  present: "unknown",
  inactive: "unknown",
};

export const BAND_LABEL: Record<ConnectionBand, string> = {
  shepherded: "Shepherded",
  known: "Known",
  unknown: "Unknown",
};

/** One line each, for legends and tooltips. Written so a ministry leader
 *  reading it cold knows what the word is claiming. */
export const BAND_DESCRIPTION: Record<ConnectionBand, string> = {
  shepherded:
    "In a group or team where somebody is responsible for them — or a volunteer reporting to staff.",
  known:
    "Not in a group or team, but active enough elsewhere in the church that we can see them.",
  unknown:
    "No activity inside the activity window, or activity below the threshold that counts as engagement.",
};

/** Band for a stored classification. Unrecognised or missing values read as
 *  unknown rather than throwing: a person with no snapshot row yet is
 *  genuinely unknown to us, which is the honest answer. */
export function bandOf(cls: string | null | undefined): ConnectionBand {
  if (!cls) return "unknown";
  return BAND_OF[cls as Classification] ?? "unknown";
}

export function bandLabel(cls: string | null | undefined): string {
  return BAND_LABEL[bandOf(cls)];
}

/** Which stored values roll up into a band — for SQL `IN (…)` and for
 *  filtering a list that still carries the four-value field. */
export const CLASSIFICATIONS_IN_BAND: Record<ConnectionBand, Classification[]> =
  {
    shepherded: ["shepherded"],
    known: ["active"],
    unknown: ["present", "inactive"],
  };


// ─── What counts as activity ──────────────────────────────────────────

/** The signals that can make someone Known. Each is something the PERSON
 *  did. An edit to their PCO record is deliberately absent: that is
 *  activity ON them by a staff member, and counting it would let a data
 *  cleanup promote hundreds of people overnight. */
export const KNOWN_SIGNALS = [
  "checkin",
  "form",
  "attendance",
  "serving",
  "giving",
  "email",
  "registration",
] as const;
export type KnownSignal = (typeof KNOWN_SIGNALS)[number];

export const SIGNAL_LABEL: Record<KnownSignal, string> = {
  checkin: "Checked in",
  form: "Submitted a form",
  attendance: "Attended a group or event",
  serving: "Served on a plan",
  giving: "Gave",
  email: "Opened or clicked an email",
  registration: "Registered for something",
};

export const SIGNAL_HELP: Record<KnownSignal, string> = {
  checkin: "A Check-Ins record. Mostly children and volunteers — adults rarely check themselves in.",
  form: "Submitted any PCO form.",
  attendance: "Marked as attended at a group meeting or event.",
  serving: "Scheduled on a service plan and did not decline.",
  giving: "A gift on record in the PushPay import.",
  email: "Opened or clicked a Constant Contact email. The single widest signal — on the member roster it reaches 243 people no other signal catches.",
  registration: "Signed up through PCO Registrations.",
};

/** Used when an org has never configured the definition. Everything the
 *  person can do, which is the honest default: the alternative is a
 *  narrower bar nobody chose. */
export const DEFAULT_KNOWN_SIGNALS: KnownSignal[] = [...KNOWN_SIGNALS];

export function parseKnownSignals(raw: string | null | undefined): KnownSignal[] {
  if (!raw) return DEFAULT_KNOWN_SIGNALS;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_KNOWN_SIGNALS;
    const kept = parsed.filter((v): v is KnownSignal =>
      (KNOWN_SIGNALS as readonly string[]).includes(v),
    );
    // An empty list would mean nobody is ever Known, which is never what
    // somebody meant to save — fall back rather than emptying the band.
    return kept.length ? kept : DEFAULT_KNOWN_SIGNALS;
  } catch {
    return DEFAULT_KNOWN_SIGNALS;
  }
}
