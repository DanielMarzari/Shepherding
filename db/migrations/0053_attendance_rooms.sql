-- Per-venue worship counts so /attendance can trend rooms separately.
-- adult_total is the combined adult worship number; Center / Chapel are its
-- venue split when the imported spreadsheet breaks them out. Nullable —
-- older imports (and weeks without the split) just leave them empty.
ALTER TABLE attendance_weekly ADD COLUMN center_total INTEGER;
ALTER TABLE attendance_weekly ADD COLUMN chapel_total INTEGER;
