import "server-only";
import { getDb } from "./db";
import { decryptJson } from "./encryption";

interface PIIBlob {
  first_name?: string | null;
  last_name?: string | null;
}

export interface GiveLaneStats {
  /** Distinct people matched to at least one imported gift. */
  givers: number;
  /** Givers whose donor stage reads as recurring / regular. */
  recurring: number;
  /** Givers whose donor stage reads as lapsed. */
  lapsed: number;
  /** Givers whose donor stage reads as first-time / new. */
  firstTime: number;
  /** Imported donor rows not yet tied to a person (ambiguous + unmatched). */
  unlinked: number;
  /** Total donor rows in the last import. */
  totalDonors: number;
}

/** Headline counts for the Give lane, all from the imported PushPay set.
 *  Stage buckets are matched loosely (LIKE) because the export's "Donor
 *  Stage" wording varies (Recurring / Regular Giver / Lapsed Donor / …). */
export function getGiveLaneStats(orgId: number): GiveLaneStats {
  const r = getDb()
    .prepare(
      `SELECT
         COUNT(DISTINCT CASE WHEN person_id IS NOT NULL THEN person_id END) AS givers,
         COUNT(DISTINCT CASE WHEN person_id IS NOT NULL AND (lower(donor_stage) LIKE '%recurring%' OR lower(donor_stage) LIKE '%regular%') THEN person_id END) AS recurring,
         COUNT(DISTINCT CASE WHEN person_id IS NOT NULL AND lower(donor_stage) LIKE '%lapsed%' THEN person_id END) AS lapsed,
         COUNT(DISTINCT CASE WHEN person_id IS NOT NULL AND (lower(donor_stage) LIKE '%first%' OR lower(donor_stage) LIKE '%new%') THEN person_id END) AS firstTime,
         SUM(CASE WHEN person_id IS NULL THEN 1 ELSE 0 END) AS unlinked,
         COUNT(*) AS totalDonors
       FROM pushpay_donors WHERE org_id = ?`,
    )
    .get(orgId) as {
    givers: number | null;
    recurring: number | null;
    lapsed: number | null;
    firstTime: number | null;
    unlinked: number | null;
    totalDonors: number | null;
  };
  return {
    givers: r.givers ?? 0,
    recurring: r.recurring ?? 0,
    lapsed: r.lapsed ?? 0,
    firstTime: r.firstTime ?? 0,
    unlinked: r.unlinked ?? 0,
    totalDonors: r.totalDonors ?? 0,
  };
}

export interface GivingPersonRow {
  pcoId: string;
  fullName: string;
  initials: string;
  membershipType: string | null;
  stage: string | null;
  fund: string | null;
  channel: string | null;
  lastGiftDate: string | null;
  /** Donor rows tied to this person (usually 1; >1 for shared-email households). */
  gifts: number;
}

/** People who have given, one row per person (latest gift wins), most
 *  recent first. Powers the Give lane person list. */
export function listGivingPeople(orgId: number, limit = 50): GivingPersonRow[] {
  const rows = getDb()
    .prepare(
      `WITH ranked AS (
         SELECT
           d.person_id     AS pcoId,
           d.donor_stage   AS stage,
           d.last_gift_fund AS fund,
           d.giving_channel AS channel,
           d.last_gift_date AS lastGiftDate,
           ROW_NUMBER() OVER (PARTITION BY d.person_id ORDER BY d.last_gift_date DESC) AS rn,
           COUNT(*)     OVER (PARTITION BY d.person_id) AS gifts
         FROM pushpay_donors d
         WHERE d.org_id = ? AND d.person_id IS NOT NULL
       )
       SELECT r.pcoId, r.stage, r.fund, r.channel, r.lastGiftDate, r.gifts,
              p.enc_pii AS encPii, p.membership_type AS membershipType
       FROM ranked r
       JOIN pco_people p ON p.org_id = ? AND p.pco_id = r.pcoId
       WHERE r.rn = 1
       ORDER BY r.lastGiftDate DESC NULLS LAST, r.pcoId
       LIMIT ?`,
    )
    .all(orgId, orgId, limit) as Array<{
    pcoId: string;
    stage: string | null;
    fund: string | null;
    channel: string | null;
    lastGiftDate: string | null;
    gifts: number;
    encPii: string | null;
    membershipType: string | null;
  }>;

  return rows.map((r) => {
    const pii = r.encPii ? decryptJson<PIIBlob>(r.encPii) : null;
    const f = pii?.first_name ?? null;
    const l = pii?.last_name ?? null;
    return {
      pcoId: r.pcoId,
      fullName: [f, l].filter(Boolean).join(" ") || `(unknown #${r.pcoId})`,
      initials: ((f?.[0] ?? "") + (l?.[0] ?? "")).toUpperCase() || "??",
      membershipType: r.membershipType,
      stage: r.stage,
      fund: r.fund,
      channel: r.channel,
      lastGiftDate: r.lastGiftDate,
      gifts: r.gifts,
    };
  });
}
