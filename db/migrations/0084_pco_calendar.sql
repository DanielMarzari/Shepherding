-- PCO Calendar. The app has never read it, and it is the only record of what
-- the building is actually asked to do: 6,258 events, 38,639 occurrences of
-- them, 66 rooms, and 115,181 bookings of those rooms.
--
-- The Facilities report's first three Outputs — events served, staff served,
-- events needing a setup — have no other source. PCO Services plans were
-- standing in for "events to support", which only ever counted Sunday services
-- and rehearsals: a funeral, a wedding, a Preschool open house and every
-- outside group renting the Center were invisible.

-- An Event is the DEFINITION ("WORSHIP Rehearsal: LIVE"). It carries no date.
-- owner_id is the person who requested it — "staff served". PCO sends
-- {"type":"Person","id":"null_person"} for an event nobody owns; that is stored
-- as NULL, not as the string.
CREATE TABLE IF NOT EXISTS pco_calendar_events (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id TEXT NOT NULL,
  name TEXT,
  approval_status TEXT,
  percent_approved INTEGER,
  visible_in_church_center INTEGER NOT NULL DEFAULT 0,
  owner_id TEXT,
  pco_created_at TEXT,
  pco_updated_at TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);
CREATE INDEX IF NOT EXISTS pco_calendar_events_owner
  ON pco_calendar_events(org_id, owner_id);

-- An EventInstance is one OCCURRENCE, and the only thing with a date on it.
-- A weekly rehearsal is one event and fifty-two instances, so the instance is
-- the unit of "an event the building served".
CREATE TABLE IF NOT EXISTS pco_calendar_event_instances (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  name TEXT,
  location TEXT,
  starts_at TEXT,
  ends_at TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  recurrence TEXT,
  pco_created_at TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);
CREATE INDEX IF NOT EXISTS pco_calendar_instances_when
  ON pco_calendar_event_instances(org_id, starts_at);
CREATE INDEX IF NOT EXISTS pco_calendar_instances_event
  ON pco_calendar_event_instances(org_id, event_id);

-- kind is 'Room' (66 of them: The Chapel, The Center, 117A, the parking lots,
-- even the exterior doors) or 'Resource' (24: tables, chairs, the portable
-- baptismal, the lift). quantity is how many of the resource exist.
CREATE TABLE IF NOT EXISTS pco_calendar_resources (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id TEXT NOT NULL,
  name TEXT,
  kind TEXT,
  path_name TEXT,
  quantity INTEGER,
  expires_at TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);

-- An EventResourceRequest is the ask: this event needs this room, or these
-- tables, with these instructions. `notes` is the setup itself — "5 round
-- tables 8 chairs per table and 2 long rectangular tables for food" — and
-- room_setup_id names a saved layout. This, not a room booking, is what
-- distinguishes an event somebody has to set up from an event that merely
-- happens in a room.
CREATE TABLE IF NOT EXISTS pco_calendar_resource_requests (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id TEXT NOT NULL,
  event_id TEXT,
  resource_id TEXT,
  quantity INTEGER,
  notes TEXT,
  approval_status TEXT,
  room_setup_id TEXT,
  pco_created_at TEXT,
  pco_updated_at TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);
CREATE INDEX IF NOT EXISTS pco_calendar_requests_event
  ON pco_calendar_resource_requests(org_id, event_id);
CREATE INDEX IF NOT EXISTS pco_calendar_requests_resource
  ON pco_calendar_resource_requests(org_id, resource_id);

-- A ResourceBooking is a request materialised against ONE occurrence, with the
-- real clock times including setup and teardown buffer. This is what room
-- utilisation is computed from.
CREATE TABLE IF NOT EXISTS pco_calendar_resource_bookings (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id TEXT NOT NULL,
  event_id TEXT,
  event_instance_id TEXT,
  resource_id TEXT,
  starts_at TEXT,
  ends_at TEXT,
  quantity INTEGER,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);
CREATE INDEX IF NOT EXISTS pco_calendar_bookings_room_when
  ON pco_calendar_resource_bookings(org_id, resource_id, starts_at);
CREATE INDEX IF NOT EXISTS pco_calendar_bookings_instance
  ON pco_calendar_resource_bookings(org_id, event_instance_id);
CREATE INDEX IF NOT EXISTS pco_calendar_bookings_event
  ON pco_calendar_resource_bookings(org_id, event_id);
