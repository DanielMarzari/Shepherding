-- Third bucket for check-in events: "adult events". Office Visitors,
-- adult Bible studies, etc. — events where checking in implies the
-- person is an adult (and so does NOT contribute to the kid /
-- shepherded count). Excluded from the shepherded set the same way
-- "ignored" events are, but ALSO drives an is_minor=0 overlay so a
-- known-adult-from-this-event isn't mis-flipped to is_minor=1 by a
-- separate kid-event check-in (e.g. an adult who once volunteered at
-- a kids event).
ALTER TABLE pco_sync_settings ADD COLUMN adult_checkin_events TEXT;
