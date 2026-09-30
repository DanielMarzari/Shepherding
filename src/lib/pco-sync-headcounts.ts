import "server-only";
import { getDb } from "./db";
import { PCOClient, type PCOResource } from "./pco-client";

/** PCO Check-Ins Headcounts — the aggregate attendance a volunteer types in
 *  per service, per venue. Not pco_check_ins, which is who walked in.
 *
 *  This is the upstream source of the attendance spreadsheet. Verified over 35
 *  Sundays from Sep 2025: W-Center + W-Chapel + W-Loft equals the sheet's
 *  adult_total with a median difference of zero, and On-YT Live + On-ChOnline
 *  equals its online_live. So the sheet is a transcription, and syncing this
 *  removes the wait for a quarterly export. */

/** Venue headcounts — the people in a room. Loft is included because it is a
 *  real venue, though it has only ever been counted twice (2022-04-17). */
export const VENUE_TYPES = ["W-Center", "W-Chapel", "W-Loft"] as const;
/** Watching live. On-App is deliberately absent: the sheet's online_live does
 *  not include it, and adding it puts the figure out by about +43 a week. */
export const LIVE_TYPES = ["On-YT Live", "On-ChOnline"] as const;
/** Watched later. These accrue after the service, so a headcount entered on
 *  the day reads lower than the same week read a fortnight on. */
export const DEMAND_TYPES = ["On-YT Demand", "On-Podcast", "On-Sermon"] as const;

/** Venue name -> the room key attendance_service already uses. */
const ROOM_OF: Record<string, string> = {
  "W-Center": "center",
  "W-Chapel": "chapel",
  "W-Loft": "loft",
};

/** Kids attendance comes from this one check-in event's daily total. */
export const KIDS_EVENT = "Sunday AM Kids";
/** Students are spread across three Sunday services that ALTERNATE — some
 *  Sundays use Afternoon, others PM, never both. Confirmed with the ministry
 *  lead. All three are summed. */
export const STUDENT_EVENTS = [
  "Sunday AM Students",
  "Sunday Afternoon Students",
  "Sunday PM Students",
] as const;

/** A week is treated as a coverage dropout, not a low week, when its total
 *  falls below this share of the median week. Student check-in coverage
 *  collapses occasionally — 2025-02-02 reads 2 against a spreadsheet figure of
 *  91 — and publishing a 2 as attendance would be worse than publishing
 *  nothing. A quarter of the median clears the genuine low weeks (Christmas
 *  2025 kids was 110 against a median near 300) while catching the dropouts. */
const DROPOUT_FRACTION = 0.25;

export interface HeadcountSyncResult {
  fetched: number;
  upserted: number;
  firstDate: string | null;
  lastDate: string | null;
  weeksProjected: number;
  columnsFilled: number;
  periodsFetched: number;
  periodsUpserted: number;
}

const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric", month: "2-digit", day: "2-digit",
});
const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/New_York",
  hour: "2-digit", minute: "2-digit", hour12: false,
});

/** America/New_York date and time for a UTC instant. Intl rather than a fixed
 *  offset, because a fixed offset is an hour wrong for half the year and
 *  mis-dates anything near midnight. */
function local(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return { date: dateFmt.format(d), time: timeFmt.format(d) };
}

export async function syncHeadcountsAll(
  client: PCOClient,
  orgId: number,
  opts: { full?: boolean } = {},
): Promise<HeadcountSyncResult> {
  const db = getDb();
  const out: HeadcountSyncResult = {
    fetched: 0, upserted: 0, firstDate: null, lastDate: null,
    weeksProjected: 0, columnsFilled: 0, periodsFetched: 0, periodsUpserted: 0,
  };

  // Newest-updated first, stopping at the newest one already held. A first run
  // holds none and so takes all 7,692; after that it is a page or two.
  const cursor = opts.full
    ? null
    : ((db.prepare(`SELECT MAX(pco_updated_at) AS m FROM pco_headcounts WHERE org_id = ?`)
        .get(orgId) as { m: string | null } | undefined)?.m ?? null);

  const up = db.prepare(
    `INSERT INTO pco_headcounts
       (org_id, pco_id, event_time_id, attendance_type_id, attendance_type, event_name,
        starts_at, local_date, local_time, total, pco_created_at, pco_updated_at, synced_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, pco_id) DO UPDATE SET
       event_time_id = excluded.event_time_id,
       attendance_type_id = excluded.attendance_type_id,
       attendance_type = excluded.attendance_type,
       event_name = excluded.event_name,
       starts_at = excluded.starts_at,
       local_date = excluded.local_date,
       local_time = excluded.local_time,
       total = excluded.total,
       pco_created_at = excluded.pco_created_at,
       pco_updated_at = excluded.pco_updated_at,
       synced_at = excluded.synced_at`,
  );

  // Event names for attendance types, so a headcount says which event it came
  // from without a second lookup per row.
  const eventName = new Map<string, string>();
  for await (const { page } of client.paginate<PCOResource>(
    "/check-ins/v2/attendance_types?per_page=100&include=event",
  )) {
    const arr = Array.isArray(page.data) ? page.data : [page.data];
    const evs = new Map(
      (page.included ?? []).filter((i) => i.type === "Event")
        .map((i) => [i.id, (i.attributes as Record<string, unknown> | undefined)?.name as string | undefined ?? ""]),
    );
    for (const t of arr) {
      const rel = t.relationships?.event?.data;
      const id = !rel || Array.isArray(rel) ? null : rel.id;
      if (id) eventName.set(t.id, evs.get(id) ?? "");
    }
  }

  let caughtUp = false;
  for await (const { page } of client.paginate<PCOResource>(
    "/check-ins/v2/headcounts?per_page=100&order=-updated_at&include=event_time,attendance_type",
  )) {
    const arr = Array.isArray(page.data) ? page.data : [page.data];
    const inc = new Map((page.included ?? []).map((i) => [`${i.type}:${i.id}`, i]));
    const tx = db.transaction(() => {
      for (const h of arr) {
        const a = (h.attributes ?? {}) as Record<string, unknown>;
        const updated = (a.updated_at as string | undefined) ?? null;
        if (cursor && updated && updated <= cursor) { caughtUp = true; return; }
        const etRel = h.relationships?.event_time?.data;
        const atRel = h.relationships?.attendance_type?.data;
        const etId = !etRel || Array.isArray(etRel) ? null : etRel.id;
        const atId = !atRel || Array.isArray(atRel) ? null : atRel.id;
        const et = etId ? inc.get(`EventTime:${etId}`) : undefined;
        const at = atId ? inc.get(`AttendanceType:${atId}`) : undefined;
        const startsAt = ((et?.attributes as Record<string, unknown> | undefined)?.starts_at as string | undefined) ?? null;
        const loc = startsAt ? local(startsAt) : null;
        if (loc) {
          if (!out.firstDate || loc.date < out.firstDate) out.firstDate = loc.date;
          if (!out.lastDate || loc.date > out.lastDate) out.lastDate = loc.date;
        }
        up.run(
          orgId, h.id, etId, atId,
          ((at?.attributes as Record<string, unknown> | undefined)?.name as string | undefined) ?? null,
          atId ? eventName.get(atId) ?? null : null,
          startsAt, loc?.date ?? null, loc?.time ?? null,
          typeof a.total === "number" ? a.total : null,
          (a.created_at as string | undefined) ?? null, updated,
        );
        out.upserted++;
      }
    });
    tx();
    out.fetched += arr.length;
    if (caughtUp) break;
  }

  const ep = await syncEventPeriods(client, orgId);
  out.periodsFetched = ep.fetched;
  out.periodsUpserted = ep.upserted;

  const p = projectHeadcountsToAttendance(orgId);
  out.weeksProjected = p.weeks;
  out.columnsFilled = p.columns;
  return out;
}

/** Every check-in event's daily periods, with the counts PCO totals itself.
 *
 *  There is no top-level /event_periods collection — it 404s — so this walks
 *  each event. 100 events, 5,090 periods, about 150 requests, which is cheap
 *  enough to take whole rather than track a cursor per event. Syncing them all
 *  rather than only the kids and student events means Monday Care Kids, MomCo
 *  and the Women's Bible Study are there when something needs them. */
async function syncEventPeriods(
  client: PCOClient,
  orgId: number,
): Promise<{ fetched: number; upserted: number }> {
  const db = getDb();
  const out = { fetched: 0, upserted: 0 };
  const events: Array<{ id: string; name: string }> = [];
  for await (const { page } of client.paginate<PCOResource>("/check-ins/v2/events?per_page=100")) {
    const arr = Array.isArray(page.data) ? page.data : [page.data];
    for (const e of arr) {
      events.push({ id: e.id, name: ((e.attributes ?? {}) as Record<string, unknown>).name as string ?? "" });
    }
  }
  const up = db.prepare(
    `INSERT INTO pco_event_periods
       (org_id, pco_id, event_id, event_name, starts_at, ends_at, local_date,
        regular_count, guest_count, volunteer_count, note,
        pco_created_at, pco_updated_at, synced_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, pco_id) DO UPDATE SET
       event_id = excluded.event_id, event_name = excluded.event_name,
       starts_at = excluded.starts_at, ends_at = excluded.ends_at,
       local_date = excluded.local_date,
       regular_count = excluded.regular_count, guest_count = excluded.guest_count,
       volunteer_count = excluded.volunteer_count, note = excluded.note,
       pco_created_at = excluded.pco_created_at, pco_updated_at = excluded.pco_updated_at,
       synced_at = excluded.synced_at`,
  );
  for (const ev of events) {
    for await (const { page } of client.paginate<PCOResource>(
      `/check-ins/v2/events/${ev.id}/event_periods?per_page=100&order=-starts_at`,
    )) {
      const arr = Array.isArray(page.data) ? page.data : [page.data];
      const tx = db.transaction(() => {
        for (const p of arr) {
          const a = (p.attributes ?? {}) as Record<string, unknown>;
          const startsAt = (a.starts_at as string | undefined) ?? null;
          up.run(
            orgId, p.id, ev.id, ev.name, startsAt,
            (a.ends_at as string | undefined) ?? null,
            startsAt ? local(startsAt).date : null,
            typeof a.regular_count === "number" ? a.regular_count : null,
            typeof a.guest_count === "number" ? a.guest_count : null,
            typeof a.volunteer_count === "number" ? a.volunteer_count : null,
            (a.note as string | undefined) ?? null,
            (a.created_at as string | undefined) ?? null,
            (a.updated_at as string | undefined) ?? null,
          );
          out.upserted++;
        }
      });
      tx();
      out.fetched += arr.length;
    }
  }
  return out;
}

/** Fold the headcounts into the tables the whole app already reads.
 *
 *  Every attendance surface — the page, the Ministry Impact Reports, 22 stored
 *  Page Builder queries, giving-impact — reads attendance_weekly and
 *  attendance_service. Adding a parallel table would have left all of them on
 *  stale data, so the headcounts are folded in instead.
 *
 *  THE RULE: never overwrite a figure the spreadsheet actually carried. A
 *  column is written only where the sheet left it NULL, and a whole row only
 *  for a Sunday the sheet does not have. Every column this fills is recorded in
 *  attendance_weekly.pco_filled, so the provenance of any number is answerable.
 *  That matters because the two sources do disagree on holiday weeks — Easter
 *  2026 has the sheet at 4,124 adults against PCO's 2,324, because the extra
 *  services were not all counted in PCO — and on those weeks the human's number
 *  is the one to keep. */
export function projectHeadcountsToAttendance(orgId: number): { weeks: number; columns: number } {
  const db = getDb();
  const sum = (types: readonly string[]) =>
    `SUM(CASE WHEN attendance_type IN (${types.map((t) => `'${t}'`).join(",")}) THEN total ELSE 0 END)`;
  const seen = (types: readonly string[]) =>
    `MAX(CASE WHEN attendance_type IN (${types.map((t) => `'${t}'`).join(",")}) THEN 1 ELSE 0 END)`;

  const perDay = db.prepare(
    `SELECT local_date AS day,
            ${sum(VENUE_TYPES)} AS venues,   ${seen(VENUE_TYPES)} AS hasVenues,
            ${sum(LIVE_TYPES)}  AS live,     ${seen(LIVE_TYPES)}  AS hasLive,
            ${sum(DEMAND_TYPES)} AS demand,  ${seen(DEMAND_TYPES)} AS hasDemand,
            SUM(CASE WHEN attendance_type = 'W-Center' THEN total ELSE 0 END) AS center,
            MAX(CASE WHEN attendance_type = 'W-Center' THEN 1 ELSE 0 END) AS hasCenter,
            SUM(CASE WHEN attendance_type = 'W-Chapel' THEN total ELSE 0 END) AS chapel,
            MAX(CASE WHEN attendance_type = 'W-Chapel' THEN 1 ELSE 0 END) AS hasChapel,
            SUM(CASE WHEN attendance_type = 'ABF' THEN total ELSE 0 END) AS abf,
            MAX(CASE WHEN attendance_type = 'ABF' THEN 1 ELSE 0 END) AS hasAbf
       FROM pco_headcounts
      WHERE org_id = ? AND local_date IS NOT NULL
        AND strftime('%w', local_date) = '0'          -- Sundays only
      GROUP BY local_date
      ORDER BY local_date`,
  ).all(orgId) as Array<Record<string, number | string | null>>;

  // Kids and students, from PCO's own daily totals on the event period. A week
  // below DROPOUT_FRACTION of the median is treated as missing rather than low
  // — see the constant for why.
  const evRow = (names: readonly string[]) =>
    db.prepare(
      `SELECT local_date AS day,
              SUM(COALESCE(regular_count,0) + COALESCE(guest_count,0)
                  + COALESCE(volunteer_count,0)) AS total
         FROM pco_event_periods
        WHERE org_id = ? AND local_date IS NOT NULL
          AND event_name IN (${names.map(() => "?").join(",")})
          AND strftime('%w', local_date) = '0'
        GROUP BY local_date
        HAVING total > 0`,
    ).all(orgId, ...names) as Array<{ day: string; total: number }>;

  const withFloor = (rows: Array<{ day: string; total: number }>) => {
    const sorted = rows.map((r) => r.total).sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    const floor = median * DROPOUT_FRACTION;
    const kept = new Map<string, number>();
    let dropped = 0;
    for (const r of rows) {
      if (r.total < floor) { dropped++; continue; }
      kept.set(r.day, r.total);
    }
    return { kept, median, floor, dropped };
  };

  const kids = withFloor(evRow([KIDS_EVENT]));
  const students = withFloor(evRow(STUDENT_EVENTS));

  const existing = new Map(
    (db.prepare(
      `SELECT sunday_on, adult_total, center_total, chapel_total, online_live,
              online_on_demand, abfs, kids_total, student_total
         FROM attendance_weekly WHERE org_id = ?`,
    ).all(orgId) as Array<Record<string, number | string | null>>)
      .map((r) => [String(r.sunday_on), r]),
  );

  // A Sunday may have kids/students without any headcount at all, so the set of
  // days to consider is the union of both sources.
  const allDays = new Set<string>([
    ...perDay.map((r) => String(r.day)),
    ...kids.kept.keys(),
    ...students.kept.keys(),
  ]);
  const headcountByDay = new Map(perDay.map((r) => [String(r.day), r]));

  let weeks = 0, columns = 0;
  const insertRow = db.prepare(
    `INSERT INTO attendance_weekly
       (org_id, sunday_on, adult_total, center_total, chapel_total, online_live,
        online_on_demand, abfs, kids_total, student_total, source_file, pco_filled)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'PCO Check-Ins', ?)`,
  );

  const tx = db.transaction(() => {
    for (const day of [...allDays].sort()) {
      const r = headcountByDay.get(day) ?? {};
      const v = (k: string) => (r[k] as number | null);
      const has = (k: string) => Number(r[k]) === 1;
      // A ZERO IS NOT A MEASUREMENT. A headcount row exists for plenty of
      // Sundays with total 0 — W-Chapel at 08:00 is always 0 because there is
      // no 8am chapel service, and several whole Sundays read 0 because nobody
      // typed the number in. The dry run found weeks where PCO says 0 adults
      // and the spreadsheet says 1,875; writing that 0 as fact would be the
      // worst kind of wrong. So a figure is only taken when it is positive.
      const pos = (k: string, gate: string) =>
        has(gate) && (v(k) ?? 0) > 0 ? v(k) : null;
      const cand: Array<[string, number | null]> = [
        ["adult_total", pos("venues", "hasVenues")],
        ["center_total", pos("center", "hasCenter")],
        ["chapel_total", pos("chapel", "hasChapel")],
        ["online_live", pos("live", "hasLive")],
        ["online_on_demand", pos("demand", "hasDemand")],
        ["abfs", pos("abf", "hasAbf")],
        ["kids_total", kids.kept.get(day) ?? null],
        ["student_total", students.kept.get(day) ?? null],
      ];
      const row = existing.get(day);
      if (!row) {
        const vals = Object.fromEntries(cand);
        const filled = cand.filter(([, val]) => val != null).map(([c]) => c);
        if (filled.length === 0) continue;
        insertRow.run(
          orgId, day, vals.adult_total, vals.center_total, vals.chapel_total,
          vals.online_live, vals.online_on_demand, vals.abfs,
          vals.kids_total, vals.student_total, JSON.stringify(filled),
        );
        weeks++; columns += filled.length;
        continue;
      }
      // Fill only what the sheet left empty.
      const toFill = cand.filter(([c, val]) => val != null && row[c] == null);
      if (toFill.length === 0) continue;
      const set = toFill.map(([c]) => `${c} = ?`).join(", ");
      db.prepare(
        `UPDATE attendance_weekly SET ${set}, pco_filled = ? WHERE org_id = ? AND sunday_on = ?`,
      ).run(...toFill.map(([, val]) => val), JSON.stringify(toFill.map(([c]) => c)), orgId, day);
      weeks++; columns += toFill.length;
    }

    // Per-service rows, and ONLY for Sundays the spreadsheet does not cover at
    // all. The two sources name the same service differently — PCO calls the
    // third one 11:00, the sheet calls it 11:15 — so writing PCO rows onto a
    // Sunday the sheet already describes would put two labels for one service
    // side by side and invent a fourth gathering. On a Sunday the sheet has
    // nothing for, PCO's own vocabulary is the only one present and is fine.
    const svc = db.prepare(
      `SELECT local_date AS day, attendance_type AS type, local_time AS time, SUM(total) AS total
         FROM pco_headcounts
        WHERE org_id = ? AND local_date IS NOT NULL AND local_time IS NOT NULL
          AND attendance_type IN (${VENUE_TYPES.map((t) => `'${t}'`).join(",")})
          AND strftime('%w', local_date) = '0'
        GROUP BY local_date, attendance_type, local_time`,
    ).all(orgId) as Array<{ day: string; type: string; time: string; total: number | null }>;
    const insSvc = db.prepare(
      `INSERT INTO attendance_service (org_id, sunday_on, room, service, count, source_file)
       VALUES (?,?,?,?,?, 'PCO Check-Ins')
       ON CONFLICT(org_id, sunday_on, room, service) DO NOTHING`,
    );
    const sheetSundays = new Set(
      (db.prepare(
        `SELECT DISTINCT sunday_on FROM attendance_service
          WHERE org_id = ? AND COALESCE(source_file,'') <> 'PCO Check-Ins'`,
      ).all(orgId) as Array<{ sunday_on: string }>).map((r) => r.sunday_on),
    );
    for (const s of svc) {
      const room = ROOM_OF[s.type];
      if (!room || s.total == null || s.total <= 0) continue;
      if (sheetSundays.has(s.day)) continue;
      // '08:00' -> '8:00', matching what the spreadsheet import stores.
      const service = s.time.replace(/^0/, "");
      insSvc.run(orgId, s.day, room, service, s.total);
    }
  });
  tx();
  return { weeks, columns };
}
