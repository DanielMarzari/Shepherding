import "server-only";

// Loaded lazily inside parseMirPdf — pdf-parse drags pdfjs-dist with
// it, and we don't want to evaluate either at module load (it would
// crash plain /mir page renders if either dep had a runtime issue).

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
  /** Other names found in the Team block (excluding lead + sponsor). */
  memberNames: string[];
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

/** Other names in the team block — anything that isn't already a Lead
 *  or Sponsor line. Best-effort: strips bullets, splits on commas, and
 *  drops obvious non-name fragments. */
function findOtherMembers(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const t = raw.trim();
    if (!t) continue;
    if (/^(lead|sponsor)\b\s*[-—:]/i.test(t)) continue;
    if (/\((lead|sponsor)\)/i.test(t)) continue;
    if (/^team\b/i.test(t)) continue;
    // Split on commas / semicolons so "Alice, Bob; Carol" → 3 names.
    for (const piece of t.split(/[,;]/)) {
      const cleaned = piece.replace(/^[-•*\d.)\s]+/, "").trim();
      if (cleaned.length < 2 || cleaned.length > 100) continue;
      // Drop role tails like "Alice (notes)".
      const stripped = cleaned.replace(/\s*\([^)]*\)\s*$/, "").trim();
      if (stripped.length < 2) continue;
      out.push(stripped);
    }
  }
  return out;
}

/** Pull the structured MIR sections out of a PDF. Returns null fields
 *  for any section that didn't match a header; the caller can fill in
 *  the gaps after. */
export async function parseMirPdf(data: Uint8Array): Promise<ParsedMir> {
  const { PDFParse } = await import("pdf-parse");
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
  const leadName = team ? findRole(team, "lead") : null;
  const sponsorName = team ? findRole(team, "sponsor") : null;
  const allOther = team ? findOtherMembers(team) : [];
  // Drop entries that look like the lead / sponsor we already extracted.
  const memberNames = allOther.filter(
    (n) =>
      n.toLowerCase() !== (leadName ?? "").toLowerCase() &&
      n.toLowerCase() !== (sponsorName ?? "").toLowerCase(),
  );

  return {
    title,
    targetAudience: joined("target audience"),
    team,
    leadName,
    sponsorName,
    memberNames,
    resources: joined("resources"),
    activities: joined("activities"),
    outputs: joined("outputs"),
    outcomes: joined("outcomes"),
    impact: joined("impact"),
  };
}
