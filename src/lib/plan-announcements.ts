import "server-only";
import { NEXT_STEPS_CATALOG, STEP_BY_KEY, type NextStep } from "./next-steps-catalog";

export { NEXT_STEPS_CATALOG, STEP_BY_KEY };
export type { NextStep };

// ---------------------------------------------------------------------------
// Announcement detection: turn a worship service's order of service into the
// set of SPECIFIC, NAMED next steps announced that week ("Discover Baptism",
// "Prayer Works", "join a small group") — not abstract categories. Detection
// is a curated keyword catalog rather than an LLM: instant, deterministic, and
// safe to run inside the nightly sync. Every match keeps the phrase that fired
// it, so the Service plans page can show exactly WHY a week was tagged.
// ---------------------------------------------------------------------------

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

/** Songs/media carry vocal-arrangement notes (noise) and the sermon item is
 *  the Sermons page's territory — neither is an announcement. */
export function isAnnouncementItem(it: PlanItemLike): boolean {
  const type = (it.item_type ?? "").toLowerCase();
  if (type === "song" || type === "media") return false;
  if (/sermon|message\b/i.test(it.title ?? "")) return false;
  return true;
}

export function itemText(it: PlanItemLike): string {
  return [it.description ?? "", it.html_details ? stripHtml(it.html_details) : ""]
    .filter(Boolean)
    .join(" ")
    .trim();
}

export function gatherAnnouncementText(items: PlanItemLike[]): string {
  const parts: string[] = [];
  for (const it of items) {
    if (!isAnnouncementItem(it)) continue;
    const t = itemText(it);
    if (t) parts.push(t);
  }
  return parts.join("  •  ");
}

export interface DetectedStep {
  key: string;
  /** Verbatim phrases that fired the tag — the evidence. */
  matches: string[];
}

/** Which named next steps a block of text announces, with evidence. */
export function detectAnnouncements(text: string): DetectedStep[] {
  if (!text) return [];
  const out: DetectedStep[] = [];
  for (const step of NEXT_STEPS_CATALOG) {
    const matches = new Set<string>();
    for (const re of step.patterns) {
      const m = text.match(re);
      if (m) matches.add(snippetAround(text, m.index ?? 0, m[0].length));
    }
    if (matches.size) out.push({ key: step.key, matches: [...matches].slice(0, 3) });
  }
  return out;
}

/** Every match of every step within a text, as offsets — powers the
 *  highlight-in-place view on the service-plan detail page. */
export interface Hit {
  key: string;
  start: number;
  end: number;
}
export function findHits(text: string): Hit[] {
  const hits: Hit[] = [];
  if (!text) return hits;
  for (const step of NEXT_STEPS_CATALOG) {
    for (const re of step.patterns) {
      const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      let m: RegExpExecArray | null;
      while ((m = g.exec(text)) !== null) {
        if (m[0].length === 0) {
          g.lastIndex++;
          continue;
        }
        hits.push({ key: step.key, start: m.index, end: m.index + m[0].length });
      }
    }
  }
  // Prefer the longest match at each position, then drop overlaps so a
  // "Discover Baptism" hit isn't shadowed by a bare "baptism" hit.
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

function snippetAround(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 18);
  const end = Math.min(text.length, index + len + 18);
  let s = text.slice(start, end).trim();
  if (start > 0) s = "…" + s;
  if (end < text.length) s = s + "…";
  return s;
}
