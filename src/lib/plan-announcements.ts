import "server-only";
import type { NextStepKey } from "./sermon-impact";

// ---------------------------------------------------------------------------
// Announcement detection: turn a worship service's order-of-service items into
// the set of next-step CALLS that were made from the stage that week. The
// content is free-text in item descriptions / html_details (e.g. a bulleted
// "- Giving / - Prayer Night / - Small Group Launch"), so we detect categories
// with a curated, auditable keyword catalog rather than an LLM — which keeps
// it instant and safe to run inside the nightly sync. Every match keeps the
// snippet that fired it, so the page can show WHY a week was tagged.
// ---------------------------------------------------------------------------

/** Word-boundary keyword catalog per next-step category. Patterns are matched
 *  case-insensitively against announcement text. Kept deliberately specific to
 *  the recurring programs this church promotes, to avoid over-tagging. */
const KEYWORDS: Record<NextStepKey, RegExp[]> = {
  giving: [
    /(?<!thanks)\bgiving\b/i,
    /\bgenerosity\b/i,
    /\btithe/i,
    /\bstewardship\b/i,
    /\bpledge\b/i,
    /extraordinary giving/i,
    /year[- ]end (giving|gift)/i,
    /capital campaign/i,
    /\bfirst fruits\b/i,
  ],
  groups: [
    // A genuine call to join / sign up, or that groups are launching / open —
    // NOT a passing "small group study sheet" resource mention.
    /small group (launch|kickoff|sign[- ]?up|signup|registration|semester|starting|\bstart\b|open|opening|begin|connect)/i,
    /(join|sign up for|get in(to)?) (a |the |our |your )?(small )?group/i,
    /small groups? (are |is )?(now )?(open|available|filling|fill up|starting|launching|back|kicking off|begin)/i,
    /group (finder|kickoff|launch|sign[- ]?up|registration)/i,
    /\blife group/i,
    /\bcommunity group/i,
  ],
  serving: [
    /\bvolunteer/i,
    /\bserve\b/i,
    /\bserving\b/i,
    /dream team/i,
    /serve team/i,
    /unleashing servants/i,
    /join (a|the|our) team/i,
    /serve (opportunit|sunday|day|the)/i,
    /\bnext gen\b.*volunteer/i,
  ],
  outreach: [
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
  prayer: [
    /prayer night/i,
    /prayer works/i,
    /night of prayer/i,
    /prayer (gathering|meeting|room|walk|vigil|tent)/i,
    /\d+ days of prayer/i,
    /week of prayer/i,
  ],
  faith_commitment: [
    /\bbaptism/i,
    /\bbaptize/i,
    /get baptized/i,
    /discover jesus/i,
    /profession of faith/i,
    /\baltar call\b/i,
  ],
  discipleship: [
    /discover (faith church|membership|faith|next)/i,
    /membership (class|interview|matters)/i,
    /\bmembership\b/i,
    /next steps class/i,
    /reading plan/i,
    /bible reading/i,
    /\bdiscipleship\b/i,
    /\bequip\b.*class/i,
  ],
  care: [
    /\bbenevolence\b/i,
    /grief\s?share/i,
    /\bcounseling\b/i,
    /foster (care|and adoption|& adoption)/i,
    /meal train/i,
    /support group/i,
    /care (team|ministry)/i,
    /divorce care/i,
  ],
};

export const ANNOUNCEMENT_CATEGORIES = Object.keys(KEYWORDS) as NextStepKey[];

/** Strip HTML to readable text for keyword scanning. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&rsquo;|&lsquo;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export interface PlanItemLike {
  item_type: string | null;
  title: string | null;
  description: string | null;
  html_details: string | null;
}

/** The announcement-bearing text of a service: descriptions + html of the
 *  'item'/'header' rows, EXCLUDING the sermon item (that's the other page)
 *  and songs (their notes are vocal arrangements, pure noise). */
export function gatherAnnouncementText(items: PlanItemLike[]): string {
  const parts: string[] = [];
  for (const it of items) {
    const type = (it.item_type ?? "").toLowerCase();
    if (type === "song" || type === "media") continue;
    const title = it.title ?? "";
    if (/sermon|message\b/i.test(title)) continue; // sermon content ≠ announcement
    const chunks = [it.description ?? "", it.html_details ? stripHtml(it.html_details) : ""];
    const text = chunks.filter(Boolean).join(" ").trim();
    if (text) parts.push(text);
  }
  return parts.join("  •  ");
}

export interface DetectedCategory {
  key: NextStepKey;
  matches: string[]; // the snippets that fired, for transparency
}

/** Detect which next-step categories a service announced, with evidence. */
export function detectAnnouncements(text: string): DetectedCategory[] {
  if (!text) return [];
  const out: DetectedCategory[] = [];
  for (const key of ANNOUNCEMENT_CATEGORIES) {
    const matches = new Set<string>();
    for (const re of KEYWORDS[key]) {
      const m = text.match(re);
      if (m) matches.add(snippetAround(text, m.index ?? 0, m[0].length));
    }
    if (matches.size) out.push({ key, matches: [...matches].slice(0, 3) });
  }
  return out;
}

/** ~40-char context window around a match, trimmed to word edges. */
function snippetAround(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 16);
  const end = Math.min(text.length, index + len + 16);
  let s = text.slice(start, end).trim();
  if (start > 0) s = "…" + s;
  if (end < text.length) s = s + "…";
  return s;
}
