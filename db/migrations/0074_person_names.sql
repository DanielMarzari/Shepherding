-- Plaintext person names for fast reads. The dominant render cost was
-- decrypting every person's enc_pii just to read their name (search on every
-- keystroke, relationship graph, name audit). Names are low-sensitivity;
-- email/phone stay HMAC-only lookups and address + birthdate stay encrypted
-- inside enc_pii. Populated by the PCO people sync (upsertPerson) and a
-- one-time backfill (backfillPersonNames) for rows synced before this landed.
ALTER TABLE pco_people ADD COLUMN first_name TEXT;
ALTER TABLE pco_people ADD COLUMN last_name TEXT;
