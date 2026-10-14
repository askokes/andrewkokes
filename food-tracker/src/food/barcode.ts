// Packaged foods by barcode. USDA's branded foods come first (the label data
// manufacturers send USDA), then Open Food Facts, the open database of product
// labels, for what USDA doesn't have. Every answer, found or not, is kept in
// barcode_cache, and Open Food Facts products in usda_cache like any food, so
// a product is looked up once.
import { barcodeForms, barcodeKey, OFF_ID_MIN } from "./gtin";
import type { FoodRecord, RawPortion } from "./types";
import { callUsda, clock, getFoods, sqlTime, UsdaError, writeFoods, type UsdaDeps } from "./usda";

const OFF_API = "https://world.openfoodfacts.org/api/v2/product";
// Open Food Facts asks every app to name itself.
const OFF_USER_AGENT = "FoodTracker/1.0 (food.pivotaiglobal.com)";
const OFF_FIELDS = [
  "code", "product_name", "product_name_en", "generic_name", "brands", "nutriments",
  "serving_size", "serving_quantity", "serving_quantity_unit",
].join(",");
/** A barcode nobody had is asked about again after a week: products get added. */
const NOT_FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;
/** Forms of a code asked of each database (see barcodeForms): the scanned one, then its 12 or 13 digit twin. */
const MAX_FORMS = 2;
/** Pure fat is 900 kcal per 100 g; anything well past it is a typo in the label data. */
const MAX_KCAL_PER_100G = 950;
const KJ_PER_KCAL = 4.184;

export interface BarcodeDeps extends UsdaDeps {
  /** fetch for Open Food Facts. Tests and dev:mock pass a fake. */
  offFetch: typeof fetch;
}

/** Open Food Facts couldn't be reached or answered with an error. */
class OffError extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function num(v: unknown): number | undefined {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ") : null);
const nonNegative = (v: number | undefined) => (v === undefined || v < 0 ? 0 : v);

/**
 * An Open Food Facts product as a FoodRecord, or null without a name or
 * calories. Its id is OFF_ID_MIN plus the barcode, so it can be saved and
 * logged like a USDA food.
 */
export function offFood(key: string, product: Record<string, unknown>): FoodRecord | null {
  const name = text(product.product_name_en) ?? text(product.product_name) ?? text(product.generic_name);
  if (!name || !/^\d{1,14}$/.test(key)) return null;
  const nutriments = isObject(product.nutriments) ? product.nutriments : {};
  const unit = text(product.serving_quantity_unit)?.toLowerCase();
  const servingQuantity = num(product.serving_quantity);
  // Millilitres count as grams, as they do for USDA's branded foods.
  const servingG = servingQuantity && servingQuantity > 0 && (!unit || unit === "g" || unit === "ml") ? servingQuantity : undefined;
  // Per 100 g, or worked out from the label serving when that's all there is.
  const per100 = (field: string) => {
    const per = num(nutriments[`${field}_100g`]);
    if (per !== undefined) return per;
    const serving = num(nutriments[`${field}_serving`]);
    return serving !== undefined && servingG ? (serving * 100) / servingG : undefined;
  };
  const kj = per100("energy-kj") ?? per100("energy");
  const kcal = per100("energy-kcal") ?? (kj === undefined ? undefined : kj / KJ_PER_KCAL);
  if (kcal === undefined || kcal < 0 || kcal > MAX_KCAL_PER_100G) return null;

  const portions: RawPortion[] = servingG
    ? [{ amount: 1, gramWeight: servingG, unitName: "serving", modifier: null, description: text(product.serving_size) }]
    : [];
  return {
    fdcId: OFF_ID_MIN + Number(key),
    description: name.slice(0, 200),
    dataType: "Open Food Facts",
    brand: text(product.brands)?.split(",")[0].trim() || null,
    per100g: { kcal, protein: nonNegative(per100("proteins")), carbs: nonNegative(per100("carbohydrates")), fat: nonNegative(per100("fat")) },
    portions,
  };
}

/** "CHEERIOS" as "Cheerios": label data is often all capitals. Mixed case is left alone. */
function tidy(name: string): string {
  if (/[a-z]/.test(name)) return name;
  return name.toLowerCase().replace(/(^|[\s\-/&(])([a-z])/g, (_, before: string, letter: string) => before + letter.toUpperCase());
}

/** The name to log a product under: its brand, then its name, unless the name already says the brand. */
export function productName(food: FoodRecord): string {
  const name = tidy(food.description);
  const brand = food.brand ? tidy(food.brand) : null;
  const brandWord = brand?.toLowerCase().split(/\s+/)[0];
  const full = brand && brandWord && !name.toLowerCase().includes(brandWord) ? `${brand} ${name}` : name;
  return full.slice(0, 100);
}

async function fromUsda(deps: BarcodeDeps, key: string, forms: string[]): Promise<FoodRecord | null> {
  for (const form of forms) {
    const body = await callUsda(deps, "/foods/search", { query: form, dataType: "Branded", pageSize: "10" });
    const hits = isObject(body) ? body.foods : undefined;
    if (!Array.isArray(hits)) throw new UsdaError("unavailable", "USDA search response had no foods list");
    // Search matches words anywhere, so only a hit filed under this very barcode counts.
    const ids = hits.flatMap((hit) => {
      if (!isObject(hit) || typeof hit.gtinUpc !== "string") return [];
      const id = num(hit.fdcId);
      return id !== undefined && Number.isInteger(id) && barcodeKey(hit.gtinUpc.replace(/\D/g, "")) === key ? [id] : [];
    });
    if (!ids.length) continue;
    // A product has a record per label update; the newest has the largest id.
    const id = Math.max(...ids);
    const food = (await getFoods(deps, [id])).get(id);
    if (food) return food;
  }
  return null;
}

async function fromOff(deps: BarcodeDeps, key: string, forms: string[]): Promise<FoodRecord | null> {
  // Called as a plain function: workerd rejects fetch invoked as a method of another object.
  const doFetch = deps.offFetch;
  for (const form of forms) {
    let res: Response;
    try {
      res = await doFetch(`${OFF_API}/${form}.json?fields=${OFF_FIELDS}`, {
        headers: { Accept: "application/json", "User-Agent": OFF_USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new OffError(`Open Food Facts could not be reached (${err instanceof Error ? err.name : "error"})`);
    }
    // A product it doesn't have is a 404 that says status 0.
    if (res.status === 404) continue;
    if (!res.ok) throw new OffError(`Open Food Facts returned HTTP ${res.status}`);
    const body: unknown = await res.json().catch(() => null);
    if (!isObject(body) || body.status !== 1 || !isObject(body.product)) continue;
    // Found but with no calories on file is no help: the label is the way.
    const food = offFood(key, body.product);
    if (food) await writeFoods(deps.db, [food], clock(deps));
    return food;
  }
  return null;
}

async function remember(deps: BarcodeDeps, key: string, fdcId: number | null) {
  await deps.db
    .prepare(
      `INSERT INTO barcode_cache (code, fdc_id, fetched_at) VALUES (?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET fdc_id = excluded.fdc_id, fetched_at = excluded.fetched_at`,
    )
    .bind(key, fdcId, sqlTime(clock(deps)))
    .run();
}

/**
 * The food a barcode (from readBarcode) is, or null when neither USDA nor Open
 * Food Facts has it. Throws a UsdaError when it can't tell: USDA couldn't be
 * asked and Open Food Facts didn't have it, or couldn't be reached either.
 */
export async function lookupBarcode(deps: BarcodeDeps, code: string): Promise<FoodRecord | null> {
  const key = barcodeKey(code);
  const cached = await deps.db
    .prepare("SELECT fdc_id, fetched_at FROM barcode_cache WHERE code = ?")
    .bind(key)
    .first<{ fdc_id: number | null; fetched_at: string }>();
  if (cached && cached.fdc_id !== null) {
    const food = (await getFoods(deps, [cached.fdc_id])).get(cached.fdc_id);
    if (food) return food;
  } else if (cached && cached.fetched_at >= sqlTime(new Date(clock(deps).getTime() - NOT_FOUND_TTL_MS))) {
    return null;
  }

  const forms = barcodeForms(code).slice(0, MAX_FORMS);
  let trouble: UsdaError | null = null;
  let food: FoodRecord | null = null;
  try {
    food = await fromUsda(deps, key, forms);
  } catch (err) {
    if (!(err instanceof UsdaError)) throw err;
    trouble = err;
  }
  if (!food) {
    try {
      food = await fromOff(deps, key, forms);
    } catch (err) {
      if (!(err instanceof OffError)) throw err;
      console.warn("barcode lookup:", err.message);
      trouble ??= new UsdaError("unavailable", err.message);
    }
  }
  if (!food) {
    // Only a clear "nobody has it" is remembered; trouble asking is tried again next time.
    if (trouble) throw trouble;
    await remember(deps, key, null);
    return null;
  }
  await remember(deps, key, food.fdcId);
  return food;
}
