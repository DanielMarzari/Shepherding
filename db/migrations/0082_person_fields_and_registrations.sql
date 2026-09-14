-- Two PCO sources the app has never read.
--
-- 1. Person custom fields. Faith Church records Baptism as a date on the
--    "Membership and Assimilation" tab — 1,006 people have one — and the
--    Adult Discipleship report's "# of baptisms" Output has sat unmeasured
--    because nothing synced it. Only the fields an allowlist names are stored
--    (see PERSON_FIELD_ALLOWLIST in pco-sync.ts); the same tab also holds Date
--    of Death and Date Widowed, which nothing needs and which are nobody's
--    business by default.
--
--    value keeps whatever PCO returned; value_date is that parsed to ISO.
--    PCO hands back "06/29/2003", which sorts and groups as nonsense in SQLite,
--    so the normalization happens once at sync time rather than in every query.
CREATE TABLE IF NOT EXISTS pco_person_fields (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  value TEXT,
  value_date TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, person_id, field_id)
);
CREATE INDEX IF NOT EXISTS pco_person_fields_by_field
  ON pco_person_fields(org_id, field_name, value_date);

-- 2. Registrations. The Discover courses — Discover Jesus, Discover Evangelism,
--    Discover Baptism, Discover the Bible and the rest — are Registrations
--    signups, not groups and not check-in events, which is why "# of people who
--    attend adult discipleship events" could not be answered. Attendees carry a
--    person id in the same namespace as pco_people.pco_id (verified: 155 of 155
--    attendees across three courses resolved to a person we already hold), so
--    attendance joins straight to engaged adults.
CREATE TABLE IF NOT EXISTS pco_registration_signups (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id TEXT NOT NULL,
  name TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  open INTEGER NOT NULL DEFAULT 0,
  pco_created_at TEXT,
  pco_updated_at TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);

CREATE TABLE IF NOT EXISTS pco_registration_attendees (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id TEXT NOT NULL,
  signup_id TEXT NOT NULL,
  person_id TEXT,
  canceled INTEGER NOT NULL DEFAULT 0,
  waitlisted INTEGER NOT NULL DEFAULT 0,
  pco_created_at TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);
CREATE INDEX IF NOT EXISTS pco_registration_attendees_signup
  ON pco_registration_attendees(org_id, signup_id);
CREATE INDEX IF NOT EXISTS pco_registration_attendees_person
  ON pco_registration_attendees(org_id, person_id);
