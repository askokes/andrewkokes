-- Phase 3: remember brand names, and cache USDA search results so repeat
-- lookups ("chicken breast" again tomorrow) never hit the API.

ALTER TABLE usda_cache ADD COLUMN brand TEXT;

CREATE TABLE usda_search_cache (
  query TEXT NOT NULL,                          -- normalized search text
  scope TEXT NOT NULL,                          -- 'core' (Foundation + SR Legacy) or 'branded'
  fdc_ids TEXT NOT NULL,                        -- JSON array of fdcIds, best match first
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (query, scope)
);
