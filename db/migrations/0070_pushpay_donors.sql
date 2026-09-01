-- PushPay giving import. We don't hit the PushPay API — an admin drops the
-- "All Donors" CSV export (First/Last, Email, Phone, Donor Stage, Giving
-- Channel, Last Gift date + fund). Donor PII is encrypted at rest (enc); we
-- keep only keyed HMAC tokens (name_hash, email_hash) for matching to
-- pco_people, the same way pco_person_emails avoids storing plaintext.
CREATE TABLE IF NOT EXISTS pushpay_donors (
  org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  donor_key     TEXT NOT NULL,           -- row id within an import (stable per re-import)
  enc           TEXT NOT NULL,           -- encryptJson({firstName,lastName,email,phone})
  name_hash     TEXT,                    -- hmac(normalized "first last")
  email_hash    TEXT,                    -- hmac(lower(trim(email))) or null
  donor_stage   TEXT,                    -- Occasional / Lapsed / Regular / Recurring / First Time …
  giving_channel TEXT,                   -- Offline / Digital / Other
  last_gift_date TEXT,                   -- ISO 'YYYY-MM-DD' (parsed from DD-Mon-YY)
  last_gift_fund TEXT,
  person_id     TEXT,                    -- matched pco_people.pco_id (null until matched/assigned)
  match_status  TEXT NOT NULL,           -- matched | manual | ambiguous | unmatched
  candidate_ids TEXT,                    -- JSON array of pco ids when ambiguous
  imported_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, donor_key)
);
CREATE INDEX IF NOT EXISTS pushpay_donors_person ON pushpay_donors(org_id, person_id);
CREATE INDEX IF NOT EXISTS pushpay_donors_status ON pushpay_donors(org_id, match_status);

-- One row per org: metadata about the most recent import.
CREATE TABLE IF NOT EXISTS pushpay_import (
  org_id      INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  file_name   TEXT,
  total       INTEGER NOT NULL DEFAULT 0,
  matched     INTEGER NOT NULL DEFAULT 0,
  ambiguous   INTEGER NOT NULL DEFAULT 0,
  unmatched   INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
