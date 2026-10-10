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
import { spokenUnits } from "./common";
import { checkDate, DATE_ERROR, parseEntryChanges, parseNewEntries, readQuantity } from "./input";
import { nutritionFor } from "./nutrition";
import { parseMeal } from "./parse";
import {
  GRAMS_PER,
  MAX_GRAMS,
  MAX_MANUAL_QUANTITY,
  maxQuantityFor,
  MEALS,
  MIN_QUANTITY,
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
import { commonFor, getFoods, looksLikeBrand, searchFoods, UsdaError, type UsdaDeps, type UsdaErrorKind } from "./usda";

type Ctx = Context<AppEnv>;

/** Foods one parse looks up. The rest of the sentence comes back "skipped". */
const MAX_PARSE_ITEMS = 8;
const PARSE_LIMIT = 5;
const SEARCH_LIMIT = 8;
const WEIGHT_UNITS = new Set(["oz", "lb", "g"]);

/**
 * USDA requests one API request may make. A food not seen before costs a search
 * and a details call, so this covers 8 new foods; a branded fallback for
 * every one of them would double it.
 */
export const USDA_CALLS_PER_REQUEST = 16;
/** USDA requests one user may make in an hour. The key allows about 1,000 an hour, shared by everyone. */
export const USDA_CALLS_PER_USER_HOUR = 150;

const EMPTY_PARSE = 'Tell me what you ate, like "two eggs and a slice of toast".';
const USDA_MESSAGES: Record<UsdaErrorKind, string> = {
  rate_limited: "The food database is busy right now. Try again in a minute, or enter it yourself.",
  unavailable: "We couldn't reach the food database. Try again in a minute, or enter it yourself.",
  skipped: "That's a lot of foods at once. Search for this one separately, or enter it yourself.",
};
const notFoundMessage = (food: string) => `We couldn't find "${food}". Try other words, or enter it yourself.`;
const TOO_MUCH = `One entry can hold up to ${MAX_GRAMS / 1000} kg (about ${Math.round(MAX_GRAMS / GRAMS_PER.lb)} lb) of a food. Enter less, or add the rest as another entry.`;

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

// ---------------------------------------------------------------- USDA key budget

/** Counts one USDA call for the user this hour, unless they're at the limit. Returns no row when refused. */
const COUNT_USDA_CALL = `INSERT INTO usda_usage (user_id, hour, calls) SELECT id, ?1, 1 FROM users WHERE email = ?2
  ON CONFLICT(user_id) DO UPDATE SET
    calls = CASE WHEN usda_usage.hour = excluded.hour THEN usda_usage.calls + 1 ELSE 1 END,
    hour = excluded.hour
  WHERE usda_usage.hour <> excluded.hour OR usda_usage.calls < ?3
  RETURNING calls`;

/**
 * Shares out the USDA key (see UsdaDeps.beforeCall): one API request gets
 * USDA_CALLS_PER_REQUEST calls, and one user USDA_CALLS_PER_USER_HOUR an
 * hour. Each call is counted in D1 as it is made, so a user's concurrent
 * requests can't go over together. Cache hits cost nothing.
 */
function usdaMeter(db: D1Database, email: string): () => Promise<void> {
  let calls = 0;
  return async () => {
    if (calls >= USDA_CALLS_PER_REQUEST) throw new UsdaError("skipped", "This request has used its USDA calls");
    calls++;
    const hour = new Date().toISOString().slice(0, 13);
    const counted = await db.prepare(COUNT_USDA_CALL).bind(hour, email, USDA_CALLS_PER_USER_HOUR).first();
    if (!counted) throw new UsdaError("rate_limited", "This user has used their USDA calls for the hour");
  };
}

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

/**
 * Candidates for a food phrase, as /api/parse and /api/foods/search offer them.
 * Never throws: a USDA failure becomes a status.
 */
export async function lookup(
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
  // "A soda" is a can, "two eggs" are large and "dumplings" are a serving, whichever record the user
  // picks (see toCandidate).
  const preferred = spokenUnits(commonFor(food), food, quantity);
  return { status: "ok", candidates: preferSpokenUnit(foods.map((f) => toCandidate(f, quantity, unit, preferred)), unit) };
}

/** Grams and nutrition for an amount of a food, or null if the unit isn't one of the food's units. */
function measure(food: FoodRecord, quantity: number, unit: string): { amount: Amount; nutrition: Nutrition } | null {
  if (!unitOptions(food).some((o) => o.unit === unit)) return null;
  const amount = resolveAmount(food, quantity, unit);
  if (amount.guessed) return null;
  return { amount, nutrition: nutritionFor(food.per100g, amount.grams) };
}

const mapNutrition = (n: Nutrition, f: (v: number) => number): Nutrition => ({
  calories: f(n.calories),
  proteinG: f(n.proteinG),
  carbsG: f(n.carbsG),
  fatG: f(n.fatG),
});

/**
 * A stored total back to its value for one unit. Rows keep full precision and
 * are rounded only for display, and snapping to 6 decimals gives back the
 * typed-in number exactly, so editing an amount back and forth never drifts.
 */
const perUnit = (total: number, quantity: number) => Math.round((total / quantity) * 1e6) / 1e6;

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
    usdaName: food?.description ?? null,
    quantity: row.quantity,
    unit: row.unit,
    unitLabel: units.find((u) => u.unit === row.unit)?.label ?? row.unit,
    // Typed-in and rescaled rows are stored unrounded (see perUnit).
    grams: round1(row.grams),
    nutrition: mapNutrition(rowNutrition(row), round1),
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
  // Call once per request: the meter counts this request's USDA calls.
  const usdaDeps = (c: Ctx): UsdaDeps => ({
    apiKey: c.env.USDA_API_KEY ?? "",
    fetch: deps.usdaFetch,
    db: c.env.DB,
    beforeCall: usdaMeter(c.env.DB, c.get("email")),
  });
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
      parsed.items.map(async (item, i): Promise<ParseItemResult> => {
        // Every food comes back, so the confirm screen can say which ones weren't looked up.
        if (i >= MAX_PARSE_ITEMS) return { ...item, status: "skipped", message: USDA_MESSAGES.skipped, candidates: [] };
        const options = { limit: PARSE_LIMIT, brandHint: looksLikeBrand(item.text) };
        return { ...item, ...(await lookup(usda, item.food, item.quantity, item.unit, options)) };
      }),
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
    const unit = (c.req.query("unit") ?? "").trim().toLowerCase();
    const quantity = readQuantity(c.req.query("quantity"), "quantity", maxQuantityFor(unit), errors, 1);
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
        // Typed-in numbers are per unit; there is no weight to go with them. Kept unrounded (see perUnit).
        const { name, quantity, unit } = item;
        rows.push({ name, fdcId: null, quantity, unit, grams: 0, nutrition: mapNutrition(item.perUnit, (v) => v * quantity) });
        return;
      }
      const food = foods.get(item.fdcId);
      const measured = food && measure(food, item.quantity, item.unit);
      if (!food) errors[`items.${i}.fdcId`] = "We couldn't find that food. Pick another match.";
      else if (!measured) errors[`items.${i}.unit`] = "Pick a unit from the list.";
      else if (measured.amount.grams > MAX_GRAMS) errors[`items.${i}.quantity`] = TOO_MUCH;
      else {
        const { quantity, unit, grams } = measured.amount;
        rows.push({ name: item.name ?? food.description, fdcId: food.fdcId, quantity, unit, grams, nutrition: measured.nutrition });
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
  // rescaled for a typed-in food (whose unit can't change: we only know its numbers per unit).
  routes.patch("/entries/:id", async (c) => {
    const db = c.env.DB;
    const user = await currentUser(c);
    if (!user) return noProfile(c);
    const row = await findEntry(db, user.id, entryId(c.req.param("id")));
    if (!row) return entryNotFound(c);

    const manual = row.fdc_id === null;
    const parsed = parseEntryChanges(await readJson(c), (newUnit) =>
      manual ? MAX_MANUAL_QUANTITY : maxQuantityFor(newUnit ?? row.unit),
    );
    if (!parsed.ok) return invalid(c, parsed.errors);
    const changes = parsed.value;
    const usda = usdaDeps(c);

    let { quantity, unit, grams } = row;
    let nutrition = rowNutrition(row);
    if (changes.quantity !== undefined || changes.unit !== undefined) {
      const newUnit = changes.unit ?? row.unit;
      const unitChanged = newUnit !== row.unit;
      let newQuantity = changes.quantity ?? row.quantity;
      let food: FoodRecord | undefined;
      if (row.fdc_id !== null) {
        try {
          food = (await getFoods(usda, [row.fdc_id])).get(row.fdc_id);
        } catch (err) {
          if (err instanceof UsdaError) return usdaFailed(c, err);
          throw err;
        }
      }
      if (food && unitChanged && changes.quantity === undefined) {
        // A new unit alone keeps the weight: 150 g of rice becomes 0.74 cup, not 150 cups.
        const option = unitOptions(food).find((o) => o.unit === newUnit);
        if (!option) return invalid(c, { unit: "Pick a unit from the list." });
        newQuantity = option.grams > 0 ? round2(row.grams / option.grams) : 0;
        if (newQuantity < MIN_QUANTITY) {
          return invalid(c, { unit: `That's too little to measure in ${option.label}. Pick a smaller unit.` });
        }
        if (newQuantity > maxQuantityFor(newUnit)) {
          return invalid(c, { unit: `That's too much to measure in ${option.label}. Pick a bigger unit.` });
        }
      }

      const measured = food ? measure(food, newQuantity, newUnit) : null;
      if (measured) {
        if (measured.amount.grams > MAX_GRAMS) return invalid(c, { quantity: TOO_MUCH });
        ({ quantity, unit, grams } = measured.amount);
        nutrition = measured.nutrition;
      } else if (!unitChanged && row.quantity > 0) {
        // A typed-in food, or a USDA food whose record no longer has this unit: rescale per unit.
        quantity = newQuantity;
        grams = perUnit(row.grams, row.quantity) * newQuantity;
        nutrition = mapNutrition(nutrition, (v) => perUnit(v, row.quantity) * newQuantity);
        if (!manual && grams > MAX_GRAMS) return invalid(c, { quantity: TOO_MUCH });
      } else {
        return invalid(c, {
          unit: manual ? "You entered this food yourself, so only the amount can change." : "Pick a unit from the list.",
        });
      }
    }
    // Never write NaN or Infinity. A row saved before amounts had a minimum (1e-307) can overflow when rescaled.
    if (![quantity, grams, nutrition.calories, nutrition.proteinG, nutrition.carbsG, nutrition.fatG].every(Number.isFinite)) {
      return invalid(c, { quantity: "We can't work out this amount. Delete the entry and add it again." });
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
