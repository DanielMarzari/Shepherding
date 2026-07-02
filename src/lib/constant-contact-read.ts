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
    campaignsWithStats: one("SELECT COUNT(*) n FROM cc_campaign_stats WHERE org_id = ?"),
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
    `SELECT c.name, c.current_status AS status, c.updated_at AS updatedAt,
            COALESCE(st.sends, 0) AS sends, st.unique_opens AS uopens, st.unique_clicks AS uclicks,
            st.bounces, st.opt_outs AS optouts
       FROM cc_campaigns c
       JOIN cc_campaign_stats st ON st.org_id = c.org_id AND st.campaign_activity_id = c.campaign_activity_id
      WHERE c.org_id = ?
      ORDER BY c.updated_at DESC LIMIT ?`,
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
