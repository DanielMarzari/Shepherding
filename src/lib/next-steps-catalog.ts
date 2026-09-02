// ---------------------------------------------------------------------------
// The next-step catalog — pure data + regex, NO server imports, so client
// components can use it too.
//
// A "next step" here is a SPECIFIC, NAMED, ACTIONABLE thing we asked people to
// do — "Discover Baptism", "Prayer Works", "join a small group" — not an
// abstract disposition. Abstract calls (follow Jesus, read your Bible, invite
// someone, care for others) are deliberately NOT next steps: we can't measure
// them, so tagging them only adds noise.
//
// Each step declares how a response would be MEASURED. Where we have no
// outcome data, `measure` is null and the UI says so plainly rather than
// implying we can score it.
// ---------------------------------------------------------------------------

export type MetricKey =
  | "group_apps"
  | "group_joins"
  | "new_servers"
  | "checkins"
  | "new_attenders"
  | "form_subs";

export const METRIC_LABELS: Record<MetricKey, string> = {
  group_apps: "group applications",
  group_joins: "group joins",
  new_servers: "first-time servers",
  checkins: "check-ins",
  new_attenders: "first-time attenders",
  form_subs: "form submissions",
};

/** How a response to this next step is measured. */
export type Measure =
  /** Weekly congregation-level series we already compute. */
  | { kind: "series"; metric: MetricKey }
  /** Attendance at a specific PCO check-in event (name matched). */
  | { kind: "checkinEvent"; match: RegExp; label: string }
  /** No outcome data exists yet — say so instead of faking a number. */
  | null;

export type StepCategory =
  | "give"
  | "group"
  | "serve"
  | "baptism"
  | "membership"
  | "class"
  | "prayer"
  | "care"
  | "event"
  | "reading";

export const CATEGORY_LABELS: Record<StepCategory, string> = {
  give: "Giving",
  group: "Groups",
  serve: "Serving",
  baptism: "Baptism",
  membership: "Membership",
  class: "Discover class",
  prayer: "Prayer gathering",
  care: "Care ministry",
  event: "Event",
  reading: "Reading plan",
};

export interface NextStep {
  key: string;
  /** The SPECIFIC name we tag — "Discover Baptism", not "a class". */
  name: string;
  category: StepCategory;
  /** Plain-English: what counts as this next step. */
  what: string;
  patterns: RegExp[];
  measure: Measure;
  /** The PCO Services service type that runs this event, when one exists. */
  pcoServiceTypeId?: string;
  /** Also detectable as a sermon call, from the stored classifier key. */
  sermonKey?: "giving" | "groups" | "serving";
  /** Detect this as a sermon call straight from the transcript (used for the
   *  steps the original classifier didn't break out, e.g. baptism). */
  sermonPatterns?: RegExp[];
}

const GROUP_APPS: Measure = { kind: "series", metric: "group_apps" };
const NEW_SERVERS: Measure = { kind: "series", metric: "new_servers" };

export const NEXT_STEPS_CATALOG: NextStep[] = [
  // ── Giving ───────────────────────────────────────────────────────────────
  {
    key: "give",
    name: "Give",
    category: "give",
    what: "An ask to give financially — the offering, generosity, tithe.",
    patterns: [/(?<!thanks )\bgiving\b/i, /\bgenerosity\b/i, /\btithe/i, /\bstewardship\b/i, /\boffering\b/i],
    measure: null, // no dated gifts in Shepherdly
    sermonKey: "giving",
  },
  {
    key: "extraordinary_giving",
    name: "Extraordinary Giving",
    category: "give",
    what: "The Extraordinary Giving campaign specifically.",
    patterns: [/extraordinary giving/i],
    measure: null,
  },
  {
    key: "kingdom_movement",
    name: "Kingdom Movement (campaign)",
    category: "give",
    what: "The Kingdom Movement capital campaign.",
    patterns: [/kingdom movement/i],
    measure: null,
  },

  // ── Groups ───────────────────────────────────────────────────────────────
  {
    key: "join_group",
    name: "Join a small group",
    category: "group",
    what: "Sign up for / join a small group, or word that groups are launching or open.",
    patterns: [
      /small group (launch|kickoff|sign[- ]?up|signup|registration|semester|starting|\bstart\b|open|opening|begin|connect)/i,
      /(join|sign up for|get in(to)?) (a |the |our |your )?(small )?group/i,
      /small groups? (are |is )?(now )?(open|available|filling|fill up|starting|launching|back|kicking off|begin)/i,
      /group (finder|kickoff|launch|sign[- ]?up|registration)/i,
      /\blife group/i,
      /\bcommunity group/i,
    ],
    measure: GROUP_APPS,
    pcoServiceTypeId: "1279325", // Small Group Kickoff
    sermonKey: "groups",
  },

  // ── Serving ──────────────────────────────────────────────────────────────
  {
    key: "serve",
    name: "Serve / volunteer",
    category: "serve",
    what: "Join a serving team or volunteer for a specific need.",
    patterns: [
      /\bvolunteer/i,
      /\bserve\b/i,
      /\bserving\b/i,
      /dream team/i,
      /serve team/i,
      /unleashing servants/i,
      /join (a|the|our) team/i,
      /serve (opportunit|sunday|day|the)/i,
    ],
    measure: NEW_SERVERS,
    sermonKey: "serving",
  },

  // ── Baptism ──────────────────────────────────────────────────────────────
  {
    key: "baptism",
    name: "Get baptized",
    category: "baptism",
    what: "Getting baptized — a baptism service, sign-up, or deadline. Must actually be about baptism (not a general recommitment).",
    patterns: [/\bbaptism\b/i, /\bbaptized\b/i, /\bbaptize\b/i],
    measure: null, // PCO records who STAFFED baptisms, not who was baptized
    pcoServiceTypeId: "1109341",
    // A sermon only counts as a baptism CALL when it invites the listener to
    // be baptized — not when it teaches about baptism (Romans 6, John's
    // baptism, baptism of the Spirit). Bare "baptism" is far too loose.
    sermonPatterns: [
      /\bget baptized\b/i,
      /\bbe baptized\b/i,
      /\bwant(ing)? to be baptized\b/i,
      /\bhaven.t been baptized\b/i,
      /\bsign up for baptism\b/i,
      /\bbaptism (sunday|service|class|sign)/i,
      /\bnext baptism\b/i,
    ],
  },

  // ── Membership ───────────────────────────────────────────────────────────
  {
    key: "membership",
    name: "Become a member",
    category: "membership",
    what: "The membership process — membership class, interview, or becoming a member.",
    patterns: [/membership (class|interview|matters|process|meeting|sunday)/i, /become a member/i, /\bnew member/i],
    measure: null, // membership_type has no date, so we can't date a change
    pcoServiceTypeId: "1623241",
    sermonPatterns: [/become a member/i, /membership (class|interview)/i],
  },

  // ── Discover classes (each one is its own next step) ─────────────────────
  {
    key: "discover_faith_church",
    name: "Discover Faith Church",
    category: "class",
    what: "The Discover Faith Church class — the church's intro / next-steps class.",
    patterns: [/discover faith church/i, /discover faith\b(?! and)/i],
    measure: null,
    pcoServiceTypeId: "1207024",
  },
  {
    key: "discover_jesus",
    name: "Discover Jesus",
    category: "class",
    what: "The Discover Jesus class.",
    patterns: [/discover jesus/i],
    measure: null,
  },
  {
    key: "discover_baptism",
    name: "Discover Baptism",
    category: "class",
    what: "The Discover Baptism class (the class, distinct from the baptism itself).",
    patterns: [/discover baptism/i],
    measure: null,
  },
  {
    key: "discover_membership",
    name: "Discover Membership",
    category: "class",
    what: "The Discover Membership class.",
    patterns: [/discover membership/i],
    measure: null,
  },
  {
    key: "discover_next_steps",
    name: "Discover Next Steps",
    category: "class",
    what: "The Discover Next Steps class.",
    patterns: [/discover next steps?/i],
    measure: null,
  },
  {
    key: "discover_evangelism",
    name: "Discover Evangelism",
    category: "class",
    what: "The Discover Evangelism class.",
    patterns: [/discover evangelism/i],
    measure: null,
  },
  {
    key: "discover_community",
    name: "Discover Community",
    category: "class",
    what: "The Discover Community class.",
    patterns: [/discover community/i],
    measure: null,
  },
  {
    key: "discover_the_bible",
    name: "Discover the Bible",
    category: "class",
    what: "The Discover the Bible class.",
    patterns: [/discover the bible/i],
    measure: null,
  },
  {
    key: "discover_discipleship",
    name: "Discover Discipleship",
    category: "class",
    what: "The Discover Discipleship class.",
    patterns: [/discover disciple(ship)?/i],
    measure: null,
  },

  // ── Prayer gatherings (the measurable version of "pray") ─────────────────
  {
    key: "prayer_works",
    name: "Prayer Works",
    category: "prayer",
    what: "Prayer Works — the church's prayer ministry gathering.",
    patterns: [/prayer ?works/i],
    measure: null, // PCO holds the prayer-partner roster, not attendees
    pcoServiceTypeId: "968579",
    sermonPatterns: [/prayer ?works/i],
  },
  {
    key: "prayer_night",
    name: "Prayer Night",
    category: "prayer",
    what: "A prayer night / night of prayer.",
    patterns: [/prayer night/i, /night of prayer/i, /\d+ days of prayer/i, /week of prayer/i],
    measure: null,
    sermonPatterns: [/prayer night/i, /night of prayer/i],
  },
  {
    key: "prayer_praise_night",
    name: "Prayer & Praise Night",
    category: "prayer",
    what: "The Prayer & Praise night.",
    patterns: [/prayer (and|&) praise/i],
    measure: null,
  },
  {
    key: "prayer_room",
    name: "Prayer Room",
    category: "prayer",
    what: "Come to the prayer room / prayer tent.",
    patterns: [/prayer (room|tent)/i],
    measure: null,
  },

  // ── Care ministries (each named ministry is its own next step) ───────────
  {
    key: "foster_adoption",
    name: "Foster & Adoption",
    category: "care",
    what: "The foster & adoption ministry or its info night.",
    patterns: [/foster (care|and adoption|& adoption)/i, /\bfoster\b.{0,20}\badoption\b/i, /adoption (info|ministry|night)/i],
    measure: null,
    pcoServiceTypeId: "1224046",
  },
  {
    key: "griefshare",
    name: "GriefShare",
    category: "care",
    what: "The GriefShare grief-support group.",
    patterns: [/grief\s?share/i],
    measure: null,
  },
  {
    key: "celebrate_recovery",
    name: "Celebrate Recovery",
    category: "care",
    what: "Celebrate Recovery.",
    patterns: [/celebrate recovery/i],
    measure: null,
  },
  {
    key: "divorce_care",
    name: "DivorceCare",
    category: "care",
    what: "The DivorceCare support group.",
    patterns: [/divorce ?care/i],
    measure: null,
  },
  {
    key: "counseling",
    name: "Counseling",
    category: "care",
    what: "Church counseling / care appointments.",
    patterns: [/\bcounseling\b/i, /\bbenevolence\b/i, /meal train/i],
    measure: null,
  },

  // ── Reading plan ─────────────────────────────────────────────────────────
  {
    key: "reading_plan",
    name: "Bible reading plan",
    category: "reading",
    what: "A specific Scripture reading plan or church-wide reading challenge.",
    patterns: [/reading plan/i, /bible reading/i, /read through the bible/i],
    measure: null,
  },

  // ── Named events people are asked to attend ──────────────────────────────
  {
    key: "vbx",
    name: "VBX",
    category: "event",
    what: "VBX (vacation Bible experience) — register / attend.",
    patterns: [/\bvbx\b/i, /\bvbs\b/i],
    measure: { kind: "checkinEvent", match: /^VBX/i, label: "VBX check-ins" },
  },
  {
    key: "christmas_eve",
    name: "Christmas Eve service",
    category: "event",
    what: "Attend (or invite someone to) a Christmas Eve service.",
    patterns: [/christmas eve/i, /christmas services?/i],
    measure: { kind: "checkinEvent", match: /christmas eve/i, label: "Christmas Eve check-ins" },
  },
  {
    key: "easter",
    name: "Easter service",
    category: "event",
    what: "Attend (or invite someone to) an Easter / Good Friday service.",
    patterns: [/easter (service|sunday|at faith)/i, /good friday/i],
    measure: { kind: "checkinEvent", match: /easter|good friday/i, label: "Easter / Good Friday check-ins" },
  },
  {
    key: "tree_lighting",
    name: "Christmas Tree Lighting",
    category: "event",
    what: "The community Christmas Tree Lighting event.",
    patterns: [/tree lighting/i],
    measure: null,
  },
  {
    key: "trunk_or_treat",
    name: "Trunk or Treat",
    category: "event",
    what: "The Trunk or Treat community event.",
    patterns: [/trunk or treat/i, /fall fest/i],
    measure: null,
  },
  {
    key: "momco",
    name: "MomCo / MOPS",
    category: "event",
    what: "MomCo (formerly MOPS / MOMSnext) — the moms' ministry.",
    patterns: [/\bmom ?co\b/i, /\bmops\b/i, /moms ?next/i],
    measure: { kind: "checkinEvent", match: /momco|mops|momsnext/i, label: "MomCo / MOPS check-ins" },
  },
  {
    key: "womens_bible_study",
    name: "Women's Bible Study",
    category: "event",
    what: "The women's Bible study.",
    patterns: [/women.{0,3}s bible study/i],
    measure: { kind: "checkinEvent", match: /women.{0,3}s bible study/i, label: "Women's Bible Study check-ins" },
  },
];

export const STEP_BY_KEY: Record<string, NextStep> = Object.fromEntries(
  NEXT_STEPS_CATALOG.map((s) => [s.key, s]),
);

/** Steps we can actually score a response for. */
export const MEASURABLE_STEPS = NEXT_STEPS_CATALOG.filter((s) => s.measure !== null);

/** Sermon calls we keep: only the ones the classifier tagged that survive the
 *  "must be actionable + measurable" bar, plus the transcript-detected ones. */
export const SERMON_STEP_KEYS = NEXT_STEPS_CATALOG.filter(
  (s) => s.sermonKey || s.sermonPatterns,
).map((s) => s.key);
