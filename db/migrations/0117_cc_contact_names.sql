-- Names for Constant Contact contacts.
--
-- 58 contacts on the seniors lists have no PCO match, and the page could
-- say nothing about them at all: we store an HMAC of the address and never
-- the address, so an unmatched contact was a person with no name, no email
-- and no record — nothing anybody could act on or even recognise.
--
-- The names were there all along. /v3/contacts returns first_name and
-- last_name and the sync simply dropped them on the floor. Storing them is
-- in line with what we already do (0074: names are plaintext, because
-- every page needs them and encrypting them bought nothing); the address
-- itself stays a hash, so this adds no new class of data about anybody.
--
-- names_backfilled_at is the lesson from 0115: the contact sync is
-- incremental on updated_after, so a new column stays empty for everyone
-- who has not changed since, and "is the column empty" is not a safe guard
-- because the first incremental pass fills a few rows and makes it look
-- done. The marker records the one full walk instead.
BEGIN IMMEDIATE;

ALTER TABLE constant_contact_contacts ADD COLUMN first_name TEXT;
ALTER TABLE constant_contact_contacts ADD COLUMN last_name TEXT;
ALTER TABLE constant_contact_sync_settings ADD COLUMN names_backfilled_at TEXT;

INSERT OR IGNORE INTO _migrations (filename) VALUES ('0117_cc_contact_names.sql');
COMMIT;
