// USDA FoodData Central client (SPEC section 6). Every food and every search is
// cached in D1 so repeat lookups never hit the API, which is rate limited to
// roughly 1,000 requests an hour per key.
import { extractFood, extractSearchHit } from "./nutrition";
import type { FoodRecord, RawPortion } from "./types";
import { contentWords, sameWord, words } from "./words";

const API = "https://api.nal.usda.gov/fdc/v1";
const SEARCH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PAGE_SIZE = 10;
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
  "quest bar",
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
}

const COOKING = /\b(cooked|roasted|grilled|baked|broiled|boiled|steamed|braised|stewed|poached|scrambled|toasted|brewed|prepared|sauteed|microwaved|heated|fried)\b/;
const UNCOOKED = /\b(raw|uncooked|unprepared|dry)\b/;
const FRIED = /\b(fried|breaded)\b/;

/**
 * People log food as eaten: "chicken breast" means cooked chicken, and dry rice
 * has about three times the calories of cooked. Unless the query names a
 * preparation, a raw record loses to a cooked one when the hits offer both,
 * and fried loses to plainer cooking. Records that are neither (milk, "Eggs,
 * whole") are left alone. 2 = keep, 1 = fried, 0 = raw while cooked exists.
 */
function prepScore(description: string, queryNamesPrep: boolean, anyCooked: boolean): number {
  if (queryNamesPrep) return 2;
  const d = description.toLowerCase();
  const cooked = COOKING.test(d);
  if (!cooked && UNCOOKED.test(d)) return anyCooked ? 0 : 2;
  return FRIED.test(d) ? 1 : 2;
}

function queryShape(query: string) {
  const tokens = contentWords(normalizeQuery(query));
  const head = [...tokens].reverse().find((w) => !PREP_WORDS.has(w)) ?? tokens[tokens.length - 1];
  return { tokens, head };
}

/** The hit names the food that was asked for (its head noun), not just something near it. */
function isReasonable(query: string, hit: RankableHit): boolean {
  const { head } = queryShape(query);
  if (!head) return false;
  return contentWords(`${hit.description} ${hit.brand ?? ""}`).some((w) => sameWord(w, head));
}

/**
 * Best match first. In priority order: names the head noun at all; Foundation
 * or SR Legacy over Branded; cooked over raw (see prepScore); description starts with the query words ("Peanut
 * butter, smooth" over "Candies, ... peanut butter"); first comma segment ends
 * with or contains the head noun ("Oranges, raw" over "Orange juice"); has
 * every query word; fewer comma segments. USDA's order breaks ties.
 */
export function rankHits<T extends RankableHit>(query: string, hits: readonly T[]): T[] {
  const { tokens, head } = queryShape(query);
  if (!head) return [...hits];
  const queryNamesPrep = tokens.some((t) => PREP_WORDS.has(t) || t === "dry" || t === "uncooked");
  const anyCooked = hits.some((h) => COOKING.test(h.description.toLowerCase()));

  const scored = hits.map((hit, index) => {
    const description = hit.description.replace(/\([^)]*\)/g, " ");
    const segments = description.split(",").map((s) => s.trim()).filter(Boolean);
    const descWords = contentWords(description);
    const allWords = [...descWords, ...contentWords(hit.brand ?? "")];
    const has = (q: string) => allWords.some((w) => sameWord(w, q));

    let lead = 0;
    while (lead < tokens.length && lead < descWords.length && sameWord(descWords[lead], tokens[lead])) lead++;
    const firstSegment = contentWords(segments[0] ?? "");
    const segmentHead = firstSegment.length && sameWord(firstSegment[firstSegment.length - 1], head)
      ? 2
      : firstSegment.some((w) => sameWord(w, head)) ? 1 : 0;

    const score = [
      has(head) ? 1 : 0,
      hit.dataType === "Branded" ? 0 : 1,
      prepScore(hit.description, queryNamesPrep, anyCooked),
      lead,
      segmentHead,
      tokens.every(has) ? 1 : 0,
      -segments.length,
      -index,
    ];
    return { hit, score };
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
    pageSize: String(PAGE_SIZE),
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

/** One search scope, ranked, as full records. Searches are cached for 30 days. */
async function searchScope(deps: UsdaDeps, query: string, scope: Scope, limit: number): Promise<FoodRecord[]> {
  let ids = await readSearch(deps, query, scope);
  if (ids === null) {
    const ranked = rankHits(query, await searchApi(deps, query, scope)).map((h) => h.fdcId);
    const details = await getFoods(deps, ranked.slice(0, limit));
    // Drop hits whose details USDA couldn't give us, so a repeat search needs no call.
    ids = ranked.filter((id, i) => i >= limit || details.has(id));
    await writeSearch(deps, query, scope, ids);
  }
  const top = ids.slice(0, limit);
  const foods = await getFoods(deps, top);
  return top.flatMap((id) => foods.get(id) ?? []);
}

/**
 * Foods matching a spoken food phrase, best first, at most `limit` (default 5).
 * Searches Foundation and SR Legacy; falls back to Branded when nothing there
 * names the food, and searches Branded first when `brandHint` is set (see
 * looksLikeBrand). Returns [] when USDA has nothing. Throws UsdaError.
 */
export async function searchFoods(
  deps: UsdaDeps,
  food: string,
  opts: { limit?: number; brandHint?: boolean } = {},
): Promise<FoodRecord[]> {
  const limit = Math.min(PAGE_SIZE, Math.max(1, Math.floor(opts.limit ?? 5)));
  const query = normalizeQuery(food);
  if (!words(query).length) return [];
  const reasonable = (foods: FoodRecord[]) => foods.some((f) => isReasonable(query, f));

  const order: Scope[] = opts.brandHint ? ["branded", "core"] : ["core", "branded"];
  const first = await searchScope(deps, query, order[0], limit);
  if (reasonable(first)) return first;
  const second = await searchScope(deps, query, order[1], limit);
  if (reasonable(second)) return second;
  // Nothing names the food. Offer what there is rather than nothing; the user confirms every match.
  return [...first, ...second].slice(0, limit);
}
