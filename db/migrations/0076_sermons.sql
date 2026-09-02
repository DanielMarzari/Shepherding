-- Sermon bridge: a local mirror of each Faith Church sermon (from the
-- separate "Sermon Lab" app) plus an LLM classification of what the sermon
-- was ABOUT and which next steps it called the congregation toward
-- (giving / groups / serving / outreach / …). This is what lets the
-- "Sermon impact" report line a sermon's theme up against measurable
-- congregation activity in the weeks that follow.
--
-- One row per sermon. source_id is Sermon Lab's sources.id (stable key we
-- re-import against). Classification columns stay NULL until the sermon has
-- been run through the classifier, so metadata can be imported first and
-- enriched later.
CREATE TABLE IF NOT EXISTS sermons (
  org_id        INTEGER NOT NULL,
  source_id     INTEGER NOT NULL,   -- Sermon Lab sources.id
  preached_on   TEXT    NOT NULL,   -- 'YYYY-MM-DD', snapped to the sermon's Sunday
  title         TEXT,
  scripture     TEXT,
  speaker       TEXT,
  word_count    INTEGER,            -- transcript length (sanity / coverage)
  -- --- classification (NULL until classified) ---
  topic         TEXT,               -- short primary theme, e.g. "Generosity"
  summary       TEXT,               -- 1-2 sentence plain summary
  -- next_steps: JSON object keyed by the canonical categories in
  -- sermon-impact.ts. Each value: {called:bool, intensity:0..3, quote:string}.
  -- intensity 0 = mentioned in passing, 3 = explicit repeated call to act.
  next_steps    TEXT,
  themes        TEXT,               -- JSON array of free-form theme tags
  confidence    REAL,               -- 0..1 classifier self-confidence
  classifier    TEXT,               -- model / prompt version that produced this
  classified_at TEXT,
  PRIMARY KEY (org_id, source_id)
);

CREATE INDEX IF NOT EXISTS idx_sermons_org_date ON sermons(org_id, preached_on);
