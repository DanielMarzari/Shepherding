-- Credentials are stored in one of two tiers. This is the rule for the next
-- integration:
--
--   A provider gets its own typed table (<provider>_credentials) once it has a
--   working sync and connection metadata worth keeping: verified_at, the
--   account's name, a refresh token the sync rotates. Until then its
--   credentials go in integration_credentials (0086), one row per field,
--   entered on the Credentials page (/settings/integrations, INTEGRATIONS in
--   src/lib/integrations.ts).
--
-- Typed columns such as api_key_last4 explain themselves to someone browsing
-- the database. A generic table for everything would lose that for the three
-- providers that actually sync, so the typed tables stay:
--   pco_credentials               PCO, live API sync
--   constant_contact_credentials  Constant Contact, live OAuth sync
--   spotify_credentials           Spotify, live API sync
--
-- This migration removes the two tables that did not meet the rule:
--
--   pushpay_credentials (0047) and subsplash_credentials (0059) were created
--   for syncs that were never built. PushPay data arrives by CSV upload
--   (src/lib/pushpay-import.ts), and Subsplash has no data here at all.
--   Nothing ever read the stored secrets, and both tables were empty in
--   production when this was written. Credentials for either now go in
--   integration_credentials under provider 'pushpay' or 'subsplash'.
--   Subsplash has a card on the Credentials page. PushPay has none: the CSVs
--   already bring in the giving data and no published Output waits on its
--   API. Whoever builds a PushPay API sync adds its entry to INTEGRATIONS.
--
-- It also renames constantcontact_credentials to constant_contact_credentials.
-- Everything else spells the provider constant_contact / constant-contact (even
-- 0058, the migration that created this table, is named
-- 0058_constant_contact_credentials.sql) or uses the cc_ prefix for its data
-- tables. No foreign key, view, trigger or stored builder SQL names the table,
-- so src/lib/constant-contact.ts is the only reader to update.
--
-- If a row appears, the migration fails rather than drop it. "Empty when this
-- was written" is not "empty when it runs", and a plain DROP would delete a
-- stored secret silently. If either table has a row, the guard below rolls
-- back the whole transaction with a message naming the table, so nothing
-- changes. To get past it, move the row into integration_credentials (one row
-- per field; the *_enc values copy across as they are because they use the
-- same key) or delete it deliberately, then deploy again. SQLite has no ASSERT
-- and RAISE() only works inside a trigger, so the guard is a throwaway TEMP
-- table and trigger. Both are dropped before COMMIT.
--
-- Old code keeps serving between this migration and the pm2 restart. For
-- those few seconds, the old PushPay, Subsplash and Constant Contact pages
-- fail with "no such table". A Constant Contact token refresh that lands in
-- that window would also fail to save the rotated refresh token. If Constant
-- Contact ever shows as disconnected right after this deploy, reconnect it
-- from /constant-contact.
--
-- IMMEDIATE, not a plain BEGIN: the guard reads before anything writes. A
-- deferred transaction would start as a reader, and SQLite does not wait on
-- the busy timeout when a reader has to become a writer, so the migration
-- would fail at once with "database is locked" whenever the live app or a
-- sync was mid-write. IMMEDIATE takes the write lock first, waits for it, and
-- stops anything from inserting a row between the guard's check and the DROP.
BEGIN IMMEDIATE;

CREATE TEMP TABLE _0092_guard (tbl TEXT NOT NULL);

CREATE TEMP TRIGGER _0092_refuse_pushpay BEFORE INSERT ON _0092_guard
WHEN NEW.tbl = 'pushpay_credentials' AND EXISTS (SELECT 1 FROM pushpay_credentials)
BEGIN
  SELECT RAISE(ROLLBACK, '0092 refused: pushpay_credentials has a row. Move it to integration_credentials (provider ''pushpay'') or delete it, then deploy again. Nothing was changed.');
END;

CREATE TEMP TRIGGER _0092_refuse_subsplash BEFORE INSERT ON _0092_guard
WHEN NEW.tbl = 'subsplash_credentials' AND EXISTS (SELECT 1 FROM subsplash_credentials)
BEGIN
  SELECT RAISE(ROLLBACK, '0092 refused: subsplash_credentials has a row. Move it to integration_credentials (provider ''subsplash'') or delete it, then deploy again. Nothing was changed.');
END;

INSERT INTO _0092_guard (tbl) VALUES ('pushpay_credentials'), ('subsplash_credentials');

DROP TRIGGER _0092_refuse_pushpay;
DROP TRIGGER _0092_refuse_subsplash;
DROP TABLE _0092_guard;

DROP TABLE pushpay_credentials;
DROP TABLE subsplash_credentials;

ALTER TABLE constantcontact_credentials RENAME TO constant_contact_credentials;

COMMIT;
