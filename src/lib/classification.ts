/** The congregation vocabulary. Three words, and they are the words the
 *  database holds — there is no second set to translate from.
 *
 *    Shepherded  in a group or team where somebody is responsible for them
 *    Known       not shepherded, but active enough that we can see them
 *    Unknown     nothing inside the activity window
 *
 *  Shepherded and Unknown are measured; Known is whatever is left, so it
 *  needs no rule of its own. What counts as activity is configured per org
 *  on /pco/filters — see KNOWN_SIGNALS below.
 */

export type Classification = "shepherded" | "known" | "unknown";

/** Most connected first. */
export const CLASSIFICATIONS: Classification[] = [
  "shepherded",
  "known",
  "unknown",
];

export const CLASS_LABEL: Record<Classification, string> = {
  shepherded: "Shepherded",
  known: "Known",
  unknown: "Unknown",
};

/** One line each, for legends and tooltips. Written so a ministry leader
 *  reading it cold knows what the word is claiming. */
export const CLASS_DESCRIPTION: Record<Classification, string> = {
  shepherded:
    "In a group or team where somebody is responsible for them — or a volunteer reporting to staff.",
  known:
    "Not in a group or team, but active enough elsewhere in the church that we can see them.",
  unknown:
    "No activity inside the activity window, or activity below the threshold that counts as engagement.",
};

/** Normalise an unrecognised or missing value to unknown. A person with no
 *  snapshot row is genuinely unknown to us, which is the honest answer. */
export function classOf(cls: string | null | undefined): Classification {
  if (cls === "shepherded" || cls === "known" || cls === "unknown") return cls;
  return "unknown";
}

export function classLabel(cls: string | null | undefined): string {
  return CLASS_LABEL[classOf(cls)];
}

// ─── What counts as activity ──────────────────────────────────────────

/** The signals that can make someone Known. Each is something the PERSON
 *  did. Planning Center's updated_at on the record is deliberately absent:
 *  it moves whenever anything about that record changes, for any reason
 *  including a sync writing to it, so it is never evidence the person did
 *  something. */
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
