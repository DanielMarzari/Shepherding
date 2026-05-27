-- The /lanes sankey needs to know WHEN each person first entered each
-- lane, not just whether they're in it today. Adding the per-person
-- "earliest joined" timestamps to person_activity so the flow chart
-- can read everything from one indexed table instead of running a
-- correlated subquery per person on every render.
ALTER TABLE person_activity ADD COLUMN first_comm_at TEXT;
ALTER TABLE person_activity ADD COLUMN first_serv_at TEXT;
