-- Which forms count, chosen rather than hardcoded.
--
-- TRACKED_FORM_IDS was three ids in a constant: the Serve Form, the
-- Network Prayer Request and the Membership Application. Every other form
-- the church runs — connection cards, interest forms, event signups —
-- produced no row at all, so submitting one was invisible to the Known
-- rule and to the inactive audit. On the audit's "no trace at all" list
-- that showed up as 413 records typed 1st Time Visitor with nothing
-- recorded against them, which is exactly what filling in a connection
-- card and nothing else looks like when the card is not synced.
--
-- Seeded with the three that were already hardcoded, so this migration
-- changes no behaviour on its own: the list is now editable, and the sync
-- also learns what other forms exist so there is something to choose from.
BEGIN IMMEDIATE;

ALTER TABLE pco_sync_settings ADD COLUMN tracked_form_ids TEXT;

UPDATE pco_sync_settings
   SET tracked_form_ids = '["308672","144568","70538"]',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE tracked_form_ids IS NULL;

INSERT OR IGNORE INTO _migrations (filename) VALUES ('0119_tracked_forms.sql');
COMMIT;
