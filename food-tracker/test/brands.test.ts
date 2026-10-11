// Brand names and drinks, over live USDA responses.
//
// USDA has no Blue Moon beer, and the app used to say so with confident junk:
// "a blue moon beer" was BLUE SKY stevia root beer soda (0 kcal), "Blue Moon"
// 100 g of blue cheese, "a michelob ultra" an industrial soy oil, "a glass of
// white claw" claw crab meat, "a corona" a plum called jocote corona, and "a
// bud light" the right record at a flagged 100 g instead of a 12 fl oz bottle.
// brands.json holds what USDA's core and Branded searches really return for
// these and other brand and drink phrases (see its _note), served by
// fake-fetch.ts, so this runs the real path offline: parseMeal, then lookup
// exactly as /api/parse calls it.
//
// Each phrase ends one of three ways: a USDA record that is that food (USDA
// has Bud Light, Branded has Dave's Killer Bread), the common-foods table's
// generic food when the brand USDA doesn't know ends in one ("blue moon beer"
// is beer), or not found. Never a record that is some other food.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { parseMeal } from "../src/food/parse";
import { lookup } from "../src/food/routes";
import type { Amount, Candidate } from "../src/food/types";
import { commonFor, isReasonableFirst, looksLikeBrand, normalizeQuery, tailFor } from "../src/food/usda";
import { createFakeUsda } from "./fixtures/usda/fake-fetch";
import brandsFile from "./fixtures/usda/live/brands.json";

type Want =
  /** No fair answer: status not_found, no candidates. */
  | "not_found"
  /** The table food the phrase's last words name (see commonTail). */
  | "tail"
  /** USDA's own record of it. */
  | { fdcId?: number; name?: RegExp; kcal?: [number, number]; amount?: Partial<Amount> };

/** Every phrase whose searches brands.json holds, and what it should come to. A phrase the
 * common-foods table answers (now or later) is checked against the table instead. */
const PHRASES: [string, Want][] = [
  // The phrases the bug report named.
  ["a blue moon beer", "tail"],
  ["Blue Moon", "not_found"],
  ["a blue moon", "not_found"],
  ["a michelob ultra", "not_found"],
  ["a glass of white claw", "not_found"],
  ["a corona", "not_found"],
  ["a bud light", { fdcId: 169572, kcal: [95, 110], amount: { quantity: 1, unit: "serving", grams: 354, guessed: false } }],
  // Brands USDA has, as a core record or a Branded product named for the phrase.
  ["chobani yogurt", { name: /^Chobani Yogurt, Greek/ }],
  ["dave's killer bread", { name: /^DAVE'S KILLER BREAD, WHITE BREAD$/, kcal: [100, 120] }],
  ["tillamook cheddar", { name: /^Tillamook Medium Cheddar Cheese$/ }],
  ["a celsius", { name: /SPARKLING ENERGY DRINK/, kcal: [0, 20], amount: { unit: "serving", grams: 355 } }],
  ["a la croix", { name: /^LA CROIX, SPARKLING WATER/, kcal: [0, 1] }],
  ["a starbucks refresher", { name: /^STARBUCKS REFRESHERS/, kcal: [50, 100] }],
  ["a chick fil a sandwich", { fdcId: 170790, kcal: [440, 490] }],
  ["takis", { name: /TAKIS.*TORTILLA CHIPS/ }],
  ["a heineken", { fdcId: 2127272, kcal: [130, 150] }],
  ["a hard seltzer", { name: /HARD SELTZER/, kcal: [90, 110] }],
  ["a margarita", { name: /^MARGARITA/ }],
  ["a mountain dew", { name: /^MOUNTAIN DEW, SODA$/, kcal: [160, 180] }],
  ["a vitamin water", { fdcId: 174161 }],
  ["an olipop", { name: /^OLIPOP CREAM SODA/, kcal: [30, 50] }],
  ["a budweiser", { fdcId: 168747, kcal: [140, 150], amount: { unit: "serving", grams: 357, guessed: false } }],
  // A brand USDA doesn't know, ending in a food the table has.
  ["kirkland trail mix", "tail"],
  ["a bang energy drink", "tail"],
  ["a twisted tea", "tail"],
  // Nothing fair: USDA's nearest are other foods or the brand's licensed snacks.
  ["a quest bar", "not_found"],
  ["a fairlife protein shake", "not_found"], // never a milkshake
  ["a mike's hard lemonade", "not_found"], // never plain lemonade
  ["a truly hard seltzer", "not_found"], // never seltzer water
  ["a white russian", "not_found"], // not white chocolate
  ["a cosmo", "not_found"], // not Cosmos puffed corn
  ["a coors light", "not_found"],
  ["a modelo", "not_found"],
  ["a guinness", "not_found"], // not Guinness-flavored truffles
  ["a high noon", "not_found"],
  ["a mimosa", "not_found"],
  ["a vodka soda", "not_found"], // never a cola
  ["a body armor", "not_found"],
  ["a liquid death", "not_found"],
  ["a pumpkin spice latte", "not_found"], // not pumpkin pie
  // Answered by the table.
  ["a red bull", { fdcId: 173210 }],
  ["a dr pepper", { fdcId: 173209 }],
  ["goldfish crackers", { fdcId: 168005 }],
  ["a gatorade", { fdcId: 173660 }],
  // Two drinks: "jack" alone is a real food named jack; the coke is cola.
  ["a jack and coke", { fdcId: 174852 }],
];

const NOT_FOUND = (food: string) => `We couldn't find "${food}". Try other words, or enter it yourself.`;

/** A candidate as rankHits and isReasonable read it. */
const asHit = (c: Candidate) => ({ description: c.name, dataType: c.dataType, brand: c.brand, per100g: c.per100g });

async function run(phrase: string) {
  const fake = createFakeUsda();
  const usda = { apiKey: "test-key", fetch: fake.fetch, db: env.DB };
  const out = [];
  for (const item of parseMeal(phrase).items) {
    const before = fake.calls.length;
    const result = await lookup(usda, item.food, item.quantity, item.unit, { limit: 5, brandHint: looksLikeBrand(item.text) });
    out.push({ item, result, calls: fake.calls.length - before });
  }
  return out;
}

describe("brand names and drinks, through parse and lookup over live USDA responses", () => {
  beforeEach(async () => {
    await env.DB.batch([env.DB.prepare("DELETE FROM usda_cache"), env.DB.prepare("DELETE FROM usda_search_cache")]);
  });

  it("has the live searches for every phrase's food", () => {
    const search = brandsFile.search as Record<"core" | "branded", Record<string, unknown>>;
    for (const [phrase] of PHRASES) {
      for (const item of parseMeal(phrase).items) {
        const query = normalizeQuery(item.food);
        expect(search.core[query], `${phrase}: core "${query}"`).toBeDefined();
        expect(search.branded[query], `${phrase}: Branded "${query}"`).toBeDefined();
      }
    }
    expect(brandsFile._note).toMatch(/Live USDA FoodData Central/);
  });

  it.each(PHRASES)("%s", async (phrase, want) => {
    const results = await run(phrase);
    const { item, result } = results.at(-1)!;
    const top = result.candidates[0];
    const what = `${phrase}: ${item.food} -> ${result.status}${top ? ` ${top.fdcId} ${top.name}, ${top.amount.quantity} ${top.amount.unit} = ${top.amount.grams} g, ${top.nutrition.calories} kcal` : ""}`;

    const table = commonFor(item.food);
    if (table) {
      // The table answers it (the bug report's drinks may be added there): its record comes first.
      expect(top?.fdcId, what).toBe(table.fdcId);
    } else if (want === "not_found") {
      expect(result, what).toEqual({ status: "not_found", message: NOT_FOUND(item.food), candidates: [] });
    } else if (want === "tail") {
      const tail = tailFor(item.food);
      expect(tail, what).not.toBeNull();
      expect(result.status, what).toBe("ok");
      // The table food and its alternatives, priced in the table's unit: "a blue moon beer" is a can of beer.
      expect(result.candidates.map((c) => c.fdcId), what).toEqual([tail!.fdcId, ...(tail!.alternatives ?? [])].slice(0, 5));
      expect(top.amount.guessed, what).toBe(false);
      if (tail!.unit) expect(top.amount.unit, what).toBe(tail!.unit);
    } else {
      expect(result.status, what).toBe("ok");
      if (want.fdcId !== undefined) expect(top.fdcId, what).toBe(want.fdcId);
      if (want.name) expect(top.name, what).toMatch(want.name);
      if (want.kcal) {
        expect(top.nutrition.calories, what).toBeGreaterThanOrEqual(want.kcal[0]);
        expect(top.nutrition.calories, what).toBeLessThanOrEqual(want.kcal[1]);
      }
      if (want.amount) expect(top.amount, what).toMatchObject(want.amount);
    }
  });

  it("never offers another food: every answer is the table's, or a fair USDA match", async () => {
    for (const [phrase] of PHRASES) {
      for (const { item, result, calls } of await run(phrase)) {
        const what = `${phrase}: ${item.food} -> ${result.status} ${result.candidates[0]?.name ?? ""}`;
        expect(["ok", "not_found"], what).toContain(result.status);
        // A food never seen costs at most both searches and one details call.
        expect(calls, what).toBeLessThanOrEqual(3);
        if (result.status === "not_found") {
          expect(result.candidates, what).toEqual([]);
          continue;
        }
        const tableIds = [commonFor(item.food), tailFor(item.food)].flatMap((e) => (e ? [e.fdcId] : []));
        const fair = tableIds.includes(result.candidates[0].fdcId) || isReasonableFirst(normalizeQuery(item.food), result.candidates.map(asHit));
        expect(fair, what).toBe(true);
      }
    }
  });

  it("keeps the brand's name for the entry: the confirm screen shows the spoken words over USDA's", async () => {
    // The parsed food is what the confirm screen saves as the plain name ("Blue moon beer"), with the
    // generic record's USDA name under it, so the user can see it's beer, regular.
    const [{ item, result }] = await run("a blue moon beer");
    expect(item.food).toBe("blue moon beer");
    expect(result.candidates[0].name).toBe("Alcoholic beverage, beer, regular, all");
  });
});
