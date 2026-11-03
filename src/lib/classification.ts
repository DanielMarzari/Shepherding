/** The congregation vocabulary. Four words, and they are the words the
 *  database holds — there is no second set to translate from.
 *
 *    Shepherded  in a group or team where somebody is responsible for them
 *    Known       not shepherded, but doing enough that we can see them
 *    Inactive    their PCO record is marked inactive
 *    Unknown     active record, nothing inside the activity window
 *
 *  Inactive is new, and it is carved out of Unknown rather than added
 *  beside it: somebody the church has already written off is not the same
 *  problem as somebody we have simply never seen, and mixing them made
 *  Unknown a number nobody could act on. Shepherded and Known still win
 *  over it — a roster membership or real activity on an inactive record is
 *  a contradiction worth seeing, not one to hide.
 *
 *  What counts as activity is configured per org on /pco/filters — see
 *  KNOWN_SIGNALS below.
 */

export type Classification = "shepherded" | "known" | "inactive" | "unknown";

/** Most connected first. */
export const CLASSIFICATIONS: Classification[] = [
  "shepherded",
  "known",
  "inactive",
  "unknown",
];

export const CLASS_LABEL: Record<Classification, string> = {
  shepherded: "Shepherded",
  known: "Known",
  inactive: "Inactive in PCO",
  unknown: "Unknown",
};

/** One line each, for legends and tooltips. Written so a ministry leader
 *  reading it cold knows what the word is claiming. */
export const CLASS_DESCRIPTION: Record<Classification, string> = {
  shepherded:
    "In a group or team where somebody is responsible for them — or a volunteer reporting to staff.",
  known:
    "Not in a group or team, but doing enough elsewhere in the church that we can see them.",
  inactive:
    "Marked inactive in Planning Center. Counted separately so Unknown means \u201cwe cannot see them\u201d rather than \u201cwe are not looking\u201d.",
  unknown:
    "An active record with nothing inside the activity window, or activity below the threshold that counts as engagement.",
};

export function classOf(cls: string | null | undefined): Classification {
  if (
    cls === "shepherded" ||
    cls === "known" ||
    cls === "inactive" ||
    cls === "unknown"
  ) {
    return cls;
  }
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
  "checkin_child",
  "checkin_self",
  "form",
  "attendance",
  "serving",
  "giving",
  "email_open",
  "registration",
] as const;
export type KnownSignal = (typeof KNOWN_SIGNALS)[number];

export const SIGNAL_LABEL: Record<KnownSignal, string> = {
  checkin_child: "Checked a child in",
  checkin_self: "Checked in themselves",
  form: "Submitted a form",
  attendance: "Attended a group meeting",
  serving: "Served on a plan",
  giving: "Gave",
  email_open: "Opened an email",
  registration: "Registered for something",
};

export const SIGNAL_HELP: Record<KnownSignal, string> = {
  checkin_child:
    "Brought somebody else to a Check-Ins event — almost always a parent with a child. Counted on the adult who did the checking in, not the child.",
  checkin_self:
    "Checked in as the attendee themselves: adult ministries, classes, volunteer check-in.",
  form: "Submitted a PCO form.",
  attendance: "Marked present at a group meeting or event.",
  serving: "Scheduled on a service plan and did not decline.",
  giving: "A gift on record in the PushPay import.",
  email_open:
    "Opened a Constant Contact email. The widest signal there is, and the weakest: an open can be a preview pane, which is why its bar is the highest.",
  registration: "Signed up through PCO Registrations.",
};

/** How many of each it takes before that category counts at all.
 *
 *  Every signal is counted now, not merely present. One check-in of a
 *  child is a visit; six is a rhythm. One email open can be a preview
 *  pane; eight is a person reading. The numbers differ because the
 *  signals are not equally hard to produce — giving once is a decision,
 *  opening an email once is barely an event.
 */
export const SIGNAL_MIN_DEFAULT: Record<KnownSignal, number> = {
  checkin_child: 6,
  checkin_self: 2,
  form: 2,
  attendance: 2,
  serving: 1,
  giving: 1,
  email_open: 8,
  registration: 1,
};

/** Categories needed before somebody is Known. Two, so that one rhythm on
 *  its own is not enough: a parent who only ever checks a child in has
 *  told us about their child, not about themselves. */
export const DEFAULT_MIN_SIGNALS = 2;

/** Used when an org has never configured the definition. Everything the
 *  person can do, which is the honest default: the alternative is a
 *  narrower bar nobody chose. */
export const DEFAULT_KNOWN_SIGNALS: KnownSignal[] = [...KNOWN_SIGNALS];

/** Anything stored before the open/click split asked for "email", which
 *  meant either. Expand it to both so an old setting keeps behaving the
 *  way it did. */
function expandLegacy(v: string): string[] {
  // "email" predates the open/click split; "email_click" was dropped when
  // every signal gained a count of its own — a click was only ever a
  // stronger open, and eight opens says the same thing without a second
  // row to configure. "checkin" became two signals, because checking a
  // child in and turning up yourself are different facts about different
  // people.
  if (v === "email" || v === "email_click") return ["email_open"];
  if (v === "checkin") return ["checkin_child", "checkin_self"];
  return [v];
}

/** Per-signal minimums, stored as JSON. Anything missing or junk falls
 *  back to the default for that signal rather than to 1, which would
 *  quietly reinstate the old presence-only behaviour. */
export function parseSignalMins(
  raw: string | null | undefined,
): Record<KnownSignal, number> {
  const out = { ...SIGNAL_MIN_DEFAULT };
  if (!raw) return out;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return out;
    for (const k of KNOWN_SIGNALS) {
      const v = (parsed as Record<string, unknown>)[k];
      if (typeof v === "number" && Number.isFinite(v) && v >= 1) {
        out[k] = Math.round(v);
      }
    }
  } catch {
    // fall through to the defaults
  }
  return out;
}

export function parseKnownSignals(raw: string | null | undefined): KnownSignal[] {
  if (!raw) return DEFAULT_KNOWN_SIGNALS;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_KNOWN_SIGNALS;
    const kept = parsed
      .filter((v: unknown): v is string => typeof v === "string")
      .flatMap(expandLegacy)
      .filter((v): v is KnownSignal =>
        (KNOWN_SIGNALS as readonly string[]).includes(v),
      );
    // An empty list would mean nobody is ever Known, which is never what
    // somebody meant to save — fall back rather than emptying the band.
    return kept.length ? kept : DEFAULT_KNOWN_SIGNALS;
  } catch {
    return DEFAULT_KNOWN_SIGNALS;
  }
}
