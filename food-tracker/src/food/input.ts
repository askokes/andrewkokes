// Request validation for the food routes. Shape and range checks only: whether
// a unit fits a food is checked against its USDA record in routes.ts.
import { addDays, isCalendarDate } from "../dates";
import { isBlank, isObject, type FieldErrors, type Result } from "../validate";
import { MAX_MANUAL_QUANTITY, maxQuantityFor, MEALS, MIN_QUANTITY, type Meal, type Nutrition } from "./types";

export const FIRST_DATE = "2000-01-01";
export const DATE_ERROR = "Pick a real date, no later than tomorrow.";
export const MAX_ITEMS = 20;

export interface FdcItem {
  kind: "fdc";
  fdcId: number;
  quantity: number;
  unit: string;
  /** The plain name to show ("Chicken breast"), or null to fall back to the USDA description. */
  name: string | null;
}

export interface ManualItem {
  kind: "manual";
  name: string;
  quantity: number;
  unit: string;
  /** Nutrition for ONE unit, as typed. */
  perUnit: Nutrition;
}

export interface NewEntries {
  date: string;
  meal: Meal | null;
  spokenText: string | null;
  items: (FdcItem | ManualItem)[];
}

export interface EntryChanges {
  quantity?: number;
  unit?: string;
  meal?: Meal | null;
}

/** A number, or a numeric string from a form field. */
function decimal(v: unknown): number | undefined {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v.trim()) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

const plural = (n: number) => n.toLocaleString("en-US");

/** A YYYY-MM-DD date from 2000-01-01 up to the user's tomorrow, or null. */
export function checkDate(raw: unknown, today: string): string | null {
  if (typeof raw !== "string") return null;
  const date = raw.trim();
  if (!isCalendarDate(date) || date < FIRST_DATE || date > addDays(today, 1)) return null;
  return date;
}

/**
 * An amount from MIN_QUANTITY to `max`. Blank means `fallback` when there is
 * one. Smaller amounts round to nothing, and rescaling from them overflows.
 */
export function readQuantity(
  v: unknown,
  field: string,
  max: number,
  errors: FieldErrors,
  fallback?: number,
): number | undefined {
  if (fallback !== undefined && isBlank(v)) return fallback;
  const n = decimal(v);
  if (n === undefined || n < MIN_QUANTITY || n > max) {
    errors[field] = `Enter an amount from ${MIN_QUANTITY} to ${plural(max)}.`;
    return undefined;
  }
  return n;
}

function readMeal(v: unknown, errors: FieldErrors): Meal | null {
  if (isBlank(v)) return null;
  const meal = typeof v === "string" ? v.trim().toLowerCase() : "";
  const found = MEALS.find((m) => m === meal);
  if (!found) errors.meal = "Pick breakfast, lunch, dinner or snack.";
  return found ?? null;
}

/** A unit key or a short typed unit: trimmed, lowercase, single spaces. */
function readUnit(v: unknown, field: string, errors: FieldErrors, fallback?: string): string | undefined {
  if (fallback !== undefined && isBlank(v)) return fallback;
  const unit = typeof v === "string" ? v.trim().toLowerCase().replace(/\s+/g, " ") : "";
  if (!unit) {
    errors[field] = "Pick a unit.";
    return undefined;
  }
  if (unit.length > 30) {
    errors[field] = 'Keep the unit short, like "bowl" or "serving".';
    return undefined;
  }
  return unit;
}

function readAmount(v: unknown, field: string, label: string, max: number, errors: FieldErrors, required: boolean) {
  if (!required && isBlank(v)) return 0;
  const n = decimal(v);
  if (n === undefined || n < 0 || n > max) {
    errors[field] = `${label} should be a number from 0 to ${plural(max)}.`;
    return 0;
  }
  return n;
}

function readItem(raw: unknown, i: number, errors: FieldErrors): FdcItem | ManualItem | null {
  const at = `items.${i}`;
  if (!isObject(raw) || (!isObject(raw.manual) && isBlank(raw.fdcId))) {
    errors[at] = "Pick a food or enter it yourself.";
    return null;
  }
  const before = Object.keys(errors).length;

  if (isObject(raw.manual)) {
    const m = raw.manual;
    const name = typeof m.name === "string" ? m.name.trim().replace(/\s+/g, " ") : "";
    if (!name) errors[`${at}.manual.name`] = "Please enter a name for this food.";
    else if (name.length > 100) errors[`${at}.manual.name`] = "Keep the name under 100 characters.";
    // Only calories are required: people often know them and nothing else.
    const perUnit: Nutrition = {
      calories: readAmount(m.calories, `${at}.manual.calories`, "Calories", 10000, errors, true),
      proteinG: readAmount(m.proteinG, `${at}.manual.proteinG`, "Protein", 1000, errors, false),
      carbsG: readAmount(m.carbsG, `${at}.manual.carbsG`, "Carbs", 1000, errors, false),
      fatG: readAmount(m.fatG, `${at}.manual.fatG`, "Fat", 1000, errors, false),
    };
    const quantity = readQuantity(raw.quantity, `${at}.quantity`, MAX_MANUAL_QUANTITY, errors, 1);
    const unit = readUnit(raw.unit, `${at}.unit`, errors, "serving");
    if (Object.keys(errors).length > before || quantity === undefined || unit === undefined) return null;
    return { kind: "manual", name, quantity, unit, perUnit };
  }

  const fdcId = decimal(raw.fdcId);
  if (fdcId === undefined || !Number.isSafeInteger(fdcId) || fdcId <= 0) {
    errors[`${at}.fdcId`] = "Pick a food from the list.";
  }
  const unit = readUnit(raw.unit, `${at}.unit`, errors);
  const quantity = readQuantity(raw.quantity, `${at}.quantity`, maxQuantityFor(unit), errors);
  // Optional and cosmetic: a bad value falls back to the USDA description instead of failing the save.
  const name = typeof raw.name === "string" ? raw.name.trim().replace(/\s+/g, " ").slice(0, 100) || null : null;
  if (Object.keys(errors).length > before || fdcId === undefined || quantity === undefined || unit === undefined) {
    return null;
  }
  return { kind: "fdc", fdcId, quantity, unit, name };
}

/** POST /api/entries. `today` is the user's today, for the date range. */
export function parseNewEntries(raw: unknown, today: string): Result<NewEntries> {
  if (!isObject(raw)) return { ok: false, errors: { body: "Expected a JSON object." } };
  const errors: FieldErrors = {};

  const date = checkDate(raw.date, today);
  if (!date) errors.date = DATE_ERROR;
  const meal = readMeal(raw.meal, errors);

  let spokenText: string | null = null;
  if (!isBlank(raw.spokenText)) {
    if (typeof raw.spokenText === "string" && raw.spokenText.trim().length <= 500) {
      spokenText = raw.spokenText.trim() || null;
    } else {
      errors.spokenText = "Keep what you said under 500 characters.";
    }
  }

  const items: (FdcItem | ManualItem)[] = [];
  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    errors.items = "Add at least one food.";
  } else if (raw.items.length > MAX_ITEMS) {
    errors.items = `Add up to ${MAX_ITEMS} foods at a time.`;
  } else {
    raw.items.forEach((item, i) => {
      const read = readItem(item, i, errors);
      if (read) items.push(read);
    });
  }

  if (Object.keys(errors).length || !date) return { ok: false, errors };
  return { ok: true, value: { date, meal, spokenText, items } };
}

/**
 * PATCH /api/entries/:id. `maxQuantity` gives the most of a unit the entry can
 * hold (undefined: the unit isn't changing); it depends on whether the entry is
 * a USDA food or typed in.
 */
export function parseEntryChanges(
  raw: unknown,
  maxQuantity: (unit: string | undefined) => number,
): Result<EntryChanges> {
  if (!isObject(raw)) return { ok: false, errors: { body: "Expected a JSON object." } };
  const errors: FieldErrors = {};
  const changes: EntryChanges = {};

  if (raw.unit !== undefined) changes.unit = readUnit(raw.unit, "unit", errors);
  if (raw.quantity !== undefined) {
    changes.quantity = readQuantity(raw.quantity, "quantity", maxQuantity(changes.unit), errors);
  }
  if (raw.meal !== undefined) changes.meal = readMeal(raw.meal, errors);

  if (raw.quantity === undefined && raw.unit === undefined && raw.meal === undefined) {
    errors.body = "Change the amount, the unit or the meal.";
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: changes };
}
