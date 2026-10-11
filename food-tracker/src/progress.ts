// Progress API (SPEC section 9): daily totals for charts, and weigh-ins. Every
// route needs a profile and is scoped to the signed-in user's id.
import { Hono, type Context } from "hono";
import { addDays, isCalendarDate, localDate } from "./dates";
import type { AppEnv } from "./env";
import type { DaySummary, GoalsSnapshot, SummaryResponse, WeightEntry, WeightResponse } from "./food/types";
import { checkDate, DATE_ERROR, FIRST_DATE } from "./food/input";
import { getUser, noProfile, readJson, type UserRow } from "./profile";
import { isBlank, isObject, type FieldErrors } from "./validate";

type Ctx = Context<AppEnv>;

/** Longest range one request may ask for: a year and change, enough for any chart. */
export const MAX_RANGE_DAYS = 400;
export const MIN_WEIGHT_LB = 50;
export const MAX_WEIGHT_LB = 1000;

const round1 = (n: number) => Math.round(n * 10) / 10;

function invalid(c: Ctx, fields: FieldErrors) {
  const messages = Object.values(fields);
  return c.json(
    { error: "invalid_input", message: messages.length === 1 ? messages[0] : "Please check the highlighted fields.", fields },
    400,
  );
}

const weightNotFound = (c: Ctx) =>
  c.json({ error: "not_found", message: "We couldn't find that weigh-in. It may have been deleted." }, 404);

/** Days between two YYYY-MM-DD dates, inclusive. */
function spanDays(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * ?from=&to= for a chart. Both default to the last 30 days ending today; from
 * may not be after to, the range is capped, and to stops at tomorrow.
 */
type Range = { ok: true; from: string; to: string } | { ok: false; errors: FieldErrors };

function readRange(c: Ctx, today: string): Range {
  const rawFrom = c.req.query("from");
  const rawTo = c.req.query("to");
  const to = rawTo === undefined ? today : checkDate(rawTo, today);
  const from = rawFrom === undefined ? addDays(to ?? today, -29) : rawFrom.trim();
  const errors: FieldErrors = {};
  if (!to) errors.to = DATE_ERROR;
  if (!isCalendarDate(from) || from < FIRST_DATE) errors.from = "Pick a real start date.";
  if (Object.keys(errors).length || !to) return { ok: false, errors };
  if (from > to) return { ok: false, errors: { from: "The start date has to be on or before the end date." } };
  if (spanDays(from, to) > MAX_RANGE_DAYS) return { ok: false, errors: { from: `Ask for at most ${MAX_RANGE_DAYS} days at a time.` } };
  return { ok: true, from, to };
}

interface GoalRow {
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  baseline_calories: number | null;
  effective_from: string;
}

/**
 * The goals in effect on each date, from the whole goal history in one query.
 * Same rule as goalsOn in profile.ts: the latest row that had started by then,
 * else the earliest row.
 */
function goalsByDate(rows: GoalRow[]) {
  // rows are ordered by effective_from, id: the last started row wins.
  const snapshot = (r: GoalRow): GoalsSnapshot => ({
    calories: r.calories,
    proteinG: r.protein_g,
    carbsG: r.carbs_g,
    fatG: r.fat_g,
    baselineCalories: r.baseline_calories,
  });
  // What a user burns isn't a target they set for a day: the first baseline they enter also stands for the
  // days before it, so the line shows across the chart at once. A later change (or clearing it) starts on
  // its own day, like any goal.
  const firstBaseline = rows.findIndex((r) => r.baseline_calories !== null);
  return (date: string): GoalsSnapshot | null => {
    if (!rows.length) return null;
    let at = 0;
    rows.forEach((r, i) => {
      if (r.effective_from <= date) at = i;
    });
    const goals = snapshot(rows[at]);
    if (firstBaseline > at) goals.baselineCalories = rows[firstBaseline].baseline_calories;
    return goals;
  };
}

async function weightsBetween(db: D1Database, userId: number, from: string, to: string): Promise<WeightEntry[]> {
  const { results } = await db
    .prepare("SELECT id, log_date, weight_lb FROM weight_entries WHERE user_id = ? AND log_date BETWEEN ? AND ? ORDER BY log_date")
    .bind(userId, from, to)
    .all<{ id: number; log_date: string; weight_lb: number }>();
  return results.map((r) => ({ id: r.id, date: r.log_date, weightLb: r.weight_lb }));
}

export const progressRoutes = new Hono<AppEnv>();

const currentUser = (c: Ctx): Promise<UserRow | null> => getUser(c.env.DB, c.get("email"));

progressRoutes.get("/summary", async (c) => {
  const user = await currentUser(c);
  if (!user) return noProfile(c);
  const today = localDate(user.timezone);
  const range = readRange(c, today);
  if (!range.ok) return invalid(c, range.errors);
  const { from, to } = range;

  const db = c.env.DB;
  const [totals, goals] = await Promise.all([
    db
      .prepare(
        `SELECT log_date, SUM(calories) AS calories, SUM(protein_g) AS protein_g, SUM(carbs_g) AS carbs_g,
           SUM(fat_g) AS fat_g, COUNT(*) AS entries
         FROM food_entries WHERE user_id = ? AND log_date BETWEEN ? AND ? GROUP BY log_date`,
      )
      .bind(user.id, from, to)
      .all<{ log_date: string; calories: number; protein_g: number; carbs_g: number; fat_g: number; entries: number }>(),
    db
      .prepare(
        "SELECT calories, protein_g, carbs_g, fat_g, baseline_calories, effective_from FROM goals WHERE user_id = ? ORDER BY effective_from, id",
      )
      .bind(user.id)
      .all<GoalRow>(),
  ]);
  const byDate = new Map(totals.results.map((r) => [r.log_date, r]));
  const goalOn = goalsByDate(goals.results);

  const days: DaySummary[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const r = byDate.get(date);
    days.push({
      date,
      calories: round1(r?.calories ?? 0),
      proteinG: round1(r?.protein_g ?? 0),
      carbsG: round1(r?.carbs_g ?? 0),
      fatG: round1(r?.fat_g ?? 0),
      entries: r?.entries ?? 0,
      goal: goalOn(date),
    });
  }
  const body: SummaryResponse = { from, to, today, days };
  return c.json(body);
});

progressRoutes.get("/weight", async (c) => {
  const user = await currentUser(c);
  if (!user) return noProfile(c);
  const today = localDate(user.timezone);
  const range = readRange(c, today);
  if (!range.ok) return invalid(c, range.errors);
  const { from, to } = range;
  const body: WeightResponse = { from, to, today, entries: await weightsBetween(c.env.DB, user.id, from, to) };
  return c.json(body);
});

// One weigh-in per day: logging again the same day replaces it (SPEC section 5).
progressRoutes.post("/weight", async (c) => {
  const user = await currentUser(c);
  if (!user) return noProfile(c);
  const today = localDate(user.timezone);
  const raw = await readJson(c);
  if (!isObject(raw)) return invalid(c, { body: "Expected a JSON object." });

  const errors: FieldErrors = {};
  const date = isBlank(raw.date) ? today : checkDate(raw.date, today);
  if (!date) errors.date = DATE_ERROR;
  const n = typeof raw.weightLb === "string" ? Number(raw.weightLb.trim()) : raw.weightLb;
  const valid = typeof n === "number" && Number.isFinite(n) && n >= MIN_WEIGHT_LB && n <= MAX_WEIGHT_LB;
  if (!valid) errors.weightLb = `Enter a weight between ${MIN_WEIGHT_LB} and ${MAX_WEIGHT_LB.toLocaleString("en-US")} lb.`;
  if (Object.keys(errors).length) return invalid(c, errors);

  const weightLb = round1(n as number);
  const row = await c.env.DB.prepare(
    `INSERT INTO weight_entries (user_id, log_date, weight_lb) VALUES (?, ?, ?)
     ON CONFLICT(user_id, log_date) DO UPDATE SET weight_lb = excluded.weight_lb, created_at = datetime('now')
     RETURNING id`,
  )
    .bind(user.id, date, weightLb)
    .first<{ id: number }>();
  const entry: WeightEntry = { id: row!.id, date: date!, weightLb };
  return c.json({ entry, today }, 201);
});

progressRoutes.delete("/weight/:id", async (c) => {
  const user = await currentUser(c);
  if (!user) return noProfile(c);
  const id = c.req.param("id");
  if (!/^\d{1,15}$/.test(id) || Number(id) <= 0) return weightNotFound(c);
  const row = await c.env.DB.prepare("DELETE FROM weight_entries WHERE id = ? AND user_id = ? RETURNING id")
    .bind(Number(id), user.id)
    .first<{ id: number }>();
  if (!row) return weightNotFound(c);
  return c.json({ deleted: row.id });
});
