import { Hono, type Context } from "hono";
import { isAdmin } from "./admins";
import { ageOn, caloriesBurned, weightOn, type Activity, type BurnProfile, type Sex } from "./burn";
import type { PlanGoal, PlanPer } from "./plan";
import { localDate } from "./dates";
import type { AppEnv } from "./env";
import { parseGoals, parseProfile, type FieldErrors, type GoalsInput } from "./validate";

export interface UserRow {
  id: number;
  email: string;
  display_name: string;
  timezone: string;
  track_weight: number;
  sex: Sex | null;
  birth_year: number | null;
  height_in: number | null;
  activity: Activity | null;
  plan_goal: PlanGoal | null;
  plan_lb: number | null;
  plan_per: PlanPer | null;
}

interface GoalRow {
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  goal_weight_lb: number | null;
  baseline_calories: number | null;
  effective_from: string;
}

export function getUser(db: D1Database, email: string) {
  return db
    .prepare(
      `SELECT id, email, display_name, timezone, track_weight, sex, birth_year, height_in, activity, plan_goal, plan_lb, plan_per
       FROM users WHERE email = ?`,
    )
    .bind(email)
    .first<UserRow>();
}

/** Goals in effect on `today`: the latest row that has started, else the latest row at all. */
function currentGoals(db: D1Database, userId: number, today: string) {
  return db
    .prepare(
      `SELECT calories, protein_g, carbs_g, fat_g, goal_weight_lb, baseline_calories, effective_from FROM goals
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
      `SELECT calories, protein_g, carbs_g, fat_g, goal_weight_lb, baseline_calories, effective_from FROM goals
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

export const burnProfileOf = (user: UserRow): BurnProfile => ({
  sex: user.sex,
  birthYear: user.birth_year,
  heightIn: user.height_in,
  activity: user.activity,
});

/** Every weigh-in, oldest first, for the calories-burned estimate (see weightOn). */
export async function weighInsOf(db: D1Database, userId: number) {
  const { results } = await db
    .prepare("SELECT log_date, weight_lb FROM weight_entries WHERE user_id = ? ORDER BY log_date")
    .bind(userId)
    .all<{ log_date: string; weight_lb: number }>();
  return results.map((r) => ({ date: r.log_date, weightLb: r.weight_lb }));
}

/** The calories the user burns in a normal day as of `date`, or null when the Goals tab is missing something. */
export async function baselineOn(db: D1Database, user: UserRow, date: string): Promise<number | null> {
  const profile = burnProfileOf(user);
  if (!profile.sex || profile.birthYear === null || !profile.activity) return null;
  return caloriesBurned(profile, weightOn(await weighInsOf(db, user.id), date), date);
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

async function loadMe(db: D1Database, email: string, env: { ADMIN_EMAILS?: string }) {
  const user = await getUser(db, email);
  if (!user) return null;
  const today = localDate(user.timezone);
  const [goals, weight, weighIns] = await Promise.all([currentGoals(db, user.id, today), latestWeight(db, user.id), weighInsOf(db, user.id)]);
  const trackWeight = user.track_weight === 1;
  const burnWeight = weightOn(weighIns, today);
  return {
    email: user.email,
    displayName: user.display_name,
    timezone: user.timezone,
    trackWeight,
    today,
    /** May add people from the Goals tab (see invites.ts). */
    canInvite: isAdmin(env, user.email),
    goals: goals && {
      calories: goals.calories,
      proteinG: goals.protein_g,
      carbsG: goals.carbs_g,
      fatG: goals.fat_g,
      goalWeightLb: goals.goal_weight_lb,
      baselineCalories: caloriesBurned(burnProfileOf(user), burnWeight, today),
      effectiveFrom: goals.effective_from,
    },
    // What the Goals tab shows and sends back for the calories-burned estimate.
    burn: {
      sex: user.sex,
      age: user.birth_year === null ? null : ageOn(user.birth_year, today),
      heightIn: user.height_in,
      activity: user.activity,
      /** The weight it uses: the last week's weigh-ins averaged, else the latest. */
      weightLb: burnWeight === null ? null : Math.round(burnWeight * 10) / 10,
    },
    latestWeight: trackWeight && weight ? { weightLb: weight.weight_lb, date: weight.log_date } : null,
    // The weight plan's choices, for the Goals tab's calculator.
    plan: user.plan_goal ? { goal: user.plan_goal, lb: user.plan_lb, per: user.plan_per ?? "week" } : null,
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
  const me = await loadMe(c.env.DB, c.get("email"), c.env);
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
  if (input.burn) {
    const b = input.burn;
    statements.push(
      db
        .prepare("UPDATE users SET sex = ?, birth_year = ?, height_in = ?, activity = ? WHERE email = ?")
        .bind(b.sex, b.age === null ? null : Number(today.slice(0, 4)) - b.age, b.heightIn, b.activity, email),
    );
  }
  if (input.plan !== undefined) {
    const p = input.plan;
    statements.push(
      db
        .prepare("UPDATE users SET plan_goal = ?, plan_lb = ?, plan_per = ? WHERE email = ?")
        .bind(p?.goal ?? null, p?.lb ?? null, p?.per ?? null, email),
    );
  }
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

  return c.json(await loadMe(db, email, c.env), existing ? 200 : 201);
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
  return c.json(await loadMe(db, email, c.env));
});
