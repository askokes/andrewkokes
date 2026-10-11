// Drinks, cocktails and snacks, over live USDA responses.
//
// A second adversarial live test (2026-10-11), after the Blue Moon fix, found more confident junk: "A
// Prime" was prime-grade beef ribs (1058 kcal), "a sierra nevada pale ale" Sierra Nevada's pale ale
// mustard, "A glass of Cabernet" a cherry cabernet vinegar, "A Captain and Coke" THE CAPTAIN'S cocktail
// sauce, "A White Claw Mango" a raw mango, "a mojito" a 400 kcal frozen pouch mix, "A Moscow Mule" a
// non-alcoholic mixer, "a bud light lime" an 8% Lime-A-Rita, "some pringles" a Branded record with half
// Pringles' calories, and "a rockstar energy drink" half its can. drinks.json holds what USDA's searches
// really return for these (see its _note), served by fake-fetch.ts, so this runs the real path offline:
// parseMeal, then lookup exactly as /api/parse calls it. The second half checks each cause on its own,
// over the same live hits.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { commonMatch, isCocktailUsdaLacks } from "../src/food/common";
import { extractFood, extractSearchHit } from "../src/food/nutrition";
import { parseMeal } from "../src/food/parse";
import { lookup } from "../src/food/routes";
import type { Amount, FoodRecord } from "../src/food/types";
import { unitOptions } from "../src/food/units";
import { isReasonable, isReasonableFirst, looksLikeBrand, rankHits } from "../src/food/usda";
import { createFakeUsda } from "./fixtures/usda/fake-fetch";
import adversarialFile from "./fixtures/usda/live/adversarial.json";
import commonFile from "./fixtures/usda/live/common-foods.json";
import drinksFile from "./fixtures/usda/live/drinks.json";

interface Want {
  /** The parsed food phrase. */
  food: string;
  /** null: not found, with no candidates. */
  fdcId?: number | null;
  name?: RegExp;
  /** Calories of the amount offered first: the label or NIH figure, as the finding gave it. */
  kcal?: [number, number];
  amount?: Partial<Amount>;
  /** What no candidate offered may be: the junk the finding reported. */
  never?: RegExp;
  /** USDA calls the lookup may make with an empty cache. */
  calls?: number;
}

const CASES: [phrase: string, items: Want[]][] = [
  // Disasters.
  ["A Prime", [{ food: "prime", fdcId: 175109, kcal: [20, 30], amount: { unit: "bottle", grams: 501 }, never: /beef/i, calls: 1 }]],
  ["a prime", [{ food: "prime", fdcId: 175109, kcal: [20, 30], never: /beef/i }]],
  ["a sierra nevada pale ale", [{ food: "sierra nevada pale ale", fdcId: 168746, kcal: [149, 201], amount: { unit: "can" }, never: /mustard|sauce/i }]],
  ["A glass of Cabernet", [{ food: "cabernet", fdcId: 174833, kcal: [110, 135], amount: { unit: "glass", grams: 147 }, never: /vinegar|sorbet|sauce|salt/i }]],
  [
    "A Captain and Coke",
    [
      { food: "captain", fdcId: 174817, kcal: [80, 100], amount: { unit: "shot", grams: 42 }, never: /sauce|wafer/i },
      { food: "coke", fdcId: 174852, kcal: [150, 160] },
    ],
  ],
  ["A White Claw Mango", [{ food: "white claw mango", fdcId: 169575, kcal: [90, 105], amount: { unit: "can" }, never: /mango/i }]],
  ["a white claw black cherry", [{ food: "white claw black cherry", fdcId: 169575, kcal: [90, 105], never: /cherr/i }]],
  ["a long island iced tea", [{ food: "long island iced tea", fdcId: null, calls: 0 }]],
  ["a mojito", [{ food: "mojito", fdcId: null, calls: 0 }]],
  ["A Moscow Mule", [{ food: "moscow mule", fdcId: null, calls: 0 }]],
  ["a bud light lime", [{ food: "bud light lime", fdcId: 169572, kcal: [99, 135], amount: { unit: "can", grams: 354 }, never: /rita|margarita/i }]],
  ["some pringles", [{ food: "pringles", fdcId: 168853, kcal: [140, 160], amount: { unit: "oz" } }]],
  // Wrong.
  ["A McChicken", [{ food: "mcchicken", fdcId: 173305, kcal: [340, 370], amount: { unit: "each", grams: 131 } }]],
  ["A large fries from McDonald's", [{ food: "fries", fdcId: 170698, kcal: [460, 510], amount: { unit: "large", grams: 154 } }]],
  ["A bag of peanut M&Ms", [{ food: "peanut m and ms", fdcId: 169582, kcal: [250, 290], amount: { unit: "serving", grams: 54 } }]],
  ["a bag of M&Ms", [{ food: "m and ms", fdcId: 169583, kcal: [230, 245], amount: { unit: "pack" } }]],
  ["A Red Bull Sugar Free", [{ food: "red bull sugar free", fdcId: 171870, kcal: [5, 20], amount: { unit: "can", grams: 250 } }]],
  ["a bowl of honey nut cheerios", [{ food: "honey nut cheerios", fdcId: 174644, kcal: [104, 145], amount: { unit: "cup" }, never: /granola|kit/i }]],
  ["a rockstar energy drink", [{ food: "rockstar energy drink", fdcId: 171937, kcal: [270, 285], amount: { unit: "can", grams: 480 } }]],
  ["a fanta", [{ food: "fanta", fdcId: 174854, kcal: [150, 185], amount: { unit: "can", grams: 372 } }]],
  // Meh.
  ["A shot of Fireball", [{ food: "fireball", fdcId: 174819, kcal: [95, 110], amount: { quantity: 1, unit: "shot", grams: 42 } }]],
  ["A shot of Patron", [{ food: "patron", fdcId: 174815, kcal: [95, 100], amount: { unit: "shot" } }]],
  ["a shot of jameson", [{ food: "jameson", fdcId: 174819, kcal: [95, 110], amount: { unit: "shot" } }]],
  // A brand the table doesn't know: a shot is liquor.
  ["A shot of Jagermeister", [{ food: "jagermeister", fdcId: 174815, kcal: [95, 100], amount: { unit: "shot", grams: 42 }, calls: 3 }]],
  ["A Monster Ultra", [{ food: "monster ultra", fdcId: 173162, kcal: [0, 30], amount: { unit: "can" } }]],
  ["A Cherry Coke", [{ food: "cherry coke", fdcId: 174852, kcal: [140, 160], amount: { unit: "can" } }]],
  ["A glass of Josh Cabernet", [{ food: "josh cabernet", fdcId: 174833, kcal: [110, 135], amount: { unit: "glass" }, never: /josh|vinegar|sauce/i }]],
  ["a whiskey sour", [{ food: "whiskey sour", fdcId: 173662, kcal: [150, 165], amount: { unit: "serving", grams: 106 } }]],
  ["a 5 hour energy", [{ food: "5 hour energy", fdcId: 174822, kcal: [0, 10], amount: { quantity: 1, unit: "shot", grams: 57 } }]],
  ["a 5-hour energy", [{ food: "5 hour energy", fdcId: 174822, amount: { quantity: 1, unit: "shot" } }]],
  ["An A&W root beer", [{ food: "a and w root beer", fdcId: 171871, kcal: [145, 175], amount: { unit: "can", grams: 370 } }]],
  ["A Mtn Dew", [{ food: "mtn dew", name: /^MOUNTAIN DEW, SODA$/, kcal: [160, 180], amount: { grams: 355 } }]],
  ["An AriZona green tea", [{ food: "arizona green tea", fdcId: 171883, kcal: [180, 230], amount: { unit: "can" } }]],
  ["A bowl of Fruity Pebbles", [{ food: "fruity pebbles", fdcId: 171645, kcal: [140, 220], amount: { unit: "cup", grams: 36 } }]],
  ["a vodka cranberry", [{ food: "vodka cranberry", fdcId: null, calls: 0 }]],
  ["A Little Debbie oatmeal creme pie", [{ food: "little debbie oatmeal creme pie", fdcId: 2035915, kcal: [300, 320] }]],
  ["A Little Caesars pizza", [{ food: "little caesars pizza", name: /^LITTLE CAESARS 14" .*Pizza/ }]],
];

const NOT_FOUND = (food: string) => `We couldn't find "${food}". Try other words, or enter it yourself.`;

describe("drinks and snacks the second adversarial test named, through parse and lookup", () => {
  beforeEach(async () => {
    await env.DB.batch([env.DB.prepare("DELETE FROM usda_cache"), env.DB.prepare("DELETE FROM usda_search_cache")]);
  });

  it.each(CASES)("%s", async (phrase, wants) => {
    const items = parseMeal(phrase).items;
    expect(items.map((i) => i.food), phrase).toEqual(wants.map((w) => w.food));
    for (const [i, item] of items.entries()) {
      const want = wants[i];
      const fake = createFakeUsda();
      const usda = { apiKey: "test-key", fetch: fake.fetch, db: env.DB };
      const result = await lookup(usda, item.food, item.quantity, item.unit, { limit: 5, brandHint: looksLikeBrand(item.text) });
      const top = result.candidates[0];
      const what = `${phrase}: ${item.food} -> ${result.status}${top ? ` ${top.fdcId} ${top.name}, ${top.amount.quantity} ${top.amount.unit} = ${top.amount.grams} g, ${top.nutrition.calories} kcal` : ""}`;
      if (want.calls !== undefined) expect(fake.calls.length, what).toBeLessThanOrEqual(want.calls);
      if (want.fdcId === null) {
        expect(result, what).toEqual({ status: "not_found", message: NOT_FOUND(item.food), candidates: [] });
        continue;
      }
      expect(result.status, what).toBe("ok");
      if (want.fdcId !== undefined) expect(top.fdcId, what).toBe(want.fdcId);
      if (want.name) expect(top.name, what).toMatch(want.name);
      if (want.kcal) {
        expect(top.nutrition.calories, what).toBeGreaterThanOrEqual(want.kcal[0]);
        expect(top.nutrition.calories, what).toBeLessThanOrEqual(want.kcal[1]);
      }
      expect(top.amount.guessed, what).toBe(false);
      if (want.amount) expect(top.amount, what).toMatchObject(want.amount);
      for (const c of result.candidates) if (want.never) expect(c.name, what).not.toMatch(want.never);
    }
  });

  it("fills a table drink's list only with fair matches: no cabernet sauces after the cabernet", async () => {
    // The search route asks for 8, so the table's 5 wines are filled out from Branded (the capital in
    // "Cabernet" hints at a brand), whose "cabernet" hits are marinara, barbecue sauce and a sorbet.
    const fake = createFakeUsda();
    const usda = { apiKey: "test-key", fetch: fake.fetch, db: env.DB };
    const result = await lookup(usda, "cabernet", 1, null, { limit: 8, brandHint: true });
    expect(fake.calls.some((u) => u.includes("query=cabernet") && u.includes("Branded"))).toBe(true);
    expect(result.candidates.map((c) => c.fdcId)).toEqual([174833, 173190, 171925, 174835, 173185]);
    for (const c of result.candidates) expect(c.name).toMatch(/^Alcoholic Beverage, wine/i);
  });
});

// ---------------------------------------------------------------- each cause, over the live hits

type Row = [number, string, string, string | null, string | null, number | null, string | null, string | null, ...(number | null)[]];
const live = drinksFile.search as unknown as Record<"core" | "branded", Record<string, { hits: Row[] }>>;

/** The recorded hits for a search, as extractSearchHit reads them (with a Branded label serving). */
function hits(scope: "core" | "branded", query: string): FoodRecord[] {
  return live[scope][query].hits.flatMap(([fdcId, dataType, description, brandName, brandOwner, servingSize, servingSizeUnit, household, ...values]) => {
    const ids = [1008, 1003, 1005, 1004];
    const foodNutrients = values.flatMap((value, i) => (value === null ? [] : [{ nutrientId: ids[i], value }]));
    const hit = extractSearchHit({
      fdcId, dataType, description, brandName, brandOwner, servingSize, servingSizeUnit,
      householdServingFullText: household, foodNutrients,
    });
    return hit ? [hit] : [];
  });
}
const hit = (scope: "core" | "branded", query: string, fdcId: number) => {
  const found = hits(scope, query).find((h) => h.fdcId === fdcId);
  if (!found) throw new Error(`${fdcId} not in the ${scope} search for "${query}"`);
  return found;
};
/** A full record from the fixtures, as the details call gives it. */
async function record(fdcId: number): Promise<FoodRecord> {
  const url = `https://api.nal.usda.gov/fdc/v1/foods?fdcIds=${fdcId}&format=full&api_key=k`;
  const [raw] = await (await createFakeUsda().fetch(url)).json<unknown[]>();
  const food = extractFood(raw);
  if (!food) throw new Error(`${fdcId} is in no fixture`);
  return food;
}
const fair = (query: string, list: FoodRecord[]) => list.filter((h) => isReasonable(query, h)).map((h) => h.description);

describe("the causes, one at a time", () => {
  it("reads a beef grade as no kind of food: 'prime' is no prime rib", () => {
    const core = hits("core", "prime");
    expect(core.length).toBeGreaterThan(10);
    expect(fair("prime", core)).toEqual([]); // every hit is "Beef, ..., prime, ..."
    expect(fair("prime", hits("branded", "prime"))).toEqual([]); // rubs, seasonings and burgers
    // Prime rib is still a rib.
    expect(isReasonable("prime rib", hit("core", "prime", 169504))).toBe(true);
  });

  it("takes a Branded segment for the brand only with the brand's first word", () => {
    const vinegar = (portions: FoodRecord["portions"]) => ({
      fdcId: 1909366,
      description: "VINEGAR, CHERRY CABERNET",
      dataType: "Branded",
      brand: "NAPA VALLEY VINEGAR CO",
      per100g: { kcal: 67 },
      portions,
    });
    // As the finding saw it: the vinegar was read as the brand, and cherry cabernet as the food.
    expect(isReasonable("cabernet", vinegar([]))).toBe(false);
    expect(isReasonable("cabernet", vinegar([{ amount: 1, gramWeight: 15, unitName: "serving", modifier: null, description: "1 Tbsp" }]))).toBe(false);
    // A brand segment is still the brand: TEA 5's milk tea, STARBUCKS' frappuccino.
    expect(isReasonable("milk tea", { description: "TEA 5, ASSAM MILK TEA", dataType: "Branded", brand: "TEA 5", per100g: { kcal: 40 } })).toBe(true);
    expect(fair("cabernet", hits("branded", "cabernet"))).toEqual([]);
    expect(fair("josh cabernet", hits("branded", "josh cabernet"))).toEqual([]);
  });

  it("never takes a teaspoon of something flavored like a drink for the drink", () => {
    // Sierra Nevada's own pale ale mustard: the brand and both words are there, but a 5 g serving is no beer.
    const mustard = hit("branded", "sierra nevada pale ale", 2316795);
    expect(mustard.description).toBe("MUSTARD PALE ALE, HONEY SPICE");
    expect(isReasonable("sierra nevada pale ale", mustard)).toBe(false);
    expect(isReasonable("sierra nevada pale ale", { ...mustard, portions: [] })).toBe(true); // the serving decides it
    expect(fair("sierra nevada pale ale", hits("branded", "sierra nevada pale ale"))).toEqual([]);
  });

  it("names no brand with a possessive the query doesn't say", () => {
    const captain = hits("branded", "captain");
    expect(isReasonable("captain", hit("branded", "captain", 2017657))).toBe(false); // THE CAPTAIN'S, GOURMET COCKTAIL SAUCE
    expect(isReasonable("captain", hit("branded", "captain", 2733653))).toBe(false); // Lance Captain's Wafers Crackers
    expect(isReasonableFirst("captain", rankHits("captain", captain))).toBe(false);
    expect(fair("captain", captain)).toEqual([]);
    // A plural or a possessive the user says still names the brand.
    const branded = (description: string, brand: string) => ({ description, dataType: "Branded", brand, per100g: { kcal: 470 } });
    expect(isReasonable("oreos", branded("OREO, CHOCOLATE SANDWICH COOKIES", "OREO"))).toBe(true);
    expect(isReasonable("reeses", branded("REESE'S, PEANUT BUTTER CUPS", "REESE'S"))).toBe(true);
  });

  it("reads a cocktail mixer or a frozen pouch mix as no cocktail", () => {
    expect(isReasonable("mojito", hit("branded", "mojito", 2509401))).toBe(false); // MOJITO IN A BAG, 400 kcal per 100 g
    expect(isReasonable("mojito", hit("branded", "mojito", 2142917))).toBe(false); // MOJITO PREMIUM COCKTAIL MIXER
    expect(isReasonable("moscow mule", hit("branded", "moscow mule", 2174590))).toBe(false); // NON-ALCOHOLIC ... MIXER
    expect(fair("moscow mule", hits("branded", "moscow mule"))).toEqual([]);
  });

  it("knows the cocktails USDA has no record of, and never searches them", () => {
    for (const name of ["long island iced tea", "Long Island", "mojito", "strawberry mojito", "Moscow Mule", "mimosa", "white russian", "old fashioned", "vodka cranberry"]) {
      expect(isCocktailUsdaLacks(name), name).toBe(true);
    }
    // USDA's own cocktails, Branded's bottled margaritas, and foods that share a word.
    for (const name of ["margarita", "pina colada", "whiskey sour", "daiquiri", "iced tea", "old fashioned oats", "mule deer"]) {
      expect(isCocktailUsdaLacks(name), name).toBe(false);
    }
    // Branded's "long island iced tea" hits are iced teas, its "mojito" ones sparkling waters: fair by their
    // words alone, so only the list keeps them away.
    expect(fair("long island iced tea", hits("branded", "long island iced tea")).length).toBeGreaterThan(0);
  });

  it("reads a flavor around a table drink as that drink, but never a mixer after a liquor", () => {
    const entry = (name: string) => commonMatch(name);
    expect(entry("white claw mango")).toBe(entry("white claw"));
    expect(entry("white claw black cherry")).toBe(entry("white claw"));
    expect(entry("mango white claw")).toBe(entry("white claw"));
    expect(entry("bud light lime")).toBe(entry("bud light"));
    expect(entry("cherry coke")).toBe(entry("coke"));
    expect(entry("diet cherry coke")).toBe(entry("diet coke"));
    expect(entry("cranberry vodka")).toBe(entry("vodka"));
    expect(entry("vodka cranberry")).toBeNull(); // a mixed drink
    expect(entry("ginger beer")).toBeNull(); // a soda, no beer
    expect(entry("strawberry milk")).toBeNull(); // milk is no canned drink: a flavored milk is its own food
    expect(entry("mango")).toBe(entry("mangoes")); // a flavor alone is still the fruit
  });

  it("ranks a Branded record whose energy is off its brand's others last", () => {
    const pringles = hits("branded", "pringles");
    const bad = pringles.find((h) => h.fdcId === 2242656)!;
    expect(bad.per100g.kcal).toBe(250); // PRINGLES, POTATO CRISPS, ORIGINAL: half the brand's 536
    const ranked = rankHits("pringles", pringles);
    expect(ranked[0].per100g.kcal).toBeGreaterThan(500);
    // Every fair Pringles record comes first; the bad one is still offered, after them.
    const others = ranked.filter((h) => h !== bad && /pringles/i.test(h.brand ?? "") && isReasonable("pringles", h));
    expect(others.length).toBeGreaterThan(20);
    for (const h of others) expect(ranked.indexOf(h), h.description).toBeLessThan(ranked.indexOf(bad));
    expect(isReasonable("pringles", bad)).toBe(true);
  });

  it("reads a brand's odd product named with the flavor asked for as its own kind of food", () => {
    // Cheerios Honey Nut Granola is granola, no Honey Nut Cheerios: it no longer names them (it is still a
    // Cheerios product, so isReasonable keeps it), so it neither ranks first nor answers when first.
    const branded = hits("branded", "honey nut cheerios");
    const granola = hit("branded", "honey nut cheerios", 2772892);
    expect(rankHits("honey nut cheerios", branded)[0]).not.toBe(granola);
    expect(isReasonableFirst("honey nut cheerios", [granola, ...branded.filter((h) => h !== granola)])).toBe(false);
    // Hot Cheetos are still hot Cheetos.
    expect(isReasonable("hot cheetos", { description: "Cheetos Hot 9.5z", dataType: "Branded", brand: "Cheetos", per100g: { kcal: 571 } })).toBe(true);
  });

  it("reads a restaurant's capitalized dish name as the dish, and an energy drink's brand as the drink", async () => {
    expect(isReasonable("mcchicken", hit("core", "mcchicken", 173305))).toBe(true); // McDONALD'S, McCHICKEN Sandwich
    expect(isReasonable("red bull sugar free", await record(171870))).toBe(true);
    expect(isReasonable("red bull", await record(173210))).toBe(true);
  });

  it("measures a drink in its can, a cocktail in USDA's pour and a cereal in a cup", async () => {
    const can = unitOptions(await record(171937)).find((o) => o.unit === "can"); // ROCKSTAR: "can" 480 g
    expect(can).toEqual({ unit: "can", label: "can", grams: 480 });
    const sour = unitOptions(await record(173662)).find((o) => o.unit === "serving");
    expect(sour).toEqual({ unit: "serving", label: "serving (2 oz mix + 1.5 oz whiskey)", grams: 106 });
    expect(unitOptions(await record(171645)).find((o) => o.unit === "cup")?.grams).toBe(36); // Fruity Pebbles
    // The table's sizes win over USDA's for a drink it names: root beer's 12 fl oz can, not its 16 fl oz one.
    const rootBeer = unitOptions(await record(171871));
    expect(rootBeer.filter((o) => o.unit === "can")).toEqual([{ unit: "can", label: "can (12 fl oz)", grams: 370 }]);
    expect(unitOptions(await record(175110)).find((o) => o.unit === "bottle")).toBeUndefined(); // AriZona: the table's can
    // Of USDA's own cans, the one nearest 12 fl oz, whatever USDA's order.
    const soda: FoodRecord = {
      fdcId: 1,
      description: "Beverages, carbonated, zorbo soda",
      dataType: "SR Legacy",
      brand: null,
      per100g: { kcal: 40, protein: 0, carbs: 10, fat: 0 },
      portions: [
        { amount: 1, gramWeight: 492, unitName: "undetermined", modifier: "can or bottle (16 fl oz)", description: null },
        { amount: 1, gramWeight: 370, unitName: "undetermined", modifier: "can or bottle (12 fl oz)", description: null },
      ],
    };
    expect(unitOptions(soda).find((o) => o.unit === "can")).toEqual({ unit: "can", label: "can or bottle (12 fl oz)", grams: 370 });
  });

  it("backs a shot of an unknown brand off to liquor, but never a shot of a plain word", async () => {
    const run = async (food: string, unit: string | null, brandHint: boolean) => {
      await env.DB.batch([env.DB.prepare("DELETE FROM usda_cache"), env.DB.prepare("DELETE FROM usda_search_cache")]);
      const usda = { apiKey: "test-key", fetch: createFakeUsda().fetch, db: env.DB };
      return lookup(usda, food, 1, unit, { limit: 5, brandHint });
    };
    expect((await run("jagermeister", "shot", true)).candidates[0]?.fdcId).toBe(174815);
    expect((await run("jagermeister", "shot", false)).status).toBe("not_found"); // "a shot of wheatgrass" is no liquor
    expect((await run("jagermeister", null, true)).status).toBe("not_found");
  });
});

describe("the parser, on names with '&', 'little', 'from' and numbers in them", () => {
  const foods = (text: string) => parseMeal(text).items.map((i) => [i.quantity, i.unit, i.food]);

  it("keeps an '&' between short words in the name", () => {
    expect(foods("A bag of peanut M&Ms")).toEqual([[1, null, "peanut m and ms"]]);
    expect(foods("M&M's")).toEqual([[1, null, "m and m's"]]);
    expect(foods("An A&W root beer")).toEqual([[1, null, "a and w root beer"]]);
    expect(foods("a pb&j")).toEqual([[1, null, "pb and j"]]);
    // Spaced, it still joins or splits as before.
    expect(foods("mac & cheese")).toEqual([[1, null, "mac and cheese"]]);
    expect(foods("eggs & toast")).toEqual([[1, null, "eggs"], [1, null, "toast"]]);
  });

  it("keeps 'Little' in Little Debbie and Little Caesars, and drops it as filler elsewhere", () => {
    expect(foods("A Little Debbie oatmeal creme pie")).toEqual([[1, null, "little debbie oatmeal creme pie"]]);
    expect(foods("a little caesars pizza")).toEqual([[1, null, "little caesars pizza"]]);
    expect(foods("a little rice")).toEqual([[1, null, "rice"]]);
  });

  it("drops where the food came from", () => {
    expect(foods("A large fries from McDonald's")).toEqual([[1, "large", "fries"]]);
    expect(foods("a burrito at chipotle")).toEqual([[1, null, "burrito"]]);
    expect(parseMeal("A large fries from McDonald's").items[0].text).toBe("A large fries from McDonald's");
  });

  it("reads the number in a 5-hour Energy as part of its name", () => {
    expect(foods("a 5 hour energy")).toEqual([[1, null, "5 hour energy"]]);
    expect(foods("a 5-hour energy")).toEqual([[1, null, "5 hour energy"]]);
    expect(foods("two 5 hour energies")).toEqual([[2, null, "5 hour energies"]]);
  });
});
