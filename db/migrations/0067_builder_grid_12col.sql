-- The builder bento moved from a 6-column to a 12-column grid (finer widths for
-- KPI rows / quarters). Double every stored block width once so existing pages
-- render identically — a 3-of-6 (half) becomes 6-of-12 (still half). New widths
-- are authored directly as twelfths.
UPDATE builder_blocks
   SET config = json_set(config, '$.span', CAST(json_extract(config, '$.span') AS INTEGER) * 2)
 WHERE json_extract(config, '$.span') IS NOT NULL;
