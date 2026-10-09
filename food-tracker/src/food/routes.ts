// Food logging API (SPEC sections 7 and 9): read a meal phrase, look foods up
// in USDA, and keep the day's entries. Every route needs a profile, and every
// query is scoped to the signed-in user's id; no route takes a user id from
// the client.
import { Hono, type Context } from "hono";
import type { AppDeps } from "../app";
import { localDate } from "../dates";
import type { AppEnv } from "../env";
import { getUser, goalsOn, noProfile, readJson, type UserRow } from "../profile";
import { isObject, type FieldErrors } from "../validate";
import {
  checkDate,
  DATE_ERROR,
  MAX_MANUAL_QUANTITY,
  MAX_QUANTITY,
  parseEntryChanges,
  parseNewEntries,
  readQuantity,
} from "./input";
import { nutritionFor } from "./nutrition";
import { parseMeal } from "./parse";
import {
  MEALS,
  type Amount,
  type Candidate,
  type DayView,
  type EntryView,
  type FoodRecord,
  type LookupStatus,
  type Meal,
  type Nutrition,
  type ParseItemResult,
  type ParseResponse,
  type SearchResponse,
  type UnitOption,
} from "./types";
import { resolveAmount, toCandidate, unitOptions } from "./units";
import { getFoods, looksLikeBrand, searchFoods, UsdaError, type UsdaDeps, type UsdaErrorKind } from "./usda";

type Ctx = Context<AppEnv>;

const MAX_PARSE_ITEMS = 8;
const PARSE_LIMIT = 5;
const SEARCH_LIMIT = 8;
const WEIGHT_UNITS = new Set(["oz", "lb", "g"]);

const EMPTY_PARSE = 'Tell me what you ate, like "two eggs and a slice of toast".';
const USDA_MESSAGES: Record<UsdaErrorKind, string> = {
  rate_limited: "The food database is busy right now. Try again in a minute, or enter it yourself.",
  unavailable: "We couldn't reach the food database. Try again in a minute, or enter it yourself.",
};
const notFoundMessage = (food: string) => `We couldn't find "${food}". Try other words, or enter it yourself.`;

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- responses

function invalid(c: Ctx, fields: FieldErrors, message?: string) {
  const messages = Object.values(fields);
  const text = message ?? (messages.length === 1 ? messages[0] : "Please check the highlighted fields.");
  return c.json({ error: "invalid_input", message: text, fields }, 400);
}

const entryNotFound = (c: Ctx) =>
  c.json({ error: "not_found", message: "We couldn't find that entry. It may have been deleted." }, 404);

const usdaFailed = (c: Ctx, err: UsdaError) => c.json({ error: err.kind, message: USDA_MESSAGES[err.kind] }, 503);

// ---------------------------------------------------------------- lookups

interface Lookup {
  status: LookupStatus;
  message?: string;
  candidates: Candidate[];
}

/**
 * When a portion unit was spoken ("a cup of greek yogurt"), foods that really
 * have that unit go first, ahead of ones where it had to be guessed as 100 g.
 * Otherwise the search ranking stands.
 */
function preferSpokenUnit(candidates: Candidate[], unit: string | null): Candidate[] {
  if (unit === null || WEIGHT_UNITS.has(unit)) return candidates;
  return [...candidates.filter((c) => !c.amount.guessed), ...candidates.filter((c) => c.amount.guessed)];
}

/** Candidates for a food phrase. Never throws: a USDA failure becomes a status. */
async function lookup(
  usda: UsdaDeps,
  food: string,
  quantity: number,
  unit: string | null,
  opts: { limit: number; brandHint: boolean },
): Promise<Lookup> {
  let foods: FoodRecord[];
  try {
    foods = await searchFoods(usda, food, opts);
  } catch (err) {
    if (!(err instanceof UsdaError)) console.error("food lookup failed", err instanceof Error ? err.message : err);
    const kind: UsdaErrorKind = err instanceof UsdaError ? err.kind : "unavailable";
    return { status: kind, message: USDA_MESSAGES[kind], candidates: [] };
  }
  if (!foods.length) return { status: "not_found", message: notFoundMessage(food), candidates: [] };
  return { status: "ok", candidates: preferSpokenUnit(foods.map((f) => toCandidate(f, quantity, unit)), unit) };
}

/** Grams and nutrition for an amount of a food, or null if the unit isn't one of the food's units. */
function measure(food: FoodRecord, quantity: number, unit: string): { amount: Amount; nutrition: Nutrition } | null {
  if (!unitOptions(food).some((o) => o.unit === unit)) return null;
  const amount = resolveAmount(food, quantity, unit);
  if (amount.guessed) return null;
  return { amount, nutrition: nutritionFor(food.per100g, amount.grams) };
}

const scale = (n: Nutrition, factor: number): Nutrition => ({
  calories: round1(n.calories * factor),
  proteinG: round1(n.proteinG * factor),
  carbsG: round1(n.carbsG * factor),
  fatG: round1(n.fatG * factor),
});

// ---------------------------------------------------------------- entries

interface EntryRow {
  id: number;
  log_date: string;
  meal: string | null;
  food_name: string;
  fdc_id: number | null;
  quantity: number;
  unit: string;
  grams: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  created_at: string;
}

/** A food_entries row about to be inserted. */
interface NewRow {
  name: string;
  fdcId: number | null;
  quantity: number;
  unit: string;
  grams: number;
  nutrition: Nutrition;
}

const ENTRY_COLUMNS = `id, log_date, meal, food_name, fdc_id, quantity, unit, grams, calories, protein_g, carbs_g,
  fat_g, created_at`;

const toMeal = (meal: string | null): Meal | null => MEALS.find((m) => m === meal) ?? null;

const rowNutrition = (row: EntryRow): Nutrition => ({
  calories: row.calories,
  proteinG: row.protein_g,
  carbsG: row.carbs_g,
  fatG: row.fat_g,
});

/** SQLite's "YYYY-MM-DD HH:MM:SS" (UTC) as ISO 8601, which every browser parses. */
const isoTime = (t: string) => (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(t) ? `${t.replace(" ", "T")}Z` : t);

function entryView(row: EntryRow, food: FoodRecord | undefined): EntryView {
  const own: UnitOption = {
    unit: row.unit,
    label: row.unit,
    grams: row.quantity > 0 ? round2(row.grams / row.quantity) : 0,
  };
  // Typed-in foods keep their own unit. A USDA food offers all of its units,
  // plus its current one in case USDA's portions changed since it was logged.
  let units = food ? unitOptions(food) : [own];
  if (!units.some((u) => u.unit === row.unit)) units = [...units, own];
  return {
    id: row.id,
    meal: toMeal(row.meal),
    foodName: row.food_name,
    fdcId: row.fdc_id,
    quantity: row.quantity,
    unit: row.unit,
    unitLabel: units.find((u) => u.unit === row.unit)?.label ?? row.unit,
    grams: row.grams,
    nutrition: rowNutrition(row),
    units,
    createdAt: isoTime(row.created_at),
  };
}

/** The foods behind a day's entries, from usda_cache. A failed lookup only costs the unit lists. */
async function foodsFor(usda: UsdaDeps, rows: EntryRow[]): Promise<Map<number, FoodRecord>> {
  const ids = rows.flatMap((r) => (r.fdc_id === null ? [] : [r.fdc_id]));
  if (!ids.length) return new Map();
  try {
    return await getFoods(usda, ids);
  } catch (err) {
    if (err instanceof UsdaError) return new Map();
    throw err;
  }
}

async function dayView(c: Ctx, usda: UsdaDeps, user: UserRow, date: string): Promise<DayView> {
  const db = c.env.DB;
  const [goals, { results: rows }] = await Promise.all([
    goalsOn(db, user.id, date),
    db
      .prepare(`SELECT ${ENTRY_COLUMNS} FROM food_entries WHERE user_id = ? AND log_date = ? ORDER BY created_at, id`)
      .bind(user.id, date)
      .all<EntryRow>(),
  ]);
  const foods = await foodsFor(usda, rows);
  const entries = rows.map((row) => entryView(row, row.fdc_id === null ? undefined : foods.get(row.fdc_id)));
  const sum = (pick: (n: Nutrition) => number) => round1(entries.reduce((total, e) => total + pick(e.nutrition), 0));
  return {
    date,
    today: localDate(user.timezone),
    goals: goals && {
      calories: goals.calories,
      proteinG: goals.protein_g,
      carbsG: goals.carbs_g,
      fatG: goals.fat_g,
    },
    totals: {
      calories: sum((n) => n.calories),
      proteinG: sum((n) => n.proteinG),
      carbsG: sum((n) => n.carbsG),
      fatG: sum((n) => n.fatG),
    },
    entries,
  };
}

/** An entry id from the path, or null if it can't be one. */
function entryId(raw: string): number | null {
  if (!/^\d{1,15}$/.test(raw)) return null;
  const id = Number(raw);
  return id > 0 ? id : null;
}

function findEntry(db: D1Database, userId: number, id: number | null) {
  if (id === null) return Promise.resolve(null);
  return db
    .prepare(`SELECT ${ENTRY_COLUMNS} FROM food_entries WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .first<EntryRow>();
}

// ---------------------------------------------------------------- routes

export function foodRoutes(deps: AppDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  // The key stays inside these deps: it is never logged or sent to the browser.
  const usdaDeps = (c: Ctx): UsdaDeps => ({ apiKey: c.env.USDA_API_KEY ?? "", fetch: deps.usdaFetch, db: c.env.DB });
  const currentUser = (c: Ctx) => getUser(c.env.DB, c.get("email"));

  // Transcript in, parsed items with ranked USDA matches out. Nothing is saved.
  routes.post("/parse", async (c) => {
    const user = await currentUser(c);
    if (!user) return noProfile(c);

    const body = await readJson(c);
    const text = isObject(body) && typeof body.text === "string" ? body.text.trim() : "";
    if (text.length > 500) return invalid(c, { text: "That's a lot at once. Keep it under 500 characters." });
    const parsed = text ? parseMeal(text) : { meal: null, items: [] };
    if (!parsed.items.length) return invalid(c, { text: EMPTY_PARSE }, EMPTY_PARSE);

    const usda = usdaDeps(c);
    const items = await Promise.all(
      parsed.items.slice(0, MAX_PARSE_ITEMS).map(async (item): Promise<ParseItemResult> => ({
        ...item,
        ...(await lookup(usda, item.food, item.quantity, item.unit, {
          limit: PARSE_LIMIT,
          brandHint: looksLikeBrand(item.text),
        })),
      })),
    );
    return c.json<ParseResponse>({ meal: parsed.meal, items });
  });

  // Manual search, for picking another match. quantity and unit price the candidates.
  routes.get("/foods/search", async (c) => {
    const user = await currentUser(c);
    if (!user) return noProfile(c);

    const errors: FieldErrors = {};
    const query = (c.req.query("q") ?? "").trim();
    if (!query) errors.q = "Type a food to look for.";
    else if (query.length > 100) errors.q = "Keep the search under 100 characters.";
    const quantity = readQuantity(c.req.query("quantity"), "quantity", MAX_QUANTITY, errors, 1);
    const unit = (c.req.query("unit") ?? "").trim().toLowerCase();
    if (unit.length > 30) errors.unit = "Pick a unit from the list.";
    if (Object.keys(errors).length || quantity === undefined) return invalid(c, errors);

    const result = await lookup(usdaDeps(c), query, quantity, unit || null, {
      limit: SEARCH_LIMIT,
      brandHint: looksLikeBrand(query),
    });
    return c.json<SearchResponse>({ query, ...result });
  });

  // One day: entries, totals and the goals in effect that day. No date means today.
  routes.get("/entries", async (c) => {
    const user = await currentUser(c);
    if (!user) return noProfile(c);

    const raw = c.req.query("date");
    const date = raw === undefined ? localDate(user.timezone) : checkDate(raw, localDate(user.timezone));
    if (!date) return invalid(c, { date: DATE_ERROR });
    return c.json(await dayView(c, usdaDeps(c), user, date));
  });

  // Save confirmed items, all or nothing.
  routes.post("/entries", async (c) => {
    const db = c.env.DB;
    const user = await currentUser(c);
    if (!user) return noProfile(c);

    const parsed = parseNewEntries(await readJson(c), localDate(user.timezone));
    if (!parsed.ok) return invalid(c, parsed.errors);
    const input = parsed.value;
    const usda = usdaDeps(c);

    let foods = new Map<number, FoodRecord>();
    const fdcIds = input.items.flatMap((item) => (item.kind === "fdc" ? [item.fdcId] : []));
    if (fdcIds.length) {
      try {
        foods = await getFoods(usda, fdcIds);
      } catch (err) {
        if (err instanceof UsdaError) return usdaFailed(c, err);
        throw err;
      }
    }

    const errors: FieldErrors = {};
    const rows: NewRow[] = [];
    input.items.forEach((item, i) => {
      if (item.kind === "manual") {
        // Typed-in numbers are per unit; there is no weight to go with them.
        const { name, quantity, unit } = item;
        rows.push({ name, fdcId: null, quantity, unit, grams: 0, nutrition: scale(item.perUnit, quantity) });
        return;
      }
      const food = foods.get(item.fdcId);
      const measured = food && measure(food, item.quantity, item.unit);
      if (!food) errors[`items.${i}.fdcId`] = "We couldn't find that food. Pick another match.";
      else if (!measured) errors[`items.${i}.unit`] = "Pick a unit from the list.";
      else {
        const { quantity, unit, grams } = measured.amount;
        rows.push({ name: food.description, fdcId: food.fdcId, quantity, unit, grams, nutrition: measured.nutrition });
      }
    });
    if (Object.keys(errors).length) return invalid(c, errors);

    const insert = db.prepare(
      `INSERT INTO food_entries (user_id, log_date, meal, spoken_text, food_name, fdc_id, quantity, unit, grams,
         calories, protein_g, carbs_g, fat_g)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    await db.batch(
      rows.map((r) =>
        insert.bind(
          user.id, input.date, input.meal, input.spokenText, r.name, r.fdcId, r.quantity, r.unit, r.grams,
          r.nutrition.calories, r.nutrition.proteinG, r.nutrition.carbsG, r.nutrition.fatG,
        ),
      ),
    );
    return c.json(await dayView(c, usda, user, input.date), 201);
  });

  // Change the amount, unit or meal. Nutrition is recomputed from the food, or
  // scaled for a typed-in food (whose unit can't change: we only know its numbers per unit).
  routes.patch("/entries/:id", async (c) => {
    const db = c.env.DB;
    const user = await currentUser(c);
    if (!user) return noProfile(c);
    const row = await findEntry(db, user.id, entryId(c.req.param("id")));
    if (!row) return entryNotFound(c);

    const manual = row.fdc_id === null;
    const parsed = parseEntryChanges(await readJson(c), manual ? MAX_MANUAL_QUANTITY : MAX_QUANTITY);
    if (!parsed.ok) return invalid(c, parsed.errors);
    const changes = parsed.value;
    const usda = usdaDeps(c);

    let { quantity, unit, grams } = row;
    let nutrition = rowNutrition(row);
    if (changes.quantity !== undefined || changes.unit !== undefined) {
      const newQuantity = changes.quantity ?? row.quantity;
      const newUnit = changes.unit ?? row.unit;
      let food: FoodRecord | undefined;
      if (row.fdc_id !== null) {
        try {
          food = (await getFoods(usda, [row.fdc_id])).get(row.fdc_id);
        } catch (err) {
          if (err instanceof UsdaError) return usdaFailed(c, err);
          throw err;
        }
      }
      const measured = food ? measure(food, newQuantity, newUnit) : null;
      if (measured) {
        ({ quantity, unit, grams } = measured.amount);
        nutrition = measured.nutrition;
      } else if (newUnit === row.unit && row.quantity > 0) {
        // A typed-in food, or a USDA food whose record no longer has this unit: scale what we stored.
        const factor = newQuantity / row.quantity;
        quantity = newQuantity;
        grams = round1(row.grams * factor);
        nutrition = scale(nutrition, factor);
      } else {
        return invalid(c, {
          unit: manual ? "You entered this food yourself, so only the amount can change." : "Pick a unit from the list.",
        });
      }
    }
    const meal = changes.meal !== undefined ? changes.meal : toMeal(row.meal);

    await db
      .prepare(
        `UPDATE food_entries SET meal = ?, quantity = ?, unit = ?, grams = ?, calories = ?, protein_g = ?,
           carbs_g = ?, fat_g = ?
         WHERE id = ? AND user_id = ?`,
      )
      .bind(
        meal, quantity, unit, grams, nutrition.calories, nutrition.proteinG, nutrition.carbsG, nutrition.fatG,
        row.id, user.id,
      )
      .run();
    return c.json(await dayView(c, usda, user, row.log_date));
  });

  routes.delete("/entries/:id", async (c) => {
    const user = await currentUser(c);
    if (!user) return noProfile(c);
    const id = entryId(c.req.param("id"));
    const deleted =
      id === null
        ? null
        : await c.env.DB.prepare("DELETE FROM food_entries WHERE id = ? AND user_id = ? RETURNING log_date")
            .bind(id, user.id)
            .first<{ log_date: string }>();
    if (!deleted) return entryNotFound(c);
    return c.json(await dayView(c, usdaDeps(c), user, deleted.log_date));
  });

  return routes;
}
