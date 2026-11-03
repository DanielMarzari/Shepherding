-- Membership types the inactive audit never suggests.
--
-- Two kinds of record are on the candidate list for reasons that have
-- nothing to do with whether anybody has seen the person:
--
--   SYSTEM USE - Do Not Delete (35) — not a person at all.
--   Outreach Partner, and its Child of / Former / Member and variants
--   (97) — partners are not expected to attend anything. A partner with
--   no check-ins is a partner, not a lapsed attender.
--
-- Kept separate from pco_sync_settings.excluded_membership_types, which
-- already holds SYSTEM USE and Non-Attendee Staff and which the audit now
-- also honours: that list removes people from the people pages, the
-- dashboards and the intake graph, and adding partners to it would hide
-- them from the whole app rather than from one suggestion list.
BEGIN IMMEDIATE;

ALTER TABLE pco_sync_settings ADD COLUMN inactive_audit_excluded_types TEXT;

UPDATE pco_sync_settings
   SET inactive_audit_excluded_types =
         '["Outreach Partner","Child of Outreach Partner","Former Outreach Partner","Member and Outreach Partner"]',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE inactive_audit_excluded_types IS NULL;

INSERT OR IGNORE INTO _migrations (filename) VALUES ('0120_inactive_audit_excludes.sql');
COMMIT;
