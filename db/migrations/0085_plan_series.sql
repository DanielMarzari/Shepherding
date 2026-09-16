-- The sermon series, from PCO Services.
--
-- The Communications - Content Creation report publishes "8 sermon series
-- packages/yr" as an Output, and it had no source: the 429 sermons we hold
-- carry title, speaker, scripture and transcript but no series. The obvious
-- next move was to read the series off faithchurchpa.com, which would have
-- meant a new scraped source.
--
-- It was already in PCO. /services/v2/series holds 104 series, and every plan
-- carries series_title plus a relationship to the series itself, populated back
-- to 2019-01-06 (359 of the last 400 past LIVE plans have one; the 41 without
-- are standalone Sundays like Christmas and Easter, which is correct).
--
-- This also links the sermon archive to its series for the first time: 428 of
-- our 429 sermons match a LIVE plan on the date they were preached.
ALTER TABLE pco_plans ADD COLUMN series_title TEXT;
ALTER TABLE pco_plans ADD COLUMN series_id TEXT;
CREATE INDEX IF NOT EXISTS pco_plans_series ON pco_plans(org_id, series_id);
