import "server-only";
import { getDb } from "./db";
import type { BlockConfig, BlockKind } from "./builder";

/** One block in a seeded page definition (position is the array order). */
export interface SeedBlock {
  kind: BlockKind;
  config: BlockConfig;
}

/** A page rebuilt out of builder widgets, seeded on first visit to its route.
 *  The definitions live in version control; the moment a page exists in the DB
 *  it becomes the editable source of truth and is never re-seeded over. */
export interface SeedPage {
  slug: string;
  title: string;
  description?: string;
  /** Bump when the block definition below changes. A pristine (never-edited)
   *  seeded page is refreshed to the new definition; edited pages are left as-is. */
  revision: number;
  /** Left-nav section — usually null: overridden routes keep their existing
   *  hand-coded sidebar link, so setting this would duplicate the nav entry. */
  navSection?: string | null;
  moreSection?: string | null;
  blocks: SeedBlock[];
}

// ─── Seed definitions (one per converted page) ───────────────────────
// SQL scopes itself with :orgId (auto-bound). Ignored / excluded settings
// stored as JSON in pco_sync_settings are read back with json_each so the
// numbers match the original hand-coded pages.

const EXCLUDED_CHECKIN_EVENTS = `
  SELECT je.value FROM pco_sync_settings s,
         json_each(COALESCE(s.excluded_checkin_events, '[]')) je
   WHERE s.org_id = :orgId`;

const checkinsSeed: SeedPage = {
  slug: "checkins",
  title: "Check-ins",
  description:
    "Tag events as Kid / Adult / Ignore under Filters → Check-in events. Ignored events don't appear here.",
  revision: 4,
  blocks: [
    {
      kind: "stat",
      config: {
        title: "This week",
        span: 3,
        color: "success",
        sub: "distinct people · last 7 days",
        sql: `SELECT COUNT(DISTINCT person_id)
                FROM pco_check_ins
               WHERE org_id = :orgId
                 AND pco_created_at >= datetime('now', '-7 days')
                 AND event_id NOT IN (${EXCLUDED_CHECKIN_EVENTS})`,
      },
    },
    {
      kind: "stat",
      config: {
        title: "Last 30 days",
        span: 3,
        sub: "distinct people · last 30 days",
        sql: `SELECT COUNT(DISTINCT person_id)
                FROM pco_check_ins
               WHERE org_id = :orgId
                 AND pco_created_at >= datetime('now', '-30 days')
                 AND event_id NOT IN (${EXCLUDED_CHECKIN_EVENTS})`,
      },
    },
    {
      kind: "stat",
      config: {
        title: "Total people",
        span: 3,
        sub: "distinct people ever checked in",
        sql: `SELECT COUNT(DISTINCT person_id)
                FROM pco_check_ins
               WHERE org_id = :orgId
                 AND event_id NOT IN (${EXCLUDED_CHECKIN_EVENTS})`,
      },
    },
    {
      kind: "stat",
      config: {
        title: "Ignored events",
        span: 3,
        color: "warning",
        sub: "hidden from this page",
        sql: `SELECT COUNT(*) FROM (${EXCLUDED_CHECKIN_EVENTS})`,
      },
    },
    {
      kind: "table",
      config: {
        title: "Check-in events",
        span: 12,
        density: "normal",
        columnColors: { Frequency: "low", "People (30d)": "low", "All-time": "low", "Last": "low" },
        sub: "active events · sorted by all-time check-ins (ignored events hidden)",
        sql: `WITH event_stats AS (
                SELECT event_id,
                       COUNT(*) AS total,
                       SUM(CASE WHEN pco_created_at >= datetime('now','-30 days') THEN 1 ELSE 0 END) AS c30,
                       COUNT(DISTINCT CASE WHEN pco_created_at >= datetime('now','-30 days') THEN person_id END) AS p30,
                       MAX(pco_created_at) AS lastAt
                  FROM pco_check_ins
                 WHERE org_id = :orgId AND event_id IS NOT NULL
                 GROUP BY event_id
              )
              SELECT e.name                        AS "Event",
                     e.frequency                   AS "Frequency",
                     COALESCE(s.c30, 0)            AS "Check-ins (30d)",
                     COALESCE(s.p30, 0)            AS "People (30d)",
                     COALESCE(s.total, 0)          AS "All-time",
                     date(s.lastAt)                AS "Last"
                FROM pco_checkin_events e
                LEFT JOIN event_stats s ON s.event_id = e.pco_id
               WHERE e.org_id = :orgId
                 AND e.archived_at IS NULL
                 AND e.pco_id NOT IN (${EXCLUDED_CHECKIN_EVENTS})
               ORDER BY "All-time" DESC, e.name ASC`,
      },
    },
  ],
};

// ── Demographics ─────────────────────────────────────────────────────
// A :scope filter (Everyone / Engaged / In groups / On teams) drives every
// chart. Each `sp` branch mirrors populatePeopleInScope() in lib/demographics.ts
// and is gated by :scope so only the selected branch returns rows.
const SCOPE_CTE = `WITH sp AS (
  SELECT pco_id AS person_id FROM pco_people
   WHERE org_id = :orgId AND :scope = 'all'
  UNION
  SELECT person_id FROM person_activity
   WHERE org_id = :orgId AND classification != 'inactive' AND :scope = 'engaged'
  UNION
  SELECT DISTINCT m.person_id FROM pco_group_memberships m
    JOIN pco_groups g ON g.org_id = m.org_id AND g.pco_id = m.group_id
   WHERE m.org_id = :orgId AND m.archived_at IS NULL AND g.archived_at IS NULL AND :scope = 'groups'
  UNION
  SELECT DISTINCT m.person_id FROM pco_team_memberships m
    JOIN pco_teams t ON t.org_id = m.org_id AND t.pco_id = m.team_id
   WHERE m.org_id = :orgId AND m.archived_at IS NULL AND m.person_id != ''
     AND t.archived_at IS NULL AND t.deleted_at IS NULL AND :scope = 'teams'
)`;
// Reused age-bucket ordinal (kept out of the SELECT list so charts get 2 columns).
const AGE_ORD = `CASE
  WHEN p.birth_year IS NULL OR p.birth_year < 1900 THEN 99
  WHEN (CAST(strftime('%Y','now') AS INTEGER) - p.birth_year) < 18 THEN 1
  WHEN (CAST(strftime('%Y','now') AS INTEGER) - p.birth_year) < 30 THEN 2
  WHEN (CAST(strftime('%Y','now') AS INTEGER) - p.birth_year) < 50 THEN 3
  WHEN (CAST(strftime('%Y','now') AS INTEGER) - p.birth_year) < 65 THEN 4
  ELSE 5 END`;

const demographicsSeed: SeedPage = {
  slug: "demographics",
  title: "Membership demographics",
  description:
    "Who makes up the church — membership status, age, gender, and whether they have kids — for whichever slice you pick below. Drawn from PCO profile data.",
  revision: 3,
  blocks: [
    {
      kind: "filter",
      config: {
        title: "Population",
        param: "scope",
        filterType: "chips",
        defaultValue: "all",
        span: 8,
        sql: `SELECT value, label FROM (
                SELECT 1 AS o, 'all' AS value, 'Everyone' AS label
                UNION ALL SELECT 2, 'engaged', 'Engaged'
                UNION ALL SELECT 3, 'groups', 'In groups'
                UNION ALL SELECT 4, 'teams', 'On teams'
              ) ORDER BY o`,
      },
    },
    {
      kind: "stat",
      config: {
        title: "People in this slice",
        span: 4,
        sub: "distinct people in the selected population",
        sql: `${SCOPE_CTE} SELECT COUNT(*) FROM sp`,
      },
    },
    {
      kind: "chart",
      config: {
        title: "Membership status",
        chartType: "pie",
        span: 3,
        sql: `${SCOPE_CTE}
              SELECT COALESCE(p.membership_type, '(unknown)') AS "Membership", COUNT(*) AS "People"
                FROM pco_people p JOIN sp ON sp.person_id = p.pco_id
               WHERE p.org_id = :orgId
               GROUP BY p.membership_type
               ORDER BY COUNT(*) DESC, p.membership_type ASC`,
      },
    },
    {
      kind: "chart",
      config: {
        title: "Gender",
        chartType: "bar",
        colorByCategory: true,
        span: 3,
        sql: `${SCOPE_CTE}
              SELECT CASE
                       WHEN lower(coalesce(p.gender,'')) IN ('m','male') THEN 'Male'
                       WHEN lower(coalesce(p.gender,'')) IN ('f','female') THEN 'Female'
                       ELSE 'Unknown' END AS "Gender",
                     COUNT(*) AS "People"
                FROM pco_people p JOIN sp ON sp.person_id = p.pco_id
               WHERE p.org_id = :orgId
               GROUP BY 1`,
      },
    },
    {
      kind: "chart",
      config: {
        title: "Age",
        chartType: "bar",
        colorByCategory: true,
        span: 3,
        sql: `${SCOPE_CTE}
              SELECT CASE
                       WHEN p.birth_year IS NULL OR p.birth_year < 1900 THEN 'Unknown'
                       WHEN (CAST(strftime('%Y','now') AS INTEGER) - p.birth_year) < 18 THEN '<18'
                       WHEN (CAST(strftime('%Y','now') AS INTEGER) - p.birth_year) < 30 THEN '18–29'
                       WHEN (CAST(strftime('%Y','now') AS INTEGER) - p.birth_year) < 50 THEN '30–49'
                       WHEN (CAST(strftime('%Y','now') AS INTEGER) - p.birth_year) < 65 THEN '50–64'
                       ELSE '65+' END AS "Age",
                     COUNT(*) AS "People"
                FROM pco_people p JOIN sp ON sp.person_id = p.pco_id
               WHERE p.org_id = :orgId
               GROUP BY 1
               ORDER BY MIN(${AGE_ORD})`,
      },
    },
    {
      kind: "chart",
      config: {
        title: "Parents",
        chartType: "bar",
        colorByCategory: true,
        span: 3,
        sql: `${SCOPE_CTE}
              SELECT CASE WHEN p.is_parent = 1 THEN 'Parent' ELSE 'No kids' END AS "Household",
                     COUNT(*) AS "People"
                FROM pco_people p JOIN sp ON sp.person_id = p.pco_id
               WHERE p.org_id = :orgId
               GROUP BY 1`,
      },
    },
  ],
};

// ── Groups ───────────────────────────────────────────────────────────
// People currently in a non-archived group — the demographics scope for /groups.
const GROUPS_SP = `WITH sp AS (
  SELECT DISTINCT m.person_id FROM pco_group_memberships m
    JOIN pco_groups g ON g.org_id = m.org_id AND g.pco_id = m.group_id
   WHERE m.org_id = :orgId AND m.archived_at IS NULL AND g.archived_at IS NULL
)`;

const groupsSeed: SeedPage = {
  slug: "groups",
  title: "Groups",
  description: "Active groups, who's in them, and the demographics of the people they gather.",
  revision: 1,
  blocks: [
    {
      kind: "stat",
      config: {
        title: "Active groups", span: 3, sub: "not archived",
        sql: `SELECT COUNT(*) FROM pco_groups WHERE org_id = :orgId AND archived_at IS NULL`,
      },
    },
    {
      kind: "stat",
      config: {
        title: "People in groups", span: 3, sub: "distinct current members",
        sql: `SELECT COUNT(DISTINCT m.person_id) FROM pco_group_memberships m
                JOIN pco_groups g ON g.org_id = m.org_id AND g.pco_id = m.group_id
               WHERE m.org_id = :orgId AND m.archived_at IS NULL AND g.archived_at IS NULL`,
      },
    },
    {
      kind: "chart",
      config: {
        title: "Members by group type", chartType: "bar", colorByCategory: true, span: 6,
        sql: `SELECT COALESCE(t.name, '(no type)') AS "Type", COUNT(DISTINCT m.person_id) AS "Members"
                FROM pco_groups g
                JOIN pco_group_memberships m ON m.org_id = g.org_id AND m.group_id = g.pco_id AND m.archived_at IS NULL
                LEFT JOIN pco_group_types t ON t.org_id = g.org_id AND t.pco_id = g.group_type_id
               WHERE g.org_id = :orgId AND g.archived_at IS NULL
               GROUP BY 1 ORDER BY 2 DESC`,
      },
    },
    {
      kind: "table",
      config: {
        title: "Groups", span: 12, density: "normal",
        columnColors: { Type: "low", "Last event": "low" },
        sub: "active groups · current members · most recent attended event",
        sql: `WITH mem AS (
                SELECT group_id, COUNT(DISTINCT person_id) AS members
                  FROM pco_group_memberships WHERE org_id = :orgId AND archived_at IS NULL GROUP BY group_id
              ), att AS (
                SELECT group_id, MAX(event_starts_at) AS last_event
                  FROM pco_event_attendances WHERE org_id = :orgId AND attended = 1 AND group_id IS NOT NULL GROUP BY group_id
              )
              SELECT g.name AS "Group",
                     COALESCE(t.name, '(no type)') AS "Type",
                     COALESCE(mem.members, 0) AS "Members",
                     date(att.last_event) AS "Last event"
                FROM pco_groups g
                LEFT JOIN pco_group_types t ON t.org_id = g.org_id AND t.pco_id = g.group_type_id
                LEFT JOIN mem ON mem.group_id = g.pco_id
                LEFT JOIN att ON att.group_id = g.pco_id
               WHERE g.org_id = :orgId AND g.archived_at IS NULL
               ORDER BY "Members" DESC, g.name ASC`,
      },
    },
    { kind: "divider", config: { title: "Demographics — people in groups", span: 12 } },
    {
      kind: "chart",
      config: {
        title: "Membership status", chartType: "pie", span: 3,
        sql: `${GROUPS_SP}
              SELECT COALESCE(p.membership_type, '(unknown)') AS "Membership", COUNT(*) AS "People"
                FROM pco_people p JOIN sp ON sp.person_id = p.pco_id WHERE p.org_id = :orgId
               GROUP BY p.membership_type ORDER BY COUNT(*) DESC`,
      },
    },
    {
      kind: "chart",
      config: {
        title: "Age", chartType: "bar", colorByCategory: true, span: 3,
        sql: `${GROUPS_SP}
              SELECT CASE
                       WHEN p.birth_year IS NULL OR p.birth_year < 1900 THEN 'Unknown'
                       WHEN (CAST(strftime('%Y','now') AS INTEGER) - p.birth_year) < 18 THEN '<18'
                       WHEN (CAST(strftime('%Y','now') AS INTEGER) - p.birth_year) < 30 THEN '18–29'
                       WHEN (CAST(strftime('%Y','now') AS INTEGER) - p.birth_year) < 50 THEN '30–49'
                       WHEN (CAST(strftime('%Y','now') AS INTEGER) - p.birth_year) < 65 THEN '50–64'
                       ELSE '65+' END AS "Age",
                     COUNT(*) AS "People"
                FROM pco_people p JOIN sp ON sp.person_id = p.pco_id WHERE p.org_id = :orgId
               GROUP BY 1 ORDER BY MIN(${AGE_ORD})`,
      },
    },
    {
      kind: "chart",
      config: {
        title: "Gender", chartType: "bar", colorByCategory: true, span: 3,
        sql: `${GROUPS_SP}
              SELECT CASE
                       WHEN lower(coalesce(p.gender,'')) IN ('m','male') THEN 'Male'
                       WHEN lower(coalesce(p.gender,'')) IN ('f','female') THEN 'Female'
                       ELSE 'Unknown' END AS "Gender",
                     COUNT(*) AS "People"
                FROM pco_people p JOIN sp ON sp.person_id = p.pco_id WHERE p.org_id = :orgId
               GROUP BY 1`,
      },
    },
    {
      kind: "chart",
      config: {
        title: "Parents", chartType: "bar", colorByCategory: true, span: 3,
        sql: `${GROUPS_SP}
              SELECT CASE WHEN p.is_parent = 1 THEN 'Parent' ELSE 'No kids' END AS "Household",
                     COUNT(*) AS "People"
                FROM pco_people p JOIN sp ON sp.person_id = p.pco_id WHERE p.org_id = :orgId
               GROUP BY 1`,
      },
    },
  ],
};

/** Every page rebuilt from builder widgets, keyed by slug. */
export const BUILDER_SEEDS: Record<string, SeedPage> = {
  [checkinsSeed.slug]: checkinsSeed,
  [demographicsSeed.slug]: demographicsSeed,
  [groupsSeed.slug]: groupsSeed,
};

// ─── Seeder ──────────────────────────────────────────────────────────

function insertBlocks(db: ReturnType<typeof getDb>, orgId: number, pageId: number, seed: SeedPage): void {
  const insBlock = db.prepare(
    `INSERT INTO builder_blocks (page_id, org_id, position, kind, config) VALUES (?, ?, ?, ?, ?)`,
  );
  seed.blocks.forEach((b, i) => insBlock.run(pageId, orgId, i, b.kind, JSON.stringify(b.config)));
}

/** Ensure the seeded page for `slug` exists and, if it was never edited, is up
 *  to date with the current seed revision.
 *
 *  - Missing → create page + blocks at the seed's revision.
 *  - Present but PRISTINE (updated_at ≈ created_at) and the code seed advanced →
 *    replace its blocks with the new definition and stamp the new revision,
 *    keeping updated_at = created_at so future revisions can still refresh it.
 *  - Present and edited → left untouched, so admin edits always win.
 *  No-op for unknown slugs. */
export function ensureSeededPage(orgId: number, slug: string): void {
  const seed = BUILDER_SEEDS[slug];
  if (!seed) return;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, created_at AS createdAt, updated_at AS updatedAt, seed_revision AS seedRevision
         FROM builder_pages WHERE org_id = ? AND slug = ?`,
    )
    .get(orgId, slug) as
    | { id: number; createdAt: string; updatedAt: string; seedRevision: number | null }
    | undefined;

  if (!row) {
    const tx = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO builder_pages (org_id, slug, title, description, nav_section, more_section, seed_revision)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(orgId, seed.slug, seed.title, seed.description ?? null, seed.navSection ?? null, seed.moreSection ?? null, seed.revision);
      insertBlocks(db, orgId, Number(info.lastInsertRowid), seed);
    });
    tx();
    return;
  }

  const storedRev = row.seedRevision ?? 1;
  const editedSecs = Math.abs((new Date(row.updatedAt).getTime() - new Date(row.createdAt).getTime()) / 1000);
  const pristine = Number.isFinite(editedSecs) && editedSecs < 5;
  if (seed.revision > storedRev && pristine) {
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM builder_blocks WHERE page_id = ?").run(row.id);
      insertBlocks(db, orgId, row.id, seed);
      db.prepare(
        `UPDATE builder_pages SET title = ?, description = ?, seed_revision = ?, updated_at = created_at WHERE id = ?`,
      ).run(seed.title, seed.description ?? null, seed.revision, row.id);
    });
    tx();
  }
}
