-- Track which code-seed revision an auto-seeded builder page was created from.
-- Lets a pristine (never-edited) seeded page be refreshed when its seed
-- definition changes, while user-edited pages are left untouched. NULL for
-- user-created pages (they are never re-seeded).
ALTER TABLE builder_pages ADD COLUMN seed_revision INTEGER;
