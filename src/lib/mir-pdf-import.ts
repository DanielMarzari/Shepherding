import "server-only";

// Loaded lazily inside the parser — pdf-parse drags pdfjs-dist with
// it, and we don't want to evaluate either at module load.

/** pdfjs-dist (the engine under pdf-parse) needs DOMMatrix / DOMPoint /
 *  DOMRect, which Node doesn't provide. Shim them with the tiny
 *  `geometry-polyfill` package, which writes to `window`. We alias
 *  window to globalThis first so those assignments stick. */
async function ensurePdfPolyfills(): Promise<void> {
  const g = globalThis as unknown as {
    DOMMatrix?: unknown;
    window?: unknown;
  };
  if (typeof g.DOMMatrix !== "undefined") return;
  if (typeof g.window === "undefined") g.window = globalThis;
  // @ts-expect-error — geometry-polyfill ships no type declarations.
  await import("geometry-polyfill");
}

/** Standard MIR section headers we look for, in lowercase. The parser
 *  matches case-insensitively and tolerates a trailing colon. Real-world
 *  templates use "IMPACT" or "IMPACT STATEMENT"; both end up here. */
const SECTION_KEYS = [
  "target audience",
  "team",
  "resources",
  "activities",
  "outputs",
  "outcomes",
  "impact",
  "impact statement",
] as const;
type SectionKey = (typeof SECTION_KEYS)[number];
type CanonicalKey =
  | "target audience"
  | "team"
  | "resources"
  | "activities"
  | "outputs"
  | "outcomes"
  | "impact";

function canonical(k: SectionKey): CanonicalKey {
  return k === "impact statement" ? "impact" : (k as CanonicalKey);
}

export interface ParsedMir {
  title: string;
  targetAudience: string | null;
  /** Raw "team" section text (kept for context). */
  team: string | null;
  /** Best-effort extraction of the Lead from the team block. */
  leadName: string | null;
  /** Best-effort extraction of the Sponsor from the team block. */
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
 *  "Lead: Jane", "Lead — Jane", "Lane - Jane", "Jane (Lead)", and the
 *  Faith Church template's "Jane Doe [Lead]" bracket notation. */
function findRole(text: string, role: "lead" | "sponsor"): string | null {
  // "Name [Lead]" — the church's template uses square brackets.
  const bracketed = new RegExp(
    `([A-Za-z][^,;\\n\\[\\]]*?)\\s*\\[\\s*${role}\\s*\\]`,
    "i",
  );
  const m1 = text.match(bracketed);
  if (m1) return m1[1].trim();
  // "Lead: Name" / "Lead — Name" / "Lead - Name".
  const labelled = new RegExp(`\\b${role}\\b\\s*[-—:]\\s*([^\\n,;]+)`, "i");
  const m2 = text.match(labelled);
  if (m2) return m2[1].trim();
  // "Name (Lead)".
  const paren = new RegExp(
    `([A-Za-z][^,;\\n()]*?)\\s*\\(\\s*${role}\\s*\\)`,
    "i",
  );
  const m3 = text.match(paren);
  if (m3) return m3[1].trim();
  return null;
}

/** Other names in the team block — anything that isn't already a Lead
 *  or Sponsor entry. Splits on commas / semicolons / newlines, strips
 *  bullets and trailing [tag] / (tag) annotations, drops obvious
 *  non-names. */
function findOtherMembers(text: string): string[] {
  const out: string[] = [];
  for (const piece of text.split(/[,;\n]/)) {
    let cleaned = piece.replace(/^[-•*\d.)\s]+/, "").trim();
    if (!cleaned) continue;
    // Drop entries that ARE the lead / sponsor entry.
    if (/\[\s*(lead|sponsor)\s*\]/i.test(cleaned)) continue;
    if (/\(\s*(lead|sponsor)\s*\)/i.test(cleaned)) continue;
    if (/^(lead|sponsor)\b\s*[-—:]/i.test(cleaned)) continue;
    if (/^team\b/i.test(cleaned)) continue;
    // Strip any trailing [annotation] or (annotation) — e.g. "(notes)".
    cleaned = cleaned
      .replace(/\s*\[[^\]]*\]\s*$/, "")
      .replace(/\s*\([^)]*\)\s*$/, "")
      .trim();
    if (cleaned.length < 2 || cleaned.length > 100) continue;
    out.push(cleaned);
  }
  return out;
}

/** Pull the structured MIR sections out of a single page's text. Returns
 *  null when the page has no recognisable MIR markers (covers, TOCs,
 *  the intro page, etc. all return null and get skipped). */
function parseOnePage(pageText: string): ParsedMir | null {
  const text = pageText ?? "";
  // Quick guard — a real MIR page mentions Target Audience or Team.
  if (
    !/target\s*audience/i.test(text) &&
    !/^\s*team\b/im.test(text)
  ) {
    return null;
  }

  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/g, ""));
  const buckets: Partial<Record<CanonicalKey, string[]>> = {};
  const preamble: string[] = [];
  let current: CanonicalKey | null = null;

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) {
      if (current && buckets[current]) buckets[current]!.push("");
      continue;
    }
    const k = asSectionKey(trimmed);
    if (k) {
      current = canonical(k);
      buckets[current] = buckets[current] ?? [];
      continue;
    }
    // "Header: content" inline ("Target Audience: …", "Team: …").
    const inline = trimmed.match(/^([^:]{1,40}):\s*(.*)$/);
    if (inline) {
      const headerKey = asSectionKey(inline[1]);
      if (headerKey) {
        current = canonical(headerKey);
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

  // Title: first preamble line that isn't generic boilerplate or a bare
  // page number.
  const titleCandidates = preamble.filter(
    (l) =>
      l.length > 0 &&
      !/ministry impact report/i.test(l) &&
      !/^\d{1,3}$/.test(l),
  );
  // OCR sometimes appends a stray single capital from the logo
  // ("ADULT DISCIPLESHIP A") — strip a trailing space + 1-letter all-caps
  // token before storing.
  const title = (titleCandidates[0] ?? "Untitled MIR")
    .replace(/\s+[A-Z]\s*$/, "")
    .trim()
    .slice(0, 300);

  const joined = (k: CanonicalKey): string | null => {
    const arr = buckets[k];
    if (!arr) return null;
    const v = arr.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    return v === "" ? null : v;
  };

  const team = joined("team");
  const leadName = team ? findRole(team, "lead") : null;
  const sponsorName = team ? findRole(team, "sponsor") : null;
  const allOther = team ? findOtherMembers(team) : [];
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

/** Parse every MIR in a PDF — typically one per page in a compendium
 *  doc. Pages that don't look like a MIR (cover, TOC, intro) are
 *  skipped. Throws a clear error when the PDF carries no extractable
 *  text at all (Canva-style outlined export, scanned image, etc.). */
export async function parseMirPdf(data: Uint8Array): Promise<ParsedMir[]> {
  await ensurePdfPolyfills();
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data });
  let pages: Array<{ num: number; text: string }>;
  try {
    const res = await parser.getText();
    pages = res.pages;
  } finally {
    await parser.destroy();
  }

  // If virtually no text came back — text was exported as outlines,
  // the doc is scanned images, etc. — fall back to OCR. Slow, but it
  // actually reads outlined / image-based MIRs.
  const meaningful = pages
    .map((p) => p.text.replace(/\s+/g, ""))
    .join("")
    .replace(/\d+/g, "");
  if (meaningful.length < 80) {
    const { ocrPagesFromPdf } = await import("./mir-pdf-ocr");
    pages = await ocrPagesFromPdf(data);
    const ocrMeaningful = pages
      .map((p) => p.text.replace(/\s+/g, ""))
      .join("")
      .replace(/\d+/g, "");
    if (ocrMeaningful.length < 80) {
      throw new Error(
        "Couldn't read any text from this PDF — even OCR found nothing. " +
          "The file may be empty, blank, or unreadable.",
      );
    }
  }

  const mirs: ParsedMir[] = [];
  for (const page of pages) {
    const mir = parseOnePage(page.text);
    if (mir) mirs.push(mir);
  }
  return mirs;
}
