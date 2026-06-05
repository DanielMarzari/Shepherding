-- Road "web": a single deduplicated mesh of the road segments people
-- drive from Faith Church, built incrementally. When a home is routed
-- (OSRM /route geometry), each consecutive coordinate pair becomes a
-- segment keyed by its quantized endpoints; shared roads collapse to one
-- row and accumulate a usage count. So the table size is bounded by the
-- road network (not the number of homes), and routing a new home just
-- bumps existing segments + adds a few new ones — exactly the mesh model.
CREATE TABLE IF NOT EXISTS road_mesh (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  seg_key TEXT NOT NULL,   -- canonical quantized endpoint pair
  ax REAL NOT NULL, ay REAL NOT NULL,   -- endpoint A lng/lat
  bx REAL NOT NULL, by REAL NOT NULL,   -- endpoint B lng/lat
  usage INTEGER NOT NULL DEFAULT 0,     -- how many homes' routes use it
  PRIMARY KEY (org_id, seg_key)
);
CREATE INDEX IF NOT EXISTS road_mesh_org_usage ON road_mesh(org_id, usage DESC);

-- Which homes have already been folded into the mesh (so we add each
-- home's route once, incrementally).
CREATE TABLE IF NOT EXISTS person_mesh (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL,
  meshed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, person_id)
);
