-- Denormalized "is this person currently under 18?" flag, derived from
-- the encrypted birthdate at sync time. Used by populateShepherdedTempTable
-- when scoring check-ins to shepherded events: only kids/students count
-- as shepherded by their check-in (an adult checking into a kids event
-- is the parent/leader doing the check-in, not the one being shepherded).
ALTER TABLE pco_people ADD COLUMN is_minor INTEGER NOT NULL DEFAULT 0;
