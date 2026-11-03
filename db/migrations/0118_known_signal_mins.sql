-- A minimum per signal, not one shared by the two email signals.
--
-- Known used to mean "one signal of any kind, once" — known_min_signals
-- was 1 and only the email signals had a threshold. On real data that made
-- 5,241 people Known off a single gift, a single registration, or one
-- email open that may have been a preview pane.
--
-- The new rule is two or more categories, each over a bar of its own:
-- checking a child in six times, turning up twice yourself, two forms, two
-- group meetings, one serve, one gift, eight email opens, one
-- registration. A parent who only ever checks a child in has told us about
-- the child, not about themselves, so one category is never enough.
--
-- known_email_min stays where it is rather than being dropped: it is what
-- an org configured before today, and parseSignalMins falls back to the
-- per-signal defaults when this column is null, so an org that never opens
-- the settings page gets the new rule rather than an empty one.
BEGIN IMMEDIATE;

ALTER TABLE pco_sync_settings ADD COLUMN known_signal_mins TEXT;

-- Two categories, for every org that has not chosen otherwise. The old
-- default of 1 is the thing being corrected, so it is not preserved.
UPDATE pco_sync_settings
   SET known_min_signals = 2,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE known_min_signals IS NULL OR known_min_signals < 2;

INSERT OR IGNORE INTO _migrations (filename) VALUES ('0118_known_signal_mins.sql');
COMMIT;
