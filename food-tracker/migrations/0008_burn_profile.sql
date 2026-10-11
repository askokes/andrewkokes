-- What the app needs to work out the calories a user burns in a day: sex, birth year (from the age they
-- give), activity level and, optionally, height. Weight comes from weigh-ins. The typed-in
-- goals.baseline_calories (0007) is no longer read: the number is always worked out now.

ALTER TABLE users ADD COLUMN sex TEXT;
ALTER TABLE users ADD COLUMN birth_year INTEGER;
ALTER TABLE users ADD COLUMN height_in REAL;
ALTER TABLE users ADD COLUMN activity TEXT;
