-- Let a builder page also appear on the "See More" page under a heading. This
-- is independent of nav_section (the left-sidebar placement): a page can be in
-- a sidebar group, listed on See More, both, or neither. Free text so admins can
-- create their own See-More headings.
ALTER TABLE builder_pages ADD COLUMN more_section TEXT;
