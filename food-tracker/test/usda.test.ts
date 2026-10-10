import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractFood, extractSearchHit } from "../src/food/nutrition";
import type { FoodRecord } from "../src/food/types";
import {
  getFoods,
  looksLikeBrand,
  normalizeQuery,
  rankHits,
  SEARCH_PAGE_SIZE,
  searchFoods,
  UsdaError,
  type UsdaDeps,
} from "../src/food/usda";
import { createFakeUsda, type FakeUsda } from "./fixtures/usda/fake-fetch";
import foodsFile from "./fixtures/usda/foods.json";
import searchFile from "./fixtures/usda/search.json";

const API_KEY = "usda-test-key-7c41e9";
const DAY = 24 * 60 * 60 * 1000;

type Json = Record<string, unknown>;
const coreResponses = searchFile.foundationAndSr as Record<string, { foods: Json[] }>;

function deps(fake: FakeUsda | typeof fetch, extra: Partial<UsdaDeps> = {}): UsdaDeps {
  return { apiKey: API_KEY, fetch: typeof fake === "function" ? fake : fake.fetch, db: env.DB, ...extra };
}

/** A recorded call as a URL, for reading its path and parameters. */
const call = (fake: FakeUsda, i: number) => new URL(fake.calls[i]);
const ids = (foods: FoodRecord[]) => foods.map((f) => f.fdcId);
const coreHits = (query: string) =>
  coreResponses[query].foods.map(extractSearchHit).filter((h): h is FoodRecord => h !== null);

async function caught(promise: Promise<unknown>): Promise<UsdaError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof UsdaError) return err;
    throw err;
  }
  throw new Error("expected a UsdaError");
}

function expectNoKey(err: Error) {
  for (const text of [err.message, String(err), err.stack ?? "", JSON.stringify(err)]) {
    expect(text).not.toContain(API_KEY);
  }
  expect(err.cause).toBeUndefined();
}

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM usda_cache"), env.DB.prepare("DELETE FROM usda_search_cache")]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("normalizeQuery", () => {
  it("lowercases, strips punctuation and collapses spaces", () => {
    expect(normalizeQuery("  Chicken   Breast. ")).toBe("chicken breast");
    expect(normalizeQuery("Jalapeño")).toBe("jalapeno");
    expect(normalizeQuery("2% milk")).toBe("2% milk");
  });

  it("maps whole phrases USDA describes differently", () => {
    expect(normalizeQuery("Oatmeal")).toBe("oats cooked");
    expect(normalizeQuery("OJ")).toBe("orange juice");
    expect(normalizeQuery("mac & cheese")).toBe("mac and cheese");
    expect(normalizeQuery("mac 'n cheese")).toBe("mac and cheese");
    // Only whole phrases: an oatmeal cookie stays an oatmeal cookie.
    expect(normalizeQuery("oatmeal cookie")).toBe("oatmeal cookie");
  });
});

describe("looksLikeBrand", () => {
  it("spots known brands anywhere, in any case", () => {
    expect(looksLikeBrand("Chobani greek yogurt")).toBe(true);
    expect(looksLikeBrand("some cheerios")).toBe(true);
    expect(looksLikeBrand("a Chick-fil-A sandwich")).toBe(true);
    expect(looksLikeBrand("M&M's")).toBe(true);
  });

  it("spots a capitalized word that doesn't start the sentence", () => {
    expect(looksLikeBrand("a Zesto bar")).toBe(true);
    expect(looksLikeBrand("two eggs. Then a Zesto bar")).toBe(true);
  });

  it("ignores I, meals, cuisines, sentence starts and Title Case", () => {
    expect(looksLikeBrand("two eggs")).toBe(false);
    expect(looksLikeBrand("Two eggs")).toBe(false);
    expect(looksLikeBrand("I had Greek yogurt for Lunch")).toBe(false);
    expect(looksLikeBrand("eggs. Toast")).toBe(false);
    expect(looksLikeBrand("Two Large Eggs")).toBe(false);
  });
});

describe("rankHits", () => {
  // [query, the foods meant, distractors USDA lists first or among them]
  const cases: [string, number[], number[]][] = [
    ["peanut butter", [174266, 172470], [167546]],
    ["banana", [173944, 1105073, 1105314], [2747660]],
    ["bananas", [173944, 1105073, 1105314], [2747660]],
    ["toast", [174925, 172689], [167927]],
    ["oatmeal", [173905], [174963]],
    ["butter", [173410], [174266, 167546]],
    ["orange", [169097], [169098]],
  ];

  for (const [query, meant, distractors] of cases) {
    it(`puts every real "${query}" above every distractor`, () => {
      const order = ids(rankHits(query, coreHits(query)));
      expect(meant).toContain(order[0]);
      const worstMeant = Math.max(...meant.map((id) => order.indexOf(id)));
      for (const id of distractors) expect(order.indexOf(id)).toBeGreaterThan(worstMeant);
    });
  }

  it("ranks the exact fixture favorites first", () => {
    expect(ids(rankHits("peanut butter", coreHits("peanut butter")))[0]).toBe(174266);
    expect(ids(rankHits("banana", coreHits("banana")))[0]).toBe(173944); // "Bananas, raw"
    expect(ids(rankHits("toast", coreHits("toast")))[0]).toBe(174925);
    expect(ids(rankHits("eggs", coreHits("eggs")))[0]).toBe(748967);
  });

  it("prefers cooked over raw unless the query says otherwise, and plain cooking over fried", () => {
    // "chicken breast": USDA lists raw records first; people log what they ate.
    expect(ids(rankHits("chicken breast", coreHits("chicken breast")))[0]).toBe(171477); // roasted, meat only
    expect(ids(rankHits("rice", coreHits("rice")))[0]).not.toBe(2512381); // not dry raw rice
    expect(ids(rankHits("broccoli", coreHits("broccoli")))[0]).toBe(169967); // cooked, boiled
    expect([2646170, 2727569]).toContain(ids(rankHits("raw chicken breast", coreHits("chicken breast")))[0]);
    expect(ids(rankHits("fried chicken breast", coreHits("chicken breast")))[0]).toBe(171078);
    // Nothing cooked on offer: raw stays fine.
    expect(ids(rankHits("spinach", coreHits("spinach")))[0]).toBe(168462);
    expect(ids(rankHits("eggs", coreHits("eggs")))[0]).toBe(748967);
  });

  it("keeps USDA's order for ties and doesn't touch the input", () => {
    const hits = coreHits("milk");
    const before = ids(hits);
    expect(ids(rankHits("milk", hits))).toEqual([746782, 171265, 171255]);
    expect(ids(hits)).toEqual(before);
  });

  it("prefers Foundation and SR Legacy over Branded", () => {
    const ranked = rankHits("peanut butter", [
      { description: "PEANUT BUTTER", dataType: "Branded", brand: "JIF" },
      { description: "Peanut butter, smooth style", dataType: "SR Legacy" },
    ]);
    expect(ranked[0].dataType).toBe("SR Legacy");
  });

  const sr = (...descriptions: string[]) => descriptions.map((description) => ({ description, dataType: "SR Legacy" }));
  const top = (query: string, hits: { description: string; dataType: string }[]) => rankHits(query, hits)[0].description;

  it("prefers the food itself over records where the word only describes another food", () => {
    expect(top("eggs", sr("Bagels, egg", "Bread, egg", "Egg, whole, raw, fresh"))).toBe("Egg, whole, raw, fresh");
    expect(top("milk", sr("Crackers, milk", "Candies, milk chocolate", "Milk, reduced fat, fluid, 2% milkfat")))
      .toBe("Milk, reduced fat, fluid, 2% milkfat");
    expect(top("rice", sr("Rice crackers", "Alcoholic beverage, rice (sake)", "Rice, white, cooked"))).toBe("Rice, white, cooked");
    expect(top("orange", sr("Marmalade, orange", "Orange juice, raw", "Oranges, raw, navels"))).toBe("Oranges, raw, navels");
    // Filing words and restaurant names come before the food: "Snacks, potato chips" is chips.
    expect(top("chips", sr("Cookies, chocolate chip", "Snacks, potato chips, plain, salted")))
      .toBe("Snacks, potato chips, plain, salted");
    expect(top("salad", sr("Fish, tuna salad", "Salad dressing, ranch dressing", "McDONALD'S, Side Salad")))
      .toBe("McDONALD'S, Side Salad");
    // A cut named in a later segment is the food; a flavor of a sauce isn't.
    expect(top("steak", sr("Sauce, steak, tomato based", "Beef, top sirloin, steak, cooked, broiled")))
      .toBe("Beef, top sirloin, steak, cooked, broiled");
  });

  it("demotes dried, powdered, mixed, part and baby food forms unless the query names them", () => {
    expect(top("banana", sr("Bananas, dehydrated, or banana powder", "Bananas, raw"))).toBe("Bananas, raw");
    expect(top("banana powder", sr("Bananas, raw", "Bananas, dehydrated, or banana powder")))
      .toBe("Bananas, dehydrated, or banana powder");
    expect(top("eggs", sr("Egg, white, dried", "Eggs, Grade A, Large, egg white", "Eggs, Grade A, Large, egg whole")))
      .toBe("Eggs, Grade A, Large, egg whole");
    expect(top("bacon", sr("Bacon, meatless", "Pork, bacon, rendered fat, cooked", "Pork, cured, bacon, cooked, baked")))
      .toBe("Pork, cured, bacon, cooked, baked");
    expect(top("carrots", sr("Babyfood, carrots, strained", "Carrots, raw"))).toBe("Carrots, raw");
    expect(top("milk", sr("Milk, sheep, fluid", "Milk, dry, nonfat", "Milk, lowfat, fluid, 1% milkfat")))
      .toBe("Milk, lowfat, fluid, 1% milkfat");
    // Made up as the label says, a mix or concentrate is eaten as is.
    expect(top("lemonade", sr("Lemonade, frozen concentrate, white", "Lemonade, frozen concentrate, white, prepared with water")))
      .toBe("Lemonade, frozen concentrate, white, prepared with water");
  });

  it("lets raw lose only to the same food cooked", () => {
    expect(top("rice", sr("Rice, black, unenriched, raw", "Wild rice, cooked"))).toBe("Wild rice, cooked");
    expect(top("orange", sr("Fish, roughy, orange, cooked, dry heat", "Oranges, raw"))).toBe("Oranges, raw");
    expect(top("banana", sr("Bread, banana, prepared from recipe", "Bananas, raw"))).toBe("Bananas, raw");
    // Canned loses to cooked of the very same name, not to another dish.
    expect(top("black beans", sr("Beans, black, mature seeds, canned", "Beans, black, mature seeds, cooked, boiled")))
      .toBe("Beans, black, mature seeds, cooked, boiled");
    expect(top("refried beans", sr("Refried beans, canned, traditional", "Beans, pinto, mature seeds, cooked, boiled")))
      .toBe("Refried beans, canned, traditional");
  });

  it("counts the brand name as part of a Branded description", () => {
    const [branded] = (searchFile.branded as Record<string, { foods: Json[] }>).chobani.foods;
    const hit = extractSearchHit(branded)!;
    const ranked = rankHits("chobani", [{ description: "Yogurt, Greek, plain", dataType: "SR Legacy" }, hit]);
    expect(ranked[0]).toBe(hit);
  });
});

describe("searchFoods", () => {
  // Lentils and quinoa aren't in the common-foods table, so these go straight to USDA's search.
  it("searches and fetches details once, then serves repeats from D1 with no API calls", async () => {
    const fake = createFakeUsda();
    const first = await searchFoods(deps(fake), "lentils");
    expect(ids(first)).toEqual([172421, 172420, 168427, 174284]); // cooked first
    expect(first[0].portions.length).toBeGreaterThan(0); // details, not bare search hits

    expect(fake.calls).toHaveLength(2);
    const search = call(fake, 0);
    expect(search.pathname).toBe("/fdc/v1/foods/search");
    expect(search.searchParams.get("query")).toBe("lentils");
    expect(search.searchParams.get("dataType")).toBe("Foundation,SR Legacy");
    expect(search.searchParams.get("pageSize")).toBe(String(SEARCH_PAGE_SIZE));
    const details = call(fake, 1);
    expect(details.pathname).toBe("/fdc/v1/foods");
    expect(details.searchParams.get("fdcIds")).toBe("172421,172420,168427,174284");
    expect(details.searchParams.get("format")).toBe("full");

    expect(await searchFoods(deps(fake), "lentils")).toEqual(first);
    expect(await searchFoods(deps(fake), "  Lentils ")).toEqual(first);
    expect(fake.calls).toHaveLength(2);
  });

  it("asks USDA for 50 hits to rank, so the right food is among them", () => {
    expect(SEARCH_PAGE_SIZE).toBe(50);
  });

  it("returns at most `limit` foods and fetches details only for those", async () => {
    const fake = createFakeUsda();
    const top = await searchFoods(deps(fake), "lentils", { limit: 2 });
    expect(ids(top)).toEqual([172421, 172420]);
    expect(call(fake, 1).searchParams.get("fdcIds")?.split(",")).toHaveLength(2);
    expect(await searchFoods(deps(fake), "lentils")).toHaveLength(4);
    expect(await searchFoods(deps(fake), "lentils", { limit: 50 })).toHaveLength(4); // at most 10 anyway
  });

  it("reuses cached foods across different searches", async () => {
    const fake = createFakeUsda();
    await searchFoods(deps(fake), "egg");
    const calls = fake.calls.length;
    const eggs = await searchFoods(deps(fake), "eggs");
    expect(eggs[0].fdcId).toBe(171287); // the table's whole egg
    expect(fake.calls).toHaveLength(calls + 1); // the new search only; every food was already cached
    expect(call(fake, calls).pathname).toBe("/fdc/v1/foods/search");
  });

  it("returns real foods ahead of distractors end to end", async () => {
    const fake = createFakeUsda();
    expect((await searchFoods(deps(fake), "banana"))[0].description).toBe("Bananas, raw");
    expect((await searchFoods(deps(fake), "toast"))[0].fdcId).toBe(174925);
    expect((await searchFoods(deps(fake), "butter"))[0].fdcId).toBe(173410);
    expect((await searchFoods(deps(fake), "quinoa"))[0].description).toBe("Quinoa, cooked");
  });

  it("searches oatmeal as cooked oats", async () => {
    const fake = createFakeUsda();
    const found = await searchFoods(deps(fake), "oatmeal");
    expect(ids(found)).toEqual([173905, 171662, 173920]); // the table's entry; the search adds nothing new
    const search = fake.calls.map((c) => new URL(c)).find((u) => u.pathname === "/fdc/v1/foods/search");
    expect(search?.searchParams.get("query")).toBe("oats cooked");
  });

  it("stays with Foundation and SR Legacy when they name the food", async () => {
    const fake = createFakeUsda();
    const found = await searchFoods(deps(fake), "greek yogurt");
    // The table's Greek yogurts, then the search's, without 2259794 twice.
    expect(ids(found)).toEqual([330137, 170902, 330415, 2259794, 171304]);
    expect(fake.calls.some((c) => c.includes("Branded"))).toBe(false);
  });

  it("falls back to Branded when Foundation and SR Legacy have nothing", async () => {
    const fake = createFakeUsda();
    const found = await searchFoods(deps(fake), "chobani");
    expect(ids(found)).toEqual([9900001]);
    expect(found[0]).toMatchObject({ brand: "CHOBANI", portions: [{ unitName: "serving", gramWeight: 170 }] });
    expect(fake.calls.map((c) => new URL(c).searchParams.get("dataType"))).toEqual([
      "Foundation,SR Legacy",
      "Branded",
      null, // details
    ]);
    await searchFoods(deps(fake), "chobani");
    expect(fake.calls).toHaveLength(3);
  });

  it("falls back to Branded when no core hit names the food", async () => {
    const fake = createFakeUsda();
    // Pretend USDA answers "chobani" with unrelated milk records.
    const fetchWithJunk: typeof fetch = async (input, init) => {
      const url = new URL(new Request(input, init).url);
      if (url.pathname.endsWith("/foods/search") && url.searchParams.get("dataType") !== "Branded") {
        return Response.json(coreResponses.milk);
      }
      return fake.fetch(input, init);
    };
    expect(ids(await searchFoods(deps(fetchWithJunk), "chobani"))).toEqual([9900001]);
  });

  it("searches Branded first when the user named a brand", async () => {
    const fake = createFakeUsda();
    const found = await searchFoods(deps(fake), "chobani greek yogurt", { brandHint: true });
    expect(ids(found)).toEqual([9900001]);
    expect(call(fake, 0).searchParams.get("dataType")).toBe("Branded");
    expect(fake.calls).toHaveLength(2); // Branded search + details, no core search
  });

  it("goes back to core foods when a brand hint finds nothing branded", async () => {
    const fake = createFakeUsda();
    const found = await searchFoods(deps(fake), "quinoa", { brandHint: true });
    expect(ids(found)).toEqual([168917, 172027, 168874]);
    expect(fake.calls.map((c) => new URL(c).searchParams.get("dataType"))).toEqual([
      "Branded",
      "Foundation,SR Legacy",
      null, // details
    ]);
  });

  it("returns [] when USDA has nothing, and remembers that", async () => {
    const fake = createFakeUsda();
    expect(await searchFoods(deps(fake), "zzzz")).toEqual([]);
    expect(fake.calls).toHaveLength(2); // core + Branded searches, no details
    expect(await searchFoods(deps(fake), "zzzz")).toEqual([]);
    expect(fake.calls).toHaveLength(2);
    expect(await searchFoods(deps(fake), "  ...  ")).toEqual([]);
    expect(fake.calls).toHaveLength(2);
  });

  it("expires cached searches after 30 days but keeps the cached foods", async () => {
    const fake = createFakeUsda();
    const start = Date.parse("2026-03-01T12:00:00Z");
    const on = (day: number) => deps(fake, { now: () => new Date(start + day * DAY) });

    await searchFoods(on(0), "quinoa");
    expect(fake.calls).toHaveLength(2);
    await searchFoods(on(29), "quinoa");
    expect(fake.calls).toHaveLength(2);

    const refreshed = await searchFoods(on(31), "quinoa");
    expect(ids(refreshed)).toEqual([168917, 172027, 168874]);
    expect(fake.calls).toHaveLength(3);
    expect(call(fake, 2).pathname).toBe("/fdc/v1/foods/search");

    await searchFoods(on(32), "quinoa");
    expect(fake.calls).toHaveLength(3);
  });

  it("serves cached searches even while USDA is failing", async () => {
    for (const food of ["quinoa", "apple"]) {
      const found = await searchFoods(deps(createFakeUsda()), food);
      const limited = createFakeUsda({ rateLimited: true });
      expect(await searchFoods(deps(limited), food)).toEqual(found);
      expect(await searchFoods(deps(limited, { apiKey: "" }), food)).toEqual(found);
      expect(limited.calls).toHaveLength(0);
    }
  });
});

describe("searchFoods with the common-foods table", () => {
  it("starts with the table's food and its alternatives, then fills from the search without repeats", async () => {
    const fake = createFakeUsda();
    const found = await searchFoods(deps(fake), "rice");
    // Cooked white rice, then brown and fried rice, then the search's dry rice (its cooked rice is already there).
    expect(ids(found)).toEqual([168878, 169704, 334536, 2512381]);
    // Two calls, like any new food: the search, then one details call for the table's foods and the search's.
    expect(fake.calls.map((c) => new URL(c).pathname)).toEqual(["/fdc/v1/foods/search", "/fdc/v1/foods"]);
    expect(call(fake, 1).searchParams.get("fdcIds")).toBe("168878,169704,334536,2512381");

    expect(await searchFoods(deps(fake), "Rice")).toEqual(found);
    expect(fake.calls).toHaveLength(2);
  });

  it("skips the search when the table's foods fill the limit", async () => {
    const fake = createFakeUsda();
    const found = await searchFoods(deps(fake), "eggs", { limit: 3 });
    expect(ids(found)).toEqual([171287, 172187, 173423]);
    expect(fake.calls).toHaveLength(1);
    expect(call(fake, 0).pathname).toBe("/fdc/v1/foods");
  });

  it("matches the phrase as spoken or as normalizeQuery rewrites it", async () => {
    const fake = createFakeUsda();
    expect((await searchFoods(deps(fake), "OJ", { limit: 1 }))[0].fdcId).toBe(169100);
    expect((await searchFoods(deps(fake), "Mac & Cheese", { limit: 1 }))[0].fdcId).toBe(169770);
    expect((await searchFoods(deps(fake), "hot dogs", { limit: 1 }))[0].fdcId).toBe(174614);
  });

  it("still returns the table's foods when the search fails", async () => {
    const fake = createFakeUsda();
    const searchDown: typeof fetch = async (input, init) => {
      const url = new URL(new Request(input, init).url);
      if (url.pathname.endsWith("/foods/search")) return new Response("Service Unavailable", { status: 503 });
      return fake.fetch(input, init);
    };
    expect(ids(await searchFoods(deps(searchDown), "rice"))).toEqual([168878, 169704, 334536]);
    // The failed search isn't cached: once USDA is back, the search runs.
    expect(ids(await searchFoods(deps(fake), "rice"))).toEqual([168878, 169704, 334536, 2512381]);
  });

  it("fails like any search when the table's foods can't be fetched", async () => {
    const err = await caught(searchFoods(deps(createFakeUsda({ rateLimited: true })), "rice"));
    expect(err).toMatchObject({ kind: "rate_limited", status: 429 });
  });

  it("shares fetched records between entries: whole milk is one of milk's alternatives", async () => {
    const fake = createFakeUsda();
    await searchFoods(deps(fake), "milk", { limit: 4 });
    const calls = fake.calls.length;
    const whole = await searchFoods(deps(fake), "whole milk", { limit: 4 });
    expect(ids(whole)).toEqual([171265, 171267, 170872, 171269]);
    expect(fake.calls).toHaveLength(calls); // all four came with "milk"
  });
});

describe("getFoods", () => {
  const fixtureIds = (foodsFile.foods as unknown as { fdcId: number }[]).map((f) => f.fdcId);

  it("bulk-fetches missing foods in chunks of 20, caches them, and skips unknown ids", async () => {
    const fake = createFakeUsda();
    const wanted = fixtureIds.slice(0, 25);
    const found = await getFoods(deps(fake), [...wanted, 1]);
    expect([...found.keys()]).toEqual(wanted);
    expect(fake.calls).toHaveLength(2); // 26 ids: 20 + 6
    expect(call(fake, 0).searchParams.get("fdcIds")?.split(",")).toHaveLength(20);

    const again = await getFoods(deps(fake), wanted);
    expect(fake.calls).toHaveLength(2);
    expect(again).toEqual(found);
  });

  it("only asks USDA for the ids it doesn't have", async () => {
    const fake = createFakeUsda();
    await getFoods(deps(fake), [171477]);
    const found = await getFoods(deps(fake), [173944, 171477, 171477]);
    expect([...found.keys()]).toEqual([173944, 171477]);
    expect(fake.calls).toHaveLength(2);
    expect(call(fake, 1).searchParams.get("fdcIds")).toBe("173944");
    expect(await getFoods(deps(fake), [])).toEqual(new Map());
  });

  it("round-trips a food through usda_cache unchanged", async () => {
    const fake = createFakeUsda();
    const raw = (foodsFile.foods as unknown as Json[]).find((f) => f.fdcId === 9900001);
    const [fetched] = (await getFoods(deps(fake), [9900001])).values();
    const [cached] = (await getFoods(deps(fake), [9900001])).values();
    expect(fetched).toEqual(extractFood(raw));
    expect(cached).toEqual(fetched);

    const row = await env.DB.prepare("SELECT brand, data_type, kcal_per_100g, portions_json FROM usda_cache WHERE fdc_id = ?")
      .bind(9900001)
      .first<{ brand: string; data_type: string; kcal_per_100g: number; portions_json: string }>();
    expect(row).toMatchObject({ brand: "CHOBANI", data_type: "Branded", kcal_per_100g: 58.8 });
    expect(JSON.parse(row!.portions_json)).toEqual(fetched.portions);
  });
});

describe("USDA errors", () => {
  it("turns 429 into rate_limited", async () => {
    const err = await caught(searchFoods(deps(createFakeUsda({ rateLimited: true })), "quinoa"));
    expect(err).toMatchObject({ kind: "rate_limited", status: 429 });
    expectNoKey(err);
    const bulk = await caught(getFoods(deps(createFakeUsda({ rateLimited: true })), [171477]));
    expect(bulk.kind).toBe("rate_limited");
  });

  it("turns 5xx into unavailable", async () => {
    const err = await caught(searchFoods(deps(createFakeUsda({ down: true })), "quinoa"));
    expect(err).toMatchObject({ kind: "unavailable", status: 503 });
    expectNoKey(err);
  });

  it("turns network failures into unavailable without repeating the URL", async () => {
    const failing: typeof fetch = async (input) => {
      throw new TypeError(`fetch failed: ${new Request(input).url}`);
    };
    const err = await caught(searchFoods(deps(failing), "quinoa"));
    expect(err.kind).toBe("unavailable");
    expectNoKey(err);
  });

  it("turns a response that isn't JSON into unavailable", async () => {
    const html: typeof fetch = async () => new Response("<html>Maintenance</html>", { status: 200 });
    const err = await caught(searchFoods(deps(html), "quinoa"));
    expect(err.kind).toBe("unavailable");
    expectNoKey(err);
  });

  it("turns a rejected key (403) into unavailable and warns without the key", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const forbidden: typeof fetch = async () => Response.json({ error: { code: "API_KEY_INVALID" } }, { status: 403 });
    const err = await caught(searchFoods(deps(forbidden), "quinoa"));
    expect(err).toMatchObject({ kind: "unavailable", status: 403 });
    expectNoKey(err);
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(API_KEY);
  });

  it("doesn't call USDA at all without a key", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fake = createFakeUsda();
    const err = await caught(searchFoods(deps(fake, { apiKey: "" }), "quinoa"));
    expect(err.kind).toBe("unavailable");
    expect(fake.calls).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });

  it("doesn't cache a failed search", async () => {
    await caught(searchFoods(deps(createFakeUsda({ rateLimited: true })), "quinoa"));
    const fake = createFakeUsda();
    expect((await searchFoods(deps(fake), "quinoa")).length).toBeGreaterThan(0);
    expect(fake.calls).toHaveLength(2);
  });
});
