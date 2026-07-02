import "server-only";
import { getDb } from "./db";
import { decryptJson } from "./encryption";

export interface CcOverview {
  contacts: number;
  linked: number;
  lists: number;
  campaigns: number;
  campaignsWithStats: number;
  activityRows: number;
  engagedPeople: number;
}

export function getCcOverview(orgId: number): CcOverview {
  const db = getDb();
  const one = (sql: string) => (db.prepare(sql).get(orgId) as { n: number }).n;
  return {
    contacts: one("SELECT COUNT(*) n FROM cc_contacts WHERE org_id = ?"),
    linked: one("SELECT COUNT(*) n FROM cc_contacts WHERE org_id = ? AND person_id IS NOT NULL"),
    lists: one("SELECT COUNT(*) n FROM cc_lists WHERE org_id = ?"),
    campaigns: one("SELECT COUNT(*) n FROM cc_campaigns WHERE org_id = ?"),
    campaignsWithStats: one("SELECT COUNT(*) n FROM cc_campaigns WHERE org_id = ? AND stat_sends IS NOT NULL"),
    activityRows: one("SELECT COUNT(*) n FROM cc_contact_activity WHERE org_id = ?"),
    engagedPeople: one(
      `SELECT COUNT(DISTINCT cc.person_id) n FROM cc_contact_activity a
         JOIN cc_contacts cc ON cc.org_id = a.org_id AND cc.contact_id = a.contact_id
        WHERE a.org_id = ? AND a.activity_type IN ('open','click') AND cc.person_id IS NOT NULL`,
    ),
  };
}

export function getConsentBreakdown(orgId: number): Array<{ permission: string; count: number }> {
  return getDb().prepare(
    `SELECT COALESCE(permission_to_send, 'unknown') AS permission, COUNT(*) AS count
       FROM cc_contacts WHERE org_id = ? GROUP BY permission ORDER BY count DESC`,
  ).all(orgId) as Array<{ permission: string; count: number }>;
}

export function getTopLists(orgId: number, limit = 25): Array<{ name: string; count: number }> {
  return getDb().prepare(
    `SELECT COALESCE(name, '(unnamed)') AS name, COALESCE(membership_count, 0) AS count
       FROM cc_lists WHERE org_id = ? ORDER BY count DESC LIMIT ?`,
  ).all(orgId, limit) as Array<{ name: string; count: number }>;
}

export interface CampaignPerf {
  name: string;
  status: string | null;
  updatedAt: string | null;
  sends: number;
  openRate: number | null;
  clickRate: number | null;
  bounceRate: number | null;
  optOutRate: number | null;
}

export function getCampaignPerformance(orgId: number, limit = 50): CampaignPerf[] {
  const rows = getDb().prepare(
    `SELECT name, current_status AS status, last_sent_date AS updatedAt,
            COALESCE(stat_sends, 0) AS sends, stat_opens AS uopens, stat_clicks AS uclicks,
            stat_bounces AS bounces, stat_optouts AS optouts
       FROM cc_campaigns
      WHERE org_id = ? AND stat_sends IS NOT NULL
      ORDER BY last_sent_date DESC LIMIT ?`,
  ).all(orgId, limit) as Array<{ name: string | null; status: string | null; updatedAt: string | null; sends: number; uopens: number | null; uclicks: number | null; bounces: number | null; optouts: number | null }>;
  const rate = (num: number | null, den: number) => (den > 0 && num != null ? num / den : null);
  return rows.map((r) => ({
    name: r.name ?? "(unnamed)",
    status: r.status,
    updatedAt: r.updatedAt,
    sends: r.sends,
    openRate: rate(r.uopens, r.sends),
    clickRate: rate(r.uclicks, r.sends),
    bounceRate: rate(r.bounces, r.sends),
    optOutRate: rate(r.optouts, r.sends),
  }));
}

export function getTopEngaged(orgId: number, limit = 25): Array<{ name: string; opens: number; clicks: number }> {
  const rows = getDb().prepare(
    `SELECT cc.person_id AS personId,
            SUM(CASE WHEN a.activity_type = 'open' THEN 1 ELSE 0 END) AS opens,
            SUM(CASE WHEN a.activity_type = 'click' THEN 1 ELSE 0 END) AS clicks
       FROM cc_contact_activity a
       JOIN cc_contacts cc ON cc.org_id = a.org_id AND cc.contact_id = a.contact_id
      WHERE a.org_id = ? AND cc.person_id IS NOT NULL
      GROUP BY cc.person_id
      ORDER BY (opens + clicks) DESC LIMIT ?`,
  ).all(orgId, limit) as Array<{ personId: string; opens: number; clicks: number }>;
  const nameStmt = getDb().prepare("SELECT enc_pii FROM pco_people WHERE org_id = ? AND pco_id = ?");
  return rows.map((r) => {
    const row = nameStmt.get(orgId, r.personId) as { enc_pii: string | null } | undefined;
    const pii = row ? decryptJson<{ first_name?: string; last_name?: string }>(row.enc_pii) : null;
    const name = pii ? `${pii.first_name ?? ""} ${pii.last_name ?? ""}`.trim() || "(unknown)" : "(unknown)";
    return { name, opens: r.opens, clicks: r.clicks };
  });
}

export interface NextStepEffect {
  engagedClasses: Record<string, number>;
  notEngagedClasses: Record<string, number>;
  engagedTotal: number;
  notEngagedTotal: number;
  engagedActivePct: number | null;
  notEngagedActivePct: number | null;
}

export interface Slice { label: string; value: number }

/** Engagement tiers of the people on the church's main list (best-guess "all
 *  church" list: a name match, else the largest). Tier from per-contact opens/clicks. */
export function getAllChurchTiers(orgId: number): { listName: string | null; data: Slice[] } {
  const db = getDb();
  const list = db.prepare(
    `SELECT list_id, name FROM cc_lists WHERE org_id = ?
      ORDER BY (CASE WHEN lower(name) LIKE '%all%church%' THEN 0 WHEN lower(name) LIKE '%all%' THEN 1 ELSE 2 END),
               COALESCE(membership_count, 0) DESC LIMIT 1`,
  ).get(orgId) as { list_id: string; name: string } | undefined;
  if (!list) return { listName: null, data: [] };
  const rows = db.prepare(
    `WITH members AS (SELECT contact_id FROM cc_contact_lists WHERE org_id = @org AND list_id = @lid),
      eng AS (
        SELECT contact_id, MAX(activity_type = 'click') AS clicked, MAX(activity_type IN ('open','click')) AS opened
          FROM cc_contact_activity WHERE org_id = @org GROUP BY contact_id
      )
      SELECT CASE WHEN e.clicked = 1 THEN 'Clicked a link'
                  WHEN e.opened = 1 THEN 'Opened only'
                  ELSE 'No opens/clicks' END AS tier, COUNT(*) AS n
        FROM members m LEFT JOIN eng e ON e.contact_id = m.contact_id
       GROUP BY tier`,
  ).all({ org: orgId, lid: list.list_id }) as Array<{ tier: string; n: number }>;
  const order = ["Clicked a link", "Opened only", "No opens/clicks"];
  const map = new Map(rows.map((r) => [r.tier, r.n]));
  return { listName: list.name, data: order.map((t) => ({ label: t, value: map.get(t) ?? 0 })).filter((d) => d.value > 0) };
}

/** Of the church's engaged people (shepherded / active / present in PCO), how
 *  many are reachable in Constant Contact vs not — an email-coverage gap. */
export function getEngagedCcCoverage(orgId: number): { data: Slice[]; inCc: number; gap: number; total: number } {
  const rows = getDb().prepare(
    `SELECT CASE WHEN cc.pid IS NOT NULL THEN 'In Constant Contact' ELSE 'Not in Constant Contact' END AS grp, COUNT(*) AS n
       FROM person_activity pa
       LEFT JOIN (SELECT DISTINCT person_id AS pid FROM cc_contacts WHERE org_id = @org AND person_id IS NOT NULL) cc
         ON cc.pid = pa.person_id
      WHERE pa.org_id = @org AND pa.classification IN ('shepherded','active','present')
      GROUP BY grp`,
  ).all({ org: orgId }) as Array<{ grp: string; n: number }>;
  const inCc = rows.find((r) => r.grp === "In Constant Contact")?.n ?? 0;
  const gap = rows.find((r) => r.grp === "Not in Constant Contact")?.n ?? 0;
  return { data: rows.map((r) => ({ label: r.grp, value: r.n })), inCc, gap, total: inCc + gap };
}

/** Most-clicked links across all synced campaigns. */
export function getTopClickedLinks(orgId: number, limit = 15): Array<{ url: string; clicks: number }> {
  return getDb().prepare(
    `SELECT link_url AS url, COUNT(*) AS clicks FROM cc_contact_activity
      WHERE org_id = ? AND activity_type = 'click' AND link_url <> ''
      GROUP BY link_url ORDER BY clicks DESC LIMIT ?`,
  ).all(orgId, limit) as Array<{ url: string; clicks: number }>;
}

/** Goal (d): do people who engage with our email take next steps more? Compares
 *  the PCO activity classification of email-engaged vs non-engaged linked people. */
export function getNextStepEffectiveness(orgId: number): NextStepEffect {
  const rows = getDb().prepare(
    `WITH linked AS (
        SELECT DISTINCT person_id AS pid FROM cc_contacts WHERE org_id = @org AND person_id IS NOT NULL
      ),
      engaged AS (
        SELECT DISTINCT cc.person_id AS pid FROM cc_contact_activity a
          JOIN cc_contacts cc ON cc.org_id = a.org_id AND cc.contact_id = a.contact_id
         WHERE a.org_id = @org AND a.activity_type IN ('open','click') AND cc.person_id IS NOT NULL
      )
      SELECT CASE WHEN e.pid IS NOT NULL THEN 'engaged' ELSE 'not' END AS grp,
             COALESCE(pa.classification, 'unknown') AS classification,
             COUNT(*) AS n
        FROM linked l
        LEFT JOIN engaged e ON e.pid = l.pid
        JOIN person_activity pa ON pa.org_id = @org AND pa.person_id = l.pid
       GROUP BY grp, classification`,
  ).all({ org: orgId }) as Array<{ grp: string; classification: string; n: number }>;

  const engagedClasses: Record<string, number> = {};
  const notEngagedClasses: Record<string, number> = {};
  for (const r of rows) (r.grp === "engaged" ? engagedClasses : notEngagedClasses)[r.classification] = r.n;
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  const active = (o: Record<string, number>) => (o.shepherded ?? 0) + (o.active ?? 0);
  const engagedTotal = sum(engagedClasses);
  const notEngagedTotal = sum(notEngagedClasses);
  return {
    engagedClasses,
    notEngagedClasses,
    engagedTotal,
    notEngagedTotal,
    engagedActivePct: engagedTotal ? active(engagedClasses) / engagedTotal : null,
    notEngagedActivePct: notEngagedTotal ? active(notEngagedClasses) / notEngagedTotal : null,
  };
}
