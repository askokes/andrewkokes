-- The weight plan on the Goals tab (see src/plan.ts): lose, keep or gain, and
-- how many pounds a week or a month. Kept so the calculator opens on the
-- person's own plan; the daily goals it works out are saved as goals rows.

ALTER TABLE users ADD COLUMN plan_goal TEXT;   -- lose | keep | gain, null until chosen
ALTER TABLE users ADD COLUMN plan_lb REAL;     -- pounds per plan_per
ALTER TABLE users ADD COLUMN plan_per TEXT;    -- week | month
