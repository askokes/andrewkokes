-- Food Tracker v1 schema. See SPEC.md section 5.

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  track_weight INTEGER NOT NULL DEFAULT 0,      -- 0/1, optional feature toggle
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE goals (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  calories INTEGER NOT NULL,
  protein_g INTEGER,
  carbs_g INTEGER,
  fat_g INTEGER,
  goal_weight_lb REAL,                          -- optional
  effective_from TEXT NOT NULL,                 -- YYYY-MM-DD; keep history, latest wins
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_goals_user_effective ON goals(user_id, effective_from);

CREATE TABLE food_entries (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  log_date TEXT NOT NULL,                       -- YYYY-MM-DD in the user's timezone
  meal TEXT,                                    -- breakfast | lunch | dinner | snack, nullable
  spoken_text TEXT,                             -- raw transcript, for debugging
  food_name TEXT NOT NULL,
  fdc_id INTEGER,                               -- null for manual entries
  quantity REAL NOT NULL,
  unit TEXT NOT NULL,
  grams REAL NOT NULL,
  calories REAL NOT NULL,
  protein_g REAL NOT NULL,
  carbs_g REAL NOT NULL,
  fat_g REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_food_user_date ON food_entries(user_id, log_date);

CREATE TABLE weight_entries (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  log_date TEXT NOT NULL,
  weight_lb REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, log_date)                     -- one weigh-in per day, latest overwrites
);

CREATE TABLE usda_cache (
  fdc_id INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  data_type TEXT NOT NULL,
  kcal_per_100g REAL NOT NULL,
  protein_per_100g REAL NOT NULL,
  carbs_per_100g REAL NOT NULL,
  fat_per_100g REAL NOT NULL,
  portions_json TEXT,                           -- USDA foodPortions, for cup/each/slice conversions
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
