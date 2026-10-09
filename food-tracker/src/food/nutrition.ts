// Turns USDA FoodData Central records into FoodRecords, and works out the
// nutrition for an amount in grams. Tolerant of the detail ("full"), search
// and abridged nutrient shapes, since USDA's docs and responses disagree.
import type { FoodRecord, Nutrition, Per100g, RawPortion } from "./types";

const ENERGY = 1008;
const ENERGY_SPECIFIC = 2048; // Atwater specific factors: newer Foundation foods often have only these two
const ENERGY_GENERAL = 2047;
const PROTEIN = 1003;
const FAT = 1004;
const CARBS = 1005;

/** Nutrient numbers used by the abridged format and older records, mapped to nutrient ids. */
const ID_BY_NUMBER: Record<string, number> = {
  "208": ENERGY,
  "203": PROTEIN,
  "204": FAT,
  "205": CARBS,
  "957": ENERGY_GENERAL,
  "958": ENERGY_SPECIFIC,
};

/** Branded servingSizeUnit values we can treat as grams (ml counts as g). */
const GRAM_LIKE = new Set(["g", "grm", "gram", "grams", "ml", "mlt", "milliliter", "milliliters", "millilitre"]);

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function num(v: unknown): number | undefined {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function nutrientId(entry: Record<string, unknown>): number | undefined {
  const nutrient = isObject(entry.nutrient) ? entry.nutrient : {};
  const id = num(entry.nutrientId) ?? num(nutrient.id);
  if (id !== undefined) return id;
  const number = entry.nutrientNumber ?? entry.number ?? nutrient.number;
  return typeof number === "string" || typeof number === "number" ? ID_BY_NUMBER[String(number).trim()] : undefined;
}

/** nutrient id -> amount per 100 g. The first entry for an id wins. */
function nutrientValues(list: unknown): Map<number, number> {
  const values = new Map<number, number>();
  if (!Array.isArray(list)) return values;
  for (const entry of list) {
    if (!isObject(entry)) continue;
    const id = nutrientId(entry);
    const value = num(entry.value) ?? num(entry.amount);
    if (id !== undefined && value !== undefined && !values.has(id)) values.set(id, value);
  }
  return values;
}

const nonNegative = (v: number | undefined) => (v === undefined || v < 0 ? 0 : v);

/** null when the food has no energy value at all: it can't be logged. */
function per100gFrom(values: Map<number, number>): Per100g | null {
  const kcal = values.get(ENERGY) ?? values.get(ENERGY_SPECIFIC) ?? values.get(ENERGY_GENERAL);
  if (kcal === undefined) return null;
  return {
    kcal: nonNegative(kcal),
    protein: nonNegative(values.get(PROTEIN)),
    carbs: nonNegative(values.get(CARBS)),
    fat: nonNegative(values.get(FAT)),
  };
}

function portionsFrom(list: unknown): RawPortion[] {
  if (!Array.isArray(list)) return [];
  const portions: RawPortion[] = [];
  for (const p of list) {
    if (!isObject(p)) continue;
    const gramWeight = num(p.gramWeight);
    if (gramWeight === undefined) continue;
    portions.push({
      amount: num(p.amount) ?? 1,
      gramWeight,
      unitName: isObject(p.measureUnit) ? str(p.measureUnit.name) : null,
      modifier: str(p.modifier),
      description: str(p.portionDescription),
    });
  }
  return portions;
}

/** Branded foods carry one label serving instead of foodPortions. */
function servingPortion(raw: Record<string, unknown>): RawPortion | null {
  const size = num(raw.servingSize);
  const unit = str(raw.servingSizeUnit)?.toLowerCase();
  if (size === undefined || size <= 0 || !unit || !GRAM_LIKE.has(unit)) return null;
  return {
    amount: 1,
    gramWeight: size,
    unitName: "serving",
    modifier: null,
    description: str(raw.householdServingFullText),
  };
}

function extract(raw: unknown, withPortions: boolean): FoodRecord | null {
  if (!isObject(raw)) return null;
  const fdcId = num(raw.fdcId);
  const description = str(raw.description);
  if (fdcId === undefined || !Number.isInteger(fdcId) || fdcId <= 0 || !description) return null;
  const per100g = per100gFrom(nutrientValues(raw.foodNutrients));
  if (!per100g) return null;

  const portions = withPortions ? portionsFrom(raw.foodPortions) : [];
  const serving = servingPortion(raw);
  if (serving) portions.push(serving);

  return {
    fdcId,
    description,
    dataType: str(raw.dataType) ?? "",
    brand: str(raw.brandName) ?? str(raw.brandOwner),
    per100g,
    portions,
  };
}

/** A detail record (`/food/{id}` or `/foods?format=full`). null if unusable (no energy, no id). */
export function extractFood(raw: unknown): FoodRecord | null {
  return extract(raw, true);
}

/**
 * A `/foods/search` hit. Search hits carry no foodPortions, so `portions` holds
 * only a Branded label serving; fetch details before converting units.
 */
export function extractSearchHit(raw: unknown): FoodRecord | null {
  return extract(raw, false);
}

/** Nutrition for `grams` of a food, each value rounded to 1 decimal. */
export function nutritionFor(per100g: Per100g, grams: number): Nutrition {
  const factor = Number.isFinite(grams) && grams > 0 ? grams / 100 : 0;
  return {
    calories: round1(per100g.kcal * factor),
    proteinG: round1(per100g.protein * factor),
    carbsG: round1(per100g.carbs * factor),
    fatG: round1(per100g.fat * factor),
  };
}
