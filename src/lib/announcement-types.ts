// Announcement vocabulary — pure data + regex, NO server imports, so client
// components (filters, chips) can use the labels and definitions too.
import type { MetricKey } from "./next-step-types";

export interface AnnouncementType {
  key: string;
  label: string;
  /** Plain-English definition of what counts — shown in the UI so a tag is
   *  never a mystery. */
  what: string;
  /** Weekly outcome series this call is correlated against, or null when the
   *  church has no measurable outcome for it yet. */
  metric: MetricKey | null;
  patterns: RegExp[];
}

export const ANNOUNCEMENT_TYPES: AnnouncementType[] = [
  {
    key: "giving",
    label: "Giving",
    what: "An ask to give financially — the offering, generosity, year-end giving, a capital campaign.",
    metric: null,
    patterns: [
      /(?<!thanks )\bgiving\b/i,
      /\bgenerosity\b/i,
      /\btithe/i,
      /\bstewardship\b/i,
      /\bpledge\b/i,
      /extraordinary giving/i,
      /year[- ]end (giving|gift)/i,
      /capital campaign/i,
      /\bfirst fruits\b/i,
    ],
  },
  {
    key: "groups",
    label: "Join a group",
    what: "A call to join or sign up for a small group, or word that groups are launching / open.",
    metric: "group_apps",
    patterns: [
      /small group (launch|kickoff|sign[- ]?up|signup|registration|semester|starting|\bstart\b|open|opening|begin|connect)/i,
      /(join|sign up for|get in(to)?) (a |the |our |your )?(small )?group/i,
      /small groups? (are |is )?(now )?(open|available|filling|fill up|starting|launching|back|kicking off|begin)/i,
      /group (finder|kickoff|launch|sign[- ]?up|registration)/i,
      /\blife group/i,
      /\bcommunity group/i,
    ],
  },
  {
    key: "serving",
    label: "Serve / volunteer",
    what: "A call to volunteer or join a serving team.",
    metric: "new_servers",
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
  },
  {
    key: "invite",
    label: "Invite / outreach",
    what: "Invite someone, bring a friend, or a community-facing event (tree lighting, trunk-or-treat, Christmas & Easter services).",
    metric: "new_attenders",
    patterns: [
      /invite (a |your |some ?one|people|them|others|a friend|a neighbor|friends)/i,
      /bring a friend/i,
      /\boutreach\b/i,
      /christmas (eve )?(service|at faith)/i,
      /easter (service|at faith|sunday)/i,
      /connect(ing)? online/i,
      /connectonline/i,
      /community (event|outreach|dinner|day|serve)/i,
      /tree lighting/i,
      /trunk or treat/i,
      /fall fest/i,
      /block party/i,
      /reach (the|our) (city|community|valley|lehigh)/i,
    ],
  },
  {
    key: "prayer_night",
    label: "Prayer gathering",
    what: "A specific prayer event — prayer night, Prayer Works, the prayer room, a week of prayer.",
    metric: null,
    patterns: [
      /prayer night/i,
      /prayer works/i,
      /night of prayer/i,
      /prayer (gathering|meeting|room|walk|vigil|tent)/i,
      /\d+ days of prayer/i,
      /week of prayer/i,
      /prayer & praise/i,
      /prayer and praise/i,
    ],
  },
  {
    key: "baptism",
    label: "Baptism",
    what: "Baptism — sign-ups, a deadline, or an upcoming baptism service.",
    metric: null,
    patterns: [/\bbaptism/i, /\bbaptize/i, /get baptized/i],
  },
  {
    key: "discover_class",
    label: "Discover class",
    what: "The Discover Faith Church / Discover Jesus / Discover Next class — the church's own next-step class.",
    metric: null,
    patterns: [/discover faith( church)?/i, /discover jesus/i, /discover next/i, /discover membership/i],
  },
  {
    key: "membership",
    label: "Membership",
    what: "Becoming a member — the membership class, interview, or process.",
    metric: null,
    patterns: [/membership (class|interview|matters|process|meeting)/i, /become a member/i, /new member/i],
  },
  {
    key: "bible_reading",
    label: "Bible reading plan",
    what: "A Scripture reading plan or church-wide reading challenge.",
    metric: null,
    patterns: [/reading plan/i, /bible reading/i, /read through the bible/i],
  },
  {
    key: "care",
    label: "Care / support",
    what: "Support for people in need — benevolence, GriefShare, counseling, foster & adoption, meal trains.",
    metric: null,
    patterns: [
      /\bbenevolence\b/i,
      /grief\s?share/i,
      /\bcounseling\b/i,
      /foster (care|and adoption|& adoption)/i,
      /meal train/i,
      /support group/i,
      /care (team|ministry)/i,
      /divorce care/i,
    ],
  },
];

export const ANNOUNCEMENT_BY_KEY: Record<string, AnnouncementType> = Object.fromEntries(
  ANNOUNCEMENT_TYPES.map((t) => [t.key, t]),
);
