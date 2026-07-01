-- Optional left-nav placement for a builder page: which sidebar section the
-- page's link appears in. NULL / '' = not shown in the nav (reachable only via
-- the Page Builder index and the "See more" menu).
ALTER TABLE builder_pages ADD COLUMN nav_section TEXT;
