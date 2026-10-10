// USDA FoodData Central client (SPEC section 6). Every food and every search is
// cached in D1 so repeat lookups never hit the API, which is rate limited to
// roughly 1,000 requests an hour per key.
import { commonMatch, type CommonFood } from "./common";
import { extractFood, extractSearchHit } from "./nutrition";
import type { FoodRecord, RawPortion } from "./types";
import { contentWords, sameWord, words } from "./words";

const API = "https://api.nal.usda.gov/fdc/v1";
const SEARCH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Most foods one search returns. */
const MAX_LIMIT = 10;
/**
 * Hits asked of USDA per search, for rankHits to choose from. Still one call;
 * details are fetched only for the foods returned. USDA's top 10 for short
 * words is mostly wrong ("rice" lists rice cakes, flour and sake first).
 */
export const SEARCH_PAGE_SIZE = 50;
const BULK_CHUNK = 20;
const TIMEOUT_MS = 10_000;

type Scope = "core" | "branded";
const DATA_TYPES: Record<Scope, string> = { core: "Foundation,SR Legacy", branded: "Branded" };

/** "skipped": the caller's beforeCall refused the request before it was made (see UsdaDeps). */
export type UsdaErrorKind = "rate_limited" | "unavailable" | "skipped";

/** Any USDA failure. Messages are for server logs and never include the API key or a request URL. */
export class UsdaError extends Error {
  readonly kind: UsdaErrorKind;
  readonly status: number | null;

  constructor(kind: UsdaErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "UsdaError";
    this.kind = kind;
    this.status = status;
  }
}

export interface UsdaDeps {
  apiKey: string;
  fetch: typeof fetch;
  db: D1Database;
  /** Clock for cache timestamps. Tests inject one to check the 30-day search expiry. */
  now?: () => Date;
  /**
   * Runs before every request to USDA (never for a cache hit). Throws a
   * UsdaError to refuse it. The routes use it to share out the key's hourly
   * limit, which every user shares (see routes.ts).
   */
  beforeCall?: () => Promise<void>;
}

// ---------------------------------------------------------------- query text

/** Whole phrases people say that USDA describes differently. Values must not be keys. */
const SYNONYMS: Record<string, string> = {
  oatmeal: "oats cooked",
  porridge: "oats cooked",
  oj: "orange juice",
  pb: "peanut butter",
  "mac n cheese": "mac and cheese",
  ketchup: "catsup",
  // USDA files hot dogs as frankfurters; its search for "hot dog" finds relish and buns first.
  "hot dog": "frankfurter",
  "hot dogs": "frankfurter",
  hotdog: "frankfurter",
  hotdogs: "frankfurter",
  // USDA has no PB&J; its Branded search for "pb and j" finds granola and bars, and for the
  // sandwich's full name finds the sandwiches.
  "pb and j": "peanut butter and jelly sandwich",
  "pb and js": "peanut butter and jelly sandwich",
  "pb and jelly": "peanut butter and jelly sandwich",
  pbj: "peanut butter and jelly sandwich",
  "peanut butter and jelly": "peanut butter and jelly sandwich",
  "pb and j sandwich": "peanut butter and jelly sandwich",
  // "Boba" alone finds popping-boba toppings and boba ice cream; the drink is milk tea.
  boba: "boba milk tea",
  "bubble tea": "boba milk tea",
  "boba tea": "boba milk tea",
};

/** Lowercase, plain characters, single spaces, synonyms applied: " Mac & Cheese! " -> "mac and cheese". */
export function normalizeQuery(text: string): string {
  const q = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9%\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s-]+|[\s-]+$/g, "")
    .slice(0, 100)
    .trim();
  return SYNONYMS[q] ?? q;
}

const KNOWN_BRANDS = [
  "chobani", "oikos", "fage", "yoplait", "dannon", "activia", "siggis", "go-gurt", "cheerios", "frosted flakes",
  "froot loops", "lucky charms", "special k", "kelloggs", "quaker", "nature valley", "clif", "rxbar", "larabar",
  "pop-tarts", "poptarts", "eggo", "goldfish", "ritz", "oreo", "oreos", "doritos", "cheetos", "pringles", "lays",
  "takis", "nutella", "jif", "skippy", "smuckers", "kraft", "velveeta", "lunchables", "uncrustables", "hot pockets",
  "digiorno", "totinos", "tyson", "hormel", "oscar mayer", "jimmy dean", "fairlife", "core power", "premier protein",
  "muscle milk", "gatorade", "powerade", "coca-cola", "coke", "pepsi", "sprite", "red bull", "celsius", "starbucks",
  "dunkin", "mcdonalds", "big mac", "chick-fil-a", "chipotle", "subway", "taco bell", "wendys", "burger king",
  "panera", "dominos", "pizza hut", "krispy kreme", "snickers", "reeses", "kit kat", "hersheys", "twix", "skittles",
  "m&m's", "m and ms", "ben and jerrys", "halo top", "tillamook", "dave's killer bread", "sara lee", "kind bar",
  "quest bar", "capri sun", "monster energy", "slurpee", "icee", "frappuccino",
].map((b) => words(b).join(" "));

/** Capitalized words that usually aren't brands: cuisines, places, varieties, meals, days. */
const NOT_BRANDS = new Set([
  "breakfast", "lunch", "dinner", "supper", "snack", "greek", "french", "swiss", "italian", "mexican", "english",
  "canadian", "caesar", "thai", "cajun", "buffalo", "belgian", "danish", "polish", "cuban", "philly", "hawaiian",
  "texas", "american", "irish", "spanish", "chinese", "japanese", "korean", "indian", "vietnamese", "german", "dutch",
  "turkish", "mediterranean", "asian", "southwestern", "cobb", "waldorf", "reuben", "kalamata", "parmesan",
  "romano", "mozzarella", "monterey", "jack", "colby", "gouda", "brie", "cheddar", "granny", "smith", "fuji",
  "gala", "honeycrisp", "florida", "california", "new", "york", "boston", "chicago", "sicilian", "dijon", "bbq",
  "blt", "oj", "pb", "ok", "um", "uh", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
]);

/**
 * True when the user seems to have named a brand: a known brand, or a
 * capitalized word that doesn't start a sentence and isn't "I", a meal or a
 * cuisine ("a Chobani", but not "Greek yogurt for Lunch").
 */
export function looksLikeBrand(text: string): boolean {
  const plain = ` ${words(text).join(" ")} `;
  if (KNOWN_BRANDS.some((b) => plain.includes(` ${b} `))) return true;

  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const bare = tokens.map((t) => t.replace(/^[^A-Za-z]+|[^A-Za-z']+$/g, ""));
  const capitalized = (w: string) => /^[A-Z]/.test(w);
  // Title Case Input says nothing about brands.
  if (bare.filter(Boolean).length > 1 && bare.filter(Boolean).every(capitalized)) return false;

  return bare.some((word, i) => {
    if (i === 0 || !capitalized(word) || /[.!?:]$/.test(tokens[i - 1])) return false;
    const lower = word.toLowerCase().replace(/['’]s$/, "");
    return lower !== "i" && !lower.startsWith("i'") && !NOT_BRANDS.has(lower);
  });
}

// ---------------------------------------------------------------- ranking
//
// USDA's relevance order is poor for short everyday words: "milk" lists milk
// chocolate and dried buttermilk above fluid milk, "eggs" lists dried egg white
// above whole eggs. rankHits reorders the hits using how USDA writes its
// descriptions: the food first ("Egg, whole, raw"), then its kind, form and
// preparation, sometimes behind a filing word ("Snacks, potato chips") or a
// restaurant's name ("McDONALD'S, Side Salad").

/** Cooking and prep words: never the head noun ("oats cooked" is about oats). */
const PREP_WORDS = new Set([
  "cooked", "raw", "fried", "baked", "grilled", "boiled", "roasted", "steamed", "scrambled", "poached", "broiled",
  "braised", "stewed", "sauteed", "mashed", "chopped", "sliced", "diced", "shredded", "plain", "fresh", "frozen",
  "canned", "dried", "hard", "soft", "whole", "nonfat", "lowfat", "skim", "unsweetened", "sweetened", "iced",
  "homemade",
]);

export interface RankableHit {
  description: string;
  dataType: string;
  brand?: string | null;
  /** Energy per 100 g, when known: a drink at 400 kcal per 100 g is a dry mix. */
  per100g?: { kcal: number } | null;
}

/** Cooked by a method that makes it ready to eat. "Prepared" alone is left out: "prepared from recipe" is a dish. */
const COOKED = /\b(cooked|roasted|grilled|baked|broiled|boiled|steamed|braised|stewed|poached|scrambled|toasted|brewed|microwaved|heated|fried|sauteed|pan-browned|omelet)\b/;
const UNCOOKED = /\b(raw|uncooked)\b/;
/** Kept for later rather than cooked: loses to the same food cooked (see rankHits). */
const PACKED = /\b(canned|frozen|smoked)\b/;
/** Cooked in fat or coated: more calories than plainer cooking, so it loses unless asked for. */
const FRIED = /\b(fried|breaded|batter|battered|sauteed)\b/;

/**
 * Forms people don't mean unless they say so, each with the query words that
 * ask for it. Dry, powdered and concentrated forms carry several times the
 * calories of the food as eaten; parts, stand-ins, other animals and baby food
 * are different foods. A form written with "prepared" (a dry mix made up with
 * milk, a concentrate made up with water) is back to being eaten as is.
 * "With added vitamin D" and the like are not forms. `inNotes` forms are also
 * looked for in USDA's parenthetical notes ("Corn, white, steamed (Navajo)").
 */
const DRIED = ["dried", "dehydrated", "dry", "powder", "powdered"];
const NOT_AS_EATEN: { form: RegExp; unless?: RegExp; asked: string[]; inNotes?: boolean; variant?: boolean }[] = [
  { form: /\b(dried|dehydrated|desiccated)\b/, asked: DRIED },
  { form: /\bdry\b(?![\s-]*(roasted|heat))/, unless: /\b(prepared|cooked)\b/, asked: DRIED },
  { form: /\bpowder(ed)?\b/, unless: /\bprepared\b/, asked: DRIED },
  { form: /\bmix(es)?\b/, unless: /\bprepared\b/, asked: ["mix"] },
  { form: /\bdough\b/, unless: /\b(baked|prepared)\b/, asked: ["dough"] },
  { form: /\b(unprepared|as purchased)\b/, asked: [] },
  { form: /\b(concentrate|undiluted)\b/, unless: /\b(prepared|diluted|reconstituted)\b/, asked: ["concentrate"] },
  { form: /\b(condensed|evaporated)\b/, unless: /\bprepared\b/, asked: ["condensed", "evaporated"] },
  {
    form: /\b(imitation|substitute|meatless|analog|made with tofu|veggie|vegan|plant[\s-]based)\b/,
    asked: ["imitation", "substitute", "meatless", "vegetarian", "veggie", "vegan", "tofu", "plant"],
  },
  { form: /\b(babyfood|baby food|infant formula|toddler formula)\b/, asked: ["babyfood"] },
  { form: /\b(rendered|grease|drippings|separable fat|fat only|skin only)\b/, asked: ["fat", "grease", "skin"] },
  // A part on its own: "Chicken, skin (drumsticks and thighs)", "Beef, variety meats, liver".
  {
    form: /(^|, )(skin|fat|giblets|liver|gizzards?|feet|neck|tail|heart|tongue)(,|$)/,
    asked: ["skin", "fat", "giblets", "liver", "gizzard", "feet", "neck", "tail", "heart", "tongue"],
  },
  { form: /\b(yolks?|egg,? whites?)\b/, asked: ["yolk", "white", "whites"] },
  { form: /\b(peel|leaves|seeds?|rind)\b/, asked: ["peel", "leaves", "leaf", "seed", "seeds", "rind"] },
  { form: /\bfermented\b/, asked: ["fermented"] },
  {
    form: /\b(sheep|goat|buffalo|bison|duck|goose|quail|emu|ostrich|deer|venison|elk|moose|caribou|rabbit|squirrel|beaver|bear|seal|whale|walrus|horse|turkey|game meat)\b/,
    asked: ["sheep", "goat", "buffalo", "bison", "duck", "goose", "quail", "venison", "deer", "turkey", "rabbit", "elk"],
  },
  { form: /\b(navajo|apache|hopi|alaska native|shoshone bannock|northern plains indians)\b/, asked: [], inNotes: true },
  {
    form: /\b(low calorie|reduced calorie|diet|sugar[\s-]free|zero sugar|lo(w)? carb|fat[\s-]free|nonfat)\b/,
    asked: ["diet", "free", "calorie", "nonfat", "skim", "carb", "zero"],
    // Still the food, eaten as is: ranked below the regular kind, but a fine match (see isReasonable).
    variant: true,
  },
];

/**
 * Foods eaten poured or sipped. A hit denser than LIQUID_MAX_KCAL per 100 g is
 * a dry mix or a concentrate however it is described: Branded chai latte and
 * cocoa mixes rarely say "powder" (429 kcal per 100 g), and a 7-Eleven
 * "SLURPEE, POPPING CANDY" is candy. Milkshakes and canned coconut milk stay
 * under it.
 */
const LIQUIDS = new Set([
  "latte", "cappuccino", "mocha", "macchiato", "frappuccino", "frappe", "coffee", "tea", "chai", "juice", "soda",
  "drink", "beverage", "lemonade", "smoothie", "shake", "milkshake", "milk", "cocoa", "water", "punch", "slurpee",
  "slushie", "kombucha", "cider", "refresher", "cola", "soup", "pho", "broth", "chowder", "bisque",
]);
const LIQUID_MAX_KCAL = 250;

/** Derived products, when one names the food or what it carries ("Flour, rice", "Oil, walnut", "Soup, beef broth"). */
const DERIVED = new Set([
  "flour", "meal", "starch", "bran", "germ", "oil", "extract", "isolate", "syrup", "nectar", "broth", "bouillon",
  // What a dish is made from, not the dish: "PHO SOUP SEASONING SPICE CUBE", "PHO BROTH BOMB", "INSTANT BOBA KIT".
  "seasoning", "seasonings", "cube", "cubes", "bomb", "bombs", "starter", "base", "kit", "kits",
]);

/** USDA's filing words, which come before the food itself: "Snacks, potato chips", "Beverages, coffee". */
const FILING = new Set([
  "snacks", "snack", "beverages", "beverage", "alcoholic beverage", "alcoholic beverages", "candies", "fast foods",
  "fast food", "restaurant", "cereals ready-to-eat", "cereals", "cereal", "nuts", "seeds", "crustaceans", "mollusks",
  "fish", "salad dressing", "formulated bar", "protein supplement", "frozen novelties", "babyfood", "infant formula",
  "school lunch", "game meat", "sweeteners", "toppings", "cheese", "pizza chain", "chinese", "italian", "mexican",
  "latino", "family style", "japanese", "thai", "greek", "indian",
].map((t) => contentWords(t).join(" ")));

/**
 * Foods whose later segments name a flavor or filling, not a kind: "Sauce,
 * steak" is a sauce and "Cookies, chocolate chip" a cookie, where "Beef, top
 * sirloin, steak" is a steak.
 */
const CARRIERS = new Set([
  "sauce", "relish", "marmalade", "jam", "jams", "jelly", "jellies", "preserves", "spread", "soup", "gravy",
  "seasoning", "pie", "pies", "filling", "fillings", "cookie", "cookies", "cracker", "crackers", "bagel", "bagels",
  "muffin", "muffins", "cake", "cakes", "pudding", "puddings", "cream", "creams", "yogurt", "yogurts", "candies",
  "bar", "bars", "drink", "juice", "nectar", "syrup", "syrups", "tea", "smoothie", "shake", "shakes", "pastries",
  "pastry", "doughnut", "doughnuts", "waffle", "waffles", "pancake", "pancakes", "sherbet", "sorbet", "dip", "chips",
  "cereals", "bread", "rolls", "biscuits", "noodles", "pasta", "loaf", "sausage", "vinegar", "liqueur",
]);

/**
 * Words that say how a food is graded, cooked, packed or fortified, never which
 * food it is. A description made of the query's words and these names the food
 * itself ("Eggs, Grade A, Large, egg whole" for "eggs"); any other word is a
 * variety, flavor or dish ("Milk, buttermilk", "Bread, egg").
 */
const GENERIC = new Set([
  "raw", "cooked", "fresh", "frozen", "canned", "roasted", "grilled", "baked", "broiled", "boiled", "steamed",
  "braised", "stewed", "poached", "scrambled", "toasted", "brewed", "microwaved", "heated", "prepared", "drained",
  "heat", "moist", "pan", "browned", "oven", "fried", "sauteed",
  "commercially", "commercial", "home", "recipe", "from", "restaurant", "whole", "plain", "regular", "original", "all",
  "variety", "varieties", "type", "types", "mixed", "species", "grade", "choice", "select", "large", "medium", "small",
  "extra", "average", "ripe", "enriched", "unenriched", "fortified", "unfortified", "added", "salt", "salted",
  "unsalted", "sodium", "low", "fat", "lowfat", "nonfat", "milkfat", "reduced", "fluid", "vitamin", "vitamins",
  "calcium", "iron", "sulfate", "magnesium", "chloride", "nigari", "propionate", "unsweetened", "solids", "liquids",
  "liquid", "only", "meat", "lean", "separable", "trimmed", "boneless", "skinless", "skin", "bone", "flesh", "pack",
  "water", "tap", "broilers", "broiler", "fryers", "fryer", "side", "chopped", "sliced", "diced", "shredded",
  "pieces", "piece", "cut", "style", "made", "includes", "include", "inch", "no", "not", "without", "processing",
  "white", "yellow", "red", "green", "chilled", "refrigerated", "shelf", "stable", "moisture", "part", "skim",
  "table", "packed", "bottled", "pasteurized", "fully",
]);

/**
 * USDA boilerplate that would otherwise read as words of the food: "Oil, olive, salad or cooking",
 * beans' "mature seeds", "ready-to-eat".
 */
const NOISE = /\b(salad or cooking|mature seeds|ready[\s-]+to[\s-]+(eat|serve|drink|heat|bake|cook|use)( or -?fry)?)\b/g;
/**
 * A package size and whatever follows it, in Branded names: "Cheetos Hot 9.5z", "Starbucks Frappuccino
 * Chilled Coffee 13.7 Fluid Ounce Glass Bottle", "CAPRI SUN ..., 6 FL OZ, 30 COUNT".
 */
const PACKAGE =
  /(^|\s)\d+(\.\d+)?\s*(z|oz|ounces?|fl\.?\s*oz|fluid\s+ounces?|ct|count|lbs?|g|grams?|ml|l|liters?|pk|packs?)\b.*$/i;

/** Sizes and other words USDA rarely writes, so a hit without them can still be the food. */
const MODIFIERS = new Set([
  "big", "little", "huge", "giant", "mini", "jumbo", "small", "medium", "large", "extra", "spicy", "cold", "warm",
  "leftover", "classic", "original", "regular",
]);

function queryShape(query: string) {
  const normal = normalizeQuery(query);
  const tokens = contentWords(normal);
  // "Bagel with cream cheese" is a bagel: the food comes before "with".
  const main = contentWords(normal.split(/\bwith\b/)[0]);
  const pick = (ws: string[]) => [...ws].reverse().find((w) => !PREP_WORDS.has(w)) ?? ws[ws.length - 1];
  const head = pick(main.length ? main : tokens);
  return { tokens, head };
}

/** Mostly capitals: a brand or restaurant ("McDONALD'S", "TACO BELL", "KFC"). */
function isBrandText(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, "");
  return letters.length >= 2 && letters.replace(/[^A-Z]/g, "").length / letters.length >= 0.7;
}

/** A phrase up to "with" or "in": "Potato salad with egg" is a salad, "french fried in vegetable oil" is fried. */
const phrase = (text: string) => contentWords(text.split(/\b(?:with|in|on)\b/)[0]);
/** A compound's own head is its last word that isn't generic: "Cereals ready-to-eat" is cereals. */
const headOf = (ws: string[]): string | undefined => [...ws].reverse().find((w) => !GENERIC.has(w)) ?? ws[ws.length - 1];
const ADDS_INGREDIENTS = /\b(with|in|on)\b/;

/** Restaurant and fast-food records are someone's dish: a generic record of the same food is more likely meant. */
const DISHES = new Set(["fast foods", "fast food", "restaurant", "school lunch"]);

interface Segment {
  /** Lowercase, without apostrophes or (notes). */
  text: string;
  /** As written, without notes: brands are told apart by their capitals. */
  original: string;
  /** A short note that names the food another way: "rice (sake)", "Balsam-pear (bitter gourd)". */
  alias: string[];
}

/** Comma segments, keeping commas inside USDA's (notes) in their segment, without package sizes. */
function segmentsOf(description: string): Segment[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of description) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts.flatMap((part) => {
    const original = part.replace(/\([^)]*\)?/g, " ").replace(PACKAGE, " ").replace(/\s+/g, " ").trim();
    const text = original.toLowerCase().replace(/['’]/g, "").replace(NOISE, " ").replace(/\s+/g, " ").trim();
    if (!text) return [];
    const notes = [...part.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
    const short = notes.find(
      (n) => !/[,;]/.test(n) && !/^\s*(includ|made|may|also|without|with)/i.test(n) && contentWords(n).length <= 3,
    );
    return [{ text, original, alias: short ? contentWords(short) : [] }];
  });
}

interface Naming {
  /** See nameScore. */
  score: number;
  /** Index of the food's own segment, after any filing words and restaurant names. */
  at: number;
  /** The food's own name: its segment's words up to "with", plus a short alias note. */
  name: string[];
  /** A restaurant's or fast-food chain's dish. */
  dish: boolean;
}

/**
 * How well a description names the asked-for food, from what its food segment
 * (the first one after filing words and restaurant names) says:
 * 4 the food itself ("Egg, whole" for "eggs"; "Chicken, ..., breast" for
 *   "chicken breast"; "Side Salad" for "salad");
 * 3 a kind or cut of something, named in a later segment of its own
 *   ("Pork, cured, bacon"; "Beef, top sirloin, steak"; "Bread, white, toasted");
 * 2 a compound with the same head but another food's name ("French toast",
 *   "Potato salad", "Almond milk", "Snacks, potato chips" for "chips");
 * 1 mentioned somewhere: an ingredient or a flavor ("Fast foods, biscuit, with
 *   egg and bacon"; "Sauce, steak"; "Cookies, chocolate chip");
 * 0 only as a modifier of something else ("Rice crackers", "Candies, milk
 *   chocolate", "Alcoholic beverage, rice (sake)").
 * A restaurant's own dish ("McDONALD'S, ...") scores at most 3, so a generic record of the same food wins.
 *
 * Branded descriptions (`brandWords` is the product's brand) are all capitals, so only a segment that is
 * the brand itself counts as one ("STARBUCKS, FRAPPUCCINO, ..."; "TEA 5, ASSAM MILK TEA"), and their later
 * segments are flavors, not kinds: "MILK CHOCOLATE, PEANUT BUTTER & JELLY SANDWICH" is chocolate.
 */
function nameScore(segments: Segment[], q: { tokens: string[]; head: string }, brandWords: string[] | null): Naming {
  const inQuery = (w: string) => q.tokens.some((t) => sameWord(w, t));
  const isHead = (w: string | undefined) => w !== undefined && sameWord(w, q.head);
  const known = (w: string) => inQuery(w) || GENERIC.has(w) || /^\d/.test(w);
  const isBrandSegment = (s: Segment, ws: string[]) =>
    brandWords === null ? isBrandText(s.original) : ws.length > 0 && ws.every((w) => brandWords.includes(w));

  let at = 0;
  let branded = false;
  let dish = false;
  for (; at < segments.length - 1; at++) {
    const ws = contentWords(segments[at].text);
    const brand = isBrandSegment(segments[at], ws);
    // A brand that shares a word with the query ("TEA 5" for "milk tea") gives way to a later segment that names it.
    const namedLater = brand && segments.slice(at + 1).some((s) => contentWords(s.text).some(inQuery));
    if (ws.some(inQuery) && !namedLater) break;
    if (!FILING.has(ws.join(" ")) && !brand) break;
    branded ||= brand;
    dish ||= brand || DISHES.has(ws.join(" "));
  }
  const segment = segments[at];
  const name = segment ? [...phrase(segment.text), ...segment.alias].filter((w) => !/^\d/.test(w)) : [];
  // Every Branded food is someone's product: no cap and no dish penalty among them.
  const sr = brandWords === null;
  const result = (score: number): Naming => ({
    score: branded && sr ? Math.min(score, 3) : score,
    at,
    name,
    dish: dish && sr,
  });
  if (!segment) return result(0);

  // "Milk chocolate" is chocolate: the head has to come last if it is there at all. When the head is the
  // product's brand ("Cheetos Hot" for "hot cheetos"), the flavor may follow it.
  const headIsBrand = brandWords !== null && brandWords.some((b) => sameWord(b, q.head));
  const headLast = isHead(headOf(name)) || headIsBrand;
  if (name.length && name.every(known) && name.some(inQuery)) return result(!name.some(isHead) || headLast ? 4 : 0);
  if (name.some(isHead)) return result(headLast ? 2 : 0);

  // Later segments: a kind or cut of the food ("Beef, top sirloin, steak"), unless the food carries
  // flavors ("Sauce, steak") or the segment is part of a "with ..." list of ingredients.
  const carrier = CARRIERS.has(headOf(name) ?? "");
  let ingredients = ADDS_INGREDIENTS.test(segment.text);
  let mentioned = false;
  const before = new Set(segments.slice(0, at + 1).flatMap((s) => contentWords(s.text)));
  for (const later of segments.slice(at + 1)) {
    // Branded names repeat the product's short name after a comma ("GYRO PIZZA, GYRO"): not a kind of it.
    const laterWords = contentWords(later.text);
    if (laterWords.every((w) => before.has(w))) continue;
    laterWords.forEach((w) => before.add(w));
    const matched = headOf(phrase(later.text));
    // "toasted" for "toast": a cooking word that is the asked-for food is a kind even on bread.
    const cookedForm = matched !== undefined && matched !== q.head && COOKED.test(matched);
    if (sr && !ingredients && isHead(matched) && (!carrier || cookedForm)) return result(3);
    if (contentWords(later.text).some(isHead)) mentioned = true;
    ingredients ||= ADDS_INGREDIENTS.test(later.text);
  }
  return result(mentioned ? 1 : 0);
}

/** What rankHits and isReasonable read from one hit. */
function readHit(hit: RankableHit, q: { tokens: string[]; head: string }) {
  const { tokens, head } = q;
  const asked = (w: string) => tokens.some((t) => sameWord(t, w));
  const segments = segmentsOf(hit.description);
  const plain = segments.map((s) => s.text).join(", ");
  const withNotes = hit.description.toLowerCase().replace(/['’]/g, "").replace(/\(includ[^)]*\)/g, " ");
  const brandWords = hit.dataType === "Branded" ? contentWords(hit.brand ?? "") : null;
  const naming = nameScore(segments, q, brandWords);
  const descWords = contentWords(plain);
  // Notes count as words of the food ("(fat free or skim)"), but not as extra words that make it specific.
  const allWords = [...contentWords(withNotes), ...contentWords(hit.brand ?? "")];
  const has = (t: string) => allWords.some((w) => sameWord(w, t));
  // A derived product: its own name ("Flour, rice", "Oil, walnut") or, for a food that carries
  // flavors, the segment after it ("Soup, chicken broth", "Bread, rice bran").
  const own = segments.slice(naming.at);
  const derivedAt = (s: Segment | undefined) => {
    const h = s ? headOf(phrase(s.text)) : undefined;
    return h !== undefined && DERIVED.has(h) && !asked(h);
  };
  const nextAfterName = own.slice(1).find((s) => !isBrandText(s.original));
  const derived = derivedAt(own[0]) || (CARRIERS.has(headOf(naming.name) ?? "") && derivedAt(nextAfterName));
  const liquid = [...LIQUIDS].some((w) => sameWord(w, head));
  const tooDense = liquid && (hit.per100g?.kcal ?? 0) > LIQUID_MAX_KCAL && !asked("dry") && !asked("mix");
  const forms = NOT_AS_EATEN.filter(({ form, unless, asked: words, inNotes }) => {
    const text = inNotes ? withNotes : plain;
    return form.test(text) && !unless?.test(text) && !words.some(asked);
  });
  /** Not the food as eaten at all: dried, a mix, a part, another animal, a seasoning. */
  const otherFood = derived || tooDense || forms.some((f) => !f.variant);
  const notAsEaten = otherFood || forms.length > 0;
  /** A Branded product of the brand that was asked for ("chobani", "hot cheetos"). */
  const brandAsked = brandWords?.some((b) => sameWord(b, head)) ?? false;
  return { segments, plain, descWords, own, naming, has, notAsEaten, otherFood, brandAsked };
}

/**
 * The hit is the food that was asked for, as eaten: it names the head noun as
 * the food itself or a kind of it (nameScore 2 or more, or it is a product of
 * the brand asked for), isn't dried, a mix, a part, a seasoning or another
 * animal (a diet variant is fine), and has at least one of the query's other
 * words that USDA would write ("capri sun" is not Sun Country cereal, "pad
 * thai" not a Thai curry soup, "caesar salad" not a plain side salad). When the
 * core search's best match isn't, Branded is searched (see searchUsda).
 */
export function isReasonable(query: string, hit: RankableHit): boolean {
  const q = queryShape(query);
  if (!q.head) return false;
  const facts = readHit(hit, q);
  if (!facts.has(q.head) || facts.otherFood || (facts.naming.score < 2 && !facts.brandAsked)) return false;
  const others = q.tokens.filter(
    (t) => !sameWord(t, q.head) && !PREP_WORDS.has(t) && !GENERIC.has(t) && !MODIFIERS.has(t) && !/^\d/.test(t),
  );
  return !others.length || others.some(facts.has);
}

/**
 * Best match first. In priority order: names the head noun at all; Foundation
 * or SR Legacy over Branded; eaten as is (not dried, powdered, a mix, a part,
 * baby food, another animal, a drink too dense to be one, a diet variant; not
 * raw when the same food is listed cooked); names the food itself or a kind of
 * it and has every query word; how well it
 * names the food (see nameScore); has every query word; cooked for foods that
 * get cooked, and plain cooking over fried; fewest words that are neither the
 * query's nor generic (a plain "Bananas, raw" over "Bananas, overripe, raw"; a
 * restaurant's dish counts one more); starts with the query words; fewer comma
 * segments. USDA's order breaks ties.
 */
export function rankHits<T extends RankableHit>(query: string, hits: readonly T[]): T[] {
  const q = queryShape(query);
  const { tokens, head } = q;
  if (!head) return [...hits];
  const asked = (w: string) => tokens.some((t) => sameWord(t, w));
  const askedForPrep = tokens.some((t) => PREP_WORDS.has(t) || t === "dry" || t === "uncooked");

  const facts = hits.map((hit, index) => {
    const { segments, plain, descWords, own, naming, has, notAsEaten } = readHit(hit, q);
    const ownWords = contentWords(own.map((s) => s.text).join(" "));
    return {
      hit,
      index,
      segments,
      descWords,
      name: naming.name,
      named: naming.score,
      hasHead: has(head),
      core: hit.dataType !== "Branded",
      notAsEaten,
      hasAll: tokens.every(has),
      cooked: COOKED.test(plain),
      raw: UNCOOKED.test(plain) && !COOKED.test(plain),
      fried: FRIED.test(plain),
      packed: PACKED.test(plain),
      unexplained:
        ownWords.filter((w) => !asked(w) && !GENERIC.has(w) && !/^\d/.test(w) && w.length > 1).length + (naming.dish ? 1 : 0),
    };
  });
  type Facts = (typeof facts)[number];

  /**
   * People log food as eaten. When the hits list the same food both raw and plainly cooked (raw and
   * roasted chicken, raw and boiled broccoli, raw black rice and cooked wild rice), raw loses. "The
   * same food" is a record whose own name has the same head ("Rice, ...", "Wild rice, ..."), so a raw
   * orange never loses to "Fish, roughy, orange, cooked", nor a banana to banana bread. A canned,
   * frozen or smoked record loses the same way to one of the very same name cooked ("Beans, black,
   * canned" to "Beans, black, cooked"), but not to a different dish ("Refried beans, canned").
   */
  const plainlyCooked = facts.filter(
    (c) => c.cooked && !c.fried && !c.notAsEaten && c.hasHead && c.core && c.named >= 2,
  );
  const sameName = (a: string[], b: string[]) => a.length === b.length && a.every((w, i) => sameWord(w, b[i]));
  const rawWhileCooked = (f: Facts) => {
    const h = headOf(f.name);
    return f.raw && !askedForPrep && h !== undefined && plainlyCooked.some((c) => sameWord(headOf(c.name) ?? "", h));
  };
  const prep = (f: Facts) => {
    if (askedForPrep) return 1;
    if (f.fried) return 0;
    return !f.cooked && f.packed && plainlyCooked.some((c) => sameName(c.name, f.name)) ? 1 : 2;
  };

  const scored = facts.map((f) => {
    let lead = 0;
    while (lead < tokens.length && lead < f.descWords.length && sameWord(f.descWords[lead], tokens[lead])) lead++;
    const score = [
      f.hasHead ? 1 : 0,
      f.core ? 1 : 0,
      f.notAsEaten || rawWhileCooked(f) ? 0 : 1,
      f.named >= 3 && f.hasAll ? 1 : 0,
      f.named,
      f.hasAll ? 1 : 0,
      prep(f),
      -f.unexplained,
      lead,
      -f.segments.length,
      -f.index,
    ];
    return { hit: f.hit, score };
  });

  scored.sort((a, b) => {
    for (let i = 0; i < a.score.length; i++) if (a.score[i] !== b.score[i]) return b.score[i] - a.score[i];
    return 0;
  });
  return scored.map((s) => s.hit);
}

// ---------------------------------------------------------------- HTTP

const sqlTime = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
const clock = (deps: UsdaDeps) => (deps.now ? deps.now() : new Date());

async function callUsda(deps: UsdaDeps, path: string, params: Record<string, string>): Promise<unknown> {
  if (!deps.apiKey) {
    console.warn("USDA_API_KEY is not set, so food lookups are unavailable.");
    throw new UsdaError("unavailable", "USDA API key is not set");
  }
  if (deps.beforeCall) await deps.beforeCall();
  const query = Object.entries({ ...params, api_key: deps.apiKey })
    .map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%2C/g, ",")}`)
    .join("&");

  // Called as a plain function: workerd rejects fetch invoked as a method of another object.
  const doFetch = deps.fetch;
  let res: Response;
  try {
    res = await doFetch(`${API}${path}?${query}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // The original error can quote the URL, and the URL carries the key, so only its name is kept.
    throw new UsdaError("unavailable", `USDA could not be reached (${err instanceof Error ? err.name : "error"})`);
  }

  if (res.status === 429) throw new UsdaError("rate_limited", "USDA rate limit reached (HTTP 429)", 429);
  if (res.status === 401 || res.status === 403) {
    console.warn(`USDA rejected the API key (HTTP ${res.status}). Check the USDA_API_KEY secret.`);
    throw new UsdaError("unavailable", `USDA rejected the API key (HTTP ${res.status})`, res.status);
  }
  if (!res.ok) throw new UsdaError("unavailable", `USDA returned HTTP ${res.status}`, res.status);
  try {
    return await res.json();
  } catch {
    throw new UsdaError("unavailable", "USDA sent a response that was not JSON", res.status);
  }
}

async function searchApi(deps: UsdaDeps, query: string, scope: Scope): Promise<FoodRecord[]> {
  const body = await callUsda(deps, "/foods/search", {
    query,
    dataType: DATA_TYPES[scope],
    pageSize: String(SEARCH_PAGE_SIZE),
  });
  const foods = typeof body === "object" && body !== null ? (body as { foods?: unknown }).foods : undefined;
  if (!Array.isArray(foods)) throw new UsdaError("unavailable", "USDA search response had no foods list");
  return foods.map(extractSearchHit).filter((f): f is FoodRecord => f !== null);
}

async function detailsApi(deps: UsdaDeps, ids: number[]): Promise<FoodRecord[]> {
  const body = await callUsda(deps, "/foods", { fdcIds: ids.join(","), format: "full" });
  if (!Array.isArray(body)) throw new UsdaError("unavailable", "USDA foods response was not a list");
  return body.map(extractFood).filter((f): f is FoodRecord => f !== null && ids.includes(f.fdcId));
}

// ---------------------------------------------------------------- D1 cache

interface CacheRow {
  fdc_id: number;
  description: string;
  data_type: string;
  brand: string | null;
  kcal_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  portions_json: string | null;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const textOrNull = (v: unknown) => (typeof v === "string" ? v : null);

function readPortions(json: string | null): RawPortion[] {
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((p): RawPortion[] => {
    if (typeof p !== "object" || p === null || !finite(p.amount) || !finite(p.gramWeight)) return [];
    return [{
      amount: p.amount,
      gramWeight: p.gramWeight,
      unitName: textOrNull(p.unitName),
      modifier: textOrNull(p.modifier),
      description: textOrNull(p.description),
    }];
  });
}

function fromRow(row: CacheRow): FoodRecord {
  return {
    fdcId: row.fdc_id,
    description: row.description,
    dataType: row.data_type,
    brand: row.brand,
    per100g: {
      kcal: row.kcal_per_100g,
      protein: row.protein_per_100g,
      carbs: row.carbs_per_100g,
      fat: row.fat_per_100g,
    },
    portions: readPortions(row.portions_json),
  };
}

async function readFoods(db: D1Database, ids: number[]): Promise<FoodRecord[]> {
  const foods: FoodRecord[] = [];
  // D1 allows 100 bound parameters per statement.
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const { results } = await db
      .prepare(
        `SELECT fdc_id, description, data_type, brand, kcal_per_100g, protein_per_100g, carbs_per_100g,
                fat_per_100g, portions_json
         FROM usda_cache WHERE fdc_id IN (${chunk.map(() => "?").join(", ")})`,
      )
      .bind(...chunk)
      .all<CacheRow>();
    foods.push(...results.map(fromRow));
  }
  return foods;
}

async function writeFoods(db: D1Database, foods: FoodRecord[], at: Date) {
  if (!foods.length) return;
  const stmt = db.prepare(
    `INSERT INTO usda_cache (fdc_id, description, data_type, brand, kcal_per_100g, protein_per_100g,
       carbs_per_100g, fat_per_100g, portions_json, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(fdc_id) DO UPDATE SET description = excluded.description, data_type = excluded.data_type,
       brand = excluded.brand, kcal_per_100g = excluded.kcal_per_100g, protein_per_100g = excluded.protein_per_100g,
       carbs_per_100g = excluded.carbs_per_100g, fat_per_100g = excluded.fat_per_100g,
       portions_json = excluded.portions_json, fetched_at = excluded.fetched_at`,
  );
  await db.batch(
    foods.map((f) =>
      stmt.bind(
        f.fdcId, f.description, f.dataType, f.brand, f.per100g.kcal, f.per100g.protein, f.per100g.carbs,
        f.per100g.fat, JSON.stringify(f.portions), sqlTime(at),
      ),
    ),
  );
}

/** Cached ids for a search, best first, or null if never searched or older than 30 days. */
async function readSearch(deps: UsdaDeps, query: string, scope: Scope): Promise<number[] | null> {
  const cutoff = new Date(clock(deps).getTime() - SEARCH_TTL_MS);
  const row = await deps.db
    .prepare("SELECT fdc_ids FROM usda_search_cache WHERE query = ? AND scope = ? AND fetched_at >= ?")
    .bind(query, scope, sqlTime(cutoff))
    .first<{ fdc_ids: string }>();
  if (!row) return null;
  try {
    const ids: unknown = JSON.parse(row.fdc_ids);
    return Array.isArray(ids) ? ids.filter((id): id is number => Number.isInteger(id) && id > 0) : null;
  } catch {
    return null;
  }
}

async function writeSearch(deps: UsdaDeps, query: string, scope: Scope, ids: number[]) {
  await deps.db
    .prepare(
      `INSERT INTO usda_search_cache (query, scope, fdc_ids, fetched_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(query, scope) DO UPDATE SET fdc_ids = excluded.fdc_ids, fetched_at = excluded.fetched_at`,
    )
    .bind(query, scope, JSON.stringify(ids), sqlTime(clock(deps)))
    .run();
}

// ---------------------------------------------------------------- public API

/**
 * Full records (with portions) by fdcId. Cache first; the rest come from one
 * bulk call per 20 ids and are cached. Ids USDA doesn't know, or foods with no
 * energy value, are left out of the map.
 */
export async function getFoods(deps: UsdaDeps, ids: number[]): Promise<Map<number, FoodRecord>> {
  const wanted = [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0);
  const found = new Map<number, FoodRecord>();
  if (!wanted.length) return found;

  for (const food of await readFoods(deps.db, wanted)) found.set(food.fdcId, food);
  const missing = wanted.filter((id) => !found.has(id));
  for (let i = 0; i < missing.length; i += BULK_CHUNK) {
    const fetched = await detailsApi(deps, missing.slice(i, i + BULK_CHUNK));
    await writeFoods(deps.db, fetched, clock(deps));
    for (const food of fetched) found.set(food.fdcId, food);
  }

  const ordered = new Map<number, FoodRecord>();
  for (const id of wanted) {
    const food = found.get(id);
    if (food) ordered.set(id, food);
  }
  return ordered;
}

/**
 * One search scope, ranked, as full records. Searches are cached for 30 days.
 * `alsoFetch` ids ride along in the same details call (the table's foods).
 */
async function searchScope(
  deps: UsdaDeps,
  query: string,
  scope: Scope,
  limit: number,
  alsoFetch: readonly number[],
): Promise<FoodRecord[]> {
  let ids = await readSearch(deps, query, scope);
  if (ids === null) {
    const ranked = rankHits(query, await searchApi(deps, query, scope)).map((h) => h.fdcId);
    const details = await getFoods(deps, [...alsoFetch, ...ranked.slice(0, limit)]);
    // Drop hits whose details USDA couldn't give us, so a repeat search needs no call.
    ids = ranked.filter((id, i) => i >= limit || details.has(id));
    await writeSearch(deps, query, scope, ids);
  }
  const top = ids.slice(0, limit);
  const foods = await getFoods(deps, [...alsoFetch, ...top]);
  return top.flatMap((id) => foods.get(id) ?? []);
}

/**
 * The common-foods table entry for a spoken food phrase, or null. Matches the
 * phrase as spoken or as normalizeQuery rewrites it ("oatmeal", "oats cooked").
 */
export function commonFor(food: string): CommonFood | null {
  return commonMatch(food) ?? commonMatch(normalizeQuery(food));
}

/**
 * USDA's own search: core, then Branded when the best core match isn't the food
 * as eaten (see isReasonable), or the other way with brandHint. "Chicken fried
 * rice" goes on to Branded, whose top hit is chicken fried rice, rather than
 * offer the core search's "fried rice, without meat". A search that only fills
 * out a table entry's list (`fill`) stays in the first scope: the table has
 * already answered, and a second search would spend the USDA key's calls.
 */
async function searchUsda(
  deps: UsdaDeps,
  query: string,
  limit: number,
  brandHint: boolean,
  alsoFetch: readonly number[] = [],
  fill = false,
): Promise<FoodRecord[]> {
  const reasonable = (foods: FoodRecord[]) => foods.length > 0 && isReasonable(query, foods[0]);
  const order: Scope[] = brandHint ? ["branded", "core"] : ["core", "branded"];
  const first = await searchScope(deps, query, order[0], limit, alsoFetch);
  if (fill || reasonable(first)) return first;
  const second = await searchScope(deps, query, order[1], limit, alsoFetch);
  if (reasonable(second)) return second;
  // Nothing names the food. Offer what there is rather than nothing; the user confirms every match.
  return [...first, ...second].slice(0, limit);
}

/**
 * Foods matching a spoken food phrase, best first, at most `limit` (default 5,
 * at most 10).
 *
 * A phrase in the common-foods table ("rice", "a coke") starts with the record
 * it names and the entry's alternatives; USDA's ranked search results fill the
 * rest, without repeats. The table's foods are fetched like any food (cache
 * first), in the same details call as the search's, so a new table food costs
 * the same two calls as any other. When they fill `limit` the search is
 * skipped, and when the search fails they are still returned.
 *
 * Anything else is searched: Foundation and SR Legacy, falling back to Branded
 * when nothing there names the food, Branded first when `brandHint` is set (see
 * looksLikeBrand). Returns [] when USDA has nothing. Throws UsdaError.
 */
export async function searchFoods(
  deps: UsdaDeps,
  food: string,
  opts: { limit?: number; brandHint?: boolean } = {},
): Promise<FoodRecord[]> {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(opts.limit ?? 5)));
  const query = normalizeQuery(food);
  if (!words(query).length) return [];
  const brandHint = opts.brandHint ?? false;

  const entry = commonFor(food);
  if (!entry) return searchUsda(deps, query, limit, brandHint);

  const ids = [entry.fdcId, ...(entry.alternatives ?? [])].slice(0, limit);
  const tableFoods = async () => {
    const known = await getFoods(deps, ids);
    return ids.flatMap((id) => known.get(id) ?? []);
  };
  if (ids.length >= limit) return tableFoods();

  let searched: FoodRecord[];
  try {
    searched = await searchUsda(deps, query, limit, brandHint, ids, true);
  } catch (err) {
    if (!(err instanceof UsdaError)) throw err;
    const curated = await tableFoods();
    if (!curated.length) throw err;
    return curated;
  }
  const curated = await tableFoods(); // cached by the search's details call
  const seen = new Set(curated.map((f) => f.fdcId));
  // Never fill with another food: no bear meat after the gummy bears.
  const q = queryShape(query);
  const fill = searched.filter((f) => !seen.has(f.fdcId) && !readHit(f, q).otherFood);
  return [...curated, ...fill].slice(0, limit);
}
