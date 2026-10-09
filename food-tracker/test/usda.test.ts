import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractFood, extractSearchHit } from "../src/food/nutrition";
import type { FoodRecord } from "../src/food/types";
import {
  getFoods,
  looksLikeBrand,
  normalizeQuery,
  rankHits,
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

  it("counts the brand name as part of a Branded description", () => {
    const [branded] = (searchFile.branded as Record<string, { foods: Json[] }>).chobani.foods;
    const hit = extractSearchHit(branded)!;
    const ranked = rankHits("chobani", [{ description: "Yogurt, Greek, plain", dataType: "SR Legacy" }, hit]);
    expect(ranked[0]).toBe(hit);
  });
});

describe("searchFoods", () => {
  it("searches and fetches details once, then serves repeats from D1 with no API calls", async () => {
    const fake = createFakeUsda();
    const first = await searchFoods(deps(fake), "peanut butter");
    expect(ids(first)).toEqual([174266, 172470, 167546]);
    expect(first[0].portions.length).toBeGreaterThan(0); // details, not bare search hits

    expect(fake.calls).toHaveLength(2);
    const search = call(fake, 0);
    expect(search.pathname).toBe("/fdc/v1/foods/search");
    expect(search.searchParams.get("query")).toBe("peanut butter");
    expect(search.searchParams.get("dataType")).toBe("Foundation,SR Legacy");
    expect(search.searchParams.get("pageSize")).toBe("10");
    const details = call(fake, 1);
    expect(details.pathname).toBe("/fdc/v1/foods");
    expect(details.searchParams.get("fdcIds")).toBe("174266,172470,167546");
    expect(details.searchParams.get("format")).toBe("full");

    expect(await searchFoods(deps(fake), "peanut butter")).toEqual(first);
    expect(await searchFoods(deps(fake), "  Peanut   Butter ")).toEqual(first);
    expect(fake.calls).toHaveLength(2);
  });

  it("returns at most `limit` foods and fetches details only for those", async () => {
    const fake = createFakeUsda();
    const top = await searchFoods(deps(fake), "chicken breast", { limit: 2 });
    expect(top).toHaveLength(2);
    expect(call(fake, 1).searchParams.get("fdcIds")?.split(",")).toHaveLength(2);
    expect(await searchFoods(deps(fake), "chicken breast")).toHaveLength(5);
  });

  it("reuses cached foods across different searches", async () => {
    const fake = createFakeUsda();
    await searchFoods(deps(fake), "egg");
    expect(fake.calls).toHaveLength(2);
    const eggs = await searchFoods(deps(fake), "eggs");
    expect(eggs[0].fdcId).toBe(748967);
    expect(fake.calls).toHaveLength(3); // the new search only; every food was already cached
    expect(call(fake, 2).pathname).toBe("/fdc/v1/foods/search");
  });

  it("returns real foods ahead of distractors end to end", async () => {
    const fake = createFakeUsda();
    expect((await searchFoods(deps(fake), "banana"))[0].description).toBe("Bananas, raw");
    expect((await searchFoods(deps(fake), "toast"))[0].fdcId).toBe(174925);
    expect((await searchFoods(deps(fake), "butter"))[0].fdcId).toBe(173410);
  });

  it("searches oatmeal as cooked oats", async () => {
    const fake = createFakeUsda();
    const found = await searchFoods(deps(fake), "oatmeal");
    expect(ids(found)).toEqual([173905]);
    expect(call(fake, 0).searchParams.get("query")).toBe("oats cooked");
  });

  it("stays with Foundation and SR Legacy when they name the food", async () => {
    const fake = createFakeUsda();
    const found = await searchFoods(deps(fake), "greek yogurt");
    expect(ids(found)).toEqual([2259794, 171304]);
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
    const found = await searchFoods(deps(fake), "greek yogurt", { brandHint: true });
    expect(ids(found)).toEqual([2259794, 171304]);
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

    await searchFoods(on(0), "salmon");
    expect(fake.calls).toHaveLength(2);
    await searchFoods(on(29), "salmon");
    expect(fake.calls).toHaveLength(2);

    const refreshed = await searchFoods(on(31), "salmon");
    expect(ids(refreshed)).toEqual([175168]);
    expect(fake.calls).toHaveLength(3);
    expect(call(fake, 2).pathname).toBe("/fdc/v1/foods/search");

    await searchFoods(on(32), "salmon");
    expect(fake.calls).toHaveLength(3);
  });

  it("serves cached searches even while USDA is failing", async () => {
    const found = await searchFoods(deps(createFakeUsda()), "apple");
    const limited = createFakeUsda({ rateLimited: true });
    expect(await searchFoods(deps(limited), "apple")).toEqual(found);
    expect(await searchFoods(deps(limited, { apiKey: "" }), "apple")).toEqual(found);
    expect(limited.calls).toHaveLength(0);
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
    const err = await caught(searchFoods(deps(createFakeUsda({ rateLimited: true })), "rice"));
    expect(err).toMatchObject({ kind: "rate_limited", status: 429 });
    expectNoKey(err);
    const bulk = await caught(getFoods(deps(createFakeUsda({ rateLimited: true })), [171477]));
    expect(bulk.kind).toBe("rate_limited");
  });

  it("turns 5xx into unavailable", async () => {
    const err = await caught(searchFoods(deps(createFakeUsda({ down: true })), "rice"));
    expect(err).toMatchObject({ kind: "unavailable", status: 503 });
    expectNoKey(err);
  });

  it("turns network failures into unavailable without repeating the URL", async () => {
    const failing: typeof fetch = async (input) => {
      throw new TypeError(`fetch failed: ${new Request(input).url}`);
    };
    const err = await caught(searchFoods(deps(failing), "rice"));
    expect(err.kind).toBe("unavailable");
    expectNoKey(err);
  });

  it("turns a response that isn't JSON into unavailable", async () => {
    const html: typeof fetch = async () => new Response("<html>Maintenance</html>", { status: 200 });
    const err = await caught(searchFoods(deps(html), "rice"));
    expect(err.kind).toBe("unavailable");
    expectNoKey(err);
  });

  it("turns a rejected key (403) into unavailable and warns without the key", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const forbidden: typeof fetch = async () => Response.json({ error: { code: "API_KEY_INVALID" } }, { status: 403 });
    const err = await caught(searchFoods(deps(forbidden), "rice"));
    expect(err).toMatchObject({ kind: "unavailable", status: 403 });
    expectNoKey(err);
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(API_KEY);
  });

  it("doesn't call USDA at all without a key", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fake = createFakeUsda();
    const err = await caught(searchFoods(deps(fake, { apiKey: "" }), "rice"));
    expect(err.kind).toBe("unavailable");
    expect(fake.calls).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });

  it("doesn't cache a failed search", async () => {
    await caught(searchFoods(deps(createFakeUsda({ rateLimited: true })), "rice"));
    const fake = createFakeUsda();
    expect((await searchFoods(deps(fake), "rice")).length).toBeGreaterThan(0);
    expect(fake.calls).toHaveLength(2);
  });
});
