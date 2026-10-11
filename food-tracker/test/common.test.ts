import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  COMMON_FOODS,
  commonKey,
  commonMatch,
  commonPortions,
  commonTail,
  spokenUnits,
  type CommonFood,
} from "../src/food/common";
import { extractFood, nutritionFor } from "../src/food/nutrition";
import { parseMeal } from "../src/food/parse";
import { lookup } from "../src/food/routes";
import type { FoodRecord } from "../src/food/types";
import { resolveAmount, unitOptions } from "../src/food/units";
import { commonFor, looksLikeBrand, normalizeQuery } from "../src/food/usda";
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

/**
 * Grams for `quantity` of a table food said with no unit, the way the app reads it (see routes.ts lookup):
 * `spoken` is the phrase as said, its first name by default ("gummy bears" with no count is a bag).
 */
function unitless(entry: CommonFood, quantity = 1, spoken = entry.names[0]): { unit: string; grams: number; guessed: boolean } {
  const food = record(entry.fdcId);
  for (const unit of [entry.unit, entry.plural]) {
    if (unit && !unitOptions(food).some((o) => o.unit === unit)) throw new Error(`${label(entry)}: unit ${unit} not offered`);
  }
  const { unit, grams, guessed } = resolveAmount(food, quantity, null, spokenUnits(entry, spoken, quantity));
  return { unit, grams, guessed };
}

function calories(name: string, quantity = 1): number {
  const entry = commonMatch(name);
  if (!entry) throw new Error(`no table entry for "${name}"`);
  return nutritionFor(record(entry.fdcId).per100g, unitless(entry, quantity, name).grams).calories;
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
    expect(commonMatch("pizza rolls")).not.toBe(commonMatch("pizza")); // its own entry: Totino's-style rolls
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
    const uncovered = ["salad", "latte", "candy", "protein bar", "protein shake", "grilled cheese", "soup", "sushi"];
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
    for (const entry of COMMON_FOODS) {
      for (const unit of [entry.unit, entry.plural].filter((u): u is string => !!u)) {
        const keys = [...unitOptions(record(entry.fdcId), false), ...(entry.portions ?? [])].map((o) => o.unit);
        expect(keys, label(entry)).toContain(unit);
        expect(unitOptions(record(entry.fdcId)).map((o) => o.unit), label(entry)).toContain(unit);
      }
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
      ["peanut butter", 1, 180, 200], // a serving, 2 tbsp
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
      // Found by the adversarial live test (see test/eval-live.test.ts).
      ["gummy bears", 1, 130, 160], // a snack bag, not bear meat
      ["monster", 1, 200, 240], // a 16 fl oz can of regular Monster
      ["energy drink", 1, 200, 240],
      ["cream cheese", 1, 95, 110], // 2 tbsp
      ["protein powder", 1, 100, 125], // a scoop
      ["ice cream cone", 1, 170, 250], // with its ice cream
      ["big mac", 1, 540, 600],
      ["quarter pounder", 1, 400, 430],
      ["jello", 1, 60, 90],
      ["pie", 1, 280, 330], // apple, not pecan
      ["beef and broccoli", 1, 250, 350],
      ["bacon egg and cheese", 1, 400, 500],
      ["dumplings", 1, 200, 300], // six
      ["mozzarella sticks", 1, 400, 600], // an order
      ["pizza rolls", 1, 200, 280], // six
      ["chicken and rice", 1, 360, 500], // a plate
      ["chicken tenders", 2, 220, 280],
      ["chai latte", 1, 200, 280], // a 16 fl oz cup
      ["capri sun", 1, 40, 90], // a 6 fl oz pouch
      ["slurpee", 1, 150, 300], // a medium
      ["yogurt parfait", 1, 120, 130],
      ["tuna sandwich", 1, 450, 550], // a 6-inch sub
      ["cereal", 1, 100, 110], // a cup, dry
      ["granola", 1, 280, 310], // half a cup
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

describe("plural phrases and spoken modifiers", () => {
  it("reads a plural with no count as a serving, and counts what is counted", () => {
    const dumplings = commonMatch("dumplings")!;
    expect(spokenUnits(dumplings, "dumplings", 1)).toEqual(["serving", "piece"]);
    expect(spokenUnits(dumplings, "dumplings", 6)).toEqual(["piece"]);
    expect(spokenUnits(dumplings, "dumpling", 1)).toEqual(["piece"]);
    expect(unitless(dumplings, 6, "dumplings")).toMatchObject({ unit: "piece", guessed: false });
    expect(unitless(commonMatch("gummy bears")!, 1, "gummy bears")).toMatchObject({ unit: "bag", grams: 39 });
    expect(unitless(commonMatch("gummy bears")!, 10, "gummy bears")).toMatchObject({ unit: "piece", grams: 22 });
    expect(unitless(commonMatch("mozzarella sticks")!, 1, "mozzarella stick")).toMatchObject({ unit: "piece", grams: 31 });
    expect(unitless(commonMatch("wings")!, 1, "wings")).toMatchObject({ unit: "order", grams: 192 });
    // Entries without a plural unit read the same either way; "hummus" is not a plural.
    expect(spokenUnits(commonMatch("eggs")!, "eggs", 1)).toEqual(["large"]);
    expect(spokenUnits(commonMatch("hummus")!, "hummus", 1)).toEqual(["tbsp"]);
    expect(spokenUnits(null, "anything", 1)).toEqual([]);
  });

  it("ignores leading words that don't change the food", () => {
    expect(commonMatch("spicy chicken sandwich")).toBe(commonMatch("chicken sandwich"));
    expect(commonMatch("homemade lasagna")).toBe(commonMatch("lasagna"));
    expect(commonMatch("regular coke")).toBe(commonMatch("coke"));
    expect(commonMatch("plain bagel")).toBe(commonMatch("bagel")); // a name of its own
    expect(commonMatch("plain yogurt")).not.toBe(commonMatch("yogurt")); // its own entry wins
    expect(commonMatch("spicy")).toBeNull();
    expect(commonMatch("big rice")).toBeNull();
    expect(commonMatch("hot cheetos")).toBeNull();
  });

  it("keeps whole dishes whole and maps the snacks and drinks the adversarial test named", () => {
    const id = (name: string) => commonMatch(name)?.fdcId;
    expect(id("gummy bears")).toBe(167989); // not game meat
    expect(id("monster energy drink")).toBe(171935); // regular, not low carb
    expect(id("beef")).toBe(171799); // cooked ground beef, not bologna
    expect(id("beef and broccoli")).toBe(168072);
    expect(id("cereal")).toBe(173884);
    expect(id("ice cream cone")).toBe(173274); // not the empty cone
    expect(id("pie")).toBe(175011);
    expect(id("jello")).toBe(169596); // prepared, not the dry mix
    expect(id("protein powder")).toBe(173180);
    expect(id("nutella")).toBe(168000);
    expect(id("capri sun")).toBe(174176);
    expect(id("chai latte")).toBe(173776);
    expect(id("bacon egg and cheese")).toBe(172029);
  });
});

describe("USDA portions the unit matcher reads", () => {
  const units = (fdcId: number) => unitOptions(record(fdcId), false);
  const unit = (fdcId: number, key: string) => units(fdcId).find((o) => o.unit === key);

  it("reads fast food's '1 item' as one of it", () => {
    expect(unit(170321, "each")).toEqual({ unit: "each", label: "item", grams: 171 }); // Quarter Pounder
    expect(unit(170720, "each")?.grams).toBe(219); // Big Mac, "item 7.6 oz"
    expect(unit(170355, "each")?.grams).toBe(149); // yogurt parfait
    expect(unit(173300, "each")?.grams).toBe(165); // McGriddle
  });

  it("reads a sub's length as one sub, the 6-inch first", () => {
    expect(unit(170299, "each")).toEqual({ unit: "each", label: "6-inch sub", grams: 237 });
  });

  it("reads '8 fl oz' as a cup", () => {
    expect(unit(173162, "cup")).toEqual({ unit: "cup", label: "cup (8 fl oz)", grams: 240 });
    expect(unit(174852, "cup")?.grams).toBeCloseTo(245.6, 1); // cola: "1 fl oz" 30.7 g
  });

  it("reads scoops, and takes a label serving for a scoop the food doesn't list", () => {
    expect(unit(173181, "scoop")?.grams).toBe(45);
    expect(unit(173177, "scoop")?.grams).toBeCloseTo(28.67, 1); // "3 scoop" 86 g
    expect(resolveAmount(record(167575), 2, "scoop")).toEqual({ quantity: 2, unit: "serving", grams: 132, guessed: false });
  });

  it("takes a piece for a slice of cake or pie, but never a piece of chicken for a slice", () => {
    expect(resolveAmount(record(174944), 1, "slice")).toEqual({ quantity: 1, unit: "piece", grams: 144, guessed: false });
    expect(resolveAmount(record(175011), 1, "slice")).toMatchObject({ unit: "piece", grams: 125, guessed: false });
    expect(resolveAmount(record(173292), 1, "piece")).toMatchObject({ unit: "slice", grams: 107, guessed: false });
    expect(resolveAmount(record(171534), 12, "slice")).toMatchObject({ unit: "g", guessed: true });
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

describe("spoken units the table fills in", () => {
  it("gives Greek yogurt a cup, which USDA's plain Greek records lack", () => {
    const greek = record(commonMatch("greek yogurt")!.fdcId);
    expect(resolveAmount(greek, 1, "cup")).toEqual({ quantity: 1, unit: "cup", grams: 227, guessed: false });
    expect(nutritionFor(greek.per100g, 227).calories).toBeGreaterThan(120);
    expect(nutritionFor(greek.per100g, 227).calories).toBeLessThan(160);
  });
});

describe("commonTail", () => {
  const entry = (name: string) => {
    const found = commonMatch(name);
    if (!found) throw new Error(`no table entry for "${name}"`);
    return found;
  };

  // Made-up brands, so entries added to the table later can't change the answer.
  it("backs a brand or variety off to the table food its last words name", () => {
    expect(commonTail("zorbo moon beer")).toBe(entry("beer")); // "zorbo moon beer", "moon beer", "beer"
    expect(commonTail("Zorbo Moon Beers!")).toBe(entry("beer"));
    expect(commonTail("zorbo trail mix")).toBe(entry("trail mix"));
    expect(commonTail("zorbo's cheddar")).toBe(entry("cheddar"));
    expect(commonTail("zorbo killer bread")).toBe(entry("bread"));
    expect(commonTail("zorbo energy drink")).toBe(entry("energy drink"));
  });

  it("tries the longest last words first", () => {
    // "chocolate milk" is an entry of its own, so a brand of it isn't just milk.
    expect(commonTail("zorbo chocolate milk")).toBe(entry("chocolate milk"));
    expect(commonTail("zorbo chocolate milk")).not.toBe(entry("milk"));
  });

  it("is null for a phrase with an entry of its own, or no entry at its end", () => {
    expect(commonTail("beer")).toBeNull();
    expect(commonTail("white claw")).toBeNull(); // never a word left on its own: there is no "claw" entry
    expect(commonTail("zorbo ultra")).toBeNull();
    expect(commonTail("")).toBeNull();
  });

  it("never drops a word that makes another food, or is a food itself", () => {
    // Hard lemonade is no lemonade, a vodka soda no cola, a protein shake no milkshake: whatever the
    // table says for the longer phrase, never the bare last word.
    expect(commonTail("zorbo hard lemonade")).toBe(commonMatch("hard lemonade"));
    expect(commonTail("zorbo hard lemonade")).not.toBe(entry("lemonade"));
    expect(commonTail("zorbo vodka soda")).not.toBe(entry("soda"));
    expect(commonTail("zorbo fried pickles")).not.toBe(commonMatch("pickles") ?? undefined);
    expect(commonTail("zorbo protein shake")).not.toBe(entry("milkshake"));
    expect(commonTail("zorbo diet soda")).not.toBe(entry("soda"));
    // Milk tea is no tea: milk is a food of its own.
    expect(commonTail("zorbo milk tea")).not.toBe(entry("tea"));
  });
});

// ---------------------------------------------------------------- beer, hard seltzer, cider, wine, liquor
//
// USDA has no Blue Moon, White Claw or Corona: before the table named them, "a blue moon beer" was a
// stevia root beer, "Blue Moon" 100 g of blue cheese, "a michelob ultra" soybean oil, "a glass of white
// claw" crab claw meat and "a corona" a plum. Each brand maps to the generic record nearest its label.

/** Every record a drink entry maps to. */
const DRINK_RECORDS = new Set([
  168746, 168747, 168749, 169572, 169575, 171906, 174146, 173185, 173190, 174837, 171908, 174815, 174818, 174817,
  174819, 171920, 168752,
]);

/**
 * What one serving of each drink should come to, with no unit said: the record, the unit, and the
 * reference calories, which are the brand's published label for 12 fl oz (as cited in
 * src/food/common.ts), or for generic drinks the usual figure for the usual pour (NIH's Rethinking
 * Drinking: 12 fl oz of 5% beer about 150, 5 fl oz of 12% wine about 120, a 1.5 fl oz shot of 80 proof
 * liquor 97, a 9 fl oz pina colada 490).
 */
const DRINKS: [name: string, fdcId: number, unit: string, kcal: number][] = [
  ["beer", 168746, "can", 150],
  ["blue moon", 168746, "can", 168],
  ["coors banquet", 168746, "can", 147],
  ["corona", 168746, "can", 148],
  ["modelo", 168746, "can", 144],
  ["heineken", 168746, "can", 142],
  ["stella", 168746, "can", 150],
  ["pacifico", 168746, "can", 145],
  ["yuengling", 168746, "can", 140],
  ["sam adams", 168746, "can", 175],
  ["pbr", 168746, "can", 144],
  ["shiner bock", 168746, "can", 142],
  ["miller high life", 168746, "can", 141],
  ["budweiser", 168747, "can", 145],
  ["dos equis", 168747, "can", 131],
  ["bud light", 169572, "can", 110],
  ["light beer", 168749, "can", 100],
  ["coors light", 168749, "can", 102],
  ["miller lite", 168749, "can", 96],
  ["corona light", 168749, "can", 99],
  ["busch light", 168749, "can", 95],
  ["natural light", 168749, "can", 95],
  ["keystone light", 168749, "can", 101],
  ["michelob ultra", 169575, "can", 95],
  ["hard seltzer", 169575, "can", 100],
  ["white claw", 169575, "can", 100],
  ["truly", 169575, "can", 100],
  ["high noon", 169575, "can", 100],
  ["ipa", 171906, "can", 190],
  ["lagunitas ipa", 171906, "can", 190],
  ["hard cider", 174146, "can", 190],
  ["angry orchard", 174146, "can", 190],
  ["wine", 173185, "glass", 120],
  ["red wine", 173190, "glass", 120],
  ["white wine", 174837, "glass", 120],
  ["champagne", 174837, "glass", 120],
  ["rose", 171908, "glass", 120],
  ["shot", 174815, "shot", 97],
  ["tequila", 174815, "shot", 97],
  ["vodka", 174818, "shot", 97],
  ["vodka soda", 174818, "shot", 97],
  ["rum", 174817, "shot", 97],
  ["whiskey", 174819, "shot", 97], // 86 proof: 105
  ["gin", 171920, "shot", 97], // 90 proof: 110
  ["pina colada", 168752, "each", 490],
];

const within15 = (kcal: number, label: number) => Math.abs(kcal - label) / label <= 0.15;

describe("drinks: beer, hard seltzer, cider, wine and liquor", () => {
  it("lands every drink within 15% of its label, in the can, glass or shot it's poured in", () => {
    for (const [name, fdcId, unit, label] of DRINKS) {
      const entry = commonMatch(name);
      expect(entry?.fdcId, name).toBe(fdcId);
      expect(unitless(entry!, 1, name), name).toMatchObject({ unit, guessed: false });
      const kcal = calories(name);
      expect(within15(kcal, label), `${name}: ${kcal} kcal against ${label} on the label`).toBe(true);
    }
  });

  it("checks a label for every drink entry, and every name of it reads the same", () => {
    const checked = new Set(DRINKS.map(([name]) => commonMatch(name)));
    for (const entry of COMMON_FOODS.filter((e) => DRINK_RECORDS.has(e.fdcId))) {
      expect(checked.has(entry), `${label(entry)} has no label in DRINKS`).toBe(true);
      for (const name of entry.names) {
        expect(commonMatch(name), name).toBe(entry);
        expect(calories(name), name).toBe(calories(entry.names[0]));
      }
    }
    // Spellings and full names people say.
    const same: [string, string][] = [
      ["blue moon beer", "blue moon"],
      ["Blue Moon Belgian White", "blue moon"],
      ["corona extra", "corona"],
      ["modelo especial", "modelo"],
      ["stella artois", "stella"],
      ["pabst blue ribbon", "pbr"],
      ["samuel adams", "sam adams"],
      ["bud lite", "bud light"],
      ["Natty Light", "natural light"],
      ["mich ultra", "michelob ultra"],
      ["White Claws", "white claw"],
      ["hazy IPA", "ipa"],
      ["cider", "hard cider"],
      ["prosecco", "champagne"],
      ["rosé", "rose"],
      ["bourbon", "whiskey"],
      ["regular beer", "beer"],
    ];
    for (const [a, b] of same) expect(commonMatch(a), `${a} vs ${b}`).toBe(commonMatch(b));
    // Apple cider without alcohol is apple juice; cider alone is hard cider, with apple juice next.
    expect(commonMatch("apple cider")).toBe(commonMatch("apple juice"));
    expect(commonMatch("cider")?.alternatives?.[0]).toBe(commonMatch("apple juice")?.fdcId);
    // Not a beer: these keep their own entries or none.
    expect(commonMatch("root beer")?.fdcId).toBe(171871);
    expect(commonMatch("seltzer")?.fdcId).toBe(174842); // club soda
    expect(commonMatch("blue cheese")).toBeNull();
    expect(commonMatch("guinness")).toBeNull(); // no USDA beer within 15% of its 125 cal label
    expect(commonMatch("margarita")).toBeNull(); // nor a cocktail record near NIH's 168 cal
  });

  it("reads the phrases that went wrong as the drink, never a guessed 100 g", () => {
    const cases: [phrase: string, food: string, fdcId: number, quantity: number, unit: string, grams: number][] = [
      ["a blue moon beer", "blue moon beer", 168746, 1, "can", 356],
      ["Blue Moon", "blue moon", 168746, 1, "can", 356],
      ["a michelob ultra", "michelob ultra", 169575, 1, "can", 354],
      ["a glass of white claw", "white claw", 169575, 1, "can", 354],
      ["a corona", "corona", 168746, 1, "can", 356],
      ["a bud light", "bud light", 169572, 1, "can", 354],
      ["two bud lights", "bud lights", 169572, 2, "can", 708],
      ["a can of white claw", "white claw", 169575, 1, "can", 354],
      ["a bottle of corona", "corona", 168746, 1, "can", 356], // the bottle is 12 fl oz too
      ["a glass of red wine", "red wine", 173190, 1, "glass", 147],
      ["two glasses of wine", "wine", 173185, 2, "glass", 296],
      ["a shot", "shot", 174815, 1, "shot", 42],
      ["three shots", "shots", 174815, 3, "shot", 126],
      ["a vodka soda", "vodka soda", 174818, 1, "shot", 42],
      ["an ipa", "ipa", 171906, 1, "can", 355],
      ["a pina colada", "pina colada", 168752, 1, "each", 283],
    ];
    for (const [phrase, food, fdcId, quantity, unit, grams] of cases) {
      const [item] = parseMeal(phrase).items;
      expect(item, phrase).toMatchObject({ food, quantity, unit: null });
      const entry = commonFor(item.food);
      expect(entry?.fdcId, phrase).toBe(fdcId);
      const amount = resolveAmount(record(fdcId), item.quantity, item.unit, spokenUnits(entry, item.food, item.quantity));
      expect(amount, phrase).toEqual({ quantity, unit, grams, guessed: false });
    }
  });

  it("answers them with status ok and the table's record first, through lookup", async () => {
    const usda = { apiKey: "test-key", fetch: createFakeUsda().fetch, db: env.DB };
    const cases: [phrase: string, fdcId: number, label: number][] = [
      ["a blue moon beer", 168746, 168],
      ["Blue Moon", 168746, 168],
      ["a michelob ultra", 169575, 95],
      ["a glass of white claw", 169575, 100],
      ["a corona", 168746, 148],
      ["a bud light", 169572, 110],
      ["two bud lights", 169572, 220],
      ["a glass of red wine", 173190, 120],
      ["a tequila", 174815, 97],
    ];
    for (const [phrase, fdcId, label] of cases) {
      const [item] = parseMeal(phrase).items;
      const result = await lookup(usda, item.food, item.quantity, item.unit, { limit: 5, brandHint: looksLikeBrand(item.text) });
      const top = result.candidates[0];
      expect(result.status, phrase).toBe("ok");
      const what = `${phrase} -> ${top.fdcId} ${top.name}, ${top.amount.quantity} ${top.amount.unit} = ${top.nutrition.calories} kcal`;
      expect(top.fdcId, what).toBe(fdcId);
      expect(top.amount.guessed, what).toBe(false);
      expect(within15(top.nutrition.calories, label), what).toBe(true);
      // Every food offered gets a real amount too: a light or stronger beer, a can or shot of something close.
      for (const c of result.candidates) expect(c.amount.guessed, `${phrase}: ${c.name}`).toBe(false);
    }
  });

  it("offers a pint and a bottle of beer, a bottle of wine and a shot of liquor", () => {
    // The parser doesn't read "pint" or "shot" yet: "a pint of blue moon" reaches the table only when
    // the unit is picked on the confirm screen. These are the amounts it then gets.
    const amount = (name: string, quantity: number, unit: string) => {
      const food = record(commonMatch(name)!.fdcId);
      const resolved = resolveAmount(food, quantity, unit);
      return { ...resolved, kcal: nutritionFor(food.per100g, resolved.grams).calories };
    };
    expect(amount("blue moon", 1, "pint")).toMatchObject({ unit: "pint", grams: 475, guessed: false });
    expect(within15(amount("blue moon", 1, "pint").kcal, (168 * 16) / 12)).toBe(true);
    expect(amount("bud light", 2, "pint")).toMatchObject({ unit: "pint", grams: 944, guessed: false });
    expect(amount("budweiser", 1, "bottle")).toMatchObject({ unit: "bottle", grams: 357, guessed: false });
    expect(amount("ipa", 1, "pint")).toMatchObject({ unit: "pint", grams: 473, guessed: false });
    expect(amount("white claw", 1, "bottle").grams).toBe(354);
    expect(amount("wine", 1, "bottle")).toMatchObject({ unit: "bottle", grams: 751, guessed: false });
    expect(within15(amount("wine", 1, "bottle").kcal, 120 * 5)).toBe(true); // 750 ml is five glasses
    expect(amount("tequila", 1, "shot")).toMatchObject({ unit: "shot", grams: 42, kcal: 97, guessed: false });
    expect(amount("whiskey", 2, "shot")).toMatchObject({ unit: "shot", grams: 84, guessed: false });
    expect(amount("pina colada", 1, "small")).toMatchObject({ unit: "small", grams: 141, guessed: false });
    // "A cup of beer" still has USDA's own fl oz: 8 fl oz.
    expect(amount("beer", 1, "cup").grams).toBeCloseTo(237.6, 1);
  });
});
