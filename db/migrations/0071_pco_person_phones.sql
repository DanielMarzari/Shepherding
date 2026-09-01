-- Keyed-HMAC phone lookup for people, mirroring pco_person_emails. Lets us
-- match PushPay donors (and future integrations) to a person by phone
-- without ever storing a plaintext number at rest. Populated by the PCO
-- people sync from each person's PhoneNumbers, normalized to US 10-digit
-- (see src/lib/phone.ts) before hashing.
CREATE TABLE IF NOT EXISTS pco_person_phones (
  org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person_id  TEXT NOT NULL,
  phone_hash TEXT NOT NULL,
  PRIMARY KEY (org_id, person_id, phone_hash)
);
CREATE INDEX IF NOT EXISTS pco_person_phones_hash ON pco_person_phones(org_id, phone_hash);
