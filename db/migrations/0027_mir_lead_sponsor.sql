-- The MIR "team" is now a structured pair of roles — exactly one Lead
-- and one Sponsor, both drawn from the REFERENCE - Church Staff list.
-- The legacy free-text `team` column is left in place for any existing
-- rows; the new UI no longer reads or writes it.
ALTER TABLE mir_docs ADD COLUMN lead_person_id TEXT;
ALTER TABLE mir_docs ADD COLUMN sponsor_person_id TEXT;
