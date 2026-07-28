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
  blocks: [
    {
      kind: "stat",
      config: {
        title: "This week",
        span: 3,
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
        sub: "hidden from this page",
        sql: `SELECT COUNT(*) FROM (${EXCLUDED_CHECKIN_EVENTS})`,
      },
    },
    {
      kind: "table",
      config: {
        title: "Check-in events",
        span: 6,
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

/** Every page rebuilt from builder widgets, keyed by slug. */
export const BUILDER_SEEDS: Record<string, SeedPage> = {
  [checkinsSeed.slug]: checkinsSeed,
};

// ─── Seeder ──────────────────────────────────────────────────────────

/** Create the seeded page + blocks for `slug` if the org doesn't have it yet.
 *  Idempotent and non-destructive: once the page exists (seeded or edited), it
 *  is left untouched so admin edits always win. No-op for unknown slugs. */
export function seedPageIfMissing(orgId: number, slug: string): void {
  const seed = BUILDER_SEEDS[slug];
  if (!seed) return;
  const db = getDb();
  const existing = db
    .prepare("SELECT 1 FROM builder_pages WHERE org_id = ? AND slug = ?")
    .get(orgId, slug);
  if (existing) return;

  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO builder_pages (org_id, slug, title, description, nav_section, more_section)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(orgId, seed.slug, seed.title, seed.description ?? null, seed.navSection ?? null, seed.moreSection ?? null);
    const pageId = Number(info.lastInsertRowid);
    const insBlock = db.prepare(
      `INSERT INTO builder_blocks (page_id, org_id, position, kind, config)
       VALUES (?, ?, ?, ?, ?)`,
    );
    seed.blocks.forEach((b, i) => insBlock.run(pageId, orgId, i, b.kind, JSON.stringify(b.config)));
  });
  tx();
}
