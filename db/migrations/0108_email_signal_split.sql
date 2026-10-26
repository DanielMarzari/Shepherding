-- Opening an email and clicking one are not the same thing.
--
-- The 'email' signal counted either as the same evidence. Measured against
-- the member roster inside the activity window:
--
--   opens   >=1: 598   >=3: 572   >=5: 552   >=10: 507
--   clicks  >=1: 437   >=3: 323   >=5: 246
--
-- Two things fall out of that. Every member who clicked had also opened —
-- zero clicked without opening — so a click is a strictly stronger signal,
-- not a different one. And raising the OPEN threshold barely filters: from
-- 598 down to 507 even at ten opens, because people who open, open often.
-- The real lever is requiring a click at all, which is 161 people.
--
-- So the signal splits in two and gains a minimum count, and a church can
-- say "opening counts" or "only clicking counts" rather than having that
-- decided for them.

BEGIN IMMEDIATE;

-- How many open/click events are needed before the signal counts. Applies
-- to each of the two independently: 2 means two opens, or two clicks.
-- Default 1 — the bar the single 'email' signal implied, so nobody's
-- numbers move until they choose to move them.
ALTER TABLE pco_sync_settings ADD COLUMN known_email_min INTEGER NOT NULL DEFAULT 1;

-- Anyone who had configured 'email' gets both halves, which reproduces
-- exactly what they had. A NULL known_signals means "never configured" and
-- falls through to the code default, so it is left alone.
UPDATE pco_sync_settings
   SET known_signals = replace(known_signals, '"email"', '"email_open","email_click"'),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE known_signals IS NOT NULL
   AND instr(known_signals, '"email"') > 0;

INSERT OR IGNORE INTO _migrations (filename) VALUES ('0108_email_signal_split.sql');
COMMIT;
