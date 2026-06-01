-- Email → person lookup for the public shepherd-intake page. We store
-- ONLY a keyed HMAC of the lowercased email (never the plaintext) so a
-- shepherd can identify themselves by email without us holding raw
-- addresses at rest. One row per (person, email) — a person can have
-- several addresses; a shared family address can map to several people.
CREATE TABLE IF NOT EXISTS pco_person_emails (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (org_id, person_id, email_hash)
);
CREATE INDEX IF NOT EXISTS pco_person_emails_hash
  ON pco_person_emails(email_hash);
CREATE INDEX IF NOT EXISTS pco_person_emails_person
  ON pco_person_emails(org_id, person_id);

-- "I know this person" marks made by shepherd-team members on the
-- public intake page. This is deliberately SEPARATE from
-- care_assignments: marking that you know someone is a signal to the
-- admin, who then decides whether to formally assign them to you.
CREATE TABLE IF NOT EXISTS shepherd_known_people (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shepherd_person_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (org_id, shepherd_person_id, person_id)
);
CREATE INDEX IF NOT EXISTS shepherd_known_people_person
  ON shepherd_known_people(org_id, person_id);
