import "server-only";
import { PDFParse } from "pdf-parse";

/** Standard MIR section headers we look for, in lowercase. The parser
 *  matches case-insensitively and tolerates a trailing colon. */
const SECTION_KEYS = [
  "target audience",
  "team",
  "resources",
  "activities",
  "outputs",
  "outcomes",
  "impact",
] as const;
type SectionKey = (typeof SECTION_KEYS)[number];

export interface ParsedMir {
  title: string;
  targetAudience: string | null;
  /** Raw "team" section text (kept for context). */
  team: string | null;
  /** Best-effort extraction of "Lead: …" from the team block. */
  leadName: string | null;
  /** Best-effort extraction of "Sponsor: …" from the team block. */
  sponsorName: string | null;
  resources: string | null;
  activities: string | null;
  outputs: string | null;
  outcomes: string | null;
  impact: string | null;
}

function normalizeHeader(s: string): string {
  return s.trim().toLowerCase().replace(/:\s*$/, "").trim();
}

function asSectionKey(line: string): SectionKey | null {
  const norm = normalizeHeader(line);
  return (SECTION_KEYS as readonly string[]).includes(norm)
    ? (norm as SectionKey)
    : null;
}

/** Extract a Lead / Sponsor name from a Team-section blob. Tolerates
 *  "Lead: Jane", "Lead — Jane", "Lead - Jane", or "Jane (Lead)". */
function findRole(text: string, role: "lead" | "sponsor"): string | null {
  const labelled = new RegExp(`\\b${role}\\b\\s*[-—:]\\s*([^\\n,;]+)`, "i");
  const m1 = text.match(labelled);
  if (m1) return m1[1].trim();
  const parenthesised = new RegExp(`([A-Za-z][^\\n,;()]*?)\\s*\\(\\s*${role}\\s*\\)`, "i");
  const m2 = text.match(parenthesised);
  if (m2) return m2[1].trim();
  return null;
}

/** Pull the structured MIR sections out of a PDF. Returns null fields
 *  for any section that didn't match a header; the caller can fill in
 *  the gaps after. */
export async function parseMirPdf(data: Uint8Array): Promise<ParsedMir> {
  const parser = new PDFParse({ data });
  let text: string;
  try {
    const res = await parser.getText();
    text = res.text ?? "";
  } finally {
    await parser.destroy();
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/g, ""));

  const buckets: Partial<Record<SectionKey, string[]>> = {};
  const preamble: string[] = [];
  let current: SectionKey | null = null;

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) {
      if (current && buckets[current]) buckets[current]!.push("");
      continue;
    }
    // Pure header line ("Resources" or "Resources:").
    const k = asSectionKey(trimmed);
    if (k) {
      current = k;
      buckets[current] = buckets[current] ?? [];
      continue;
    }
    // "Header: content" inline.
    const inline = trimmed.match(/^([^:]{1,40}):\s*(.*)$/);
    if (inline) {
      const headerKey = asSectionKey(inline[1]);
      if (headerKey) {
        current = headerKey;
        buckets[current] = buckets[current] ?? [];
        const content = inline[2].trim();
        if (content) buckets[current]!.push(content);
        continue;
      }
    }
    if (current) {
      buckets[current]!.push(raw);
    } else {
      preamble.push(trimmed);
    }
  }

  // Title: first preamble line that isn't generic boilerplate.
  const titleCandidates = preamble.filter(
    (l) => l.length > 0 && !/ministry impact report/i.test(l),
  );
  const title = (titleCandidates[0] ?? "Untitled MIR").slice(0, 300);

  const joined = (k: SectionKey): string | null => {
    const arr = buckets[k];
    if (!arr) return null;
    const v = arr.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    return v === "" ? null : v;
  };

  const team = joined("team");

  return {
    title,
    targetAudience: joined("target audience"),
    team,
    leadName: team ? findRole(team, "lead") : null,
    sponsorName: team ? findRole(team, "sponsor") : null,
    resources: joined("resources"),
    activities: joined("activities"),
    outputs: joined("outputs"),
    outcomes: joined("outcomes"),
    impact: joined("impact"),
  };
}
