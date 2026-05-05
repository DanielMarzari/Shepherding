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

export const SAMPLE_JOURNEYS = [
  {
    name: "Priya Patel",
    summary: "3.1 yr at church",
    note: "Now ready to co-lead a group",
    points: [
      { lane: "wors" as LaneKey, label: "Worship", at: 0 },
      { lane: "comm" as LaneKey, label: "+ Comm", at: 18 },
      { lane: "serv" as LaneKey, label: "+ Serve", at: 42 },
      { lane: "give" as LaneKey, label: "+ Giving", at: 78 },
    ],
  },
  {
    name: "Tyler Rodriguez",
    summary: "2.4 yr · serve-first",
    note: "Found community through Worship Team",
    points: [
      { lane: "wors" as LaneKey, label: "Worship", at: 0 },
      { lane: "serv" as LaneKey, label: "+ Serve", at: 8 },
      { lane: "comm" as LaneKey, label: "+ Comm", at: 55 },
    ],
  },
  {
    name: "Marcus Johnson",
    summary: "1.4 yr · stuck",
    note: "14mo Worship-only · candidate for group invite",
    points: [
      { lane: "wors" as LaneKey, label: "Worship", at: 0 },
      { lane: null, label: "no next", at: 88 },
    ],
  },
  {
    name: "Christopher Walsh",
    summary: "4.0 yr · all five",
    note: "Mentoring 2 in Recovery · ready to shepherd",
    points: [
      { lane: "wors" as LaneKey, label: "W", at: 0 },
      { lane: "comm" as LaneKey, label: "+C", at: 14 },
      { lane: "serv" as LaneKey, label: "+S", at: 38 },
      { lane: "give" as LaneKey, label: "+G", at: 60 },
      { lane: "outr" as LaneKey, label: "+O", at: 84 },
    ],
  },
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
