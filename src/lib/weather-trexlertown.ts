import "server-only";
import { getDb } from "./db";

// Trexlertown, PA (the church's location).
const LAT = 40.5462;
const LON = -75.6088;
const TZ = "America/New_York";

export interface DayWeather {
  tmaxF: number | null;
  tminF: number | null;
  precipIn: number | null;
  rainIn: number | null;
  /** Snowfall depth in inches (converted from the archive's cm). */
  snowIn: number | null;
}

/** Ensure the weather cache covers every Sunday in `weekDates`, then
 *  return a date → weather map for those dates. Network-fetches only the
 *  missing span from the Open-Meteo historical archive (free, no key),
 *  and only for dates old enough that the archive has them (~5-day lag).
 *  The HTTP call itself is cached by Next for 12h, so repeated renders
 *  don't actually hit the network. */
export async function loadWeatherForWeeks(
  weekDates: string[],
): Promise<Map<string, DayWeather>> {
  const db = getDb();
  if (weekDates.length === 0) return new Map();

  const have = new Set(
    (db.prepare(`SELECT date FROM weather_daily`).all() as { date: string }[]).map(
      (r) => r.date,
    ),
  );

  // Archive has a ~5 day lag; don't bother fetching very recent Sundays.
  const cutoff = new Date(Date.now() - 6 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const missing = weekDates.filter((d) => !have.has(d) && d <= cutoff);

  if (missing.length > 0) {
    missing.sort();
    const start = missing[0];
    const end = missing[missing.length - 1];
    try {
      await fetchAndStore(start, end);
    } catch {
      // Network/parse failure is non-fatal — the chart just shows the
      // attendance line without weather for the missing span.
    }
  }

  const out = new Map<string, DayWeather>();
  if (weekDates.length > 0) {
    const placeholders = weekDates.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT date, tmax_f, tmin_f, precip_in, rain_in, snow_in
           FROM weather_daily WHERE date IN (${placeholders})`,
      )
      .all(...weekDates) as Array<{
      date: string;
      tmax_f: number | null;
      tmin_f: number | null;
      precip_in: number | null;
      rain_in: number | null;
      snow_in: number | null;
    }>;
    for (const r of rows) {
      out.set(r.date, {
        tmaxF: r.tmax_f,
        tminF: r.tmin_f,
        precipIn: r.precip_in,
        rainIn: r.rain_in,
        snowIn: r.snow_in,
      });
    }
  }
  return out;
}

async function fetchAndStore(startDate: string, endDate: string): Promise<void> {
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${LAT}&longitude=${LON}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,rain_sum,snowfall_sum` +
    `&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=${encodeURIComponent(TZ)}`;

  const res = await fetch(url, { next: { revalidate: 43_200 } }); // 12h
  if (!res.ok) throw new Error(`weather archive ${res.status}`);
  const json = (await res.json()) as {
    daily?: {
      time?: string[];
      temperature_2m_max?: (number | null)[];
      temperature_2m_min?: (number | null)[];
      precipitation_sum?: (number | null)[];
      rain_sum?: (number | null)[];
      snowfall_sum?: (number | null)[];
    };
  };
  const d = json.daily;
  if (!d?.time?.length) return;

  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO weather_daily (date, tmax_f, tmin_f, precip_in, rain_in, snow_in)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       tmax_f = excluded.tmax_f,
       tmin_f = excluded.tmin_f,
       precip_in = excluded.precip_in,
       rain_in = excluded.rain_in,
       snow_in = excluded.snow_in,
       fetched_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  );
  const tx = db.transaction((rows: string[]) => {
    rows.forEach((date, i) => {
      // With precipitation_unit=inch the archive returns snowfall in
      // inches too, so store it directly (no cm conversion).
      upsert.run(
        date,
        d.temperature_2m_max?.[i] ?? null,
        d.temperature_2m_min?.[i] ?? null,
        d.precipitation_sum?.[i] ?? null,
        d.rain_sum?.[i] ?? null,
        d.snowfall_sum?.[i] ?? null,
      );
    });
  });
  tx(d.time);
}
