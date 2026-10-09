-- Phase 3: the USDA key allows about 1,000 requests an hour, and every user
-- shares it. Count each user's requests this hour so no one person (or a
-- script signed in as them) can use up the key for everyone.
-- Deleting a user must delete their row here too.

CREATE TABLE usda_usage (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  hour TEXT NOT NULL,                           -- UTC hour being counted, 'YYYY-MM-DDTHH'
  calls INTEGER NOT NULL                        -- USDA requests made in that hour
);
