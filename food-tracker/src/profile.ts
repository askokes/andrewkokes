import { Hono, type Context } from "hono";
import { localDate } from "./dates";
import type { AppEnv } from "./env";
import { parseGoals, parseProfile, type FieldErrors, type GoalsInput } from "./validate";

export interface UserRow {
  id: number;
  email: string;
  display_name: string;
  timezone: string;
  track_weight: number;
}

interface GoalRow {
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  goal_weight_lb: number | null;
  effective_from: string;
}

export function getUser(db: D1Database, email: string) {
  return db
    .prepare("SELECT id, email, display_name, timezone, track_weight FROM users WHERE email = ?")
    .bind(email)
    .first<UserRow>();
}

/** Goals in effect on `today`: the latest row that has started, else the latest row at all. */
function currentGoals(db: D1Database, userId: number, today: string) {
  return db
    .prepare(
      `SELECT calories, protein_g, carbs_g, fat_g, goal_weight_lb, effective_from FROM goals
       WHERE user_id = ? ORDER BY (effective_from <= ?) DESC, effective_from DESC, id DESC LIMIT 1`,
    )
    .bind(userId, today)
    .first<GoalRow>();
}

/**
 * Goals in effect on a past or future `date` (goal history): the latest row
 * that had started by then, else the earliest row, since a day logged before
 * the first goals were set is best judged against those.
 */
export function goalsOn(db: D1Database, userId: number, date: string) {
  return db
    .prepare(
      `SELECT calories, protein_g, carbs_g, fat_g, goal_weight_lb, effective_from FROM goals
       WHERE user_id = ?
       ORDER BY (effective_from <= ?) DESC, CASE WHEN effective_from <= ? THEN effective_from END DESC,
         effective_from ASC, id DESC
       LIMIT 1`,
    )
    .bind(userId, date, date)
    .first<GoalRow>();
}

function latestWeight(db: D1Database, userId: number) {
  return db
    .prepare("SELECT weight_lb, log_date FROM weight_entries WHERE user_id = ? ORDER BY log_date DESC LIMIT 1")
    .bind(userId)
    .first<{ weight_lb: number; log_date: string }>();
}

function sameGoals(row: GoalRow | null, goals: GoalsInput) {
  return (
    row !== null &&
    row.calories === goals.calories &&
    row.protein_g === goals.proteinG &&
    row.carbs_g === goals.carbsG &&
    row.fat_g === goals.fatG &&
    row.goal_weight_lb === goals.goalWeightLb
  );
}

/** New goals row effective today. Earlier rows stay as history. */
function insertGoals(db: D1Database, email: string, goals: GoalsInput, today: string) {
  return db
    .prepare(
      `INSERT INTO goals (user_id, calories, protein_g, carbs_g, fat_g, goal_weight_lb, effective_from)
       SELECT id, ?, ?, ?, ?, ?, ? FROM users WHERE email = ?`,
    )
    .bind(goals.calories, goals.proteinG, goals.carbsG, goals.fatG, goals.goalWeightLb, today, email);
}

async function loadMe(db: D1Database, email: string) {
  const user = await getUser(db, email);
  if (!user) return null;
  const today = localDate(user.timezone);
  const [goals, weight] = await Promise.all([currentGoals(db, user.id, today), latestWeight(db, user.id)]);
  const trackWeight = user.track_weight === 1;
  return {
    email: user.email,
    displayName: user.display_name,
    timezone: user.timezone,
    trackWeight,
    today,
    goals: goals && {
      calories: goals.calories,
      proteinG: goals.protein_g,
      carbsG: goals.carbs_g,
      fatG: goals.fat_g,
      goalWeightLb: goals.goal_weight_lb,
      effectiveFrom: goals.effective_from,
    },
    latestWeight: trackWeight && weight ? { weightLb: weight.weight_lb, date: weight.log_date } : null,
  };
}

export async function readJson(c: Context<AppEnv>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

const invalid = (c: Context<AppEnv>, fields: FieldErrors) =>
  c.json({ error: "invalid_input", message: "Please check the highlighted fields.", fields }, 400);

export const noProfile = (c: Context<AppEnv>) =>
  c.json({ error: "no_profile", message: "Set up your profile first.", email: c.get("email") }, 404);

export const profileRoutes = new Hono<AppEnv>();

profileRoutes.get("/me", async (c) => {
  const me = await loadMe(c.env.DB, c.get("email"));
  return me ? c.json(me) : noProfile(c);
});

// Create or update the profile. On create, goals are required. Optionally sets
// new goals and today's weight in the same atomic batch.
profileRoutes.post("/me", async (c) => {
  const db = c.env.DB;
  const email = c.get("email");
  const existing = await getUser(db, email);

  const parsed = parseProfile(await readJson(c), existing === null);
  if (!parsed.ok) return invalid(c, parsed.errors);
  const input = parsed.value;
  const today = localDate(input.timezone);

  const statements = [
    db
      .prepare(
        `INSERT INTO users (email, display_name, timezone, track_weight) VALUES (?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET display_name = excluded.display_name,
           timezone = excluded.timezone, track_weight = excluded.track_weight`,
      )
      .bind(email, input.displayName, input.timezone, input.trackWeight ? 1 : 0),
  ];
  if (input.goals) {
    const current = existing ? await currentGoals(db, existing.id, today) : null;
    if (!sameGoals(current, input.goals)) statements.push(insertGoals(db, email, input.goals, today));
  }
  if (input.currentWeightLb !== null) {
    statements.push(
      db
        .prepare(
          `INSERT INTO weight_entries (user_id, log_date, weight_lb)
           SELECT id, ?, ? FROM users WHERE email = ?
           ON CONFLICT(user_id, log_date) DO UPDATE SET weight_lb = excluded.weight_lb, created_at = datetime('now')`,
        )
        .bind(today, input.currentWeightLb, email),
    );
  }
  await db.batch(statements);

  return c.json(await loadMe(db, email), existing ? 200 : 201);
});

profileRoutes.post("/goals", async (c) => {
  const db = c.env.DB;
  const email = c.get("email");
  const user = await getUser(db, email);
  if (!user) return noProfile(c);

  const parsed = parseGoals(await readJson(c));
  if (!parsed.ok) return invalid(c, parsed.errors);

  const today = localDate(user.timezone);
  if (!sameGoals(await currentGoals(db, user.id, today), parsed.value)) {
    await insertGoals(db, email, parsed.value, today).run();
  }
  return c.json(await loadMe(db, email));
});
