-- Denormalized birth_year (just the year, not the full date) on pco_people
-- so we can compute age buckets in SQL for the demographic charts. The
-- full birthdate stays encrypted in enc_pii. Populated by the same pass
-- that computes is_minor.
ALTER TABLE pco_people ADD COLUMN birth_year INTEGER;
CREATE INDEX IF NOT EXISTS pco_people_birth_year ON pco_people(org_id, birth_year);
