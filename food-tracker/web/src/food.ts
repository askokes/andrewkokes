// Client-side helpers for food logging: nutrition math (mirrors the Worker),
// amount wording, meals and dates.
import type { Meal, Nutrition, Per100g, UnitOption } from "../../src/food/types";
import { formatDay, formatNumber } from "./dom";

export const MEAL_ORDER: readonly Meal[] = ["breakfast", "lunch", "dinner", "snack"];
export const MEAL_LABELS: Record<Meal, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };

const WEIGHT_UNITS = new Set(["oz", "lb", "g"]);

export function isWeightUnit(unit: string) {
  return WEIGHT_UNITS.has(unit);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Same math as the Worker: grams = quantity x grams per unit, rounded to 0.1 g. */
export function gramsFor(quantity: number, unit: UnitOption) {
  return round1(quantity * unit.grams);
}

/** Same math as the Worker: per-100 g values scaled to grams, each rounded to 0.1. */
export function nutritionFor(per100g: Per100g, grams: number): Nutrition {
  return {
    calories: round1((per100g.kcal * grams) / 100),
    proteinG: round1((per100g.protein * grams) / 100),
    carbsG: round1((per100g.carbs * grams) / 100),
    fatG: round1((per100g.fat * grams) / 100),
  };
}

export function scaleNutrition(n: Nutrition, factor: number): Nutrition {
  return {
    calories: round1(n.calories * factor),
    proteinG: round1(n.proteinG * factor),
    carbsG: round1(n.carbsG * factor),
    fatG: round1(n.fatG * factor),
  };
}

export function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * A food name without USDA's program notes: "Apples, raw, with skin (Includes
 * foods for USDA's Food Distribution Program)" -> "Apples, raw, with skin".
 * Plain names pass through unchanged.
 */
export function friendlyName(name: string) {
  return name.replace(/\s*\(Includes[^)]*\)?/gi, "").trim() || name.trim();
}

/** Whole numbers for display: "1,240". */
export function whole(n: number) {
  return formatNumber(Math.round(n));
}

export function macroText(n: Nutrition) {
  return `Protein ${whole(n.proteinG)} g · Carbs ${whole(n.carbsG)} g · Fat ${whole(n.fatG)} g`;
}

/**
 * Reads a typed amount: "2", "1.5", "1,5", "1/2", "1 1/2". Returns null for
 * anything that isn't a positive number we can use.
 */
export function parseQuantity(raw: string): number | null {
  const s = raw.trim().replace(",", ".");
  let n: number;
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(s);
  const frac = /^(\d+)\/(\d+)$/.exec(s);
  if (mixed) n = Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  else if (frac) n = Number(frac[1]) / Number(frac[2]);
  else if (/^(\d+\.?\d*|\.\d+)$/.test(s)) n = Number(s);
  else return null;
  return Number.isFinite(n) && n > 0 && n <= 10000 ? n : null;
}

export function formatQuantity(n: number) {
  return String(Math.round(n * 100) / 100);
}

/**
 * New quantity after switching units. To or from a weight, keep about the same
 * grams (6 oz -> 1 breast, 2 large -> 122 g); between portions keep the number
 * (2 large -> 2 medium).
 */
export function convertQuantity(quantity: number, from: UnitOption, to: UnitOption) {
  if (from.unit === to.unit || !(WEIGHT_UNITS.has(from.unit) || WEIGHT_UNITS.has(to.unit)) || from.grams <= 0 || to.grams <= 0) return quantity;
  const n = (quantity * from.grams) / to.grams;
  if (to.unit === "g") return Math.max(1, Math.round(n));
  if (to.unit === "oz") return Math.max(0.1, Math.round(n * 10) / 10);
  if (to.unit === "lb") return Math.max(0.01, Math.round(n * 100) / 100);
  return Math.max(0.25, Math.round(n * 4) / 4);
}

/** Option text for a unit picker: "large (50 g)", "cup, chopped (140 g)", or just "oz". */
export function unitOptionLabel(u: UnitOption) {
  if (WEIGHT_UNITS.has(u.unit) || /\d\s*g\)$/.test(u.label)) return u.label;
  return `${u.label} (${formatQuantity(Math.round(u.grams * 10) / 10)} g)`;
}

/** Puts a food's own units (large, cup, slice) ahead of the weights. */
export function sortUnits(units: UnitOption[]) {
  return [...units.filter((u) => !WEIGHT_UNITS.has(u.unit)), ...units.filter((u) => WEIGHT_UNITS.has(u.unit))];
}

const NO_PLURAL = new Set(["oz", "lb", "g", "tbsp", "tsp", "large", "medium", "small", "extra", "fl", "each", "whole", "jumbo"]);

function pluralWord(word: string) {
  if (NO_PLURAL.has(word.toLowerCase()) || /s$/i.test(word)) return word;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(ch|sh|x|z)$/i.test(word)) return `${word}es`;
  return `${word}s`;
}

/** "2 large", "6 oz", "2 cups, chopped", "1 slice". Pluralizes only the first word of the label. */
export function amountText(quantity: number, label: string) {
  const q = formatQuantity(quantity);
  if (quantity <= 1) return `${q} ${label}`;
  const m = /^([A-Za-z]+)(.*)$/.exec(label);
  return m ? `${q} ${pluralWord(m[1])}${m[2]}` : `${q} ${label}`;
}

/** Default meal from the clock: before 10:30 breakfast, before 15:00 lunch, before 21:00 dinner, else snack. */
export function mealForTime(now = new Date()): Meal {
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes < 10 * 60 + 30) return "breakfast";
  if (minutes < 15 * 60) return "lunch";
  if (minutes < 21 * 60) return "dinner";
  return "snack";
}

/** Today's date (YYYY-MM-DD) in the user's time zone. */
export function todayIn(timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
}

export function isIsoDate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "Today", "Yesterday", or "Wednesday, Oct 7" (with the year when it isn't this year). */
export function dayTitle(date: string, today: string) {
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return formatDay(date, { weekday: "long", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/** "Friday, October 9", with the year when it isn't this year. */
export function fullDate(date: string, today: string) {
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return formatDay(date, sameYear ? undefined : { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

export function dayPath(date: string, today: string) {
  return date === today ? "/" : `/day/${date}`;
}
