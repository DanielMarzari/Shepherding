-- A ZIP on person_geo, so the map stops decrypting the congregation.
--
-- map-analysis.loadPoints decrypted every geocoded person's PII blob on every
-- request — 25,834 AES decryptions — to regex a five-digit ZIP out of their
-- address, which is used only to label a marker "near 18104". The ZIP does
-- not change between page loads, so it belongs beside the coordinates it was
-- derived from.
--
-- Backfill cannot happen here: the addresses are encrypted and SQLite has no
-- key. backfillGeoZips() fills this column during the nightly refresh, and
-- the geocoder writes it for every address it resolves from now on. Until
-- then a null simply means no ZIP label, which is what a failed parse always
-- meant anyway.

BEGIN IMMEDIATE;

ALTER TABLE person_geo ADD COLUMN zip TEXT;

INSERT OR IGNORE INTO _migrations (filename) VALUES ('0112_person_geo_zip.sql');
COMMIT;
