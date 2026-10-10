// Deterministic meal-phrase parser (spec section 7). No LLM: word lists plus a
// small hand-written grammar, so every rule is pinned by test/parse.test.ts.
//
//   "I had two eggs and a slice of toast for breakfast"
//   -> { meal: "breakfast", items: [{ 2, null, "eggs" }, { 1, "slice", "toast" }] }
//
// Pipeline: tokenize (keeping offsets into the original text), drop "um"/"uh",
// pull out meal hints, split into items (on punctuation, "and", "plus", "with"),
// then read each item as
//   [filler] [quantity] [container of] [unit] [of] food [trailing filler]

import { commonMatch } from "./common";
import type { Meal, ParseResult, ParsedItem, SpokenUnit } from "./types";

interface Token {
  /** Lowercase text. "&" reads as "and", "+" as "plus", curly apostrophes as straight. */
  w: string;
  kind: "word" | "num" | "sep";
  /** Value of a "num" token, 0 otherwise. */
  n: number;
  /** Written as a fraction ("1/2", "½"), so "1 1/2" reads as one mixed number. */
  frac: boolean;
  /** Offsets into the original text, for ParsedItem.text. */
  start: number;
  end: number;
}

/** A value read from the tokens and the index just past it. */
interface Read {
  value: number;
  end: number;
}

// ---------------------------------------------------------------- word lists
// Everything is a Map or Set so words like "constructor" never hit Object.prototype.

const words = (list: string) => new Set(list.split(" "));
const phrases = (list: string[]) => list.map((p) => p.split(" "));

const HESITATIONS = words("um umm uh uhh uhm er erm hmm hm mm");
const ARTICLES = words("a an");

const ONES = new Map(
  "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen"
    .split(" ")
    .map((w, i) => [w, i + 1] as const),
);
const TENS = new Map(
  "twenty thirty forty fifty sixty seventy eighty ninety".split(" ").map((w, i) => [w, (i + 2) * 10] as const),
);
/** Spoken fractions by denominator: "a half", "two thirds", "three quarters". */
const FRACTIONS = new Map([
  ["half", 2], ["halves", 2], ["third", 3], ["thirds", 3],
  ["quarter", 4], ["quarters", 4], ["fourth", 4], ["fourths", 4],
]);
const VULGAR_FRACTIONS = new Map([
  ["½", 1 / 2], ["⅓", 1 / 3], ["⅔", 2 / 3], ["¼", 1 / 4], ["¾", 3 / 4],
  ["⅛", 1 / 8], ["⅜", 3 / 8], ["⅝", 5 / 8], ["⅞", 7 / 8],
]);
const VAGUE_COUNTS = new Map([["couple", 2], ["few", 3], ["several", 3]]);
/** A number before one of these is a size, not a count: "a 6 inch sub" is one sub. */
const LENGTHS = words("inch inches foot feet ft cm centimeter centimeters centimetre centimetres");

const UNIT_SPELLINGS: Record<SpokenUnit, string> = {
  oz: "oz ozs ounce ounces",
  lb: "lb lbs pound pounds",
  g: "g gm gms gram grams gramme grammes",
  cup: "cup cups",
  // "A spoonful of nutella" is a tablespoon, the spoon people eat spreads with.
  tbsp: "tbsp tbsps tbs tbl tablespoon tablespoons tablespoonful tablespoonfuls spoonful spoonfuls",
  tsp: "tsp tsps teaspoon teaspoons teaspoonful teaspoonfuls",
  slice: "slice slices",
  piece: "piece pieces pc pcs",
  large: "large",
  medium: "medium",
  small: "small",
  serving: "serving servings portion portions",
  scoop: "scoop scoops scoopful scoopfuls",
};
const UNITS = new Map<string, SpokenUnit>(
  (Object.keys(UNIT_SPELLINGS) as SpokenUnit[]).flatMap((unit) =>
    UNIT_SPELLINGS[unit].split(" ").map((w) => [w, unit] as const),
  ),
);
const SIZES = new Set<SpokenUnit>(["large", "medium", "small"]);
/** A "." right after these is part of the word ("6 oz. chicken"), not the end of a sentence. */
const ABBREVIATIONS = words("oz ozs lb lbs g gm gms tbsp tbsps tbs tbl tsp tsps pc pcs fl approx");

/** "a bowl of", "two glasses of": dropped, leaving no unit. "a cup of" is a real unit. */
const CONTAINERS = words(
  "bowl bowls bowlful glass glasses plate plates plateful mug mugs can cans bottle bottles handful handfuls side sides bag bags packet packets",
);
/** "a big bowl of": the size describes the container, so it is dropped with it. */
const CONTAINER_SIZES = words("big little huge full whole tall large medium small");

/** Foods that would otherwise read as numbers or split on "and". Plurals match loosely. */
const COMPOUNDS = phrases([
  "mac and cheese", "macaroni and cheese", "peanut butter and jelly", "peanut butter and jam",
  "peanut butter and banana", "pb and j", "pb and jelly", "salt and pepper", "salt and vinegar",
  "sour cream and onion", "rice and beans", "beans and rice", "chicken and rice", "fish and chips",
  "chips and salsa", "chips and dip", "chips and guac", "chips and guacamole", "chips and queso",
  "biscuits and gravy", "bread and butter", "ham and cheese", "turkey and cheese", "half and half",
  "spaghetti and meatballs", "pork and beans", "franks and beans", "shrimp and grits",
  "chicken and waffles", "chicken and dumplings", "bangers and mash", "surf and turf", "sweet and sour",
  "cookies and cream", "peaches and cream", "strawberries and cream", "corned beef and cabbage",
  "liver and onions", "beef and broccoli", "chicken and broccoli", "bacon egg and cheese", "sausage egg and cheese",
  "ham egg and cheese", "steak egg and cheese",
]);
const NUMBER_LIKE_FOODS = phrases(["half and half", "quarter pounder"]);

const LEADING_FILLER = phrases([
  "i had", "i've had", "ive had", "i have had", "i just had", "i also had", "i ate", "i just ate",
  "i also ate", "i've eaten", "i have eaten", "i drank", "i just drank", "i'm having", "im having",
  "i am having", "i'm eating", "i am eating", "i'm drinking", "i am drinking", "i have", "i got",
  "i grabbed", "i'll have", "i will have", "we had", "i snacked on",
  "had", "ate", "drank", "eaten", "having", "eating", "drinking",
  "just", "also", "some", "about", "around", "roughly", "approximately", "approx", "maybe",
  "probably", "only", "my", "so", "okay", "ok", "oh", "yeah", "please", "log", "add", "track",
  "a little bit of", "a bit of", "a little",
  "today", "tonight", "yesterday", "earlier", "this morning", "this afternoon", "this evening",
]);
const TRAILING_FILLER = phrases([
  "please", "today", "tonight", "yesterday", "earlier", "too", "also", "as well", "like", "maybe",
  "or so", "or something", "i think", "i guess", "this morning", "this afternoon", "this evening",
]);
/** Left over in front of the food name once the amount is read: "two of the cookies". */
const FOOD_LEAD = words("of a an the some my");

const SPLIT_PHRASES = phrases(["with a side of", "along with", "as well as", "plus", "then"]);

/** Who a meal is shared with: "pizza with my friends" is pizza. */
const COMPANIONS = words(
  "friends friend family mom mum dad parents brother brothers sister sisters kids roommate roommates team " +
    "teammates coworkers grandma grandpa boyfriend girlfriend everyone",
);
const COMPANION_LEAD = words("my the a an some all of");
/** "with no cheese", "with nothing on it": what follows isn't eaten. */
const NOTHING = words("no none nothing out");
/** Hot drinks whose milk or cream is a splash, not a glass: "coffee with milk". */
const HOT_DRINKS = words("coffee tea latte chai espresso cappuccino americano");
const SPLASHES = new Set([
  "milk", "cream", "creamer", "half and half", "oat milk", "almond milk", "soy milk", "2% milk", "whole milk",
  "skim milk",
]);
/** Tablespoons in a splash of milk or cream. */
const SPLASH_TBSP = 2;

const MEAL_WORDS = new Map<string, Meal | null>([
  ["breakfast", "breakfast"], ["brunch", "breakfast"],
  ["lunch", "lunch"], ["lunchtime", "lunch"],
  ["dinner", "dinner"], ["dinnertime", "dinner"], ["supper", "dinner"], ["suppertime", "dinner"],
  ["snack", "snack"], ["snacks", "snack"],
  // Removed from the food, but it doesn't say which meal it belongs to.
  ["dessert", null],
]);
const HINT_PREPS = words("for at with during as over");
const HINT_DETS = words("a an my the our");
const HINT_MODIFIERS = words(
  "early late quick light little small big morning afternoon evening night midnight bedtime mid-morning mid-afternoon late-night post-workout pre-workout after-school",
);
const LINK_VERBS = words("was is were");
const BOUNDARY_WORDS = words("and plus then i i'm i've we was is today tonight yesterday this please also too earlier");

// ---------------------------------------------------------------- tokens

// Groups: 1-2 fraction, 3-4 number (+ "%"), 5 fraction character, 6 word,
// 7 dash in a range ("2-3", read as "2 to 3"; "1-1/2" stays a mixed number), 8 punctuation.
const TOKEN_RE =
  /(\d+)\/(\d+)|(\d*\.\d+|\d+)(%?)|([½⅓⅔¼¾⅛⅜⅝⅞])|(\p{L}[\p{L}\d]*(?:['’-][\p{L}\d]+)*)|((?<=\d)\s?[-–]\s?(?=\d+(?:\.\d+)?(?![/\d])))|(\s[-–—]\s|[–—]|\.(?!\d)|[,;:!?\n&+])/gu;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0;
    const base = { start, end: start + m[0].length, n: 0, frac: false };
    const prev = tokens[tokens.length - 1];
    if (m[1] !== undefined) {
      tokens.push({ ...base, w: m[0], kind: "num", n: Number(m[1]) / Number(m[2]), frac: true });
    } else if (m[3] !== undefined) {
      // "2% milk": a percentage is part of the food name, not an amount.
      tokens.push(m[4] ? { ...base, w: m[0], kind: "word" } : { ...base, w: m[0], kind: "num", n: Number(m[3]) });
    } else if (m[5] !== undefined) {
      tokens.push({ ...base, w: m[5], kind: "num", n: VULGAR_FRACTIONS.get(m[5]) ?? 0, frac: true });
    } else if (m[6] !== undefined) {
      tokens.push({ ...base, w: m[6].toLowerCase().replace(/’/g, "'"), kind: "word" });
    } else if (m[7] !== undefined) {
      tokens.push({ ...base, w: "to", kind: "word" });
    } else {
      const s = m[0].trim() || "\n";
      if (s === "&" || s === "+") tokens.push({ ...base, w: s === "&" ? "and" : "plus", kind: "word" });
      else if (s === "." && prev?.end === start && ABBREVIATIONS.has(prev.w)) continue;
      else tokens.push({ ...base, w: /^[-–—]$/.test(s) ? "-" : s, kind: "sep" });
    }
  }
  return tokens;
}

function wordAt(t: Token[], i: number): string {
  const tok = t[i];
  return tok && tok.kind === "word" ? tok.w : "";
}

/** Does `ws` appear at t[start..]? Loose matching ignores a plural "s"/"es" on either side. */
function matchAt(t: Token[], start: number, ws: string[], loose = false): boolean {
  if (start < 0 || start + ws.length > t.length) return false;
  return ws.every((w, k) => {
    const have = wordAt(t, start + k);
    if (have === w) return true;
    return loose && have !== "" && (have === `${w}s` || have === `${w}es` || w === `${have}s` || w === `${have}es`);
  });
}

/** Length of the longest phrase starting at t[i], or 0. */
function phraseAt(t: Token[], i: number, list: string[][]): number {
  let best = 0;
  for (const p of list) if (p.length > best && matchAt(t, i, p)) best = p.length;
  return best;
}

/** Length of the longest phrase ending just before t[end] that starts at or after t[start], or 0. */
function phraseEndingAt(t: Token[], start: number, end: number, list: string[][]): number {
  let best = 0;
  for (const p of list) if (p.length > best && end - p.length >= start && matchAt(t, end - p.length, p)) best = p.length;
  return best;
}

// ---------------------------------------------------------------- numbers

/** "seven", "twelve", "forty", "twenty five", "twenty-five". */
function readBelow100(t: Token[], i: number): Read | null {
  const w = wordAt(t, i);
  const one = ONES.get(w);
  if (one !== undefined) return { value: one, end: i + 1 };
  const dashed = /^([a-z]+)-([a-z]+)$/.exec(w);
  if (dashed) {
    const tens = TENS.get(dashed[1]);
    const unit = ONES.get(dashed[2]);
    return tens !== undefined && unit !== undefined && unit < 10 ? { value: tens + unit, end: i + 1 } : null;
  }
  const tens = TENS.get(w);
  if (tens === undefined) return null;
  const unit = ONES.get(wordAt(t, i + 1));
  return unit !== undefined && unit < 10 ? { value: tens + unit, end: i + 2 } : { value: tens, end: i + 1 };
}

/** Word numbers up to the hundreds: "six", "a hundred" (from "hundred"), "two hundred and fifty". */
function readWordNumber(t: Token[], i: number): Read | null {
  const small = readBelow100(t, i);
  let j = small ? small.end : i;
  if (wordAt(t, j) !== "hundred") return small;
  let value = (small ? small.value : 1) * 100;
  j++;
  const rest = readBelow100(t, wordAt(t, j) === "and" ? j + 1 : j);
  if (rest) {
    value += rest.value;
    j = rest.end;
  }
  return { value, end: j };
}

/** A plain number: digits ("6", "1.5", "1/2", "1 1/2", "1½") or words ("twenty five"). */
function readCardinal(t: Token[], i: number): Read | null {
  const tok = t[i];
  if (!tok || tok.kind !== "num") return readWordNumber(t, i);
  const next = t[i + 1];
  // A whole number then a proper fraction is one mixed number.
  if (!tok.frac && Number.isInteger(tok.n) && next?.kind === "num" && next.frac && next.n < 1) {
    return { value: tok.n + next.n, end: i + 2 };
  }
  return { value: tok.n, end: i + 1 };
}

const isCardinalToken = (t: Token[], i: number) => t[i]?.kind === "num" || readBelow100(t, i) !== null;

/** Denominator when t[i] is a fraction word, unless it starts a food like "half and half". */
function fractionAt(t: Token[], i: number): number | null {
  const d = FRACTIONS.get(wordAt(t, i));
  if (d === undefined || NUMBER_LIKE_FOODS.some((p) => matchAt(t, i, p, true))) return null;
  return d;
}

/** The fraction after "and" in "one and a half", "two and three quarters", "1 and 1/2". */
function readFraction(t: Token[], i: number): Read | null {
  const tok = t[i];
  if (tok?.kind === "num") return tok.frac && tok.n < 1 ? { value: tok.n, end: i + 1 } : null;
  let j = i;
  let count = 1;
  const c = readBelow100(t, i);
  if (ARTICLES.has(wordAt(t, i))) j++;
  else if (c) {
    count = c.value;
    j = c.end;
  }
  const d = fractionAt(t, j);
  return d ? { value: count / d, end: j + 1 } : null;
}

/** "a cup and a half (of rice)": the fraction comes after the unit, then "of" or the end. */
function fractionAfterUnit(t: Token[], i: number): Read | null {
  if (wordAt(t, i) !== "and") return null;
  const f = readFraction(t, i + 1);
  if (!f) return null;
  return f.end >= t.length || t[f.end].kind === "sep" || wordAt(t, f.end) === "of" ? f : null;
}

/**
 * The amount at the start of an item, or null when none was spoken (the item
 * then counts as 1). "a"/"an" means 1 but gives way to a number after it
 * ("an 8 ounce steak" is 8). Never returns 0 or less: "0 calorie soda" keeps
 * its "0" as part of the food.
 */
function readQuantity(t: Token[], i: number): Read | null {
  let j = i;
  const article = ARTICLES.has(wordAt(t, j));
  if (article) j++;
  let value: number | null = null;
  const card = readCardinal(t, j);
  if (card && !LENGTHS.has(wordAt(t, card.end))) {
    value = card.value;
    j = card.end;
  }
  const denom = fractionAt(t, j);
  if (denom) {
    // "half", "a half", "one third", "two thirds", then "half a", "a third of a", "half the"
    value = (value ?? 1) / denom;
    j++;
    if (wordAt(t, j) === "of") j++;
    if (ARTICLES.has(wordAt(t, j)) || wordAt(t, j) === "the") j++;
  } else if (value !== null) {
    const next = wordAt(t, j);
    const f = next === "and" ? readFraction(t, j + 1) : null;
    // "two or three", "2 to 3", "2-3": take the higher number, since people tend to under-log.
    const hi = next === "or" || next === "to" ? readCardinal(t, j + 1) : null;
    if (f) {
      value += f.value;
      j = f.end;
    } else if (hi) {
      value = Math.max(value, hi.value);
      j = hi.end;
    }
  } else {
    const vague = VAGUE_COUNTS.get(wordAt(t, j));
    if (vague !== undefined) {
      value = vague;
      j++;
      if (wordAt(t, j) === "of") j++;
    }
  }
  if (wordAt(t, j) === "dozen") {
    value = (value ?? 1) * 12;
    j++;
    if (wordAt(t, j) === "of") j++;
  }
  if (value === null && article) value = 1;
  return value !== null && value > 0 && Number.isFinite(value) ? { value, end: j } : null;
}

// ---------------------------------------------------------------- units

function readUnit(t: Token[], i: number): { unit: SpokenUnit; end: number } | null {
  // "fl oz", "fluid ounces": read as weight ounces, close enough for drinks.
  const fluid = wordAt(t, i) === "fl" || wordAt(t, i) === "fluid";
  const j = fluid ? i + 1 : i;
  const w = wordAt(t, j);
  const unit = UNITS.get(/^(large|medium|small)-sized?$/.exec(w)?.[1] ?? w);
  if (!unit || (fluid && unit !== "oz")) return null;
  let end = j + 1;
  if (SIZES.has(unit) && (wordAt(t, end) === "sized" || wordAt(t, end) === "size")) end++;
  return { unit, end };
}

function skipContainer(t: Token[], i: number): number {
  const j = CONTAINER_SIZES.has(wordAt(t, i)) ? i + 1 : i;
  return CONTAINERS.has(wordAt(t, j)) && wordAt(t, j + 1) === "of" ? j + 2 : i;
}

// ---------------------------------------------------------------- meal hints

/** A boundary after a meal word: end, punctuation, a new clause, or an amount. */
function boundaryAt(t: Token[], k: number): boolean {
  const tok = t[k];
  if (!tok || tok.kind === "sep" || BOUNDARY_WORDS.has(tok.w)) return true;
  return isCardinalToken(t, k) || readQuantity(t, k) !== null;
}

function mealHintAt(t: Token[], j: number): { meal: Meal | null; end: number } | null {
  const w = wordAt(t, j);
  // "for lunch", "as a snack", "with my afternoon snack", "at lunch time"
  if (HINT_PREPS.has(w)) {
    let k = j + 1;
    if (HINT_DETS.has(wordAt(t, k))) k++;
    for (let m = 0; m < 2 && HINT_MODIFIERS.has(wordAt(t, k)); m++) k++;
    const meal = MEAL_WORDS.get(wordAt(t, k));
    if (meal !== undefined) {
      k++;
      if (wordAt(t, k) === "time") k++;
      // "with" also joins foods ("pancakes with breakfast sausage"), so it needs a clean break.
      if (w !== "with" || boundaryAt(t, k)) return { meal, end: k };
    }
  }
  const meal = MEAL_WORDS.get(w);
  if (meal === undefined) return null;
  const next = t[j + 1];
  // "breakfast was ...", "Lunch: ...", "Lunch - ..."
  if (next && (LINK_VERBS.has(wordAt(t, j + 1)) || (next.kind === "sep" && (next.w === ":" || next.w === "-")))) {
    return { meal, end: j + 2 };
  }
  // A bare meal word opening a sentence: "Breakfast, two eggs", but not "breakfast burrito" or "dinner rolls".
  if ((j === 0 || t[j - 1].kind === "sep") && boundaryAt(t, j + 1)) return { meal, end: j + 1 };
  return null;
}

/** Removes every meal hint. The first one that names a meal wins. */
function extractMeal(t: Token[]): { meal: Meal | null; rest: Token[] } {
  let meal: Meal | null = null;
  const rest: Token[] = [];
  for (let j = 0; j < t.length; ) {
    const hint = mealHintAt(t, j);
    if (hint) {
      meal ??= hint.meal;
      j = hint.end;
    } else {
      rest.push(t[j++]);
    }
  }
  return { meal, rest };
}

// ---------------------------------------------------------------- items

/** Should this "and" stay inside an item instead of splitting it? */
function joinsAt(t: Token[], k: number): boolean {
  // Compound foods: "mac and cheese", "peanut butter and jelly sandwich".
  if (COMPOUNDS.some((c) => matchAt(t, k - c.indexOf("and"), c, true))) return true;
  // Numbers: "one and a half", "2 and 1/2", "two hundred and fifty".
  if (isCardinalToken(t, k - 1) && readFraction(t, k + 1)) return true;
  if (wordAt(t, k - 1) === "hundred" && readBelow100(t, k + 1)) return true;
  return UNITS.has(wordAt(t, k - 1)) && fractionAfterUnit(t, k) !== null;
}

/** Splits on punctuation, "and", "plus", "then", "with a side of", "along with", "as well as". */
function splitItems(t: Token[]): Token[][] {
  const items: Token[][] = [];
  let current: Token[] = [];
  for (let k = 0; k < t.length; k++) {
    const skip =
      t[k].kind === "sep" ? 1 : phraseAt(t, k, SPLIT_PHRASES) || (t[k].w === "and" && !joinsAt(t, k) ? 1 : 0);
    if (skip === 0) {
      current.push(t[k]);
      continue;
    }
    if (current.length) items.push(current);
    current = [];
    k += skip - 1;
  }
  if (current.length) items.push(current);
  return items;
}

function skipLeadingFiller(t: Token[], i: number): number {
  for (;;) {
    const n = phraseAt(t, i, LEADING_FILLER);
    if (n) i += n;
    // "like" is a hedge only before an amount: "like 2 eggs".
    else if (wordAt(t, i) === "like" && (isCardinalToken(t, i + 1) || readQuantity(t, i + 1))) i++;
    else return i;
  }
}

function parseItem(seg: Token[], source: string): ParsedItem | null {
  let i = skipLeadingFiller(seg, 0);
  const first = i;
  let quantity = 1;
  const q = readQuantity(seg, i);
  if (q) {
    quantity = q.value;
    i = q.end;
    // A count of sized things: "two 8 ounce steaks" is 16 oz.
    const each = readCardinal(seg, i);
    if (each && readUnit(seg, each.end)) {
      quantity *= each.value;
      i = each.end;
    }
  }
  i = skipContainer(seg, i);
  let unit: SpokenUnit | null = null;
  const u = readUnit(seg, i);
  if (u) {
    unit = u.unit;
    i = u.end;
    const half = fractionAfterUnit(seg, i);
    if (half) {
      quantity += half.value;
      i = half.end;
    }
  }
  while (FOOD_LEAD.has(wordAt(seg, i))) i++;
  let last = seg.length;
  while (last > i) {
    const n = phraseEndingAt(seg, i, last, TRAILING_FILLER);
    if (!n) break;
    last -= n;
  }
  let end = last;
  // A typed amount after the food, only when none came first: "chicken breast 6 oz".
  if (!q && !u) {
    for (let k = i + 1; k < end; k++) {
      const amount = readCardinal(seg, k);
      const after = amount && amount.value > 0 ? readUnit(seg, amount.end) : null;
      if (amount && after?.end === end) {
        quantity = amount.value;
        unit = after.unit;
        end = k;
        break;
      }
    }
  }
  if (i >= end) return null;
  return {
    quantity,
    unit,
    food: seg
      .slice(i, end)
      .map((tok) => tok.w)
      .join(" "),
    text: source.slice(seg[first].start, seg[last - 1].end).trim(),
  };
}

/**
 * "A bagel with cream cheese" is two foods, read as two items ("a bagel",
 * "cream cheese"), each with its own amount ("toast with 2 tablespoons of
 * peanut butter"). A dish the common-foods table names whole stays one item
 * ("spaghetti with meat sauce", "nachos with cheese"); company and what was
 * left off are dropped ("pizza with my friends", "a burger with no pickles");
 * and milk or cream in a hot drink is a splash ("coffee with milk" is 2 tbsp).
 */
function itemsOf(seg: Token[], source: string): ParsedItem[] {
  const whole = parseItem(seg, source);
  const k = seg.findIndex((tok, i) => i > 0 && tok.w === "with");
  if (k < 0 || k === seg.length - 1 || (whole && commonMatch(whole.food))) return whole ? [whole] : [];

  const left = itemsOf(seg.slice(0, k), source);
  let tail = seg.slice(k + 1);
  if (NOTHING.has(tail[0].w)) return left;
  let j = 0;
  while (j < tail.length - 1 && COMPANION_LEAD.has(tail[j].w)) j++;
  if (COMPANIONS.has(tail[j].w)) return left;
  if (tail[0].w === "extra" && tail.length > 1) tail = tail.slice(1);

  const added = itemsOf(tail, source);
  const drink = left[left.length - 1];
  const splash = added[0];
  if (drink && splash && HOT_DRINKS.has(drink.food.split(" ").pop() ?? "") && SPLASHES.has(splash.food)) {
    if (splash.unit === null && splash.quantity === 1) added[0] = { ...splash, quantity: SPLASH_TBSP, unit: "tbsp" };
  }
  return [...left, ...added];
}

/** Parses a voice transcript or typed text into a meal hint and food items. Never throws. */
export function parseMeal(text: string): ParseResult {
  if (typeof text !== "string") return { meal: null, items: [] };
  const tokens = tokenize(text).filter((tok) => !HESITATIONS.has(tok.w));
  const { meal, rest } = extractMeal(tokens);
  const items = splitItems(rest).flatMap((segment) => itemsOf(segment, text));
  return { meal, items };
}
