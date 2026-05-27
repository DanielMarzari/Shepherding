-- Aggregated lane-state transitions across every person's full
-- chronology. Each person's group/team join/leave events are sorted
-- chronologically into a state timeline (none / comm / serv / both)
-- and every (prev_state, next_state) transition contributes +1 to
-- the matching row here. Rebuilt by refreshDashboardSnapshots.
--
-- Same-state-to-same-state edges aren't stored — they're not
-- transitions by definition (a person joining a 2nd group while
-- already in another group doesn't change their lane state).
CREATE TABLE IF NOT EXISTS lane_transitions (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, from_state, to_state)
);
