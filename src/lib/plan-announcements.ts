import "server-only";
import {
  ANNOUNCEMENT_TYPES,
  ANNOUNCEMENT_BY_KEY,
  type AnnouncementType,
} from "./announcement-types";

export { ANNOUNCEMENT_TYPES, ANNOUNCEMENT_BY_KEY };
export type { AnnouncementType };

// ---------------------------------------------------------------------------
// Announcement detection: turn a worship service's order-of-service items into
// the set of next-step CALLS made from the stage that week. The content is
// free-text in item descriptions / html_details (e.g. a bulleted "- Giving /
// - Prayer Night / - Small Group Launch"), so we detect types with a curated,
// auditable keyword catalog rather than an LLM — instant, deterministic, and
// safe to run inside the nightly sync. Every match keeps the phrase that fired
// it, so the Service plans page can show exactly WHY a week was tagged.
//
// Types are deliberately CONCRETE — named after what the church actually
// promotes ("Discover class", "Baptism", "Prayer night") rather than abstract
// buckets like "discipleship", so a tag is self-explanatory.
// ---------------------------------------------------------------------------

/** Strip HTML to readable text for keyword scanning. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export interface PlanItemLike {
  item_type: string | null;
  title: string | null;
  description: string | null;
  html_details: string | null;
}

/** Is this item one whose text we scan for announcements? Songs and media are
 *  vocal-arrangement notes (pure noise) and the sermon item is the other
 *  page's territory. */
export function isAnnouncementItem(it: PlanItemLike): boolean {
  const type = (it.item_type ?? "").toLowerCase();
  if (type === "song" || type === "media") return false;
  if (/sermon|message\b/i.test(it.title ?? "")) return false;
  return true;
}

/** The announcement-bearing text of one item (description + stripped html). */
export function itemText(it: PlanItemLike): string {
  return [it.description ?? "", it.html_details ? stripHtml(it.html_details) : ""]
    .filter(Boolean)
    .join(" ")
    .trim();
}

/** All announcement-bearing text of a service, joined. */
export function gatherAnnouncementText(items: PlanItemLike[]): string {
  const parts: string[] = [];
  for (const it of items) {
    if (!isAnnouncementItem(it)) continue;
    const t = itemText(it);
    if (t) parts.push(t);
  }
  return parts.join("  •  ");
}

export interface DetectedType {
  key: string;
  /** The exact phrases that fired, with context — the evidence for the tag. */
  matches: string[];
}

/** Detect which announcement types a block of text contains, with evidence. */
export function detectAnnouncements(text: string): DetectedType[] {
  if (!text) return [];
  const out: DetectedType[] = [];
  for (const t of ANNOUNCEMENT_TYPES) {
    const matches = new Set<string>();
    for (const re of t.patterns) {
      const m = text.match(re);
      if (m) matches.add(snippetAround(text, m.index ?? 0, m[0].length));
    }
    if (matches.size) out.push({ key: t.key, matches: [...matches].slice(0, 3) });
  }
  return out;
}

/** Every match of every type within one item's text, as offsets — used to
 *  highlight the exact phrases in the service-plan detail view. */
export interface Hit {
  key: string;
  start: number;
  end: number;
}
export function findHits(text: string): Hit[] {
  const hits: Hit[] = [];
  if (!text) return hits;
  for (const t of ANNOUNCEMENT_TYPES) {
    for (const re of t.patterns) {
      const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      let m: RegExpExecArray | null;
      while ((m = g.exec(text)) !== null) {
        if (m[0].length === 0) {
          g.lastIndex++;
          continue;
        }
        hits.push({ key: t.key, start: m.index, end: m.index + m[0].length });
      }
    }
  }
  // Sort and drop overlaps (keep the first/longest at each position).
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Hit[] = [];
  let lastEnd = -1;
  for (const h of hits) {
    if (h.start >= lastEnd) {
      out.push(h);
      lastEnd = h.end;
    }
  }
  return out;
}

/** ~40-char context window around a match, trimmed with ellipses. */
function snippetAround(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 18);
  const end = Math.min(text.length, index + len + 18);
  let s = text.slice(start, end).trim();
  if (start > 0) s = "…" + s;
  if (end < text.length) s = s + "…";
  return s;
}
