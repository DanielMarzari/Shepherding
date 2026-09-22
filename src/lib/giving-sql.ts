// Giving, expressed in gifts rather than in PushPay's donor stages.
//
// WHY THIS FILE EXISTS. Every giving surface used to read `pushpay_donors`,
// one row per donor from PushPay's "All Donors" export, carrying that export's
// own `donor_stage` ("Recurring Donor", "Lapsed Donor", "First Time Donor").
// That table was emptied on 2026-09-22 and is not coming back: the export has
// no stable donor id, so it could never be re-matched reliably. The giving
// source from here on is the TRANSACTIONS export — one row per gift, with
// PushPay's Payer ID — stored in `pushpay_transactions` and rolled up per
// payer into `pushpay_payer_summary` (0098).
//
// TWO THINGS TO KNOW BEFORE READING ANY NUMBER BELOW.
//
//  1. NO AMOUNTS EXIST. The Transactions export carries no dollar figure at
//     all. Everything here is a count of gifts, a count of people, a date, a
//     channel or a fund. Nothing on any giving surface may be phrased as, or
//     rendered as, money — axis labels and subtitles included.
//
//  2. THE WINDOW IS NOT ALL OF HISTORY. The loaded export covers a span the
//     rollup records in `pushpay_giving_snapshot` (1 Jan – 16 Sep 2026 today).
//     Nobody who stopped giving before that span has a row anywhere, so no
//     count here can be read as "of the whole church, ever". Every giving
//     surface prints the span for exactly this reason.
//
// HOW THE OLD DONOR STAGES ARE EXPRESSED NOW. These are OUR words, worked out
// from the gifts. They are deliberately not PushPay's stage names: PushPay
// computed those over its own full history with its own thresholds, and
// printing "Recurring Donor" next to a number we derived differently would
// claim a provenance we no longer have.
//
//  * RECURRING — has at least one gift whose PushPay Source is 'Recurring',
//    i.e. a schedule set up in advance. Straightforward and exact: the source
//    is on the gift. Note that a recurring gift cannot respond to anything
//    said on a given Sunday; it was arranged weeks earlier.
//
//  * LAPSED — no gift in the LAPSE_DAYS (90) days up to the last gift in the
//    loaded data. Three reasons for that shape:
//      - 90 days, because the giving here is overwhelmingly monthly or
//        per-paycheque (8,890 of 16,574 gifts are Recurring). One missed month
//        is noise; three consecutive is the first point at which "stopped" is
//        likelier than "between gifts".
//      - Measured back from the last gift in the DATA, not from today, because
//        the import lags reality. Batch Entry (cash or cheque keyed in
//        afterwards) lands days to weeks late, and the export itself is
//        uploaded by hand. Anchoring to `now` would quietly relabel everyone as
//        lapsed in the gap between the last upload and today.
//      - IT CANNOT SEE ANYONE WHO LAPSED BEFORE THE WINDOW. Someone who gave
//        for years and stopped in 2025 has no gift row at all, so they are not
//        counted as lapsed — they are simply absent. This number is "givers
//        inside the window who have since gone quiet", never "everyone who ever
//        stopped giving".
//
//  * FIRST SEEN / NEW — first gift inside the same trailing LAPSE_DAYS window.
//    Again bounded by the data: someone who gave in 2025, paused, and gave
//    again in August looks new here, because the window starts in January.
//    "New to this import" is the honest reading, not "new to the church".
//
// GIVER means a person, not a payer: a PushPay payer id linked to a
// `pco_people` record. 1,669 payers, 1,121 of them linked, resolve to 1,113
// people — a household can hold two payer ids for one person.
//
// One more join in every payer-level count: `pushpay_payer_summary` is built
// from every gift row, including the ~123 still marked 'Processing'. The
// gift-level blocks on the MIR Finance page filter to Status = 'Success' and
// so run about 0.7% lower. Both are defensible; they are not the same number.

/** Days of silence before a giver reads as lapsed, and the width of the
 *  trailing window a "new" giver's first gift must fall inside. See the note
 *  above for why 90 and why it is measured from the data's last gift. */
export const LAPSE_DAYS = 90;

/** The org's gift window, as the rollup recorded it. `org` is the SQL
 *  expression naming the org — `:orgId` in stored builder SQL, `?`/`@orgId` in
 *  application queries. */
export const lastGiftOn = (org = ":orgId") =>
  `(SELECT last_gift_on FROM pushpay_giving_snapshot WHERE org_id = ${org})`;

/** The date a giver must have given on or after to count as still giving. */
export const lapseCutoff = (org = ":orgId") =>
  `(SELECT date(last_gift_on, '-${LAPSE_DAYS} day') FROM pushpay_giving_snapshot WHERE org_id = ${org})`;

/** "first gift to last gift" for the org, as a scalar expression: for a row
 *  label that has to name the window it counts. Never NULL — before the first
 *  Transactions import there is no snapshot row at all, and a NULL here would
 *  concatenate a bar label away to nothing. Em-dash free so it reads the same
 *  in a stat card, a bar label and a CSV export. */
export const givingWindow = (org = ":orgId") =>
  `COALESCE((SELECT COALESCE(first_gift_on, '(none)') || ' to ' || COALESCE(last_gift_on, '(none)')
              FROM pushpay_giving_snapshot WHERE org_id = ${org}), 'no gifts imported')`;

/** The same as a whole statement, for the window line every giving surface has
 *  to print. */
export const givingWindowLabel = (org = ":orgId") => `SELECT ${givingWindow(org)}`;

/** The three giving patterns. One spelling, used by the SQL below and by the
 *  TypeScript that labels the Give lane, so a chart legend and a table cell can
 *  never drift apart. */
export const PATTERN_LAPSED = `Lapsed (no gift in ${LAPSE_DAYS} days)`;
export const PATTERN_RECURRING = "Recurring schedule";
/** Not "one gift": someone can give 37 times a year without a schedule. */
export const PATTERN_ONE_OFF = "Not on a schedule";

/** The three giving patterns, mutually exclusive and tested in this order over
 *  two SQL expressions: the person's (or payer's) last gift date and their
 *  count of recurring gifts. Lapsed wins over recurring — a schedule that
 *  stopped three months ago is a lapse, not a schedule. */
export const givingPatternExpr = (
  lastGift: string,
  recurringGifts: string,
  org = ":orgId",
) =>
  `CASE WHEN ${lastGift} < ${lapseCutoff(org)} THEN '${PATTERN_LAPSED}'
        WHEN ${recurringGifts} > 0 THEN '${PATTERN_RECURRING}'
        ELSE '${PATTERN_ONE_OFF}' END`;

/** The same, for a `pushpay_payer_summary` row aliased `alias`. */
export const givingPatternCase = (alias: string, org = ":orgId") =>
  givingPatternExpr(`${alias}.last_gift_on`, `${alias}.recurring_gifts`, org);

/** The same three buckets in TypeScript, for rows already loaded. `cutoff` is
 *  the value of `lapseCutoff` for the org. */
export function givingPattern(
  lastGift: string | null,
  recurringGifts: number,
  cutoff: string | null,
): string {
  if (cutoff !== null && lastGift !== null && lastGift < cutoff) return PATTERN_LAPSED;
  return recurringGifts > 0 ? PATTERN_RECURRING : PATTERN_ONE_OFF;
}

/** How a payer's gifts arrived, counted once per PAYER rather than once per
 *  gift. 'Batch Entry' is PushPay's channel for a gift keyed in afterwards,
 *  which is how cash or a cheque in the plate is recorded; every other source
 *  — Recurring, Web, Mobile, Text Giving, Kiosk — arrived electronically. A
 *  Kiosk gift happens on campus but is still an electronic transaction.
 *
 *  A PAYER IS NOT A PERSON, and anything built on this has to say "payers".
 *  The key below is the PushPay payer id, so a household holding two of them
 *  counts twice, and the 548 payers we cannot put a name to count too. Over
 *  the loaded window that is 1,669 payers against 1,113 people — a payer-keyed
 *  split labelled "people" overstates the biggest bucket by about half. Group
 *  by `person_id` instead (and say that unlinked payers are left out) when a
 *  block really means people; `PERSON_GIFTS` in builder-seeds.ts is the
 *  person-level rollup the /giving page uses for exactly that reason. */
export const METHOD_BOTH = "Both";
export const METHOD_OFFLINE = "Check or cash";
export const METHOD_ONLINE = "Online";

export const givingMethodCase = (offline: string, online: string) =>
  `CASE WHEN ${offline} > 0 AND ${online} > 0 THEN '${METHOD_BOTH}'
        WHEN ${offline} > 0 THEN '${METHOD_OFFLINE}'
        ELSE '${METHOD_ONLINE}' END`;

/** Per-payer method flags over a set of gifts, ready to wrap in the CASE
 *  above. `where` is extra predicate text (e.g. a date bound), already
 *  prefixed with AND. */
export const payerMethodFlags = (org = ":orgId", where = "") =>
  `SELECT COALESCE(payer_id, 'tx:' || transaction_id) AS pk,
          MAX(CASE WHEN source = 'Batch Entry' THEN 1 ELSE 0 END) AS offline_gifts,
          MAX(CASE WHEN source IS NULL OR source <> 'Batch Entry' THEN 1 ELSE 0 END) AS online_gifts
     FROM pushpay_transactions
    WHERE org_id = ${org}${where}
    GROUP BY 1`;

// ---------------------------------------------------------------------------
// WHICH GIFTS COULD POSSIBLY ANSWER A SUNDAY
//
// PushPay stamps every gift with a Source, and the three groups below behave
// so differently in time that adding them together hides everything. Any
// question of the form "did giving move after we said something" has to keep
// them apart, so the split lives here rather than in one page's query.
//
//  * RESPONDING — Web, Text Giving, Mobile, Kiosk. Someone decided and gave,
//    and the gift is dated when they gave it. These are the only gifts that
//    CAN answer something said on a Sunday. 4,012 of 16,574 in the loaded
//    window.
//
//  * SCHEDULED — Recurring. Set up in advance, so the date is the schedule's,
//    not a decision's. A recurring gift cannot respond to this morning; it was
//    arranged weeks or months ago. That makes it the natural CONTROL line: if
//    it moves in the same weeks as the responding line, the week is what
//    moved, not the ask. 8,890 gifts.
//
//  * LAGGING — Batch Entry. Cash or a cheque in the plate, keyed in afterwards
//    by hand, so its `received_on` is the day someone typed it, which can be
//    days or weeks after the gift. It is real giving and it belongs on the
//    chart, but its date does not line up with the Sunday that prompted it, so
//    it is never read as a response. 3,672 gifts.
// ---------------------------------------------------------------------------

export const SOURCE_SCHEDULED = "Recurring";
export const SOURCE_LAGGING = "Batch Entry";
export const SOURCES_RESPONDING = ["Web", "Text Giving", "Mobile", "Kiosk"] as const;

export const ROLE_RESPONDING_LABEL = "Responding gifts (Web, Text, Mobile, Kiosk)";
export const ROLE_SCHEDULED_LABEL = "Recurring — scheduled in advance (control)";
export const ROLE_LAGGING_LABEL = "Batch Entry — keyed in later (lags the Sunday)";

/** SQL predicate over a `pushpay_transactions` row aliased `alias`. */
export const respondingSourceSql = (alias = "") => {
  const col = alias ? `${alias}.source` : "source";
  return `${col} IN (${SOURCES_RESPONDING.map((s) => `'${s}'`).join(", ")})`;
};

/** One payer key per gift row. A gift whose export row carried no Payer ID is
 *  its own payer, keyed by transaction — the same rule `pushpay_payer_summary`
 *  is built with, so a distinct-giver count here and a payer count there mean
 *  the same thing. */
export const payerKeySql = (alias = "") => {
  const p = alias ? `${alias}.` : "";
  return `COALESCE(${p}payer_id, 'tx:' || ${p}transaction_id)`;
};

/** Sunday that starts the week a dated column falls in. `received_on` is
 *  already a calendar date (§3), so no timezone shift is needed. */
export const giftWeekSql = (col = "received_on") =>
  `date(${col}, '-' || strftime('%w', ${col}) || ' days')`;

/** EVERY GIFT ROW COUNTS, WHATEVER ITS STATUS. ~123 rows are still
 *  'Processing', and every one of them sits in the last two weeks of the
 *  window — a gift that arrived in March settled long ago. Filtering to
 *  Status = 'Success' would therefore shave only the most recent weeks, which
 *  are exactly the weeks any "did it move recently" question turns on, and
 *  would read as a fall in giving that is really a fall in clearing time.
 *  Counting every row is also what `pushpay_payer_summary` does, so the series
 *  here and the rollup's counts agree. */
export const STATUS_PROCESSING = "Processing";
