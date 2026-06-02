-- Split precipitation into rain vs snow so /attendance can show snow
-- distinctly, and keep the daily low (already stored). Clearing the
-- cache forces a clean refetch from the archive that populates the new
-- columns (it's just a cache — repopulates on the next page render).
ALTER TABLE weather_daily ADD COLUMN rain_in REAL;
ALTER TABLE weather_daily ADD COLUMN snow_in REAL;
DELETE FROM weather_daily;
