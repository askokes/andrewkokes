-- The calories a user burns in a normal day (maintenance), optional. Kept with the goals so it has the
-- same history: a change starts today and earlier days keep the number they had.

ALTER TABLE goals ADD COLUMN baseline_calories INTEGER;
