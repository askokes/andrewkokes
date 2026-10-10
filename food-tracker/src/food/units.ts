// Unit conversion (SPEC section 7): weights convert directly; cups, sizes,
// slices and whole items ("2 eggs") use the food's USDA portions, plus the
// everyday units the common-foods table adds (a can of soda, a container of
// yogurt). When nothing matches we assume 100 g per unit and flag the amount
// as guessed.
import { commonPortions, commonUnit } from "./common";
import { nutritionFor } from "./nutrition";
import {
  GRAMS_PER,
  MAX_GRAMS,
  maxQuantityFor,
  MIN_QUANTITY,
  type Amount,
  type Candidate,
  type FoodRecord,
  type RawPortion,
  type UnitOption,
} from "./types";
import { sameWord, words } from "./words";

const WEIGHT_OPTIONS: readonly UnitOption[] = [
  { unit: "oz", label: "oz", grams: GRAMS_PER.oz },
  { unit: "lb", label: "lb", grams: GRAMS_PER.lb },
  { unit: "g", label: "g", grams: GRAMS_PER.g },
];

/** Order portion units are listed in after the weights. */
const LIST_ORDER = ["each", "small", "medium", "large", "slice", "piece", "serving", "cup", "tbsp", "tsp"];
/**
 * What a unitless amount ("two eggs", "a banana") means when the food has no
 * unit of its own in the common-foods table, best first. There is no cup here:
 * a food whose only portion is a cup is as often a powder as a drink ("two
 * eggs" once became 2 cups of dried egg white, 800 kcal). A guessed 100 g is
 * flagged for the user to check; a cup is not. Poured and scooped staples
 * ("a glass of milk", "a bowl of oatmeal") get their cup from the table.
 */
const COUNT_ORDER = ["each", "medium", "large", "small", "piece", "slice", "serving"];
const SIZES = new Set(["large", "medium", "small"]);

const VOLUME: Record<string, "cup" | "tbsp" | "tsp"> = {
  cup: "cup",
  cups: "cup",
  tbsp: "tbsp",
  tbs: "tbsp",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  tsp: "tsp",
  teaspoon: "tsp",
  teaspoons: "tsp",
};

/** Weights are always offered as oz/lb/g, so weight portions are skipped. "fl" is "fl oz". */
const WEIGHT_WORDS = new Set(["oz", "ounce", "ounces", "lb", "lbs", "pound", "pounds", "g", "gram", "grams", "kg", "fl"]);

/** Portion words that name a whole item even when the food's description doesn't use them. */
const ITEM_WORDS = [
  "fruit", "bar", "pastry", "waffle", "cookie", "cracker", "muffin", "bagel", "biscuit", "roll", "bun",
  "fillet", "breast", "thigh", "drumstick", "wing", "leg", "patty", "link", "sausage", "egg", "whole",
  "pancake", "tortilla", "sandwich", "burrito", "taco", "donut", "doughnut", "croissant", "nugget", "chop",
];

/** Containers and odd measures that are never "one of the food", even if the description mentions them. */
const NOT_ITEMS = new Set([
  "unit", "package", "container", "bunch", "stalk", "spear", "leaf", "pat", "stick", "cubic", "quart", "pint",
  "gallon", "liter", "ml", "can", "bottle", "jar", "box", "bag", "packet", "envelope", "scoop", "dash", "pinch",
  "extra", "jumbo", "mini", "serving", "nlea", "racc", "yield", "yields",
]);

/** Forms people rarely mean by "a cup of cheese": used only when nothing else fits. */
const DENSE_FORMS = /\b(pureed|mashed|melted|crumbs)\b/;

interface Match {
  unit: string;
  label: string;
  /**
   * When a food has several portions for one unit, the highest wins: 2 for a
   * plain one ("slice"), 1 qualified ("slice, thin"), 0 a dense form ("cup, melted").
   */
  rank: number;
}

const rankOf = (qualified: boolean, text: string) => (!qualified ? 2 : DENSE_FORMS.test(text) ? 0 : 1);

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const gramsText = (g: number) => `${round1(g)} g`;

/** The text after the first word, up to the next comma, without "or ..." alternatives. */
function qualifier(text: string): string {
  const rest = text.replace(/^[^a-z0-9]*[a-z0-9]+/, "").replace(/^[\s,]+/, "");
  return rest.split(",")[0].split(" or ")[0].trim();
}

function isItemWord(word: string, foodWords: string[]): boolean {
  if (word.length < 3 || NOT_ITEMS.has(word)) return false;
  return ITEM_WORDS.some((w) => sameWord(w, word)) || foodWords.some((w) => sameWord(w, word));
}

/**
 * Maps one USDA portion to a unit key. Foundation foods name the unit in
 * measureUnit ("cup", "RACC", "egg", "Banana"); SR Legacy foods say
 * "undetermined" there and put the unit in the modifier ("cup, chopped or diced").
 */
function classify(p: RawPortion, gramsEach: number, foodWords: string[]): Match | null {
  const unitName = p.unitName?.trim() ?? "";
  const namedUnit = unitName !== "" && unitName.toLowerCase() !== "undetermined";
  const source = namedUnit
    ? [unitName, p.modifier].filter(Boolean).join(", ")
    : p.modifier?.trim() || (p.description ?? "").replace(/^[\d\s./]+/, "");
  const text = source
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/^[\s,]+|[\s,]+$/g, "");
  if (!text || text.includes("yield")) return null;
  const [first, second] = words(text);
  if (!first) return null;

  if (first === "racc" || first === "serving" || first === "servings" || (first === "nlea" && second?.startsWith("serving"))) {
    // Branded label servings keep their household text: "serving (1 container)".
    const label = namedUnit && unitName === "serving" && p.description
      ? `serving (${p.description.toLowerCase()})`
      : `serving (${gramsText(gramsEach)})`;
    return { unit: "serving", label, rank: rankOf(!["racc", "serving", "nlea serving"].includes(text), text) };
  }
  if (WEIGHT_WORDS.has(first)) return null;

  const volume = VOLUME[first];
  if (volume || first === "slice" || first === "slices" || first === "piece" || first === "pieces") {
    const unit = volume ?? (first.startsWith("slice") ? "slice" : "piece");
    const rest = qualifier(text);
    return { unit, label: rest ? `${unit}, ${rest}` : unit, rank: rankOf(rest !== "", rest) };
  }
  if (SIZES.has(first)) {
    // "large (8" to 8-7/8" long)" -> "large"; "medium bagel" stays as is. "extra large" never gets here.
    const label = text.split(",")[0].trim();
    return { unit: first, label, rank: rankOf(label !== first, label) };
  }
  if (isItemWord(first, foodWords)) {
    // "potato large" is a size of the item, not the item itself.
    if (second && SIZES.has(second)) return { unit: second, label: `${second} ${first}`, rank: 1 };
    return { unit: "each", label: first, rank: 2 };
  }
  return null;
}

/**
 * The units a food can be measured in: oz, lb and g first, then its portion
 * units in a fixed order (each, small, medium, large, slice, piece, serving,
 * cup, tbsp, tsp), then any other unit the common-foods table adds for it
 * ("can", "bottle", "pack"). When USDA lists several portions for one unit, a
 * plain one ("slice") beats a qualified one ("slice, thin"), which beats a dense
 * form ("cup, melted"); otherwise USDA's order wins. Missing cup/tbsp/tsp are
 * derived from whichever of them USDA gives. The table only adds units USDA's
 * portions lack (see commonPortions); `withCommon: false` leaves them out.
 */
export function unitOptions(food: FoodRecord, withCommon = true): UnitOption[] {
  const foodWords = words(food.description);
  const found = new Map<string, { label: string; grams: number; rank: number }>();

  for (const p of food.portions) {
    if (!(p.amount > 0) || !(p.gramWeight > 0)) continue;
    const gramsEach = p.gramWeight / p.amount; // "0.5 breast = 86 g" means one breast is 172 g
    const match = classify(p, gramsEach, foodWords);
    if (!match) continue;
    const prev = found.get(match.unit);
    if (!prev || match.rank > prev.rank) found.set(match.unit, { label: match.label, grams: gramsEach, rank: match.rank });
  }

  const cup = found.get("cup")?.grams;
  const tbsp = found.get("tbsp")?.grams;
  const tsp = found.get("tsp")?.grams;
  const derive = (unit: string, grams: number | undefined) => {
    if (!found.has(unit) && grams !== undefined) found.set(unit, { label: unit, grams, rank: 2 });
  };
  derive("cup", tbsp !== undefined ? tbsp * 16 : tsp !== undefined ? tsp * 48 : undefined);
  derive("tbsp", cup !== undefined ? cup / 16 : tsp !== undefined ? tsp * 3 : undefined);
  derive("tsp", tbsp !== undefined ? tbsp / 3 : cup !== undefined ? cup / 48 : undefined);

  const extra: UnitOption[] = [];
  if (withCommon) {
    for (const p of commonPortions(food.fdcId)) {
      if (found.has(p.unit) || WEIGHT_OPTIONS.some((o) => o.unit === p.unit)) continue;
      if (LIST_ORDER.includes(p.unit)) found.set(p.unit, { label: p.label, grams: p.grams, rank: 2 });
      else extra.push({ unit: p.unit, label: p.label, grams: round2(p.grams) });
    }
  }

  const portionOptions = LIST_ORDER.flatMap((unit) => {
    const option = found.get(unit);
    return option ? [{ unit, label: option.label, grams: round2(option.grams) }] : [];
  });
  return [...WEIGHT_OPTIONS.map((o) => ({ ...o })), ...portionOptions, ...extra];
}

/**
 * Units to try, best first, when none was spoken: the ones the caller prefers
 * (the unit of the table entry the spoken phrase matched, so "a soda" is a can
 * whichever cola record is offered), then the food's own table unit, then
 * COUNT_ORDER.
 */
function unitlessOrder(food: FoodRecord, preferred: readonly (string | null | undefined)[]): string[] {
  const own = commonUnit(food.fdcId);
  return [...preferred, own, ...COUNT_ORDER].filter((u): u is string => typeof u === "string" && u !== "");
}

function resolveWith(options: UnitOption[], quantity: number, unit: string | null, order: readonly string[]): Amount {
  const key = unit?.trim().toLowerCase() || null;
  const find = (u: string) => options.find((o) => o.unit === u);
  let option = key === null ? order.map(find).find(Boolean) : find(key);
  // "a large egg" when the egg record only has a whole-egg portion: one egg beats a 100 g guess.
  if (!option && key !== null && SIZES.has(key)) option = find("each");

  if (option) return { quantity, unit: option.unit, grams: round1(quantity * option.grams), guessed: false };
  const grams = round1(100 * quantity);
  return { quantity: grams, unit: "g", grams, guessed: true };
}

/**
 * Grams for a spoken amount of a food. `unit` is a weight, one of the food's
 * unit keys, or null when no unit was spoken ("two eggs"): then the first of
 * `preferred` the food offers, its own common-foods unit ("eggs" are large), or
 * COUNT_ORDER. Anything that doesn't match falls back to 100 g per unit with
 * `guessed: true`.
 */
export function resolveAmount(
  food: FoodRecord,
  quantity: number,
  unit: string | null,
  preferred: readonly (string | null | undefined)[] = [],
): Amount {
  return resolveWith(unitOptions(food), quantity, unit, unitlessOrder(food, preferred));
}

/**
 * An offered amount that POST /api/entries takes as is: at least MIN_QUANTITY,
 * at most the unit's limit and MAX_GRAMS ("200 eggs" becomes 99.4 eggs, 5 kg).
 * A changed amount is flagged guessed so the confirm card asks the user to check it.
 */
function withinLimits(amount: Amount, options: UnitOption[]): Amount {
  const each = options.find((o) => o.unit === amount.unit)?.grams ?? 1;
  const most = Math.min(maxQuantityFor(amount.unit), each > 0 ? MAX_GRAMS / each : Infinity);
  const quantity =
    amount.quantity > most ? Math.floor(most * 100) / 100 : Math.max(amount.quantity, MIN_QUANTITY);
  if (quantity === amount.quantity) return amount;
  return { quantity, unit: amount.unit, grams: round1(quantity * each), guessed: true };
}

/**
 * The HTTP Candidate for a food and a spoken amount, always one that can be
 * saved as offered. `preferred` as for resolveAmount.
 */
export function toCandidate(
  food: FoodRecord,
  quantity: number,
  unit: string | null,
  preferred: readonly (string | null | undefined)[] = [],
): Candidate {
  const units = unitOptions(food);
  const amount = withinLimits(resolveWith(units, quantity, unit, unitlessOrder(food, preferred)), units);
  return {
    fdcId: food.fdcId,
    name: food.description,
    dataType: food.dataType,
    brand: food.brand,
    per100g: food.per100g,
    units,
    amount,
    nutrition: nutritionFor(food.per100g, amount.grams),
  };
}
