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
export interface Series { columns: string[]; rows: Array<Array<string | number>> }
export interface PersonRow { name: string; detail: string }

function personName(orgId: number, personId: string): string {
  const row = getDb().prepare("SELECT enc_pii FROM pco_people WHERE org_id = ? AND pco_id = ?").get(orgId, personId) as { enc_pii: string | null } | undefined;
  const pii = row ? decryptJson<{ first_name?: string; last_name?: string }>(row.enc_pii) : null;
  return pii ? `${pii.first_name ?? ""} ${pii.last_name ?? ""}`.trim() || "(unknown)" : "(unknown)";
}
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Click-to-open rate: of people who opened, what share clicked. */
export function getCtor(orgId: number): { openers: number; clickers: number; ctor: number | null } {
  const db = getDb();
  const d = (t: string) => (db.prepare("SELECT COUNT(DISTINCT contact_id) n FROM cc_contact_activity WHERE org_id = ? AND activity_type = ?").get(orgId, t) as { n: number }).n;
  const openers = d("open"), clickers = d("click");
  return { openers, clickers, ctor: openers > 0 ? clickers / openers : null };
}

/** Open % and click % by month of send. */
export function getRateOverTime(orgId: number): Series {
  const rows = getDb().prepare(
    `SELECT substr(last_sent_date,1,7) AS m, SUM(stat_sends) AS sends, SUM(stat_opens) AS opens, SUM(stat_clicks) AS clicks
       FROM cc_campaigns WHERE org_id = ? AND stat_sends > 0 AND last_sent_date IS NOT NULL
      GROUP BY m ORDER BY m DESC LIMIT 24`,
  ).all(orgId) as Array<{ m: string; sends: number; opens: number; clicks: number }>;
  return {
    columns: ["Month", "Open %", "Click %"],
    rows: rows.reverse().map((r) => [r.m, round1((r.opens / r.sends) * 100), round1((r.clicks / r.sends) * 100)]),
  };
}

/** New Constant Contact contacts by month. */
export function getSubscriberGrowth(orgId: number): Slice[] {
  return (getDb().prepare(
    `SELECT substr(created_at,1,7) AS m, COUNT(*) AS n FROM cc_contacts
      WHERE org_id = ? AND created_at IS NOT NULL GROUP BY m ORDER BY m DESC LIMIT 24`,
  ).all(orgId) as Array<{ m: string; n: number }>).reverse().map((r) => ({ label: r.m, value: r.n }));
}

/** Opens by day of week — when people read our email. */
export function getOpensByDow(orgId: number): Slice[] {
  const rows = getDb().prepare(
    `SELECT CAST(strftime('%w', activity_time) AS INTEGER) AS dow, COUNT(*) AS n
       FROM cc_contact_activity WHERE org_id = ? AND activity_type = 'open' AND activity_time IS NOT NULL GROUP BY dow`,
  ).all(orgId) as Array<{ dow: number; n: number }>;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const map = new Map(rows.map((r) => [r.dow, r.n]));
  return days.map((d, i) => ({ label: d, value: map.get(i) ?? 0 }));
}

/** Bounces and opt-outs by month. */
export function getBounceOptoutOverTime(orgId: number): Series {
  const rows = getDb().prepare(
    `SELECT substr(last_sent_date,1,7) AS m, SUM(stat_bounces) AS b, SUM(stat_optouts) AS o
       FROM cc_campaigns WHERE org_id = ? AND stat_sends > 0 AND last_sent_date IS NOT NULL
      GROUP BY m ORDER BY m DESC LIMIT 24`,
  ).all(orgId) as Array<{ m: string; b: number; o: number }>;
  return { columns: ["Month", "Bounces", "Opt-outs"], rows: rows.reverse().map((r) => [r.m, r.b ?? 0, r.o ?? 0]) };
}

/** Performance by campaign type (Newsletter, etc.). */
export function getCampaignTypePerf(orgId: number): Array<{ type: string; campaigns: number; openRate: number | null; clickRate: number | null }> {
  const rows = getDb().prepare(
    `SELECT COALESCE(type,'(none)') AS type, COUNT(*) AS campaigns, SUM(stat_sends) AS sends, SUM(stat_opens) AS opens, SUM(stat_clicks) AS clicks
       FROM cc_campaigns WHERE org_id = ? AND stat_sends > 0 GROUP BY type ORDER BY sends DESC`,
  ).all(orgId) as Array<{ type: string; campaigns: number; sends: number; opens: number; clicks: number }>;
  return rows.map((r) => ({ type: r.type, campaigns: r.campaigns, openRate: r.sends ? r.opens / r.sends : null, clickRate: r.sends ? r.clicks / r.sends : null }));
}

/** Engaged church people (shepherded/active/present) who are NOT in Constant Contact. */
export function getReachGapPeople(orgId: number, limit = 20): PersonRow[] {
  const rows = getDb().prepare(
    `SELECT pa.person_id AS pid, pa.classification AS cls FROM person_activity pa
      WHERE pa.org_id = ? AND pa.classification IN ('shepherded','active','present')
        AND pa.person_id NOT IN (SELECT person_id FROM cc_contacts WHERE org_id = ? AND person_id IS NOT NULL)
      LIMIT ?`,
  ).all(orgId, orgId, limit) as Array<{ pid: string; cls: string }>;
  return rows.map((r) => ({ name: personName(orgId, r.pid), detail: r.cls }));
}

/** Engaged church people who ARE in CC but have never opened an email (in synced tracking). */
export function getActiveNeverOpen(orgId: number, limit = 20): PersonRow[] {
  const rows = getDb().prepare(
    `SELECT DISTINCT cc.person_id AS pid, pa.classification AS cls FROM cc_contacts cc
       JOIN person_activity pa ON pa.org_id = cc.org_id AND pa.person_id = cc.person_id
      WHERE cc.org_id = ? AND cc.person_id IS NOT NULL AND pa.classification IN ('shepherded','active','present')
        AND cc.person_id NOT IN (
          SELECT c2.person_id FROM cc_contact_activity a JOIN cc_contacts c2 ON c2.org_id = a.org_id AND c2.contact_id = a.contact_id
           WHERE a.org_id = ? AND a.activity_type = 'open' AND c2.person_id IS NOT NULL)
      LIMIT ?`,
  ).all(orgId, orgId, limit) as Array<{ pid: string; cls: string }>;
  return rows.map((r) => ({ name: personName(orgId, r.pid), detail: r.cls }));
}

/** People who engage with our email but aren't in a group or on a team — warm next-step targets. */
export function getEngagedNotInGroup(orgId: number, limit = 20): PersonRow[] {
  const rows = getDb().prepare(
    `SELECT cc.person_id AS pid, COUNT(*) AS acts FROM cc_contact_activity a
       JOIN cc_contacts cc ON cc.org_id = a.org_id AND cc.contact_id = a.contact_id
       JOIN person_activity pa ON pa.org_id = cc.org_id AND pa.person_id = cc.person_id
      WHERE a.org_id = ? AND a.activity_type IN ('open','click') AND cc.person_id IS NOT NULL
        AND COALESCE(pa.active_group_count,0) = 0 AND COALESCE(pa.active_team_count,0) = 0
      GROUP BY cc.person_id ORDER BY acts DESC LIMIT ?`,
  ).all(orgId, limit) as Array<{ pid: string; acts: number }>;
  return rows.map((r) => ({ name: personName(orgId, r.pid), detail: `${r.acts} opens/clicks` }));
}

/** Long-subscribed contacts with no opens in synced tracking — a win-back audience. */
export function getWinBack(orgId: number, limit = 20): { count: number; people: PersonRow[] } {
  const cutoff = new Date(Date.now() - 6 * 30 * 24 * 60 * 60 * 1000).toISOString();
  const db = getDb();
  const base = `FROM cc_contacts cc WHERE cc.org_id = ? AND cc.created_at IS NOT NULL AND cc.created_at < ?
     AND NOT EXISTS (SELECT 1 FROM cc_contact_activity a WHERE a.org_id = cc.org_id AND a.contact_id = cc.contact_id AND a.activity_type = 'open')`;
  const count = (db.prepare(`SELECT COUNT(*) n ${base}`).get(orgId, cutoff) as { n: number }).n;
  const rows = db.prepare(`SELECT cc.person_id AS pid ${base} AND cc.person_id IS NOT NULL LIMIT ?`).all(orgId, cutoff, limit) as Array<{ pid: string }>;
  return { count, people: rows.map((r) => ({ name: personName(orgId, r.pid), detail: "no opens" })) };
}

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
