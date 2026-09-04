import "server-only";
// Type-only import: erased at compile time, so builder-seeds.ts can import
// MIR_SEEDS from here without a runtime circular dependency.
import type { BlockConfig } from "./builder";
import type { SeedBlock, SeedPage } from "./builder-seeds";
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
  gaps?: { intro: string; items: string[]; footer?: string };
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
        // Heading goes in the body for the same reason the columns' does:
        // BlockView drops `title` on text blocks.
        text: [
          "### Outputs we cannot measure yet",
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
    revision: extras.revision ?? 1,
    navSection: "ministry-impact-reports",
    blocks,
  };
}

// ─── Adult Discipleship: the one report with live metrics ────────────
// The other 39 ministries carry the published Outputs as text until the data
// behind them exists; see the gap list at the bottom of this page for what
// "exists" would take.

/** Adults engaged with Faith Church, per the app's own activity classification.
 *  This is the denominator every "% of congregation" Output is measured against
 *  — it matches the report's target audience ("Adults engaged with Faith
 *  Church") far better than a raw people count, 64% of which is inactive. */
const ENGAGED_ADULTS = `
  SELECT p.pco_id
    FROM pco_people p
    JOIN person_activity pa ON pa.person_id = p.pco_id AND pa.org_id = :orgId
   WHERE p.org_id = :orgId AND p.is_minor = 0
     AND pa.classification IN ('shepherded','active','present')`;

/** The group types that constitute adult discipleship at Faith Church. Kids /
 *  student / childcare / foster-org group types are deliberately excluded — the
 *  report's audience is adults. Edit this list as PCO group types change. */
const ADULT_DISCIPLESHIP_TYPES = `
  'Small Groups','Disciple-making Groups','ABF Groups',
  'Women''s AM Bible Studies','Women''s PM Bible Studies',
  'Mens'' Groups','Young Adults Groups','Seniors In Action (SIA)',
  'Organic Groups'`;

/** One row per (person, group type, role) in an adult discipleship group. */
const DISCIPLESHIP_MEMBERS = `
  SELECT m.person_id, gt.name AS type_name, m.role, m.joined_at
    FROM pco_group_memberships m
    JOIN pco_groups g       ON g.pco_id = m.group_id       AND g.org_id = :orgId
    JOIN pco_group_types gt ON gt.pco_id = g.group_type_id AND gt.org_id = :orgId
   WHERE m.org_id = :orgId AND m.archived_at IS NULL
     AND gt.name IN (${ADULT_DISCIPLESHIP_TYPES})`;

/** Per-ministry additions, keyed by slug. Everything in here is ours rather
 *  than the report's: the live metric blocks and the honest account of which
 *  published Outputs we still cannot measure. A ministry with no entry renders
 *  its Logic Model alone. */
const MIR_EXTRAS: Record<string, MirExtras> = {
  "mir-adult-discipleship": {
    revision: 5,
    metrics: [
    {
      kind: "stat",
      config: {
        title: "Engaged adults",
        span: 3,
        sub: "the denominator for every % below",
        sql: `SELECT COUNT(*) FROM (${ENGAGED_ADULTS})`,
      },
    },
    {
      kind: "stat",
      config: {
        title: "In a discipleship group",
        span: 3,
        color: "highlight",
        sub: "engaged adults in an adult discipleship group",
        sql: `SELECT COUNT(DISTINCT d.person_id)
                FROM (${DISCIPLESHIP_MEMBERS}) d
                JOIN (${ENGAGED_ADULTS}) a ON a.pco_id = d.person_id`,
      },
    },
    {
      kind: "stat",
      config: {
        title: "% of congregation in a group",
        span: 3,
        // Computed against the live denominator rather than a `progress` block
        // with a fixed goal — a hard-coded congregation size silently goes
        // stale the moment the roster moves.
        sub: "share of engaged adults in a discipleship group",
        sql: `SELECT ROUND(
                  100.0 * (SELECT COUNT(DISTINCT d.person_id)
                             FROM (${DISCIPLESHIP_MEMBERS}) d
                             JOIN (${ENGAGED_ADULTS}) a ON a.pco_id = d.person_id)
                        / NULLIF((SELECT COUNT(*) FROM (${ENGAGED_ADULTS})), 0), 1) || '%'`,
      },
    },
    {
      kind: "stat",
      config: {
        title: "Discipleship group leaders",
        span: 3,
        sub: "engaged adults leading a group",
        sql: `SELECT COUNT(DISTINCT d.person_id)
                FROM (${DISCIPLESHIP_MEMBERS}) d
                JOIN (${ENGAGED_ADULTS}) a ON a.pco_id = d.person_id
               WHERE d.role = 'leader'`,
      },
    },
    {
      kind: "stat",
      config: {
        title: "Disciple-Making Groups",
        span: 3,
        sub: "people currently in a DMG",
        sql: `SELECT COUNT(DISTINCT person_id)
                FROM (${DISCIPLESHIP_MEMBERS})
               WHERE type_name = 'Disciple-making Groups'`,
      },
    },
    {
      kind: "stat",
      config: {
        title: "Adults taking Next Steps",
        span: 3,
        sub: "in a worship, community, or serving lane",
        sql: `SELECT COUNT(*)
                FROM person_activity pa
                JOIN pco_people p ON p.pco_id = pa.person_id AND p.org_id = :orgId
               WHERE pa.org_id = :orgId AND p.is_minor = 0
                 AND (pa.in_lane_wors = 1 OR pa.in_lane_comm = 1 OR pa.in_lane_serv = 1)`,
      },
    },
    {
      kind: "chart",
      config: {
        title: "Where adults are discipled",
        span: 6,
        chartType: "bar",
        colorByCategory: true,
        sub: "engaged adults by group type",
        sql: `SELECT d.type_name AS "Group type", COUNT(DISTINCT d.person_id) AS "Adults"
                FROM (${DISCIPLESHIP_MEMBERS}) d
                JOIN (${ENGAGED_ADULTS}) a ON a.pco_id = d.person_id
               GROUP BY 1 ORDER BY 2 DESC`,
      },
    },
    {
      kind: "chart",
      config: {
        title: "New discipleship-group joins by year",
        span: 6,
        chartType: "area",
        sub: "people joining an adult discipleship group",
        sql: `SELECT substr(d.joined_at, 1, 4) AS "Year",
                     COUNT(DISTINCT d.person_id) AS "Joined"
                FROM (${DISCIPLESHIP_MEMBERS}) d
               WHERE d.joined_at IS NOT NULL AND substr(d.joined_at, 1, 4) >= '2019'
               GROUP BY 1 ORDER BY 1`,
      },
    },
    {
      kind: "table",
      config: {
        title: "Disciple-Making Groups",
        span: 6,
        sortable: true,
        sub: "the multiplying core — each group and who leads it",
        sql: `SELECT g.name AS "Group",
                     COUNT(DISTINCT m.person_id) AS "Members",
                     SUM(CASE WHEN m.role = 'leader' THEN 1 ELSE 0 END) AS "Leaders"
                FROM pco_groups g
                JOIN pco_group_types gt ON gt.pco_id = g.group_type_id AND gt.org_id = :orgId
                LEFT JOIN pco_group_memberships m
                       ON m.group_id = g.pco_id AND m.org_id = :orgId AND m.archived_at IS NULL
               WHERE g.org_id = :orgId AND gt.name = 'Disciple-making Groups'
               GROUP BY g.name ORDER BY 2 DESC`,
      },
    },
    {
      kind: "table",
      config: {
        title: "Discipleship reach by group type",
        span: 6,
        sortable: true,
        sub: "adults reached, and how many of them lead",
        sql: `SELECT d.type_name AS "Group type",
                     COUNT(DISTINCT d.person_id) AS "Adults",
                     COUNT(DISTINCT CASE WHEN d.role = 'leader' THEN d.person_id END) AS "Leaders"
                FROM (${DISCIPLESHIP_MEMBERS}) d
                JOIN (${ENGAGED_ADULTS}) a ON a.pco_id = d.person_id
               GROUP BY 1 ORDER BY 2 DESC`,
      },
    }
    ],
    gaps: {
      intro:
        "These Outputs are in the published report but have no data behind them today. Listed here rather than dropped, so the gap is visible and fixable:",
      items: [
        "- **# of people who come to faith in Christ** — no faith-decision is recorded anywhere we sync. Needs a PCO form or workflow that stamps the person's record.",
        "- **# of baptisms** — a `Going Public (Baptism)` check-in event exists in PCO but has never had a single check-in. Checking people in at baptisms would make this live immediately.",
        "- **% who attend Discover Courses** — the Discover Faith Church check-in events stop in **February 2020**. Nothing since has been tracked.",
        "- **% who attend Discipleship Workshops** — no check-in event or group type corresponds to the workshops.",
        "- **% who complete a Disciple-Making Group** — we can see current membership, not completion. Needs an archived-with-outcome convention, or a \"graduated\" list.",
        "- **% of DMG graduates who become leaders** — depends on completion above.",
        "- **Standardized spiritual growth inventory** — no instrument has been administered, so there is nothing to report.",
      ],
      footer:
        "_The three Outputs that ARE live above (group participation, leaders, Next Steps) come from PCO group membership and the app's own lane classification._",
    },
  },
};

/** Every Ministry Impact Report page, built from the transcription. */
export const MIR_SEEDS: SeedPage[] = (reports2025 as MirReport[]).map((r) =>
  mirSeedPage(r, MIR_EXTRAS[r.slug] ?? {}),
);
