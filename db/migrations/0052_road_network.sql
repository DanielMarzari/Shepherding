-- Road "network": each road that any household drives to Faith Church,
-- stored ONCE. Replaces the old 1-meter-segment mesh (road_mesh), which
-- exploded into ~257k tiny pieces and then had to hide the low-traffic
-- tips (so houses looked disconnected). Here we use OSRM's named route
-- steps: each step is a stretch of a named road, deduped by name +
-- quantized endpoints. A road's PRESENCE means a household needs it —
-- no usage weighting. Bounded by the road network, not the home count.
CREATE TABLE IF NOT EXISTS road_network (
  org_id   INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  road_key TEXT NOT NULL,           -- name + quantized endpoints (dedupe)
  name     TEXT,                    -- road name (for the hover tooltip)
  geom     TEXT NOT NULL,           -- JSON [[lng,lat], ...] polyline
  PRIMARY KEY (org_id, road_key)
);
CREATE INDEX IF NOT EXISTS road_network_org ON road_network(org_id);

-- person_mesh already tracks which homes have been folded in; reused as-is.
-- (The road_mesh table from 0051 is left in place but no longer read.)
