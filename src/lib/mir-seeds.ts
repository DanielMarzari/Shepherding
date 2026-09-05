import "server-only";
// Type-only import: erased at compile time, so builder-seeds.ts can import
// MIR_SEEDS from here without a runtime circular dependency.
import type { BlockConfig } from "./builder";
import type { SeedBlock, SeedPage } from "./builder-seeds";
import { MIR_EXTRAS } from "./mir-metrics";
import reports2025 from "./mir-reports-2025.json";

// Ministry Impact Reports — one builder page per ministry, generated from the
// published 2025 report rather than hand-authored 40 times.
//
// Faith Church evaluates every ministry with a Logic Model:
//   Target Audience → Resources → Activities → Outputs → Outcomes → Impact
// read left to right as if/then statements. The published report is a flattened
// PDF; `mir-reports-2025.json` is its transcription (see the `page` field for
// the source page). This module turns one transcription into a SeedPage, so the
// document IS the page and staff edit it in the builder like anything else.
//
// Only the Outputs column is a dashboard: it is the one the report itself calls
// "the story of ministry impact through numbers". Ministries with data we
// already sync get live metric blocks; the rest carry the published Outputs as
// text until the data exists. An Output we cannot measure is listed as a gap
// with the reason — never dropped, never backed by a proxy dressed up as real.

/** Width of each Logic Model column. The bento grid is 12 wide and 12 isn't
 *  divisible by 5, so five equal sixths (5 × 2 = 10) leave a 2-unit gap at the
 *  right of the row rather than five unequal columns. Equal beats flush: the
 *  five columns are a single published table, and one column rendering 50%
 *  wider than its neighbours reads as emphasis the report never intended. */
export const MIR_COLUMN_SPAN = 2;

/** A column the published PDF visually cuts off. The report was flattened from
 *  a fixed-height template, so overflowing text is gone from the source image
 *  and is genuinely unrecoverable — we render what is legible and mark it. */
export interface MirClip {
  /** One of the five column keys. Deliberately `string`, not a union: these
   *  come straight from the transcription JSON, whose inferred member type is
   *  `string`, and a union here would reject the import for no real safety —
   *  an unrecognised key simply matches no column. */
  column: string;
  lastVisibleText: string;
}

/** One ministry's Logic Model, transcribed verbatim from the printed report. */
export interface MirReport {
  /** Page in the 2025 report PDF this was transcribed from. */
  page: number;
  slug: string;
  title: string;
  targetAudience: string;
  team: string;
  resources: string[];
  activities: string[];
  outputs: string[];
  outcomes: string[];
  impact: string[];
  clipped?: MirClip[];
  /** Typos and oddities in the printed source, for whoever reconciles them. */
  sourceNotes?: string[];
}

/** Everything that is ours rather than the report's: the live metrics, and the
 *  honest account of which published Outputs we still can't measure. */
export interface MirExtras {
  metrics?: SeedBlock[];
  gaps?: { title?: string; intro: string; items: string[]; footer?: string; collapsible?: boolean };
  /** Bump to re-seed a page that nobody has edited. */
  revision?: number;
}

const HEADINGS = {
  resources: "Resources",
  activities: "Activities",
  outputs: "Outputs",
  outcomes: "Outcomes",
  impact: "IMPACT",
} as const;

/** A Logic Model column. `title` can't carry the heading — BlockView's
 *  `kind === "text"` branch renders only `config.text` and drops title/sub —
 *  so it goes in the markdown body, where MD_CLASS already styles `###` as a
 *  column head. Bullets are separated by a blank line to match the airy
 *  spacing of the printed table. */
function column(
  key: keyof typeof HEADINGS,
  items: string[],
  opts: { clipped?: MirClip[]; sub?: string; bulleted?: boolean; color?: BlockConfig["color"] } = {},
): SeedBlock {
  const clip = opts.clipped?.find((c) => c.column === key);
  const lines = items.slice();
  // The published report cuts this column off mid-thought; the ellipsis says so
  // rather than letting the sentence look like it simply ended oddly.
  if (clip && lines.length > 0) lines[lines.length - 1] = `${lines[lines.length - 1]} …`;

  const body = opts.bulleted === false
    ? lines.join("\n\n")
    : lines.map((l) => `- ${l}`).join("\n\n");

  const head = `### ${HEADINGS[key]}\n\n` + (opts.sub ? `_${opts.sub}_\n\n` : "");
  return {
    kind: "text",
    config: {
      span: MIR_COLUMN_SPAN,
      ...(opts.color ? { color: opts.color } : {}),
      text: head + body,
    },
  };
}

/** Stable 31-bit fingerprint of everything a reader would see. Deterministic
 *  across processes (no hashing library, no salt), so the same definition always
 *  produces the same number and a rebuild doesn't churn every page. */
function seedFingerprint(report: MirReport, blocks: SeedBlock[]): number {
  const text = JSON.stringify([report.title, report.page, blocks]);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h | 0);
}

/** Build the builder page for one ministry. */
export function mirSeedPage(report: MirReport, extras: MirExtras = {}): SeedPage {
  const hasMetrics = (extras.metrics?.length ?? 0) > 0;
  const blocks: SeedBlock[] = [
    {
      kind: "text",
      config: {
        span: 12,
        text: [
          `# ${report.title}`,
          "",
          `**Target Audience:** ${report.targetAudience}`,
          "",
          `**Team:** ${report.team}`,
          "",
          "_2025 Ministry Impact Report. The five columns below are the published Logic Model, read left to right as if/then statements: if these Resources, then these Activities; if these Activities, then these Outputs; if these Outputs, then these Outcomes; if these Outcomes, then this Impact._",
        ].join("\n"),
      },
    },
    {
      kind: "divider",
      config: { span: 12, title: "The Logic Model", sub: "As published in the 2025 report" },
    },
    column("resources", report.resources, { clipped: report.clipped }),
    column("activities", report.activities, { clipped: report.clipped }),
    column("outputs", report.outputs, {
      clipped: report.clipped,
      sub: hasMetrics ? "measured below" : undefined,
    }),
    column("outcomes", report.outcomes, { clipped: report.clipped }),
    // Impact is prose, not a list — the report writes it as a paragraph plus
    // numbered commitments.
    column("impact", report.impact, {
      clipped: report.clipped,
      bulleted: false,
      color: "highlight",
    }),
  ];

  if (hasMetrics) {
    blocks.push({
      kind: "divider",
      config: {
        span: 12,
        title: "Outputs, measured",
        sub: "The story of ministry impact through numbers — live from PCO",
      },
    });
    blocks.push(...(extras.metrics ?? []));
  }

  if (extras.gaps) {
    blocks.push({
      kind: "text",
      config: {
        span: 12,
        color: "warning",
        ...(extras.gaps.collapsible
          ? {
              collapsible: true,
              detailLabel: extras.gaps.title ?? "Outputs we cannot measure yet",
            }
          : {}),
        // Heading goes in the body for the same reason the columns' does:
        // BlockView drops `title` on text blocks.
        text: [
          `### ${extras.gaps.title ?? "Outputs we cannot measure yet"}`,
          "",
          extras.gaps.intro,
          "",
          ...extras.gaps.items,
          ...(extras.gaps.footer ? ["", extras.gaps.footer] : []),
        ].join("\n"),
      },
    });
  }

  return {
    slug: report.slug,
    title: report.title,
    description: hasMetrics
      ? "2025 Ministry Impact Report — the Logic Model as published, with the Outputs column measured against live PCO data."
      : `2025 Ministry Impact Report — the Logic Model as published (source page ${report.page}). Outputs are not yet measured.`,
    // A fingerprint of the actual content, NOT a hand-kept number and NOT the
    // block count. Hand-kept numbers get forgotten — that is how the Original
    // Music report ended up with a Logic Model and no statistics. Block count
    // is no better: correcting a query or adding a collapsible detail changes
    // what the page SAYS without changing how many blocks it has, and the page
    // would sit on stale content looking fine. Any edit to any block changes
    // this value, and seeded pages are compared for difference, not for
    // "newer". An explicit revision still wins where one is set.
    revision: extras.revision ?? seedFingerprint(report, blocks),
    navSection: "ministry-impact-reports",
    blocks,
  };
}

/** Every Ministry Impact Report page, built from the transcription. */
export const MIR_SEEDS: SeedPage[] = (reports2025 as MirReport[]).map((r) =>
  mirSeedPage(r, MIR_EXTRAS[r.slug] ?? {}),
);
