// Restaurant menus: what the chains publish for their own items (Andrew asked
// for Panera, Subway, Jimmy John's, Jersey Mike's, Chick-fil-A, Chipotle,
// Taco Bell, McDonald's and Panda Express). USDA has few chain items, and old
// ones, so these come from each chain's nutrition guide instead (see the
// `source` on every item in src/food/menus/*.json, and scripts/import-menus.mjs).
//
// Each size of an item is a food of its own, with a made-up id from
// MENU_ID_MIN up that never collides with a USDA fdcId, so the rest of the app
// (units, nutrition, saved entries, the edit sheet) treats it like any food.
// A size keeps the chain's own numbers exactly: "a large fries" is the large's
// published calories, not the medium's scaled by weight.
//
// A phrase finds a menu item when it names the chain ("a spicy deluxe from
// Chick-fil-A", "Panda Express orange chicken") or says one of an item's
// signature names, which only one chain uses ("a Big Mac", "a Crunchwrap
// Supreme"). Anything else is left to the common-foods table and USDA.
import { commonKey } from "./common";
import type { FoodRecord, UnitOption } from "./types";
import { GRAMS_PER } from "./types";
import chickFilA from "./menus/chick-fil-a.json";
import chipotle from "./menus/chipotle.json";
import jerseyMikes from "./menus/jersey-mikes.json";
import jimmyJohns from "./menus/jimmy-johns.json";
import mcdonalds from "./menus/mcdonalds.json";
import pandaExpress from "./menus/panda-express.json";
import panera from "./menus/panera.json";
import subway from "./menus/subway.json";
import tacoBell from "./menus/taco-bell.json";

export interface MenuSize {
  /** Stable for good: saved entries point at it. */
  id: number;
  /** "regular", "medium", "6-inch", "8-count", "bowl". */
  size: string;
  /** One serving, for the unit picker: "1 sandwich", "medium (30 oz)". */
  label: string;
  /** Published serving weight; null where the chain only gives a volume or nothing. */
  grams: number | null;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  default?: boolean;
}

export interface MenuItem {
  name: string;
  /** Lowercase phrases people say for it, without the chain's name. */
  says: string[];
  /** The ones only this chain uses, which find it without the chain named. */
  signature?: string[];
  category: string;
  sizes: MenuSize[];
  sourceKind?: string;
  source?: string;
  note?: string;
}

export interface MenuChain {
  chain: string;
  /** Ways people name the chain ("mcdonald's", "mickey d's"). */
  chainSays: string[];
  sources?: string[];
  retrieved?: string;
  items: MenuItem[];
}

export const MENU_ID_MIN = 900_000_000;
/** Grams one serving stands for when the chain publishes no weight. Never shown: those foods have no weight units. */
const NOMINAL_GRAMS = 100;

export const MENUS: readonly MenuChain[] = [
  mcdonalds,
  chickFilA,
  subway,
  jimmyJohns,
  jerseyMikes,
  tacoBell,
  chipotle,
  panera,
  pandaExpress,
] as MenuChain[];

interface Entry {
  chain: MenuChain;
  item: MenuItem;
  size: MenuSize;
  /** Pieces in one serving, for sizes like "8-count". */
  count: number | null;
}

// ---------------------------------------------------------------- keys

const NUMBER_WORDS = new Set(["number", "num", "no"]);

/** commonKey, with "#9" and "number 9" both "9" (Jimmy John's and Jersey Mike's go by number). */
export function menuKey(text: string): string {
  const ws = commonKey(text).split(" ").filter(Boolean);
  return ws.filter((w, i) => !(NUMBER_WORDS.has(w) && /^\d+$/.test(ws[i + 1] ?? ""))).join(" ");
}

const SIZE_SYNONYMS: [RegExp, string][] = [
  [/\bfoot long\b/g, "footlong"],
  [/\b(six|6) inche?\b/g, "6 inch"],
  [/\b(eight|8) inche?\b/g, "8 inch"],
  // A Subway footlong is 12 inches.
  [/\b(twelve|12) inche?\b/g, "footlong"],
  [/\bkid size\b/g, "kid"],
];

function withSynonyms(key: string): string {
  return SIZE_SYNONYMS.reduce((k, [re, to]) => k.replace(re, to), key);
}

const countOf = (size: string) => {
  const m = /^(\d+) (?:count|piece|pc|ct|nugget|strip|wing)$/.exec(menuKey(size));
  return m ? Number(m[1]) : null;
};

/** Removes the words of `part` (a key) from `whole` (a key) where they appear together; null if they don't. */
function without(whole: string, part: string): string | null {
  if (!part) return null;
  const w = ` ${whole} `;
  const at = w.indexOf(` ${part} `);
  if (at < 0) return null;
  return `${w.slice(0, at)} ${w.slice(at + part.length + 2)}`.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------- index

const byId = new Map<number, Entry>();
/** Chain names, longest first, so "panda express" wins over "panda". */
const chainNames: { key: string; chain: MenuChain }[] = [];
/** Every size word any item uses, longest first ("bread bowl" before "bowl"). */
const sizeWords = new Set<string>();

for (const chain of MENUS) {
  for (const name of new Set([chain.chain, ...chain.chainSays].map(menuKey))) if (name) chainNames.push({ key: name, chain });
  for (const item of chain.items) {
    for (const size of item.sizes) {
      byId.set(size.id, { chain, item, size, count: countOf(size.size) });
      const k = withSynonyms(menuKey(size.size));
      if (k && countOf(size.size) === null) sizeWords.add(k);
    }
  }
}
chainNames.sort((a, b) => b.key.length - a.key.length);
const SIZE_WORDS = [...sizeWords].sort((a, b) => b.length - a.length);

/** An item's names as keys, with any chain name in them taken out ("chick fil a sandwich" is "sandwich" there). */
function namesOf(chain: MenuChain, item: MenuItem, which: "says" | "signature"): string[] {
  const raw = which === "says" ? [item.name, ...item.says] : (item.signature ?? []);
  const keys = new Set<string>();
  for (const text of raw) {
    let k = withSynonyms(menuKey(text));
    for (const c of chainNames) if (c.chain === chain) k = without(k, c.key) ?? k;
    if (k) keys.add(k);
  }
  return [...keys];
}

const saysOf = new Map<MenuItem, string[]>();
const signaturesOf = new Map<MenuItem, string[]>();
for (const chain of MENUS) {
  for (const item of chain.items) {
    saysOf.set(item, namesOf(chain, item, "says"));
    signaturesOf.set(item, namesOf(chain, item, "signature"));
  }
}

// ---------------------------------------------------------------- foods

export const isMenuId = (id: number) => byId.has(id);

/** "McDonald's Big Mac", "Subway Turkey Breast (footlong)". */
function description(e: Entry) {
  const sized = e.item.sizes.length > 1 ? ` (${e.size.size})` : "";
  return `${e.chain.chain} ${e.item.name}${sized}`;
}

/** A menu size as a food: per 100 g from its published weight, or per serving when the chain gives none. */
export function menuFood(id: number): FoodRecord | null {
  const e = byId.get(id);
  if (!e) return null;
  const grams = e.size.grams ?? NOMINAL_GRAMS;
  const per = (n: number) => Math.max(0, (n * 100) / grams);
  return {
    fdcId: id,
    description: description(e),
    dataType: "Restaurant",
    brand: e.chain.chain,
    per100g: { kcal: per(e.size.calories), protein: per(e.size.proteinG), carbs: per(e.size.carbsG), fat: per(e.size.fatG) },
    portions: [],
  };
}

/** False for a menu size the chain publishes no weight for: it has no oz or grams to offer. */
export function menuWeightKnown(id: number): boolean {
  return byId.get(id)?.size.grams != null;
}

/**
 * A menu size's units: one serving ("each", labeled the chain's way), a piece
 * for counted sizes ("8-count" nuggets), and oz, lb and g when the weight is
 * published. Null for anything not on a menu.
 */
export function menuUnits(id: number): UnitOption[] | null {
  const e = byId.get(id);
  if (!e) return null;
  const grams = e.size.grams ?? NOMINAL_GRAMS;
  const units: UnitOption[] = [];
  if (e.size.grams != null) {
    units.push({ unit: "oz", label: "oz", grams: GRAMS_PER.oz }, { unit: "lb", label: "lb", grams: GRAMS_PER.lb }, { unit: "g", label: "g", grams: 1 });
  }
  units.push({ unit: "each", label: e.size.label, grams: Math.round(grams * 100) / 100 });
  if (e.count) units.push({ unit: "piece", label: "piece", grams: Math.round((grams / e.count) * 100) / 100 });
  return units;
}

// ---------------------------------------------------------------- matching

export interface MenuMatch {
  /** The size asked for (or the item's usual one) first, then its other sizes, then like items there. */
  foods: FoodRecord[];
  quantity: number;
  /** "piece" for a count no size has ("7 nuggets"); otherwise null, one serving each. */
  unit: string | null;
}

/** The chain a phrase or its "from ..." names, and the phrase without it. */
function findChain(food: string, place: string | null | undefined): { chain: MenuChain | null; rest: string } {
  const key = withSynonyms(menuKey(food));
  for (const c of chainNames) {
    const rest = without(key, c.key);
    if (rest !== null) return { chain: c.chain, rest };
  }
  if (place) {
    const at = menuKey(place);
    const found = chainNames.find((c) => at === c.key || without(at, c.key) !== null);
    if (found) return { chain: found.chain, rest: key };
  }
  return { chain: null, rest: key };
}

/** The size word in a phrase, and the phrase without it. */
function findSize(key: string): { size: string | null; rest: string } {
  for (const s of SIZE_WORDS) {
    const rest = without(key, s);
    if (rest !== null && rest !== "") return { size: s, rest };
  }
  return { size: null, rest: key };
}

const wordsOf = (k: string) => k.split(" ").filter(Boolean);
const containsAll = (have: string[], need: string[]) => need.every((w) => have.includes(w));

/**
 * The size a phrase says, among the sizes this item has ("bread bowl" in "broccoli cheddar in a bread bowl",
 * "footlong" in "a footlong italian bmt"), longest first; null when it says none.
 */
function sizeIn(item: MenuItem, key: string): string | null {
  const said = item.sizes
    .map((s) => withSynonyms(menuKey(s.size)))
    .filter((k) => k && countOf(k) === null && without(key, k) !== null)
    .sort((a, b) => b.length - a.length);
  return said[0] ?? null;
}

/**
 * The item a phrase names at a chain: its exact name first (as said, then
 * without a size word), then the item with the longest name the phrase
 * contains ("chicken burrito bowl" over "chicken burrito"), then the shortest
 * name containing the phrase ("spicy deluxe" is the Spicy Deluxe Sandwich).
 * The last only for two words or more: "chicken" alone names nothing, and
 * "banana" is no Strawberry Banana Smoothie.
 */
function itemAt(chain: MenuChain, key: string): MenuItem | null {
  if (!key) return null;
  const items = chain.items;
  const exact = items.find((it) => saysOf.get(it)!.includes(key));
  if (exact) return exact;
  const sized = findSize(key);
  if (sized.size) {
    const bare = items.find((it) => saysOf.get(it)!.includes(sized.rest));
    if (bare) return bare;
  }

  const have = wordsOf(key);
  let best: { item: MenuItem; n: number } | null = null;
  for (const it of items) {
    for (const name of saysOf.get(it)!) {
      const need = wordsOf(name);
      if (need.length && containsAll(have, need) && (!best || need.length > best.n)) best = { item: it, n: need.length };
    }
  }
  if (best) return best.item;

  const bare = wordsOf(sized.rest);
  if (bare.length < 2) return null;
  const within: { item: MenuItem; n: number }[] = [];
  for (const it of items) {
    const fits = saysOf.get(it)!.filter((name) => containsAll(wordsOf(name), bare));
    if (fits.length) within.push({ item: it, n: Math.min(...fits.map((name) => wordsOf(name).length)) });
  }
  if (!within.length) return null;
  within.sort((a, b) => a.n - b.n);
  return within[0].item;
}

/** The item a signature name says, at any chain ("big mac"). */
function itemBySignature(key: string): { chain: MenuChain; item: MenuItem } | null {
  for (const chain of MENUS) {
    for (const item of chain.items) if (signaturesOf.get(item)!.includes(key)) return { chain, item };
  }
  return null;
}

function pickSize(item: MenuItem, size: string | null, count: number | null): MenuSize {
  const byWord = size
    ? item.sizes.find((s) => withSynonyms(menuKey(s.size)) === size) ??
      item.sizes.find((s) => without(withSynonyms(menuKey(s.label)), size) !== null)
    : undefined;
  const byCount = count ? item.sizes.find((s) => countOf(s.size) === count) : undefined;
  return byWord ?? byCount ?? item.sizes.find((s) => s.default) ?? item.sizes[0];
}

/** Other items at the chain to offer after this one's sizes: the same kind, most words in common first. */
function likeItems(chain: MenuChain, item: MenuItem, key: string): MenuItem[] {
  const have = wordsOf(key);
  const overlap = (it: MenuItem) => Math.max(0, ...saysOf.get(it)!.map((s) => wordsOf(s).filter((w) => have.includes(w)).length));
  return chain.items
    .filter((it) => it !== item && it.category === item.category)
    .map((it, i) => ({ it, i, n: overlap(it) }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.it);
}

const SIZE_UNITS = new Set(["small", "medium", "large", "cup"]);
const COUNT_WORDS = new Set(["count", "piece", "pc", "ct"]);

/**
 * The menu foods a spoken phrase means, or null when it names no menu item
 * (then `rest` of lookupMenu is searched as usual). `place` is where the
 * sentence said the food came from ("from McDonald's").
 */
export function menuMatch(
  food: string,
  opts: { quantity: number; unit: string | null; place?: string | null; limit?: number },
): MenuMatch | null {
  const { chain, rest } = findChain(food, opts.place);
  let quantity = opts.quantity;
  let unit = opts.unit;
  let key = rest;

  // "an 8 count nuggets" reads as 8 of "count nuggets"; "8 piece nuggets" as 8 pieces of nuggets.
  let count: number | null = null;
  const lead = wordsOf(key)[0];
  if (lead && COUNT_WORDS.has(lead) && quantity > 1 && Number.isInteger(quantity)) {
    count = quantity;
    quantity = 1;
    key = wordsOf(key).slice(1).join(" ");
  } else if (unit === "piece" && Number.isInteger(quantity)) {
    count = quantity;
    quantity = 1;
    unit = null;
  }
  const countSaid = /\b(\d+) (?:count|piece|pc|ct)\b/.exec(key);
  if (countSaid) {
    count = Number(countSaid[1]);
    key = key.replace(countSaid[0], " ").replace(/\s+/g, " ").trim();
  }

  let size: string | null = null;
  if (unit !== null && SIZE_UNITS.has(unit)) {
    size = unit;
    unit = null;
  }

  let found: { chain: MenuChain; item: MenuItem } | null = null;
  const atChain = chain ? itemAt(chain, key) : null;
  if (chain && atChain) found = { chain, item: atChain };
  else {
    // A name only one chain uses finds it without the chain said: "a big mac", "a large baja blast freeze".
    const sized = findSize(key);
    found = itemBySignature(key) ?? (sized.size ? itemBySignature(sized.rest) : null);
  }
  if (!found) return null;
  size ??= sizeIn(found.item, key);

  // A number with no unit, for something sold by the count, counts pieces: "20 McNuggets" is the 20-piece,
  // "7 nuggets" seven of them. "Two Big Macs" stays two.
  const counted = found.item.sizes.some((s) => countOf(s.size) !== null);
  if (counted && !count && !size && unit === null && quantity > 1 && Number.isInteger(quantity)) {
    count = quantity;
    quantity = 1;
  } else if (!counted && count) {
    // "2 pieces of orange chicken": servings, since it isn't sold by the piece.
    quantity = count;
    count = null;
    unit = null;
  }

  const chosen = pickSize(found.item, size, count);
  let pieces: number | null = null;
  // A count no size has ("7 nuggets"): that many pieces of the usual size.
  if (count && countOf(chosen.size) !== count) {
    const e = byId.get(chosen.id)!;
    if (e.count) pieces = count;
  }
  const limit = opts.limit ?? 5;
  const sizes = [chosen, ...found.item.sizes.filter((s) => s !== chosen)];
  const others = likeItems(found.chain, found.item, key).map((it) => pickSize(it, size, null));
  const ids = [...sizes, ...others].slice(0, Math.max(limit, 1)).map((s) => s.id);
  return {
    foods: ids.map((id) => menuFood(id)!),
    quantity: pieces ?? quantity,
    unit: pieces ? "piece" : unit,
  };
}

/**
 * The chain a food phrase names or one of its signature items says, if any: the other foods in the sentence
 * come from there too ("a Crunchwrap Supreme and a Baja Blast" is Taco Bell's Baja Blast).
 */
export function chainIn(food: string): string | null {
  const named = findChain(food, null);
  if (named.chain) return named.chain.chain;
  const sized = findSize(named.rest);
  return (itemBySignature(named.rest) ?? (sized.size ? itemBySignature(sized.rest) : null))?.chain.chain ?? null;
}

/**
 * True when a phrase is exactly a menu item's name (a size word aside), so it stays one food: "a McFlurry with
 * Oreo", or "a mini turkey and provolone" said with Jersey Mike's. Without a chain only signature names count:
 * "chips and guac" anywhere else is two foods.
 */
export function isMenuName(food: string, place?: string | null): boolean {
  const { chain, rest } = findChain(food, place);
  const keys = [rest, findSize(rest).rest].filter(Boolean);
  if (!keys.length) return false;
  if (chain) return chain.items.some((it) => keys.some((k) => saysOf.get(it)!.includes(k)));
  return MENUS.some((c) => c.items.some((it) => keys.some((k) => signaturesOf.get(it)!.includes(k))));
}

/** What a menu size is saved as: the chain and the item, as on the menu ("McDonald's Big Mac"). The size is the amount. */
export function menuEntryName(id: number): string | null {
  const e = byId.get(id);
  return e ? `${e.chain.chain} ${e.item.name}` : null;
}

/**
 * The phrase with the chain's name taken out, as said, for searching USDA
 * when no menu item matched: "a panera banana" is a banana.
 */
export function withoutChain(food: string): string {
  const said = food.toLowerCase().replace(/['’]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
  const keys = said.map((w) => menuKey(w));
  for (const c of chainNames) {
    const name = wordsOf(c.key);
    for (let i = 0; i + name.length <= keys.length; i++) {
      if (name.every((w, j) => keys[i + j] === w)) {
        const rest = [...said.slice(0, i), ...said.slice(i + name.length)].join(" ");
        return rest || food;
      }
    }
  }
  return food;
}
