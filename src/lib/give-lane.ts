import "server-only";
import { cache } from "react";
import { getDb } from "./db";
import { decryptJson } from "./encryption";
import {
  LAPSE_DAYS,
  givingMethodCase,
  givingPattern,
  lapseCutoff,
  PATTERN_LAPSED,
} from "./giving-sql";

interface PIIBlob {
  first_name?: string | null;
  last_name?: string | null;
}

export interface GiveLaneStats {
  /** Distinct people linked to at least one gift in the window. */
  givers: number;
  /** Givers with at least one gift PushPay recorded as Recurring. */
  recurring: number;
  /** Givers with no gift in the last LAPSE_DAYS days of the window. */
  lapsed: number;
  /** Givers whose FIRST gift in the window is in its last LAPSE_DAYS days. */
  firstSeen: number;
  /** PushPay payer ids with no person behind them yet. */
  unlinkedPayers: number;
  /** Gifts in the window. A count of gifts — never an amount. */
  gifts: number;
  /** First and last gift date the loaded export covers, or null before any
   *  Transactions import. Every giving surface has to print these. */
  windowStart: string | null;
  windowEnd: string | null;
}

/** How many days of silence reads as lapsed, for the pages' own copy. */
export const GIVE_LANE_LAPSE_DAYS = LAPSE_DAYS;

/** Per-person rollup of the per-payer rollup. One person can hold more than
 *  one PushPay payer id — a household giving from two cards — so every
 *  person-level number here aggregates the payer rows first. */
const PER_PERSON = `
  SELECT person_id AS pid,
         MIN(first_gift_on)   AS firstGift,
         MAX(last_gift_on)    AS lastGift,
         SUM(gifts)           AS gifts,
         SUM(recurring_gifts) AS recurringGifts
    FROM pushpay_payer_summary
   WHERE org_id = @orgId AND person_id IS NOT NULL
   GROUP BY person_id`;

/** Headline counts for the Give lane, from the PushPay Transactions import.
 *
 *  All of it comes from `pushpay_payer_summary`, the per-payer rollup of
 *  `pushpay_transactions` (0098), except the gift total and the window, which
 *  come from its snapshot row. What "recurring", "lapsed" and "first seen"
 *  mean here — and why they are our words rather than PushPay's donor stages,
 *  which came from the All Donors export and are gone — is set out at the top
 *  of giving-sql.ts. The short version: recurring is a gift PushPay sourced as
 *  'Recurring'; lapsed is no gift in the 90 days to the last gift in the data,
 *  and cannot see anyone who stopped before the window opened; first seen is a
 *  first gift inside those same 90 days, so it means new to this import, not
 *  new to the church. Nothing here is money: the export carries no amounts. */
export function getGiveLaneStats(orgId: number): GiveLaneStats {
  const r = getDb()
    .prepare(
      `WITH me AS (${PER_PERSON}), cut AS (SELECT ${lapseCutoff("@orgId")} AS d)
       SELECT COUNT(*) AS givers,
              COALESCE(SUM(CASE WHEN me.recurringGifts > 0 THEN 1 ELSE 0 END), 0) AS recurring,
              COALESCE(SUM(CASE WHEN me.lastGift  <  cut.d THEN 1 ELSE 0 END), 0) AS lapsed,
              COALESCE(SUM(CASE WHEN me.firstGift >= cut.d THEN 1 ELSE 0 END), 0) AS firstSeen
         FROM me, cut`,
    )
    .get({ orgId }) as {
    givers: number | null;
    recurring: number | null;
    lapsed: number | null;
    firstSeen: number | null;
  };
  const w = getDb()
    .prepare(
      `SELECT s.gifts AS gifts, s.first_gift_on AS windowStart, s.last_gift_on AS windowEnd,
              (SELECT COUNT(*) FROM pushpay_payer_summary
                WHERE org_id = s.org_id AND person_id IS NULL) AS unlinkedPayers
         FROM pushpay_giving_snapshot s WHERE s.org_id = ?`,
    )
    .get(orgId) as
    | {
        gifts: number;
        windowStart: string | null;
        windowEnd: string | null;
        unlinkedPayers: number;
      }
    | undefined;
  return {
    givers: r.givers ?? 0,
    recurring: r.recurring ?? 0,
    lapsed: r.lapsed ?? 0,
    firstSeen: r.firstSeen ?? 0,
    unlinkedPayers: w?.unlinkedPayers ?? 0,
    gifts: w?.gifts ?? 0,
    windowStart: w?.windowStart ?? null,
    windowEnd: w?.windowEnd ?? null,
  };
}

export interface GivingPersonRow {
  pcoId: string;
  fullName: string;
  initials: string;
  membershipType: string | null;
  /** Recurring schedule / One gift at a time / Lapsed — our words, worked out
   *  from the gifts. See giving-sql.ts. */
  pattern: string;
  /** True when `pattern` is the lapsed one, so callers never match on text. */
  lapsed: boolean;
  /** Funds this person's gifts were designated to, comma-separated. */
  funds: string | null;
  /** Online / Check or cash / Both, counted once per person. */
  method: string;
  firstGiftDate: string | null;
  lastGiftDate: string | null;
  /** Gifts from this person in the window. A count, not an amount. */
  gifts: number;
}

/** `order`: most recent first for the directory, longest silent first for the
 *  reconnect list. Both are bounded by `limit`, so they cannot be the same
 *  query sorted twice — at 1,113 givers, taking the 1,000 most recent and then
 *  filtering to the lapsed ones would drop exactly the people the reconnect
 *  list is for. */
function loadGivers(
  orgId: number,
  limit: number,
  order: "recent" | "quietest",
  lapsedOnly: boolean,
): GivingPersonRow[] {
  const db = getDb();
  const cutoff = (
    db.prepare(`SELECT ${lapseCutoff("?")} AS cutoff`).get(orgId) as {
      cutoff: string | null;
    }
  ).cutoff;

  const rows = db
    .prepare(
      `WITH me AS (${PER_PERSON}), cut AS (SELECT ${lapseCutoff("@orgId")} AS d),
       picked AS (
         SELECT me.* FROM me, cut
          WHERE (@lapsedOnly = 0 OR (cut.d IS NOT NULL AND me.lastGift < cut.d))
          ORDER BY CASE WHEN @quietest = 1 THEN me.lastGift END ASC,
                   CASE WHEN @quietest = 0 THEN me.lastGift END DESC,
                   me.pid
          LIMIT @limit
       )
       SELECT m.pid AS pcoId, m.firstGift AS firstGiftDate, m.lastGift AS lastGiftDate,
              m.gifts, m.recurringGifts,
              p.first_name AS firstName, p.last_name AS lastName,
              p.enc_pii AS encPii, p.membership_type AS membershipType,
              (SELECT group_concat(DISTINCT t.fund_name)
                 FROM pushpay_transactions t
                WHERE t.org_id = @orgId AND t.person_id = m.pid
                  AND t.fund_name IS NOT NULL AND t.fund_name <> '') AS funds,
              (SELECT ${givingMethodCase(
                `MAX(CASE WHEN t.source = 'Batch Entry' THEN 1 ELSE 0 END)`,
                `MAX(CASE WHEN t.source IS NULL OR t.source <> 'Batch Entry' THEN 1 ELSE 0 END)`,
              )}
                 FROM pushpay_transactions t
                WHERE t.org_id = @orgId AND t.person_id = m.pid) AS method
         FROM picked m
         JOIN pco_people p ON p.org_id = @orgId AND p.pco_id = m.pid
        ORDER BY CASE WHEN @quietest = 1 THEN m.lastGift END ASC,
                 CASE WHEN @quietest = 0 THEN m.lastGift END DESC,
                 m.pid`,
    )
    .all({
      orgId,
      limit,
      quietest: order === "quietest" ? 1 : 0,
      lapsedOnly: lapsedOnly ? 1 : 0,
    }) as Array<{
    pcoId: string;
    firstGiftDate: string | null;
    lastGiftDate: string | null;
    gifts: number;
    recurringGifts: number;
    firstName: string | null;
    lastName: string | null;
    encPii: string | null;
    membershipType: string | null;
    funds: string | null;
    method: string | null;
  }>;

  return rows.map((r) => {
    // Names are plaintext since 0097; enc_pii is only a fallback for a record
    // written before it and never re-synced since.
    let f = r.firstName;
    let l = r.lastName;
    if (f == null && l == null && r.encPii) {
      const pii = decryptJson<PIIBlob>(r.encPii);
      f = pii?.first_name ?? null;
      l = pii?.last_name ?? null;
    }
    const pattern = givingPattern(r.lastGiftDate, r.recurringGifts, cutoff);
    return {
      pcoId: r.pcoId,
      fullName: [f, l].filter(Boolean).join(" ") || `(unknown #${r.pcoId})`,
      initials: ((f?.[0] ?? "") + (l?.[0] ?? "")).toUpperCase() || "??",
      membershipType: r.membershipType,
      pattern,
      lapsed: pattern === PATTERN_LAPSED,
      funds: r.funds,
      method: r.method ?? "",
      firstGiftDate: r.firstGiftDate,
      lastGiftDate: r.lastGiftDate,
      gifts: r.gifts,
    };
  });
}

/** People who have given, one row per person, most recent gift first. Powers
 *  the Give lane person list and the giving page's directory. Memoized per
 *  (orgId, limit) within a request. */
export const listGivingPeople = cache((orgId: number, limit = 50): GivingPersonRow[] =>
  loadGivers(orgId, limit, "recent", false),
);

/** Givers who have gone quiet, longest silence first — the reconnect worklist.
 *  See giving-sql.ts: this can only see people who gave inside the loaded
 *  window and then stopped, never anyone who stopped before it opened. */
export const listLapsedGivers = cache((orgId: number, limit = 50): GivingPersonRow[] =>
  loadGivers(orgId, limit, "quietest", true),
);
