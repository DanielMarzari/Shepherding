-- Add a per-org group-type exclusion list (mirrors excluded_membership_types).
ALTER TABLE pco_sync_settings ADD COLUMN excluded_group_types TEXT;

-- Group attendance is now folded into the "groups" toggle. Drop any stored
-- group_attendance entity rows so the legacy switch can't get out of sync.
DELETE FROM pco_sync_entities WHERE entity = 'group_attendance';
