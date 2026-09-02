-- Full transcript text per sermon, so the Sermons explorer can show the whole
-- message with each next-step call highlighted in place. Sourced from the
-- Sermon Lab app's transcripts; backfilled by scripts/backfill-sermon-
-- transcripts.mjs. Nullable — stays empty in environments without Sermon Lab.
ALTER TABLE sermons ADD COLUMN transcript TEXT;
