-- Apple Watch activity, sent by an Apple Shortcut on the person's iPhone (src/watch.ts).

-- The sync key the Shortcut sends, as a SHA-256 hash. Null until they connect.
ALTER TABLE users ADD COLUMN watch_key_hash TEXT;
CREATE UNIQUE INDEX idx_users_watch_key ON users(watch_key_hash);

-- One row a day: the day's totals as of the last sync. A field the Shortcut
-- didn't send stays null.
CREATE TABLE watch_days (
  user_id INTEGER NOT NULL REFERENCES users(id),
  log_date TEXT NOT NULL,                       -- YYYY-MM-DD in the user's timezone
  active_kcal REAL,
  resting_kcal REAL,
  steps INTEGER,
  synced_at TEXT NOT NULL,                      -- ISO time of the last sync that day
  PRIMARY KEY (user_id, log_date)
);
