// Shared contract for food logging (Phase 3). The Worker modules and the web
// client both use these shapes; the client imports them with `import type`.

export type Meal = "breakfast" | "lunch" | "dinner" | "snack";
export const MEALS: readonly Meal[] = ["breakfast", "lunch", "dinner", "snack"];

/** Units the parser can produce. Weight units convert directly; the rest go through USDA portions. */
export type WeightUnit = "oz" | "lb" | "g";
export type PortionUnit = "cup" | "tbsp" | "tsp" | "slice" | "piece" | "large" | "medium" | "small" | "serving";
export type SpokenUnit = WeightUnit | PortionUnit;

export const GRAMS_PER: Record<WeightUnit, number> = { oz: 28.3495, lb: 453.592, g: 1 };

// ---------------------------------------------------------------- parser

export interface ParsedItem {
  /** Always > 0. "a", "an" or no number at all means 1. "a half" means 0.5. */
  quantity: number;
  /** null when no unit was spoken ("two eggs", "a banana"). */
  unit: SpokenUnit | null;
  /** Lowercase food phrase with filler, articles and "of" removed, e.g. "chicken breast". Plurals kept. */
  food: string;
  /** The slice of the original text this item came from, trimmed. */
  text: string;
}

export interface ParseResult {
  /** Meal hint from phrases like "for lunch"; null if none. */
  meal: Meal | null;
  items: ParsedItem[];
}

// ---------------------------------------------------------------- USDA and nutrition

/** Nutrition per 100 g. Never negative (USDA occasionally reports e.g. -0.43 g carbs). */
export interface Per100g {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

/** A USDA foodPortion, trimmed. Stored as JSON in usda_cache.portions_json so matching can improve later. */
export interface RawPortion {
  /** How many units gramWeight covers, e.g. 0.5 for "0.5 breast = 86 g". */
  amount: number;
  gramWeight: number;
  /** measureUnit.name, e.g. "cup", "piece", "RACC", "egg", "undetermined". null if absent. */
  unitName: string | null;
  /** e.g. "cup, chopped or diced", "large", "extra large (9\" or longer)". null if absent. */
  modifier: string | null;
  /** portionDescription when USDA provides one. */
  description: string | null;
}

export interface FoodRecord {
  fdcId: number;
  description: string;
  dataType: string; // "Foundation" | "SR Legacy" | "Branded" | ...
  brand: string | null;
  per100g: Per100g;
  portions: RawPortion[];
}

/**
 * A unit the user can pick for a given food. `unit` is a stable key stored in
 * food_entries.unit: "oz" | "lb" | "g" | a PortionUnit | "each" (a whole item
 * such as "1 egg", "1 banana", "1 breast").
 */
export interface UnitOption {
  unit: string;
  /** Human label for one unit, e.g. "oz", "cup, chopped", "large", "egg". */
  label: string;
  /** Grams in ONE of this unit. */
  grams: number;
}

export interface Nutrition {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface Amount {
  quantity: number;
  unit: string;
  grams: number;
  /**
   * True when the spoken unit matched no portion and we fell back to 100 g per
   * unit (spec section 7). Then unit is "g" and quantity is 100 x spoken quantity.
   */
  guessed: boolean;
}

// ---------------------------------------------------------------- HTTP API

export type LookupStatus = "ok" | "not_found" | "rate_limited" | "unavailable";

export interface Candidate {
  fdcId: number;
  name: string;
  dataType: string;
  brand: string | null;
  per100g: Per100g;
  /** Weights first (oz, lb, g), then this food's portion units. */
  units: UnitOption[];
  /** The spoken amount, resolved for this food. */
  amount: Amount;
  /** Nutrition for amount.grams. */
  nutrition: Nutrition;
}

/** POST /api/parse { text } -> ParseResponse */
export interface ParseResponse {
  meal: Meal | null;
  items: ParseItemResult[];
}

export interface ParseItemResult extends ParsedItem {
  status: LookupStatus;
  /** Friendly message when status is not "ok". */
  message?: string;
  /** candidates[0] is the top match; up to 5 total. Empty unless status is "ok". */
  candidates: Candidate[];
}

/** GET /api/foods/search?q=&quantity=&unit= -> SearchResponse */
export interface SearchResponse {
  query: string;
  status: LookupStatus;
  message?: string;
  candidates: Candidate[];
}

export interface GoalsSnapshot {
  calories: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

export interface EntryView {
  id: number;
  meal: Meal | null;
  /** food_entries.food_name: the plain name the user knows the food by ("Chicken breast"), or a manual name. */
  foodName: string;
  fdcId: number | null;
  /**
   * The USDA description for fdcId (usda_cache.description), shown under the
   * plain name in the edit sheet so the match can still be checked. Null or
   * absent for manual entries.
   */
  usdaName?: string | null;
  quantity: number;
  unit: string;
  /** Label for the unit, e.g. "large", "cup", "oz", "serving". */
  unitLabel: string;
  grams: number;
  nutrition: Nutrition;
  /** Units this entry can be changed to. Manual entries offer only their own unit. */
  units: UnitOption[];
  createdAt: string;
}

/** GET /api/entries?date= and the response to every entries write. */
export interface DayView {
  date: string;
  /** Today in the user's time zone, so the client knows where "next day" stops. */
  today: string;
  /** Goals in effect on `date` (goal history), or null if none. */
  goals: GoalsSnapshot | null;
  totals: Nutrition;
  entries: EntryView[];
}

/** POST /api/entries body. */
export interface CreateEntriesBody {
  date: string;
  meal: Meal | null;
  spokenText?: string;
  items: EntryInput[];
}

export type EntryInput =
  | {
      fdcId: number;
      quantity: number;
      unit: string;
      /**
       * Plain name to store in food_entries.food_name, e.g. "Chicken breast"
       * (the client sends the spoken food phrase or search text, capitalized).
       * Trimmed, up to 100 characters. When absent or blank the Worker stores
       * the USDA description. The description stays reachable via fdc_id and
       * usda_cache either way.
       */
      name?: string;
    }
  | {
      manual: { name: string; calories: number; proteinG: number; carbsG: number; fatG: number };
      quantity?: number;
      unit?: string;
    };

/** PATCH /api/entries/:id body. */
export interface UpdateEntryBody {
  quantity?: number;
  unit?: string;
  meal?: Meal | null;
}
