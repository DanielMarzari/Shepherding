// Shared next-step vocabulary — pure data, NO server imports, so both server
// components and client components can use it. The server-only libs
// (sermon-impact.ts, plan-announcements.ts) re-export from here.

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

/** The next-step categories the sermon classifier tags. `metric` is the weekly
 *  outcome series we correlate against, or null when the church has no
 *  measurable outcome for it (notably giving — no dated gifts). Labels are
 *  deliberately concrete so a tag is self-explanatory. */
export const NEXT_STEPS = [
  {
    key: "giving",
    label: "Give financially",
    metric: null as MetricKey | null,
    blurb: "An ask to give money — tithe, generosity, support the mission financially.",
  },
  {
    key: "groups",
    label: "Join a group",
    metric: "group_apps",
    blurb: "Get into a small group / don't do life alone.",
  },
  {
    key: "serving",
    label: "Serve / volunteer",
    metric: "new_servers",
    blurb: "Volunteer, serve on a team, use your gifts to help.",
  },
  {
    key: "outreach",
    label: "Invite / share faith",
    metric: "new_attenders",
    blurb: "Invite someone, share your faith, reach the city.",
  },
  {
    key: "faith_commitment",
    label: "Follow Jesus / be baptized",
    metric: null,
    blurb: "Decide to follow Jesus, get baptized, respond to the gospel, recommit.",
  },
  {
    key: "prayer",
    label: "Pray",
    metric: null,
    blurb: "A call to actually pray — make prayer a habit, pray about this now.",
  },
  {
    key: "discipleship",
    label: "Read & obey Scripture",
    metric: null,
    blurb: "Open your Bible, study it, and do what it says — spiritual-growth practices.",
  },
  {
    key: "care",
    label: "Care for others",
    metric: null,
    blurb: "Meet someone's tangible need — benevolence, hospitality, support the hurting.",
  },
] as const;

export type NextStepKey = (typeof NEXT_STEPS)[number]["key"];

/** Row shape for the Sermons list page (shared with the client filter). */
export interface SermonListRow {
  sourceId: number;
  preachedOn: string;
  title: string | null;
  speaker: string | null;
  topic: string | null;
  wordCount: number | null;
  calls: Array<{ key: NextStepKey; label: string; intensity: number }>;
}
