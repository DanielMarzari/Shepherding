// Centralized mock data — same names/numbers as the v1+v2 mockups.
// Real PCO + DB integration replaces this layer later.

export const TODAY_LABEL = "Mon, Aug 18 · Week 33";

export const STATS = {
  active: 587,
  joinedMonth: 12,
  departedMonth: 6,
  unshepherded: 41,
  nextStepReady: 14,
  shepherds: 38,
  highRisk: 12,
};

export const LANE_STATS = [
  {
    key: "none",
    label: "No activity",
    count: 67,
    pct: "11%",
    avgTenure: "—",
    monthDelta: "27 new · 40 fading",
    note: "newcomers · or fell off all lanes",
  },
  {
    key: "give",
    label: "Giving",
    count: 312,
    pct: "53%",
    avgTenure: "3.4 yr",
    monthDelta: "+8",
  },
  {
    key: "wors",
    label: "Worship",
    count: 487,
    pct: "83%",
    avgTenure: "4.1 yr",
    monthDelta: "entry lane",
  },
  {
    key: "outr",
    label: "Outreach",
    count: 134,
    pct: "23%",
    avgTenure: "1.6 yr",
    monthDelta: "+4",
  },
  {
    key: "comm",
    label: "Community",
    count: 298,
    pct: "51%",
    avgTenure: "2.7 yr",
    monthDelta: "+11",
  },
  {
    key: "serv",
    label: "Serve",
    count: 221,
    pct: "38%",
    avgTenure: "2.1 yr",
    monthDelta: "+6",
  },
] as const;

export type LaneKey = (typeof LANE_STATS)[number]["key"];

export const AT_RISK = [
  {
    name: "Marcus Johnson",
    initials: "MJ",
    risk: 91,
    riskLevel: "high" as const,
    lastSunday: "6 weeks ago",
    shepherd: null,
    context: "No group · no team",
    reason: "No primary shepherd · went silent in early July",
  },
  {
    name: "Daniel Park",
    initials: "DP",
    risk: 86,
    riskLevel: "high" as const,
    lastSunday: "5 weeks ago",
    shepherd: "Jamal Williams",
    context: "14mo consistent → quiet",
    reason: "Sudden quiet · no exit reason",
  },
  {
    name: "Sarah Chen",
    initials: "SC",
    risk: 82,
    riskLevel: "high" as const,
    lastSunday: "3 weeks ago",
    shepherd: "Rachel Thompson",
    context: "Wed Women's Group · paused",
    reason: "Group ended · attendance dropped",
  },
  {
    name: "Megan O'Brien",
    initials: "MO",
    risk: 71,
    riskLevel: "med" as const,
    lastSunday: "3 weeks ago",
    shepherd: null,
    context: "Newcomer · April",
    reason: "Track done, no group joined",
  },
  {
    name: "Elena Vasquez",
    initials: "EV",
    risk: 68,
    riskLevel: "med" as const,
    lastSunday: "4 weeks ago",
    shepherd: "David Kim",
    context: "Hospitality · stepped down Jun",
    reason: "Left team · rhythm broke",
  },
  {
    name: "Jenny Liu",
    initials: "JL",
    risk: 41,
    riskLevel: "low" as const,
    lastSunday: "2 weeks ago",
    shepherd: "Sarah Chen",
    context: "Recent handoff",
    reason: "Just handed off · monitoring",
  },
];

export const NEXT_STEP_READY = [
  {
    name: "Christopher Walsh",
    initials: "CW",
    suggestion: "shepherd",
    confidence: 94,
    detail: "Recovery · 2 yr · mentoring 2",
  },
  {
    name: "Priya Patel",
    initials: "PP",
    suggestion: "co-lead group",
    confidence: 91,
    detail: "Tue Women's · 22mo · stepped up at retreat",
  },
  {
    name: "Tyler Rodriguez",
    initials: "TR",
    suggestion: "team lead",
    confidence: 87,
    detail: "Worship · 18mo · trains new vocalists",
  },
  {
    name: "Amara Okafor",
    initials: "AO",
    suggestion: "invite to group",
    confidence: 82,
    detail: "11/12 Sundays · finished newcomer track",
  },
  {
    name: "Jordan Walker",
    initials: "JW",
    suggestion: "greeter",
    confidence: 78,
    detail: "12mo · always early · welcomes guests",
  },
];

export const MOVEMENT_THIS_WEEK = [
  {
    day: "Tue",
    type: "handoff" as const,
    text: "Rachel Thompson handed off Jenny Liu → Sarah Chen",
  },
  {
    day: "Wed",
    type: "join" as const,
    text: "Carlos Mendoza joined Tuesday Men's Bible Study",
  },
  {
    day: "Thu",
    type: "exit" as const,
    text: "Two Greene left · moved to Austin",
  },
  {
    day: "Sun",
    type: "return" as const,
    text: "Hannah Voss returned after 4mo away",
  },
  {
    day: "Sun",
    type: "milestone" as const,
    text: "Newcomer's Lunch · 7 first-timers · 5 follow-ups booked",
  },
];

export const SHEPHERD_LOAD = [
  {
    name: "Rachel Thompson",
    load: 14,
    capacity: 12,
    status: "over" as const,
    note: "Over capacity · consider redistributing",
  },
  {
    name: "David Kim",
    load: 12,
    capacity: 12,
    status: "full" as const,
  },
  {
    name: "Jamal Williams",
    load: 9,
    capacity: 12,
    status: "ok" as const,
  },
  {
    name: "Sarah Chen",
    load: 7,
    capacity: 12,
    status: "ok" as const,
    note: "Has capacity for 5 more",
  },
  {
    name: "Daniel Park",
    load: 3,
    capacity: 12,
    status: "ok" as const,
  },
];

export const GROUP_HEALTH = [
  {
    name: "Young Married Connect",
    members: 22,
    delta: 8,
    state: "growing" as const,
    spark: "M2 16 L12 14 L22 12 L32 9 L42 7 L52 5 L58 4",
  },
  {
    name: "Recovery Group",
    members: 14,
    delta: 6,
    state: "growing" as const,
    spark: "M2 14 L12 13 L22 11 L32 9 L42 8 L52 7 L58 6",
  },
  {
    name: "Tuesday Men's Bible Study",
    members: 11,
    delta: 0,
    state: "steady" as const,
    spark: "M2 11 L12 12 L22 10 L32 11 L42 10 L52 11 L58 11",
  },
  {
    name: "Worship Team",
    members: 12,
    delta: -1,
    state: "steady" as const,
    spark: "M2 9 L12 10 L22 11 L32 11 L42 10 L52 11 L58 12",
  },
  {
    name: "Wednesday Women's Group",
    members: 9,
    delta: -9,
    state: "shrinking" as const,
    spark: "M2 5 L12 7 L22 9 L32 11 L42 13 L52 15 L58 17",
  },
];

// ─── Care Queue items ──────────────────────────────────────────────────────

export type CareQueueType =
  | "reach-out"
  | "match"
  | "promote"
  | "welcome"
  | "celebrate";

export interface CareQueueItem {
  id: string;
  person: string;
  initials: string;
  type: CareQueueType;
  badge: { label: string; tone: "warn" | "good" | "muted" };
  title: string;
  context: string;
  body: string;
  approach?: string;
  matches?: { name: string; reason: string }[];
  source: string;
  overdue?: string;
}

export const CARE_QUEUE: CareQueueItem[] = [
  {
    id: "marcus-reach",
    person: "Marcus Johnson",
    initials: "MJ",
    type: "reach-out",
    badge: { label: "Risk 91 · highest", tone: "warn" },
    title: "Marcus Johnson",
    context: "no shepherd · no group · no team",
    body: "Faithful weekly attender for 14 months — then went silent in early July. No primary shepherd. No exit conversation. The system flags this as the highest care risk in the congregation.",
    approach:
      'Short, low-pressure note: "Hey Marcus — haven\'t seen you on Sundays for a bit and wanted to check in. No agenda. Coffee this week?" Then assign him a shepherd before the week ends.',
    source: "attendance rule + no-shepherd flag",
    overdue: "12d",
  },
  {
    id: "megan-match",
    person: "Megan O'Brien",
    initials: "MO",
    type: "match",
    badge: { label: "Risk 71", tone: "warn" },
    title: "Megan O'Brien",
    context: "newcomer track done · no group · 3 weeks quiet",
    body: "Joined April. Finished newcomer track. Never assigned a shepherd. Lives in Anaheim Hills (zip 92807) — single, late 20s.",
    matches: [
      {
        name: "Sarah Chen",
        reason: "same zip · capacity 5/12 · co-leads Wed Women's",
      },
      {
        name: "Lauren Bell",
        reason: "nearby · solo · 4/12 capacity · also late 20s",
      },
    ],
    source: "unshepherded + zip + life-stage",
  },
  {
    id: "chris-promote",
    person: "Christopher Walsh",
    initials: "CW",
    type: "promote",
    badge: { label: "Confidence 94", tone: "good" },
    title: "Christopher Walsh",
    context: "→ ready to become a shepherd",
    body: "24 months in Recovery Group. Already informally mentoring two newer members (Roberto Sanchez, Jeremy Vale). Active in all five lanes. Steady attendance. Trusted by current shepherd.",
    approach:
      "Pull him aside Sunday. \"Chris, I see what you're doing with Roberto and Jeremy. I'd love to make that official — would you take on shepherding 4–6 men formally? Capacity, training, support included.\"",
    source: "tenure + lane breadth + informal mentoring signal",
  },
  {
    id: "hannah-welcome",
    person: "Hannah Voss",
    initials: "HV",
    type: "welcome",
    badge: { label: "First Sunday after 4mo", tone: "muted" },
    title: "Hannah Voss",
    context: "attended Sunday · had been gone since April",
    body: "Came back this Sunday after 4 months away. Greeted by Tyler at door — but no follow-up scheduled. She had been part of Tuesday Women's prior to leaving.",
    approach:
      'Don\'t ask why she left. Just welcome warmly: "So good to see you Sunday. We\'ve missed you. Lunch this week?" Karen Voss (her former shepherd before sabbatical) has capacity to re-engage.',
    source: "return-after-absence rule",
  },
  {
    id: "sarah-reach",
    person: "Sarah Chen",
    initials: "SC",
    type: "reach-out",
    badge: { label: "Risk 82", tone: "warn" },
    title: "Sarah Chen",
    context: "3 weeks no Sunday · group ended in July",
    body: "Wednesday Women's Group ended in late July. Sarah hasn't been on Sunday since. Her shepherd Rachel Thompson last contacted Jul 28 — Rachel currently 14/12 over capacity.",
    approach:
      'You take this one — Rachel is stretched. "Hi Sarah, just thinking of you. The Wednesday group wrapping up was a real loss. Want to grab coffee this week?" Then plug her into a fall replacement group.',
    source: "attendance + group exit + shepherd overload",
  },
  {
    id: "carlos-celebrate",
    person: "Carlos Mendoza",
    initials: "CM",
    type: "celebrate",
    badge: { label: "new community lane", tone: "muted" },
    title: "Carlos Mendoza",
    context: "joined Tuesday Men's BS · first group ever",
    body: "8 months Worship-only at this church. Just joined a group for the first time. Worth a quick text from you — short signal, big effect.",
    source: "lane-add milestone",
  },
];

// ─── Lanes ────────────────────────────────────────────────────────────────

export const LANE_SEQUENCES = [
  {
    seq: ["wors", "comm", "serv"] as LaneKey[],
    label: "Worship · Community · Serve",
    count: 142,
    note: "classic discipleship path · 14mo avg",
    highlight: false,
  },
  {
    seq: ["wors", "comm"] as LaneKey[],
    label: "Worship · Community",
    count: 96,
    note: "in a group, not yet serving",
    highlight: false,
  },
  {
    seq: ["wors", "serv", "comm"] as LaneKey[],
    label: "Worship · Serve · Community",
    count: 73,
    note: '"serve first" — found community through team',
    highlight: false,
  },
  {
    seq: ["wors", "comm", "serv", "give"] as LaneKey[],
    label: "+ Giving",
    count: 52,
    note: "deepest engagement · 24mo avg to giving",
    highlight: false,
  },
  {
    seq: ["wors"] as LaneKey[],
    label: "Worship only",
    count: 112,
    note: "≥ 6mo · invitation candidates",
    highlight: true,
  },
];

export const RECENT_LANE_TRANSITIONS = [
  {
    person: "Carlos Mendoza",
    change: "+ Community",
    lane: "comm" as LaneKey,
    trigger: "Joined Tuesday Men's BS",
    tenurePrior: "8mo Worship-only",
    when: "Wed",
  },
  {
    person: "Hannah Voss",
    change: "↻ Worship",
    lane: "wors" as LaneKey,
    trigger: "Returned · 4mo gap",
    tenurePrior: "had Worship+Comm",
    when: "Sun",
  },
  {
    person: "Ethan Park",
    change: "+ Serve",
    lane: "serv" as LaneKey,
    trigger: "Joined Greeters team",
    tenurePrior: "11mo Worship+Comm",
    when: "Sun",
  },
  {
    person: "Aisha Khan",
    change: "+ Giving",
    lane: "give" as LaneKey,
    trigger: "First recurring gift",
    tenurePrior: "19mo W+C+S",
    when: "Mon",
  },
  {
    person: "Olivia Martin",
    change: "+ Outreach",
    lane: "outr" as LaneKey,
    trigger: "Signed up · Aug Soup Kitchen",
    tenurePrior: "2.4yr W+C",
    when: "Tue",
  },
  {
    person: "Elena Vasquez",
    change: "− Serve",
    lane: null,
    trigger: "Stepped down Hospitality",
    tenurePrior: "3.2yr in Serve",
    when: "Jun",
  },
];

// ─── Person profiles (slug-keyed) ─────────────────────────────────────────

export interface PersonProfile {
  slug: string;
  name: string;
  initials: string;
  age: number;
  joinedDate: string; // "March 2023"
  status: "active" | "fading" | "newcomer";
  household: string;
  zip: string;
  summary: string;
  note: string;
  noteTone: "good" | "warn" | "muted";
  tenureYears: number;
  lastSunday: string;
  lastTouch: string;
  shepherds: { name: string; role: string; since: string }[];
  shepherdsOf: { name: string; tag?: string }[];
  groups: { name: string; role: string; since: string }[];
  teams: { name: string; role: string; since: string }[];
  journey: { lane: LaneKey | null; label: string; date: string; at: number }[];
  laneTenure: { lane: LaneKey; entered: string; months: number; intensity: string }[];
  activity: { when: string; type: string; text: string }[];
  notes: { when: string; author: string; text: string }[];
}

export const PEOPLE_PROFILES: Record<string, PersonProfile> = {
  "priya-patel": {
    slug: "priya-patel",
    name: "Priya Patel",
    initials: "PP",
    age: 34,
    joinedDate: "May 2023",
    status: "active",
    household: "Patel · 2 adults",
    zip: "92806",
    summary: "3.1 yr at church · 4 of 5 lanes · ready to co-lead",
    note: "Now ready to co-lead a group",
    noteTone: "good",
    tenureYears: 3.1,
    lastSunday: "Aug 17 · this week",
    lastTouch: "Aug 12 · Rachel Thompson",
    shepherds: [{ name: "Rachel Thompson", role: "primary · Women's care", since: "May 2023" }],
    shepherdsOf: [],
    groups: [
      { name: "Tuesday Women's Group", role: "member", since: "Jan 2024" },
      { name: "Marriage Mentoring", role: "member", since: "Mar 2025" },
    ],
    teams: [{ name: "Hospitality Team", role: "member", since: "Aug 2024" }],
    journey: [
      { lane: "none", label: "First visit", date: "May 2023", at: 0 },
      { lane: "wors", label: "+ Worship", date: "Jun 2023", at: 4 },
      { lane: "comm", label: "+ Community", date: "Jan 2024", at: 22 },
      { lane: "serv", label: "+ Serve", date: "Aug 2024", at: 45 },
      { lane: "give", label: "+ Giving", date: "Apr 2026", at: 92 },
    ],
    laneTenure: [
      { lane: "wors", entered: "Jun 2023", months: 38, intensity: "weekly · 3.6 of 4 Sundays" },
      { lane: "comm", entered: "Jan 2024", months: 31, intensity: "Tuesdays · ~96% attendance" },
      { lane: "serv", entered: "Aug 2024", months: 24, intensity: "monthly · Hospitality" },
      { lane: "give", entered: "Apr 2026", months: 4, intensity: "monthly · recurring since launch" },
    ],
    activity: [
      { when: "Aug 17", type: "worship", text: "Sunday service · 9am" },
      { when: "Aug 13", type: "community", text: "Tuesday Women's Group · attended" },
      { when: "Aug 12", type: "touchpoint", text: "Lunch with Rachel Thompson · noted as &quot;leadership ready&quot;" },
      { when: "Aug 10", type: "worship", text: "Sunday service · 11am" },
      { when: "Aug 06", type: "community", text: "Tuesday Women's Group · attended" },
      { when: "Aug 03", type: "worship", text: "Sunday service · 9am" },
    ],
    notes: [
      {
        when: "Aug 12",
        author: "Rachel Thompson",
        text: "Coffee at Pieology. Asked about leadership opportunities — feels ready to mentor newer women. Suggested co-leading a fall group.",
      },
      {
        when: "Jul 04",
        author: "Rachel Thompson",
        text: "Spring retreat takeaway: she stepped in to lead a small group discussion when Karen got sick. Naturals.",
      },
    ],
  },
  "tyler-rodriguez": {
    slug: "tyler-rodriguez",
    name: "Tyler Rodriguez",
    initials: "TR",
    age: 27,
    joinedDate: "April 2024",
    status: "active",
    household: "Rodriguez · 1 adult",
    zip: "92804",
    summary: "2.4 yr · serve-first · ready for team lead",
    note: "Found community through Worship Team",
    noteTone: "good",
    tenureYears: 2.4,
    lastSunday: "Aug 17 · this week",
    lastTouch: "Aug 11 · Brian Choi",
    shepherds: [{ name: "Brian Choi", role: "primary · Worship lead", since: "Aug 2024" }],
    shepherdsOf: [],
    groups: [{ name: "Young Married Connect", role: "member", since: "May 2025" }],
    teams: [{ name: "Worship Team · vocals", role: "weekly", since: "Aug 2024" }],
    journey: [
      { lane: "none", label: "First visit", date: "Apr 2024", at: 0 },
      { lane: "wors", label: "+ Worship", date: "May 2024", at: 4 },
      { lane: "serv", label: "+ Serve", date: "Aug 2024", at: 14 },
      { lane: "comm", label: "+ Community", date: "May 2025", at: 50 },
    ],
    laneTenure: [
      { lane: "wors", entered: "May 2024", months: 27, intensity: "weekly · leads vocals" },
      { lane: "serv", entered: "Aug 2024", months: 24, intensity: "weekly · Worship Team" },
      { lane: "comm", entered: "May 2025", months: 15, intensity: "biweekly · Young Married" },
    ],
    activity: [
      { when: "Aug 17", type: "worship", text: "Sunday service · led vocals 9am+11am" },
      { when: "Aug 14", type: "community", text: "Young Married Connect · attended" },
      { when: "Aug 11", type: "touchpoint", text: "Brian Choi · ran rehearsal feedback" },
      { when: "Aug 10", type: "worship", text: "Sunday service · led vocals 9am+11am" },
    ],
    notes: [
      {
        when: "Aug 11",
        author: "Brian Choi",
        text: "Tyler trained Megan and Hannah this month. Naturally takes responsibility for new vocalists. Time to talk about a formal team-lead role.",
      },
    ],
  },
  "marcus-johnson": {
    slug: "marcus-johnson",
    name: "Marcus Johnson",
    initials: "MJ",
    age: 44,
    joinedDate: "August 2024",
    status: "fading",
    household: "Johnson · 1 adult",
    zip: "92805",
    summary: "1.4 yr · Worship-only → no activity 6 weeks",
    note: "Highest care risk · no shepherd · system flagged",
    noteTone: "warn",
    tenureYears: 1.4,
    lastSunday: "Jul 06 · 6 weeks ago",
    lastTouch: "—",
    shepherds: [],
    shepherdsOf: [],
    groups: [],
    teams: [],
    journey: [
      { lane: "none", label: "First visit", date: "Aug 2024", at: 0 },
      { lane: "wors", label: "+ Worship", date: "Aug 2024", at: 2 },
      { lane: "none", label: "→ no activity", date: "Jul 2026", at: 90 },
    ],
    laneTenure: [
      { lane: "wors", entered: "Aug 2024", months: 11, intensity: "weekly until July · 0 since" },
    ],
    activity: [
      { when: "Jul 06", type: "worship", text: "Sunday service · last attended" },
      { when: "Jun 29", type: "worship", text: "Sunday service · 9am" },
      { when: "Jun 22", type: "worship", text: "Sunday service · 9am" },
      { when: "Aug 18", type: "system", text: "Risk score raised to 91 (high) · 6 weeks no Sunday" },
    ],
    notes: [
      {
        when: "Aug 18",
        author: "System",
        text: "Flagged in Care Queue: no primary shepherd, no group, no team, attendance gap exceeds inactivity threshold by 2 weeks.",
      },
    ],
  },
  "christopher-walsh": {
    slug: "christopher-walsh",
    name: "Christopher Walsh",
    initials: "CW",
    age: 41,
    joinedDate: "September 2022",
    status: "active",
    household: "Walsh · 4 adults · 2 kids",
    zip: "92806",
    summary: "4.0 yr · all five lanes · mentoring 2 informally",
    note: "Ready to be a shepherd · confidence 94",
    noteTone: "good",
    tenureYears: 4.0,
    lastSunday: "Aug 17 · this week",
    lastTouch: "Aug 09 · Pastor Mark",
    shepherds: [{ name: "Mark Davies", role: "primary · Lead Pastor", since: "Sep 2022" }],
    shepherdsOf: [
      { name: "Roberto Sanchez", tag: "Recovery · 14mo · informal" },
      { name: "Jeremy Vale", tag: "Recovery · 8mo · informal" },
    ],
    groups: [{ name: "Recovery Group", role: "co-lead", since: "Apr 2024" }],
    teams: [
      { name: "Greeters", role: "monthly", since: "Mar 2023" },
      { name: "Outreach · Soup Kitchen", role: "quarterly", since: "Aug 2025" },
    ],
    journey: [
      { lane: "none", label: "First visit", date: "Sep 2022", at: 0 },
      { lane: "wors", label: "+ Worship", date: "Sep 2022", at: 1 },
      { lane: "comm", label: "+ Community", date: "Jan 2023", at: 14 },
      { lane: "serv", label: "+ Serve", date: "Mar 2023", at: 18 },
      { lane: "give", label: "+ Giving", date: "Jun 2024", at: 60 },
      { lane: "outr", label: "+ Outreach", date: "Aug 2025", at: 84 },
    ],
    laneTenure: [
      { lane: "wors", entered: "Sep 2022", months: 47, intensity: "weekly" },
      { lane: "comm", entered: "Jan 2023", months: 43, intensity: "Recovery · co-lead since 2024" },
      { lane: "serv", entered: "Mar 2023", months: 41, intensity: "Greeters monthly" },
      { lane: "give", entered: "Jun 2024", months: 26, intensity: "monthly · faithful" },
      { lane: "outr", entered: "Aug 2025", months: 12, intensity: "Soup Kitchen · quarterly" },
    ],
    activity: [
      { when: "Aug 17", type: "worship", text: "Sunday service · 9am" },
      { when: "Aug 14", type: "community", text: "Recovery Group · co-led" },
      { when: "Aug 09", type: "touchpoint", text: "1:1 with Pastor Mark · talked about Roberto" },
      { when: "Aug 03", type: "worship", text: "Sunday service · 9am" },
    ],
    notes: [
      {
        when: "Aug 09",
        author: "Mark Davies",
        text: "Chris has been mentoring Roberto and Jeremy on his own initiative. Brought up bringing them into Recovery's leadership rotation. Time to make this official with a shepherd role.",
      },
    ],
  },
};

export const PEOPLE_PROFILE_SLUGS = Object.keys(PEOPLE_PROFILES);

// ─── All people (table view) ──────────────────────────────────────────────

export interface PersonRow {
  slug: string | null;
  name: string;
  initials: string;
  lanes: LaneKey[];
  shepherd: string | null;
  lastSeen: string;
  status: "active" | "fading" | "newcomer" | "inactive";
  risk: number | null;
  tenure: string;
}

export const ALL_PEOPLE: PersonRow[] = [
  // The 4 with full profiles
  {
    slug: "priya-patel",
    name: "Priya Patel",
    initials: "PP",
    lanes: ["wors", "comm", "serv", "give"],
    shepherd: "Rachel Thompson",
    lastSeen: "Aug 17 · this week",
    status: "active",
    risk: null,
    tenure: "3.1y",
  },
  {
    slug: "tyler-rodriguez",
    name: "Tyler Rodriguez",
    initials: "TR",
    lanes: ["wors", "comm", "serv"],
    shepherd: "Brian Choi",
    lastSeen: "Aug 17 · this week",
    status: "active",
    risk: null,
    tenure: "2.4y",
  },
  {
    slug: "marcus-johnson",
    name: "Marcus Johnson",
    initials: "MJ",
    lanes: [],
    shepherd: null,
    lastSeen: "Jul 06 · 6 weeks ago",
    status: "fading",
    risk: 91,
    tenure: "1.4y",
  },
  {
    slug: "christopher-walsh",
    name: "Christopher Walsh",
    initials: "CW",
    lanes: ["wors", "comm", "serv", "give", "outr"],
    shepherd: "Mark Davies",
    lastSeen: "Aug 17 · this week",
    status: "active",
    risk: null,
    tenure: "4.0y",
  },
  // At-risk roster
  { slug: null, name: "Sarah Chen", initials: "SC", lanes: ["wors", "comm"], shepherd: "Rachel Thompson", lastSeen: "Jul 27 · 3w ago", status: "fading", risk: 82, tenure: "3.8y" },
  { slug: null, name: "Daniel Park", initials: "DP", lanes: ["wors", "serv"], shepherd: "Jamal Williams", lastSeen: "Jul 13 · 5w ago", status: "fading", risk: 86, tenure: "2.1y" },
  { slug: null, name: "Elena Vasquez", initials: "EV", lanes: ["wors"], shepherd: "David Kim", lastSeen: "Jul 20 · 4w ago", status: "fading", risk: 68, tenure: "6.2y" },
  { slug: null, name: "Megan O'Brien", initials: "MO", lanes: ["wors"], shepherd: null, lastSeen: "Jul 27 · 3w ago", status: "newcomer", risk: 71, tenure: "0.4y" },
  { slug: null, name: "Jenny Liu", initials: "JL", lanes: ["wors", "comm"], shepherd: "Sarah Chen", lastSeen: "Aug 03 · 2w ago", status: "active", risk: 41, tenure: "1.2y" },
  // Returners + recent
  { slug: null, name: "Hannah Voss", initials: "HV", lanes: ["wors"], shepherd: "Karen Voss", lastSeen: "Aug 17 · this week", status: "active", risk: null, tenure: "4.5y" },
  { slug: null, name: "Carlos Mendoza", initials: "CM", lanes: ["wors", "comm"], shepherd: null, lastSeen: "Aug 17 · this week", status: "active", risk: null, tenure: "0.7y" },
  { slug: null, name: "Amara Okafor", initials: "AO", lanes: ["wors"], shepherd: null, lastSeen: "Aug 17 · this week", status: "newcomer", risk: null, tenure: "0.4y" },
  { slug: null, name: "Jordan Walker", initials: "JW", lanes: ["wors", "serv"], shepherd: "Brian Choi", lastSeen: "Aug 17 · this week", status: "active", risk: null, tenure: "1.0y" },
  // Rachel's flock extras
  { slug: null, name: "Maria Velez", initials: "MV", lanes: ["wors", "comm", "outr"], shepherd: "Rachel Thompson", lastSeen: "Aug 17 · this week", status: "active", risk: null, tenure: "1.6y" },
  { slug: null, name: "Lauren Bell", initials: "LB", lanes: ["wors", "comm"], shepherd: "Rachel Thompson", lastSeen: "Aug 17 · this week", status: "active", risk: null, tenure: "2.2y" },
  { slug: null, name: "Nina Rao", initials: "NR", lanes: ["wors", "comm", "serv"], shepherd: "Rachel Thompson", lastSeen: "Aug 17 · this week", status: "active", risk: null, tenure: "3.3y" },
  { slug: null, name: "Sabrina Hill", initials: "SH", lanes: ["wors", "comm"], shepherd: "Rachel Thompson", lastSeen: "Aug 17 · this week", status: "active", risk: null, tenure: "0.8y" },
  { slug: null, name: "Carla Brooks", initials: "CB", lanes: ["wors", "comm"], shepherd: "Rachel Thompson", lastSeen: "Aug 17 · this week", status: "active", risk: null, tenure: "2.4y" },
  { slug: null, name: "Emily Watson", initials: "EW", lanes: ["wors", "comm"], shepherd: "Rachel Thompson", lastSeen: "Aug 10 · last wk", status: "active", risk: null, tenure: "1.2y" },
  { slug: null, name: "Aisha Khan", initials: "AK", lanes: ["wors", "comm", "serv", "give"], shepherd: "Rachel Thompson", lastSeen: "Aug 17 · this week", status: "active", risk: null, tenure: "1.6y" },
  // Other named people
  { slug: null, name: "Ethan Park", initials: "EP", lanes: ["wors", "comm", "serv"], shepherd: "Brian Choi", lastSeen: "Aug 17 · this week", status: "active", risk: null, tenure: "0.9y" },
  { slug: null, name: "Olivia Martin", initials: "OM", lanes: ["wors", "comm", "outr"], shepherd: "Karen Voss", lastSeen: "Aug 17 · this week", status: "active", risk: null, tenure: "2.4y" },
  { slug: null, name: "Roberto Sanchez", initials: "RS", lanes: ["wors", "comm"], shepherd: "Christopher Walsh", lastSeen: "Aug 17 · this week", status: "active", risk: null, tenure: "1.2y" },
  { slug: null, name: "Jeremy Vale", initials: "JV", lanes: ["wors", "comm"], shepherd: "Christopher Walsh", lastSeen: "Aug 10 · last wk", status: "active", risk: null, tenure: "0.7y" },
  { slug: null, name: "Hassan Ali", initials: "HA", lanes: ["wors"], shepherd: null, lastSeen: "Aug 10 · last wk", status: "newcomer", risk: 35, tenure: "0.2y" },
  { slug: null, name: "Andre Garcia", initials: "AG", lanes: ["wors", "comm"], shepherd: "Karen Voss", lastSeen: "Aug 03 · 2w ago", status: "fading", risk: 64, tenure: "2.0y" },
  { slug: null, name: "Janelle Carter", initials: "JC", lanes: ["wors", "comm"], shepherd: "Jamal Williams", lastSeen: "Aug 03 · 2w ago", status: "active", risk: 32, tenure: "3.1y" },
  { slug: null, name: "Brad Rivera", initials: "BR", lanes: [], shepherd: "David Kim", lastSeen: "Jun 22 · 8w ago", status: "inactive", risk: 38, tenure: "5.2y" },
  // No-activity newcomers
  { slug: null, name: "Tori Bennett", initials: "TB", lanes: [], shepherd: null, lastSeen: "first visit Aug 10", status: "newcomer", risk: null, tenure: "0.0y" },
  { slug: null, name: "Sam Whitfield", initials: "SW", lanes: [], shepherd: null, lastSeen: "first visit Aug 17", status: "newcomer", risk: null, tenure: "0.0y" },
  { slug: null, name: "Linnea Holst", initials: "LH", lanes: [], shepherd: null, lastSeen: "first visit Aug 03", status: "newcomer", risk: null, tenure: "0.0y" },
];

export function peopleInLane(laneKey: LaneKey): PersonRow[] {
  if (laneKey === "none") {
    return ALL_PEOPLE.filter((p) => p.lanes.length === 0);
  }
  return ALL_PEOPLE.filter((p) => p.lanes.includes(laneKey));
}

// ─── Groups (full list) ────────────────────────────────────────────────────

export interface GroupRow {
  slug: string;
  name: string;
  type: string;
  members: number;
  delta12w: number;
  state: "growing" | "steady" | "shrinking" | "paused";
  lead: string;
  meeting: string;
  spark: string;
}

export const ALL_GROUPS: GroupRow[] = [
  {
    slug: "young-married-connect",
    name: "Young Married Connect",
    type: "Community",
    members: 22,
    delta12w: 8,
    state: "growing",
    lead: "Tyler Rodriguez · co-lead Aliza Levy",
    meeting: "Thu 7pm · Anaheim Hills",
    spark: "M2 16 L12 14 L22 12 L32 9 L42 7 L52 5 L58 4",
  },
  {
    slug: "tuesday-mens-bible-study",
    name: "Tuesday Men's Bible Study",
    type: "Community",
    members: 11,
    delta12w: 0,
    state: "steady",
    lead: "Mark Davies",
    meeting: "Tue 6:30am · church basement",
    spark: "M2 11 L12 12 L22 10 L32 11 L42 10 L52 11 L58 11",
  },
  {
    slug: "wednesday-womens-group",
    name: "Wednesday Women's Group",
    type: "Community",
    members: 9,
    delta12w: -9,
    state: "paused",
    lead: "Rachel Thompson",
    meeting: "paused · resumes Sept 4",
    spark: "M2 5 L12 7 L22 9 L32 11 L42 13 L52 15 L58 17",
  },
  {
    slug: "recovery-group",
    name: "Recovery Group",
    type: "Community",
    members: 14,
    delta12w: 6,
    state: "growing",
    lead: "Christopher Walsh · co-lead Carla Brooks",
    meeting: "Mon 7pm · room 12",
    spark: "M2 14 L12 13 L22 11 L32 9 L42 8 L52 7 L58 6",
  },
  {
    slug: "marriage-mentoring",
    name: "Marriage Mentoring",
    type: "Community",
    members: 8,
    delta12w: 1,
    state: "steady",
    lead: "Mark + Lori Davies",
    meeting: "1st & 3rd Sun · home",
    spark: "M2 8 L12 8 L22 8 L32 7 L42 7 L52 7 L58 7",
  },
  {
    slug: "college-ministry",
    name: "College Ministry",
    type: "Community",
    members: 27,
    delta12w: 3,
    state: "growing",
    lead: "Jamal Williams",
    meeting: "Wed 8pm · Anaheim",
    spark: "M2 12 L12 12 L22 11 L32 10 L42 9 L52 9 L58 8",
  },
  {
    slug: "worship-team",
    name: "Worship Team",
    type: "Serve",
    members: 12,
    delta12w: -1,
    state: "steady",
    lead: "Brian Choi",
    meeting: "Sat 4pm rehearsal · Sun 8/10:30am services",
    spark: "M2 9 L12 10 L22 11 L32 11 L42 10 L52 11 L58 12",
  },
  {
    slug: "hospitality-team",
    name: "Hospitality Team",
    type: "Serve",
    members: 17,
    delta12w: 1,
    state: "steady",
    lead: "Karen Voss",
    meeting: "Sun 8/10:30am",
    spark: "M2 10 L12 9 L22 10 L32 9 L42 9 L52 10 L58 9",
  },
  {
    slug: "greeters",
    name: "Greeters",
    type: "Serve",
    members: 14,
    delta12w: 2,
    state: "growing",
    lead: "David Kim",
    meeting: "Sun 8/10:30am",
    spark: "M2 12 L12 12 L22 11 L32 10 L42 10 L52 9 L58 8",
  },
  {
    slug: "kids-team",
    name: "Kids Team",
    type: "Serve",
    members: 19,
    delta12w: 0,
    state: "steady",
    lead: "Megan Sutter",
    meeting: "Sun 8/10:30am",
    spark: "M2 11 L12 11 L22 11 L32 10 L42 11 L52 11 L58 10",
  },
  {
    slug: "soup-kitchen",
    name: "Soup Kitchen",
    type: "Outreach",
    members: 23,
    delta12w: 5,
    state: "growing",
    lead: "Karen Voss",
    meeting: "1st Sat · downtown",
    spark: "M2 14 L12 13 L22 12 L32 10 L42 9 L52 8 L58 7",
  },
  {
    slug: "prayer-team",
    name: "Prayer Team",
    type: "Outreach",
    members: 16,
    delta12w: 2,
    state: "steady",
    lead: "Lori Davies",
    meeting: "Sun 7:30am",
    spark: "M2 10 L12 11 L22 10 L32 10 L42 9 L52 10 L58 9",
  },
];

// ─── Movement feed (longer) ────────────────────────────────────────────────

export interface MovementEvent {
  date: string;
  day: string;
  type: "join" | "exit" | "handoff" | "return" | "milestone" | "promote";
  text: string;
}

export const MOVEMENT_FEED: MovementEvent[] = [
  { date: "Aug 18", day: "Mon", type: "milestone", text: "Aisha Khan made her first recurring gift — Giving lane added" },
  { date: "Aug 17", day: "Sun", type: "return", text: "Hannah Voss returned after 4 months — first Sunday since April" },
  { date: "Aug 17", day: "Sun", type: "milestone", text: "Newcomer's Lunch · 7 first-timers · 5 follow-ups booked" },
  { date: "Aug 17", day: "Sun", type: "join", text: "Ethan Park joined the Greeters team — Serve lane added" },
  { date: "Aug 14", day: "Thu", type: "exit", text: "Two Greene left the church — moved to Austin" },
  { date: "Aug 13", day: "Tue", type: "handoff", text: "Rachel Thompson handed off Jenny Liu's care to Sarah Chen" },
  { date: "Aug 13", day: "Tue", type: "join", text: "Olivia Martin signed up for Aug Soup Kitchen — Outreach lane added" },
  { date: "Aug 12", day: "Wed", type: "join", text: "Carlos Mendoza joined Tuesday Men's Bible Study — Community lane added" },
  { date: "Aug 12", day: "Wed", type: "promote", text: "Priya Patel flagged ready to co-lead a group" },
  { date: "Aug 10", day: "Sun", type: "join", text: "Sam Whitfield · first visit · welcomed by greeters" },
  { date: "Aug 10", day: "Sun", type: "milestone", text: "Tori Bennett completed newcomer track — eligible for group invite" },
  { date: "Aug 09", day: "Sat", type: "milestone", text: "Christopher Walsh logged 24th month in Recovery Group — promote-to-shepherd flag raised" },
  { date: "Aug 03", day: "Sun", type: "join", text: "Linnea Holst · first visit · brought by Priya Patel" },
  { date: "Jul 31", day: "Wed", type: "exit", text: "Wednesday Women's Group ended its semester — 9 members on hold" },
];

// ─── Shepherding Hierarchy (Rachel Thompson) ─────────────────────────────

export const FOCUS_SHEPHERD = {
  name: "Rachel Thompson",
  initials: "RT",
  role: "Shepherd · Women's Care · since 2021",
  load: 14,
  capacity: 12,
  shepherdedByCount: 2,
  atRiskInCare: 3,
  avgTimeToTouch: "11d",
  handoffs90d: 4,
  tenure: "4.2y",
};

export const RACHEL_UPWARD = [
  {
    name: "Mark Davies",
    initials: "MD",
    role: "Lead Pastor · top of chain",
    note: "Primary shepherd · since 2022 · 1:1 monthly",
    lastTouch: "4d ago",
  },
  {
    name: "Karen Voss",
    initials: "KV",
    role: "Discipleship Pastor · co-shepherd",
    note: "Co-shepherd · since 2024 · monthly + retreats",
    lastTouch: "11d ago",
  },
];

export const RACHEL_FLOCK = [
  {
    name: "Sarah Chen",
    initials: "SC",
    risk: 82,
    riskLevel: "high" as const,
    coShepherd: "David Kim",
    lastSeen: "Sun · 3w ago",
    lastTouch: "Jul 28",
    lanes: ["wors", "comm"] as LaneKey[],
  },
  {
    name: "Daniel Park",
    initials: "DP",
    risk: 86,
    riskLevel: "high" as const,
    coShepherd: null,
    lastSeen: "Sun · 5w ago",
    lastTouch: "Jul 15",
    lanes: ["wors", "serv"] as LaneKey[],
  },
  {
    name: "Jenny Liu",
    initials: "JL",
    risk: 41,
    riskLevel: "low" as const,
    coShepherd: null,
    lastSeen: "Sun · 2w ago",
    lastTouch: "Aug 13",
    lanes: ["wors", "comm"] as LaneKey[],
    tag: "handoff in",
  },
  {
    name: "Priya Patel",
    initials: "PP",
    risk: null,
    riskLevel: "solid" as const,
    coShepherd: null,
    lastSeen: "Sun · this week",
    lastTouch: "Aug 12",
    lanes: ["wors", "comm", "serv", "give"] as LaneKey[],
    tag: "ready · co-lead",
  },
  {
    name: "Amara Okafor",
    initials: "AO",
    risk: null,
    riskLevel: "solid" as const,
    coShepherd: null,
    lastSeen: "Sun · this week",
    lastTouch: "Aug 6",
    lanes: ["wors"] as LaneKey[],
  },
  {
    name: "Maria Velez",
    initials: "MV",
    risk: null,
    riskLevel: "solid" as const,
    coShepherd: "Karen Voss",
    lastSeen: "Sun · this week",
    lastTouch: "Aug 11",
    lanes: ["wors", "comm", "outr"] as LaneKey[],
  },
  {
    name: "Lauren Bell",
    initials: "LB",
    risk: null,
    riskLevel: "solid" as const,
    coShepherd: null,
    lastSeen: "Sun · this week",
    lastTouch: "Aug 4",
    lanes: ["wors", "comm"] as LaneKey[],
  },
  {
    name: "Nina Rao",
    initials: "NR",
    risk: null,
    riskLevel: "solid" as const,
    coShepherd: null,
    lastSeen: "Sun · this week",
    lastTouch: "Aug 8",
    lanes: ["wors", "comm", "serv"] as LaneKey[],
  },
  {
    name: "Emily Watson",
    initials: "EW",
    risk: null,
    riskLevel: "solid" as const,
    coShepherd: null,
    lastSeen: "Sun · last week",
    lastTouch: "Jul 30",
    lanes: ["wors", "comm"] as LaneKey[],
  },
  {
    name: "Carla Brooks",
    initials: "CB",
    risk: null,
    riskLevel: "solid" as const,
    coShepherd: null,
    lastSeen: "Sun · this week",
    lastTouch: "Aug 1",
    lanes: ["wors", "comm"] as LaneKey[],
  },
  {
    name: "Sabrina Hill",
    initials: "SH",
    risk: null,
    riskLevel: "solid" as const,
    coShepherd: "Jamal Williams",
    lastSeen: "Sun · this week",
    lastTouch: "Aug 5",
    lanes: ["wors", "comm"] as LaneKey[],
  },
  {
    name: "Jess Mendez",
    initials: "JM",
    risk: null,
    riskLevel: "solid" as const,
    coShepherd: null,
    lastSeen: "Sun · this week",
    lastTouch: "Aug 9",
    lanes: ["wors", "comm"] as LaneKey[],
  },
  {
    name: "Tina Fields",
    initials: "TF",
    risk: null,
    riskLevel: "solid" as const,
    coShepherd: null,
    lastSeen: "Sun · last week",
    lastTouch: "Aug 2",
    lanes: ["wors", "comm"] as LaneKey[],
  },
  {
    name: "Rosa Gomez",
    initials: "RG",
    risk: null,
    riskLevel: "solid" as const,
    coShepherd: null,
    lastSeen: "Sun · this week",
    lastTouch: "Aug 7",
    lanes: ["wors"] as LaneKey[],
  },
];

export const RACHEL_HANDOFFS = [
  {
    when: "Aug 13",
    direction: "out" as const,
    text: "→ Sarah Chen · handed Jenny Liu's care to Sarah (Jenny's group changed)",
  },
  {
    when: "Jun 22",
    direction: "in" as const,
    text: "← from David Kim · received Sarah Chen during marriage transition",
  },
  {
    when: "Apr 04",
    direction: "out" as const,
    text: "→ Karen Voss · handed Olivia Martin to Karen (joined outreach team)",
  },
  {
    when: "Feb 18",
    direction: "in" as const,
    text: "← from Mark Davies · received Maria Velez (graduated newcomer track)",
  },
];
