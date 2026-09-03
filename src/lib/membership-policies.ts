// Membership-type policies: what each PCO membership type asserts about a
// person, and the checks that enforce it. Pure data + logic — no database, no
// server-only import — so it can be unit-tested directly and imported from
// either side of the server/client boundary. The querying half lives in
// `membership-fit.ts`.

export const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** "Recent" everywhere in this module. A church year — long enough that a
 *  snowbird or a family with a rough season doesn't get flagged as gone. */
export const RECENT_DAYS = 365;

// ─── Signal vocabulary ────────────────────────────────────────────────

/** The observable things a person can do. Requirements are written against
 *  these keys so the rule table stays declarative and the requirement text
 *  shown in the UI can't drift from what's actually evaluated. */
export type SignalKey =
  | "giving"
  | "givingRecent"
  | "group"
  | "team"
  | "served"
  | "checkin"
  | "checkinRecent"
  | "repeatCheckin"
  | "event"
  | "form"
  | "householdCheckin";

export const SIGNAL_LABELS: Record<SignalKey, string> = {
  giving: "gives",
  givingRecent: "gave in the last year",
  group: "in a group",
  team: "on a serving team",
  served: "scheduled to serve",
  checkin: "checked in",
  checkinRecent: "checked in this year",
  repeatCheckin: "checked in more than once",
  event: "attended an event",
  form: "submitted a form",
  householdCheckin: "someone in their household checks in",
};

/** Signals that can only be produced by physically showing up. Used by the
 *  "online only" and "contributor only" policies, which assert the absence
 *  of exactly this set. */
export const IN_PERSON_SIGNALS: SignalKey[] = [
  "checkin",
  "event",
  "group",
  "team",
  "served",
];

export interface PersonSignals {
  giving: boolean;
  givingRecent: boolean;
  group: boolean;
  team: boolean;
  served: boolean;
  checkin: boolean;
  checkinRecent: boolean;
  repeatCheckin: boolean;
  event: boolean;
  form: boolean;
  householdCheckin: boolean;
}

// ─── Policy model ─────────────────────────────────────────────────────

/** One line of the "what this category means" contract, and — unless it's a
 *  `note` — the check that enforces it. */
export interface Requirement {
  /** Stable key. Doubles as the flag id when the requirement is violated,
   *  so it can be used in a URL filter. */
  id: string;
  /** Requirement text, rendered in the policy panel above the roster. */
  text: string;
  /** `must` — needs at least one of `signals`.
   *  `only`  — must have none of `signals` (the category claims exclusivity).
   *  `temporary` — a provisional label that shouldn't outlive `maxAgeDays`.
   *  `note`  — context only, never flags anyone. */
  kind: "must" | "only" | "temporary" | "note";
  signals?: SignalKey[];
  /** Days a `temporary` label may stand before the record is flagged. */
  maxAgeDays?: number;
  /** Short chip shown on a violating row. */
  flagLabel?: string;
  /** One line explaining what the violation means, shown under the flag
   *  filter. Written for a church admin, not an engineer. */
  flagDetail?: string;
}

export interface TypePolicy {
  /** What claiming this membership type asserts about a person. */
  meaning: string;
  requirements: Requirement[];
  /** System/bookkeeping records — listed but never audited. */
  systemOnly?: boolean;
}

/** Normalize a PCO membership type for policy lookup: lowercase, collapse
 *  whitespace, and treat hyphens as spaces so "Ministry-Specific" and
 *  "Ministry Specific" resolve to the same policy. */
export function normalizeType(t: string | null): string {
  return (t ?? "")
    .toLowerCase()
    .replace(/[-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NO_EXPECTATIONS: Requirement[] = [
  {
    id: "informational",
    kind: "note",
    text: "No participation requirement — this is a relationship label, not a commitment. Nobody is flagged for inactivity here.",
  },
];

/** Keyed by `normalizeType()`. Every type Faith Church currently uses has an
 *  entry; anything new that appears in PCO falls through to DEFAULT_POLICY and
 *  shows as informational until a policy is written for it. */
export const POLICIES: Record<string, TypePolicy> = {
  member: {
    meaning:
      "A covenant member. We expect an ongoing, visible relationship — worshipping with us, connected in a group, serving, and/or giving.",
    requirements: [
      {
        id: "member-participation",
        kind: "must",
        signals: ["group", "team", "served", "checkin", "event", "giving"],
        text: "Has at least one of: group membership, serving team, scheduled serving, a check-in, event attendance, or giving.",
        flagLabel: "no participation",
        flagDetail:
          "On the member roll but nothing on record — no group, no team, no attendance, no giving. These are the membership conversations to have.",
      },
      {
        id: "member-note",
        kind: "note",
        text: "Members marked inactive in PCO are still listed here — use the inactive filter to separate a roll-clearing pass from a pastoral one.",
      },
    ],
  },

  "member and outreach partner": {
    meaning:
      "A covenant member who is also an outreach partner. Held to the member expectation; the partner half adds nothing to check.",
    requirements: [
      {
        id: "member-participation",
        kind: "must",
        signals: ["group", "team", "served", "checkin", "event", "giving"],
        text: "Has at least one of: group membership, serving team, scheduled serving, a check-in, event attendance, or giving.",
        flagLabel: "no participation",
        flagDetail:
          "Carries the member half of this label with nothing on record to support it.",
      },
    ],
  },

  "contributor only": {
    meaning:
      "Giving is the entire relationship. They give; they don't attend, serve, or belong to anything.",
    requirements: [
      {
        id: "contributor-gives",
        kind: "must",
        signals: ["giving"],
        text: "Has giving on record. That's the whole premise of the category.",
        flagLabel: "no giving",
        flagDetail:
          "Filed as a contributor but no matched gift exists. Either the PushPay match failed, or this label was never true.",
      },
      {
        id: "contributor-only-gives",
        kind: "only",
        signals: ["group", "team", "served", "checkin", "event", "form"],
        text: "Does nothing but give — no group, team, serving, check-in, event, or form submission.",
        flagLabel: "more than giving",
        flagDetail:
          "They joined, served, attended or submitted something. Giving is no longer the only relationship — they belong in an attender category.",
      },
    ],
  },

  "online submission only": {
    meaning:
      "Reached us once through an online form and never in person. A contact record, not an attender.",
    requirements: [
      {
        id: "online-no-in-person",
        kind: "only",
        signals: IN_PERSON_SIGNALS,
        text: "No in-person trace — no check-in, event, group, team, or serving.",
        flagLabel: "in person",
        flagDetail:
          "There's physical activity on this record. Whatever brought them in online, they've since shown up.",
      },
      {
        id: "online-form-note",
        kind: "note",
        text: "A missing form submission is NOT flagged: only a subset of PCO forms sync, so most of this category has no form row even when the label is correct.",
      },
    ],
  },

  "1st time visitor": {
    meaning:
      "Visited once. A starting label with a short shelf life — it should be replaced the moment someone comes back.",
    requirements: [
      {
        id: "first-time-once",
        kind: "only",
        signals: ["repeatCheckin", "group", "team", "served"],
        text: "Has checked in at most once and hasn't joined, served, or been scheduled.",
        flagLabel: "came back",
        flagDetail:
          "They returned — more than one check-in, or they've joined/served since. They stopped being a first-time visitor on their second visit.",
      },
      {
        id: "first-time-stale",
        kind: "temporary",
        maxAgeDays: 365,
        text: "Record is under a year old. Past that, a first-time visitor who never returned is a lapsed contact, not a visitor.",
        flagLabel: "stale label",
        flagDetail:
          "Created over a year ago and still labelled first-time. Move them on or archive them; this label is doing no work.",
      },
    ],
  },

  attendee: {
    meaning:
      "Attends but hasn't joined. The expectation is simply that they actually attend.",
    requirements: [
      {
        id: "attendee-attends",
        kind: "must",
        signals: ["checkin", "event", "group", "team", "served", "giving"],
        text: "Has some trace of attending — a check-in, event, group, team, serving, or giving.",
        flagLabel: "no attendance",
        flagDetail:
          "Filed as an attender with nothing on record to show it. Most of these are old records that predate check-in coverage — worth a sweep, not a phone call.",
      },
    ],
  },

  "occasional attendee": {
    meaning: "Attends irregularly. Same low bar as Attendee: some trace of attending.",
    requirements: [
      {
        id: "attendee-attends",
        kind: "must",
        signals: ["checkin", "event", "group", "team", "served", "giving"],
        text: "Has some trace of attending — a check-in, event, group, team, serving, or giving.",
        flagLabel: "no attendance",
        flagDetail: "Nothing on record to support the label.",
      },
    ],
  },

  "activity only": {
    meaning:
      "In the system because they took part in one activity — a camp, a class, a one-off event. No ongoing relationship is claimed.",
    requirements: [
      {
        id: "activity-has-activity",
        kind: "must",
        signals: ["checkin", "event", "group", "team", "served", "form"],
        text: "Has the activity the label refers to — a check-in, event, group, team, serving, or form.",
        flagLabel: "no activity",
        flagDetail:
          "The label's own premise fails: no activity of any kind on record. These are the strongest candidates for archiving or merging.",
      },
    ],
  },

  "parent only": {
    meaning:
      "In the system only as the parent of a child who attends. The child is the attender; the parent is the contact.",
    requirements: [
      {
        id: "parent-has-child-activity",
        kind: "must",
        signals: ["householdCheckin", "checkin"],
        text: "Somebody in their household checks in — otherwise there's no child here to be the parent of.",
        flagLabel: "no child activity",
        flagDetail:
          "No check-in anywhere in this person's household. Either the household link is broken or the child stopped attending.",
      },
      {
        id: "parent-not-participating",
        kind: "only",
        signals: ["team", "group", "served", "giving"],
        text: "Isn't participating in their own right — no group, team, serving, or giving.",
        flagLabel: "participating",
        flagDetail:
          "They're doing more than dropping a child off — serving, in a group, or giving. They're an attender in their own right now.",
      },
    ],
  },

  "benevolence only": {
    meaning:
      "Known to us through benevolence or assistance. Not an attender, and no expectation that they become one.",
    requirements: [
      {
        id: "benevolence-not-participating",
        kind: "only",
        signals: ["team", "group", "served"],
        text: "Not serving or in a group.",
        flagLabel: "participating",
        flagDetail:
          "They've joined a group or started serving. The relationship has moved past assistance.",
      },
    ],
  },

  "former member": {
    meaning: "Used to be a member and isn't any more. The label asserts they've stopped.",
    requirements: [
      {
        id: "former-still-active",
        kind: "only",
        signals: ["team", "group", "givingRecent", "checkinRecent"],
        text: "Genuinely gone — not on a team, not in a group, no giving or check-in in the last year.",
        flagLabel: "still active",
        flagDetail:
          "Marked 'Former' but currently on a team, in a group, giving, or attending. Either they came back or the label was applied by mistake.",
      },
    ],
  },

  "former outreach partner": {
    meaning: "A past outreach partner. The label asserts the partnership ended.",
    requirements: [
      {
        id: "former-still-active",
        kind: "only",
        signals: ["team", "group", "givingRecent", "checkinRecent"],
        text: "Genuinely gone — not on a team, not in a group, no giving or check-in in the last year.",
        flagLabel: "still active",
        flagDetail: "Marked 'Former' but still showing current activity.",
      },
    ],
  },

  "former child of outreach partner": {
    meaning: "A past outreach partner's child. The label asserts the connection ended.",
    requirements: [
      {
        id: "former-still-active",
        kind: "only",
        signals: ["team", "group", "givingRecent", "checkinRecent"],
        text: "Genuinely gone — not on a team, not in a group, no giving or check-in in the last year.",
        flagLabel: "still active",
        flagDetail: "Marked 'Former' but still showing current activity.",
      },
    ],
  },

  // Partner / staff / relationship labels. Dan's rule: these carry no
  // participation obligation, so the audit lists them and stays quiet.
  "outreach partner": {
    meaning:
      "A ministry partner we're in relationship with. Partnership is the point — attendance and giving are not expected.",
    requirements: NO_EXPECTATIONS,
  },
  "child of outreach partner": {
    meaning: "The child of an outreach partner. A relationship label, nothing more.",
    requirements: NO_EXPECTATIONS,
  },
  "ministry specific": {
    meaning:
      "Connected to one specific ministry rather than the congregation as a whole.",
    requirements: NO_EXPECTATIONS,
  },
  "non attendee staff": {
    meaning:
      "Staff who don't attend here. Employment is the relationship; attendance isn't expected.",
    requirements: NO_EXPECTATIONS,
  },

  "system use do not delete": {
    meaning:
      "PCO bookkeeping records, not people. Excluded from the audit entirely.",
    requirements: [],
    systemOnly: true,
  },
};

/** Membership type is null/blank in PCO. Not a policy failure so much as a
 *  gap — every one of these people has signals we can classify them by. */
export const UNSET_POLICY: TypePolicy = {
  meaning:
    "No membership type set in PCO. Every person here has activity we can classify them from — the suggestion column proposes where each belongs.",
  requirements: [
    {
      id: "unclassified",
      kind: "must",
      signals: [],
      text: "Has a membership type. Everyone in this tab fails that by definition.",
      flagLabel: "unclassified",
      flagDetail:
        "No membership type at all. Sort by the suggested type to work through these in batches.",
    },
  ],
};

export const DEFAULT_POLICY: TypePolicy = {
  meaning:
    "No policy defined for this membership type yet. Listed with a full activity profile so you can decide what it should assert.",
  requirements: NO_EXPECTATIONS,
};

/** Resolve the policy for a membership type. `null` (unset in PCO) gets its
 *  own policy; unknown types degrade to informational rather than guessing. */
export function policyFor(membershipType: string | null): TypePolicy {
  if (membershipType === null) return UNSET_POLICY;
  return POLICIES[normalizeType(membershipType)] ?? DEFAULT_POLICY;
}

// ─── Evaluation ───────────────────────────────────────────────────────

export interface FitFlag {
  id: string;
  label: string;
  detail: string;
}

/** Which signals a person actually has, in display order. */
export function activeSignals(s: PersonSignals): SignalKey[] {
  const order: SignalKey[] = [
    "giving",
    "group",
    "team",
    "served",
    "checkin",
    "event",
    "form",
    "householdCheckin",
  ];
  return order.filter((k) => s[k]);
}

/** Apply a policy to one person. Returns every requirement they violate. */
export function evaluate(
  policy: TypePolicy,
  signals: PersonSignals,
  recordAgeDays: number | null,
): FitFlag[] {
  if (policy.systemOnly) return [];
  const flags: FitFlag[] = [];
  for (const req of policy.requirements) {
    let violated = false;
    if (req.kind === "must") {
      // Empty signal list = unconditionally unmet (the "unclassified" case).
      violated = !(req.signals ?? []).some((k) => signals[k]);
    } else if (req.kind === "only") {
      violated = (req.signals ?? []).some((k) => signals[k]);
    } else if (req.kind === "temporary") {
      violated =
        recordAgeDays !== null && recordAgeDays > (req.maxAgeDays ?? Infinity);
    }
    if (violated) {
      flags.push({
        id: req.id,
        label: req.flagLabel ?? req.id,
        detail: req.flagDetail ?? req.text,
      });
    }
  }
  return flags;
}

/** Where this person's activity says they belong. Deliberately conservative:
 *  it never suggests promoting anyone to Member — that's a church decision,
 *  not something giving records can settle. */
export function suggestType(
  signals: PersonSignals,
  current: string | null,
): string | null {
  const inPerson =
    signals.checkin || signals.event || signals.group || signals.team || signals.served;
  let suggested: string;
  if (inPerson) suggested = "Attendee";
  else if (signals.giving) suggested = "Contributor Only";
  else if (signals.form) suggested = "Online Submission Only";
  else if (signals.householdCheckin) suggested = "Parent Only";
  else return null; // nothing to go on — the row's flags say enough
  return suggested === current ? null : suggested;
}
