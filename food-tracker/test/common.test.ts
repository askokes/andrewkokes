import { describe, expect, it } from "vitest";
import { COMMON_FOODS, commonKey, commonMatch, commonPortions, type CommonFood } from "../src/food/common";
import { extractFood, nutritionFor } from "../src/food/nutrition";
import type { FoodRecord } from "../src/food/types";
import { resolveAmount, unitOptions } from "../src/food/units";
import { normalizeQuery } from "../src/food/usda";
import { createFakeUsda } from "./fixtures/usda/fake-fetch";
import commonFile from "./fixtures/usda/live/common-foods.json";
import liveSearch from "./fixtures/usda/live/search-core.json";

const fixture = new Map((commonFile.foods as unknown as { fdcId: number }[]).map((f) => [f.fdcId, f]));

function record(fdcId: number): FoodRecord {
  const food = extractFood(fixture.get(fdcId));
  if (!food) throw new Error(`${fdcId} missing from common-foods.json or unusable`);
  return food;
}

const label = (entry: CommonFood) => `${entry.names[0]} (${entry.fdcId})`;

/** Grams for `quantity` of a table food said with no unit, the way the app reads it (see routes.ts lookup). */
function unitless(entry: CommonFood, quantity = 1): { unit: string; grams: number; guessed: boolean } {
  const food = record(entry.fdcId);
  if (entry.unit && !unitOptions(food).some((o) => o.unit === entry.unit)) {
    throw new Error(`${label(entry)}: unit ${entry.unit} not offered`);
  }
  const { unit, grams, guessed } = resolveAmount(food, quantity, null, [entry.unit]);
  return { unit, grams, guessed };
}

function calories(name: string, quantity = 1): number {
  const entry = commonMatch(name);
  if (!entry) throw new Error(`no table entry for "${name}"`);
  return nutritionFor(record(entry.fdcId).per100g, unitless(entry, quantity).grams).calories;
}

describe("COMMON_FOODS records", () => {
  it("has every primary and alternative fdcId in the fixture, as a usable SR Legacy or Foundation record", () => {
    const referenced = new Set<number>();
    for (const entry of COMMON_FOODS) {
      for (const id of [entry.fdcId, ...(entry.alternatives ?? [])]) {
        referenced.add(id);
        const food = record(id);
        expect(["SR Legacy", "Foundation"], `${id}`).toContain(food.dataType);
        expect(food.description.length).toBeGreaterThan(0);
        expect(food.per100g.kcal).toBeGreaterThanOrEqual(0);
      }
    }
    expect([...fixture.keys()].sort()).toEqual([...referenced].sort());
  });

  it("keeps alternatives to a short list of other records", () => {
    for (const entry of COMMON_FOODS) {
      const alternatives = entry.alternatives ?? [];
      expect(alternatives.length, label(entry)).toBeLessThanOrEqual(4);
      expect(new Set(alternatives).size, label(entry)).toBe(alternatives.length);
      expect(alternatives, label(entry)).not.toContain(entry.fdcId);
    }
  });

  it("covers the live queries plus about 100 more everyday foods", () => {
    expect(COMMON_FOODS.length).toBeGreaterThan(250);
  });
});

describe("commonMatch", () => {
  it("maps every name back to its own entry", () => {
    for (const entry of COMMON_FOODS) {
      expect(entry.names.length, label(entry)).toBeGreaterThan(0);
      for (const name of entry.names) {
        expect(name, label(entry)).toBe(name.trim().toLowerCase());
        expect(commonMatch(name), `"${name}"`).toBe(entry);
      }
    }
  });

  it("never gives two names the same key, within an entry or across entries", () => {
    const seen = new Map<string, string>();
    for (const entry of COMMON_FOODS) {
      for (const name of entry.names) {
        const key = commonKey(name);
        expect(key, `"${name}"`).not.toBe("");
        expect(seen.get(key), `"${name}" and "${seen.get(key)}"`).toBeUndefined();
        seen.set(key, name);
      }
    }
  });

  it("ignores case, punctuation and simple plurals", () => {
    const same = (a: string, b: string) => {
      expect(commonMatch(a), a).not.toBeNull();
      expect(commonMatch(a), `${a} vs ${b}`).toBe(commonMatch(b));
    };
    same("Eggs", "egg");
    same("EGG", "eggs");
    same("Strawberry", "strawberries");
    same("blueberry", "Blueberries");
    same("French Fry", "french fries");
    same("tomatoes", "Tomato");
    same("potatoes", "potato");
    same("peaches", "peach");
    same("turkey sandwiches", "turkey sandwich");
    same("Chicken Nugget", "chicken nuggets");
    same("cookie", "Cookies");
    same("brownies", "brownie");
    same("hard-boiled eggs", "hard boiled egg");
    same("Mac & Cheese", "mac and cheese");
    same("mac n cheese", "macaroni and cheese");
    same("M&M's", "m and ms");
    same("Reese's", "reeses");
    same("Dr. Pepper", "dr pepper");
    same("General Tso's Chicken", "general tsos chicken");
    same("Cheez-Its", "cheez its");
    same("  2% Milk ", "milk");
    same("Hummus", "hummus");
    expect(commonKey("hummus")).toBe("hummus"); // "-us" is not a plural
    expect(commonKey("glasses")).toBe("glass");
    expect(commonKey("Jalapeño Poppers")).toBe("jalapeno popper"); // accents go, like normalizeQuery
    expect(commonKey("Kids' Cookies & Cream")).toBe("kid cookie and cream");
  });

  it("matches phrases normalizeQuery rewrites, so callers can pass either form", () => {
    expect(commonMatch("oats cooked")).toBe(commonMatch("oatmeal"));
    expect(commonMatch("porridge")).toBe(commonMatch("oatmeal"));
    expect(commonMatch("catsup")).toBe(commonMatch("ketchup"));
    expect(commonMatch("oj")).toBe(commonMatch("orange juice"));
    expect(commonMatch("pb")).toBe(commonMatch("peanut butter"));
    for (const entry of COMMON_FOODS) {
      for (const name of entry.names) expect(commonMatch(normalizeQuery(name)), `"${name}"`).toBe(entry);
    }
  });

  it("matches whole phrases only", () => {
    const rice = commonMatch("rice");
    expect(rice?.fdcId).toBe(168878);
    for (const phrase of ["rice crackers", "rice flour", "rice pudding", "white rice flour", "spanish rice"]) {
      expect(commonMatch(phrase), phrase).toBeNull();
    }
    expect(commonMatch("brown rice")).not.toBe(rice);
    expect(commonMatch("rice cakes")).not.toBe(rice);
    expect(commonMatch("fried rice")).not.toBe(rice);

    expect(commonMatch("milk chocolate")).toBe(commonMatch("chocolate"));
    expect(commonMatch("chocolate milk")).not.toBe(commonMatch("milk"));
    expect(commonMatch("egg rolls")).not.toBe(commonMatch("egg"));
    expect(commonMatch("apple juice")).not.toBe(commonMatch("apple"));
    expect(commonMatch("peanut butter cookies")).toBeNull();
    expect(commonMatch("pizza rolls")).toBeNull();
    expect(commonMatch("chicken noodle")).toBeNull();
    expect(commonMatch("big rice")).toBeNull();
    for (const empty of ["", "   ", "!!", "&"]) expect(commonMatch(empty), JSON.stringify(empty)).toBeNull();
  });

  it("picks the record people mean for generic words USDA's search ranks badly", () => {
    const id = (name: string) => commonMatch(name)?.fdcId;
    expect(id("rice")).toBe(168878); // Rice, white, long-grain, regular, enriched, cooked
    expect(id("milk")).toBe(171267); // Milk, reduced fat, fluid, 2% milkfat
    expect(id("eggs")).toBe(171287); // Egg, whole, raw, fresh
    expect(id("bacon")).toBe(168322); // Pork, cured, bacon, pre-sliced, cooked, pan-fried
    expect(id("coffee")).toBe(171890); // Beverages, coffee, brewed
    expect(id("steak")).toBe(174054); // Beef, top sirloin, steak, lean, broiled
    expect(id("hamburger")).toBe(170694); // Fast foods, hamburger; single, regular patty
    expect(id("cheeseburger")).toBe(170691); // Fast foods, cheeseburger; single, regular patty
    expect(id("pizza")).toBe(173292); // Fast Food, Pizza Chain, 14" pizza, cheese topping, regular crust
    expect(record(id("milk")!).description).toContain("fluid");
    expect(record(id("rice")!).description).toContain("cooked");
  });

  it("covers the live USDA search queries that have a sensible core record", () => {
    // No SR Legacy or Foundation record is a fair stand-in for these; the ranked search answers them
    // (test/eval-live.test.ts scores it). "Sandwich" is the cold cut sub: the search's top hit for it
    // is an ice cream sandwich, and the independent labels pick the sub too.
    const uncovered = [
      "cereal", "salad", "latte", "candy", "protein bar", "protein shake", "grilled cheese", "soup", "sushi",
    ];
    const queries = Object.keys(liveSearch.queries);
    expect(queries).toHaveLength(153);
    for (const query of queries) {
      if (uncovered.includes(query)) expect(commonMatch(query), query).toBeNull();
      else expect(commonMatch(query), query).not.toBeNull();
    }
  });
});

describe("default amounts", () => {
  it("resolves a unitless mention without a guess, to a sane weight", () => {
    for (const entry of COMMON_FOODS) {
      const amount = unitless(entry);
      expect(amount.guessed, label(entry)).toBe(false);
      expect(amount.grams, label(entry)).toBeGreaterThanOrEqual(3);
      expect(amount.grams, label(entry)).toBeLessThanOrEqual(700);
    }
  });

  it("only names units the food offers or the entry adds", () => {
    for (const entry of COMMON_FOODS.filter((e) => e.unit)) {
      const keys = [...unitOptions(record(entry.fdcId), false), ...(entry.portions ?? [])].map((o) => o.unit);
      expect(keys, label(entry)).toContain(entry.unit);
      expect(unitOptions(record(entry.fdcId)).map((o) => o.unit), label(entry)).toContain(entry.unit);
    }
  });

  it("gives each alternative an amount too: the entry's unit, its own entry's unit, or its USDA portions", () => {
    for (const entry of COMMON_FOODS) {
      for (const alt of entry.alternatives ?? []) {
        const food = record(alt);
        // The order the app uses: the matched entry's unit, then the food's own table unit, then its portions.
        const amount = resolveAmount(food, 1, null, [entry.unit]);
        expect(amount.guessed, `${label(entry)} -> ${alt} ${food.description}`).toBe(false);
        expect(amount.grams, `${label(entry)} -> ${alt} ${food.description}`).toBeLessThanOrEqual(700);
      }
    }
  });

  it("gets the calories right for everyday staples", () => {
    const cases: [string, number, number, number][] = [
      ["eggs", 2, 143, 155],
      ["rice", 1, 200, 210],
      ["milk", 1, 120, 125],
      ["banana", 1, 100, 110],
      ["apple", 1, 90, 100],
      ["bread", 1, 70, 85],
      ["peanut butter", 2, 180, 200],
      ["chicken breast", 1, 270, 300],
      ["pizza", 1, 270, 300],
      ["coke", 1, 140, 160],
      ["coffee", 1, 0, 5],
      ["butter", 1, 95, 105],
      ["oatmeal", 1, 155, 170],
      ["bacon", 2, 85, 115],
      ["cheeseburger", 1, 300, 360],
      ["french fries", 1, 330, 380],
      ["chips", 1, 145, 160],
      ["orange juice", 1, 110, 125],
      ["broccoli", 1, 50, 60],
      ["bagel", 1, 250, 280],
      ["greek yogurt", 1, 95, 110],
      ["steak", 1, 280, 320],
      ["almonds", 1, 155, 170],
      ["beer", 1, 145, 160],
    ];
    for (const [name, quantity, low, high] of cases) {
      const kcal = calories(name, quantity);
      expect(kcal, `${quantity} ${name}`).toBeGreaterThanOrEqual(low);
      expect(kcal, `${quantity} ${name}`).toBeLessThanOrEqual(high);
    }
  });

  it("reads a large egg as 50 g and a cup of cooked rice as 158 g", () => {
    expect(unitless(commonMatch("eggs")!, 2)).toEqual({ unit: "large", grams: 100, guessed: false });
    expect(unitless(commonMatch("white rice")!)).toEqual({ unit: "cup", grams: 158, guessed: false });
    expect(unitless(commonMatch("soda")!).unit).toBe("can");
    expect(unitless(commonMatch("pizza")!).unit).toBe("slice");
  });
});

describe("commonPortions", () => {
  it("adds only units USDA's portions lack, with short keys and sane weights", () => {
    for (const entry of COMMON_FOODS) {
      const usda = unitOptions(record(entry.fdcId), false).map((o) => o.unit);
      for (const p of entry.portions ?? []) {
        expect(p.unit, label(entry)).toMatch(/^[a-z]{2,8}$/);
        expect(usda, `${label(entry)} ${p.unit}`).not.toContain(p.unit);
        expect(p.label.trim().length, label(entry)).toBeGreaterThan(0);
        expect(p.grams, label(entry)).toBeGreaterThan(0);
        expect(p.grams, label(entry)).toBeLessThan(1500);
      }
    }
  });

  it("returns every entry's portions for its fdcId, one per unit", () => {
    const byId = new Map<number, CommonFood[]>();
    for (const entry of COMMON_FOODS) byId.set(entry.fdcId, [...(byId.get(entry.fdcId) ?? []), entry]);
    for (const [fdcId, entries] of byId) {
      const portions = commonPortions(fdcId);
      expect(new Set(portions.map((p) => p.unit)).size, `${fdcId}`).toBe(portions.length);
      for (const p of entries.flatMap((e) => e.portions ?? [])) expect(portions, `${fdcId}`).toContainEqual(p);
    }
  });

  it("works for alternatives and unknown ids, and hands out copies", () => {
    expect(commonPortions(174852)).toContainEqual({ unit: "can", label: "can (12 fl oz)", grams: 370 });
    // String cheese's stick applies to mozzarella too: same record.
    expect(commonPortions(171244)).toContainEqual({ unit: "each", label: "stick (1 oz)", grams: 28 });
    expect(commonPortions(171265)).toEqual([]); // whole milk: USDA's cup is enough
    expect(commonPortions(1)).toEqual([]);
    commonPortions(174852)[0].grams = 1;
    expect(commonPortions(174852)[0].grams).toBe(370);
  });
});

describe("fake USDA bulk endpoint", () => {
  it("serves the common-foods records too", async () => {
    const usda = createFakeUsda();
    const ids = [168878, 174852, 2257046, 171477, 1];
    const url = `https://api.nal.usda.gov/fdc/v1/foods?fdcIds=${ids.join(",")}&format=full&api_key=k`;
    const foods = await (await usda.fetch(url)).json<{ fdcId: number }[]>();
    expect(foods.map((f) => f.fdcId)).toEqual([168878, 174852, 2257046, 171477]);
    expect(extractFood(foods[2])?.description).toBe("Oat milk, unsweetened, plain, refrigerated");
  });
});
