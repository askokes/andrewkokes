import { describe, expect, it } from "vitest";
import { extractFood, nutritionFor } from "../src/food/nutrition";
import type { FoodRecord } from "../src/food/types";
import { resolveAmount, toCandidate, unitOptions } from "../src/food/units";
import foodsFile from "./fixtures/usda/foods.json";

const foods = foodsFile.foods as unknown as { fdcId: number }[];
function food(fdcId: number): FoodRecord {
  const record = extractFood(foods.find((f) => f.fdcId === fdcId));
  if (!record) throw new Error(`fixture ${fdcId} missing or unusable`);
  return record;
}
const option = (f: FoodRecord, unit: string) => unitOptions(f).find((o) => o.unit === unit);
const keys = (f: FoodRecord) => unitOptions(f).map((o) => o.unit);

const ROASTED_CHICKEN = 171477; // SR: "cup, chopped or diced" 140 g, "0.5 breast, bone and skin removed" 86 g
const SR_EGG = 171287; // SR: large 50, medium 44, small 38, extra large 56, jumbo 63, "cup (4.86 large eggs)" 243
const FOUNDATION_EGG = 748967; // Foundation: measureUnit "egg" 50.3 g, RACC 50 g
const SR_BANANA = 173944; // SR: large 136, extra large 152, small 101, extra small 81, medium 118, ...
const FOUNDATION_BANANA = 1105314; // Foundation: measureUnit "Banana" 115 g, RACC 140 g

describe("unitOptions", () => {
  it("always starts with oz, lb and g", () => {
    expect(unitOptions(food(ROASTED_CHICKEN)).slice(0, 3)).toEqual([
      { unit: "oz", label: "oz", grams: 28.3495 },
      { unit: "lb", label: "lb", grams: 453.592 },
      { unit: "g", label: "g", grams: 1 },
    ]);
  });

  it("divides by the portion amount: 0.5 breast = 86 g means one breast is 172 g", () => {
    expect(option(food(ROASTED_CHICKEN), "each")).toEqual({ unit: "each", label: "breast", grams: 172 });
    expect(option(food(175168), "each")).toEqual({ unit: "each", label: "fillet", grams: 356 }); // 0.5 fillet = 178 g
  });

  it("maps SR modifiers and skips yield units", () => {
    expect(unitOptions(food(ROASTED_CHICKEN))).toEqual([
      { unit: "oz", label: "oz", grams: 28.3495 },
      { unit: "lb", label: "lb", grams: 453.592 },
      { unit: "g", label: "g", grams: 1 },
      { unit: "each", label: "breast", grams: 172 },
      { unit: "cup", label: "cup, chopped", grams: 140 },
      { unit: "tbsp", label: "tbsp", grams: 8.75 },
      { unit: "tsp", label: "tsp", grams: 2.92 },
    ]);
  });

  it("matches large, medium and small but never extra large, extra small or jumbo", () => {
    const egg = food(SR_EGG);
    expect(option(egg, "large")).toEqual({ unit: "large", label: "large", grams: 50 });
    expect(option(egg, "medium")?.grams).toBe(44);
    expect(option(egg, "small")?.grams).toBe(38);

    const banana = food(SR_BANANA);
    expect(option(banana, "large")).toEqual({ unit: "large", label: "large", grams: 136 }); // not extra large (152)
    expect(option(banana, "small")?.grams).toBe(101); // not extra small (81)
    expect(option(banana, "medium")?.grams).toBe(118);
    expect(keys(banana)).toEqual(["oz", "lb", "g", "small", "medium", "large", "serving", "cup", "tbsp", "tsp"]);
  });

  it("reads Foundation count nouns as 'each', including capitalized ones", () => {
    expect(option(food(FOUNDATION_EGG), "each")).toEqual({ unit: "each", label: "egg", grams: 50.3 });
    expect(option(food(FOUNDATION_BANANA), "each")).toEqual({ unit: "each", label: "banana", grams: 115 });
    expect(option(food(169097), "each")).toEqual({ unit: "each", label: "fruit", grams: 131 }); // oranges
  });

  it("turns RACC, NLEA serving and serving into 'serving' with the grams in the label", () => {
    expect(option(food(2646170), "serving")).toEqual({ unit: "serving", label: "serving (114 g)", grams: 114 });
    expect(option(food(SR_BANANA), "serving")).toEqual({ unit: "serving", label: "serving (126 g)", grams: 126 });
    expect(option(food(173325), "serving")?.grams).toBe(244); // mac and cheese "serving"
  });

  it("offers a Branded label serving with its household text", () => {
    expect(unitOptions(food(9900001)).slice(3)).toEqual([
      { unit: "serving", label: "serving (1 container)", grams: 170 },
    ]);
  });

  it("derives tbsp and tsp from a cup", () => {
    const rice = food(168878); // only "cup" = 158 g
    expect(option(rice, "cup")?.grams).toBe(158);
    expect(option(rice, "tbsp")).toEqual({ unit: "tbsp", label: "tbsp", grams: 9.88 }); // 158 / 16
    expect(option(rice, "tsp")).toEqual({ unit: "tsp", label: "tsp", grams: 3.29 }); // 158 / 48
  });

  it("derives tsp from tbsp, and keeps volumes USDA already gives", () => {
    const peanutButter = food(174266); // "2 tbsp" = 32 g, "cup" = 258 g
    expect(option(peanutButter, "tbsp")?.grams).toBe(16);
    expect(option(peanutButter, "cup")?.grams).toBe(258);
    expect(option(peanutButter, "tsp")?.grams).toBe(5.33);

    const oil = food(171413); // tablespoon 13.5, tsp 4.5, cup 216: nothing derived
    expect([option(oil, "cup")?.grams, option(oil, "tbsp")?.grams, option(oil, "tsp")?.grams]).toEqual([216, 13.5, 4.5]);
  });

  it("derives a cup from a lone tablespoon", () => {
    const oil = food(171413);
    const tbspOnly = { ...oil, portions: oil.portions.filter((p) => p.modifier === "tablespoon") };
    expect(unitOptions(tbspOnly).slice(3)).toEqual([
      { unit: "cup", label: "cup", grams: 216 },
      { unit: "tbsp", label: "tbsp", grams: 13.5 },
      { unit: "tsp", label: "tsp", grams: 4.5 },
    ]);
  });

  it("skips weight portions, so a food with only oz and lb portions offers just the weights", () => {
    expect(unitOptions(food(174054), false).map((o) => o.unit)).toEqual(["oz", "lb", "g"]); // steak: "3 oz", "lb"
    expect(keys(food(323604))).toEqual(["oz", "lb", "g", "serving"]); // Foundation measureUnit "oz"
  });

  it("adds the units the common-foods table gives a food, after USDA's", () => {
    // Steak is in the table with a 6 oz cooked steak; whole milk has nothing to add.
    expect(unitOptions(food(174054)).slice(3)).toEqual([{ unit: "each", label: "steak (6 oz cooked)", grams: 170 }]);
    expect(unitOptions(food(171265))).toEqual(unitOptions(food(171265), false));
  });

  it("prefers a plain portion over a qualified one, and a qualified one over a dense form", () => {
    // Toasted white bread lists "slice, thin" (17 g) before "slice" (22 g).
    expect(option(food(174925), "slice")).toEqual({ unit: "slice", label: "slice", grams: 22 });
    // Cheddar lists "cup, melted" (244 g) before "cup, shredded" (113 g).
    expect(option(food(173414), "cup")).toEqual({ unit: "cup", label: "cup, shredded", grams: 113 });
    // Otherwise the first in USDA order wins.
    expect(option(food(SR_BANANA), "cup")).toEqual({ unit: "cup", label: "cup, sliced", grams: 150 });
  });

  it("reads sizes written after the item ('potato large')", () => {
    const potato = food(170093);
    expect(option(potato, "large")).toEqual({ unit: "large", label: "large potato", grams: 299 });
    expect(option(potato, "medium")?.grams).toBe(173);
  });

  it("skips portions with no weight or no amount", () => {
    const egg = food(SR_EGG);
    const broken = {
      ...egg,
      portions: [
        { amount: 0, gramWeight: 50, unitName: "undetermined", modifier: "large", description: null },
        { amount: 1, gramWeight: 0, unitName: "undetermined", modifier: "medium", description: null },
      ],
    };
    expect(keys(broken)).toEqual(["oz", "lb", "g"]);
  });
});

describe("resolveAmount", () => {
  it("converts weights directly", () => {
    const chicken = food(ROASTED_CHICKEN);
    expect(resolveAmount(chicken, 6, "oz")).toEqual({ quantity: 6, unit: "oz", grams: 170.1, guessed: false });
    expect(resolveAmount(chicken, 1.5, "lb")).toEqual({ quantity: 1.5, unit: "lb", grams: 680.4, guessed: false });
    expect(resolveAmount(chicken, 250, "g")).toEqual({ quantity: 250, unit: "g", grams: 250, guessed: false });
  });

  it("uses the food's portion for a spoken unit", () => {
    expect(resolveAmount(food(SR_BANANA), 2, "large")).toEqual({ quantity: 2, unit: "large", grams: 272, guessed: false });
    expect(resolveAmount(food(168878), 0.5, "cup")).toEqual({ quantity: 0.5, unit: "cup", grams: 79, guessed: false });
    expect(resolveAmount(food(174266), 2, "tbsp")).toEqual({ quantity: 2, unit: "tbsp", grams: 32, guessed: false });
    expect(resolveAmount(food(174925), 2, "slice")).toEqual({ quantity: 2, unit: "slice", grams: 44, guessed: false });
    expect(resolveAmount(food(ROASTED_CHICKEN), 1, "Cup").grams).toBe(140);
  });

  it("resolves a unitless count to a whole item ('two eggs', 'a banana')", () => {
    expect(resolveAmount(food(FOUNDATION_EGG), 2, null)).toEqual({ quantity: 2, unit: "each", grams: 100.6, guessed: false });
    expect(resolveAmount(food(FOUNDATION_BANANA), 1, null)).toEqual({ quantity: 1, unit: "each", grams: 115, guessed: false });
    expect(resolveAmount(food(ROASTED_CHICKEN), 1, null)).toEqual({ quantity: 1, unit: "each", grams: 172, guessed: false });
  });

  it("tries each, medium, large, small, piece, slice, serving in that order", () => {
    expect(resolveAmount(food(SR_BANANA), 1, null)).toMatchObject({ unit: "medium", grams: 118 });
    // Without its table unit the SR egg would be medium; see the next test.
    expect(resolveAmount(food(SR_EGG), 2, null, ["medium"])).toMatchObject({ unit: "medium", grams: 88 });
    expect(resolveAmount(food(173423), 1, null)).toMatchObject({ unit: "large", grams: 46 }); // fried egg: large only
    expect(resolveAmount(food(331960), 1, null)).toMatchObject({ unit: "piece", grams: 174 });
    expect(resolveAmount(food(172688), 2, null)).toMatchObject({ unit: "slice", grams: 64 });
    expect(resolveAmount(food(9900001), 1, null)).toMatchObject({ unit: "serving", grams: 170 });
  });

  it("uses the caller's unit, then the food's own common-foods unit, before that order", () => {
    // "eggs" in the table are large (50 g): eggs are sold by the dozen as large.
    expect(resolveAmount(food(SR_EGG), 2, null)).toEqual({ quantity: 2, unit: "large", grams: 100, guessed: false });
    expect(resolveAmount(food(SR_EGG), 2, null, ["can"])).toMatchObject({ unit: "large" }); // not offered: skipped
    expect(resolveAmount(food(174054), 1, null)).toEqual({ quantity: 1, unit: "each", grams: 170, guessed: false });
    // A food the table offers under another entry takes that entry's unit: "a cup of rice" for brown rice.
    expect(resolveAmount(food(169704), 1, null, ["cup"])).toMatchObject({ unit: "cup", guessed: false });
    // A spoken unit always wins.
    expect(resolveAmount(food(SR_EGG), 1, "small", ["medium"])).toMatchObject({ unit: "small", grams: 38 });
  });

  it("uses the whole item for a size the food doesn't list ('a large egg')", () => {
    expect(resolveAmount(food(FOUNDATION_EGG), 1, "large")).toEqual({ quantity: 1, unit: "each", grams: 50.3, guessed: false });
  });

  it("guesses 100 g per unit when nothing matches", () => {
    const chicken = food(ROASTED_CHICKEN);
    expect(resolveAmount(chicken, 1, "slice")).toEqual({ quantity: 100, unit: "g", grams: 100, guessed: true });
    expect(resolveAmount(chicken, 2, "slice")).toEqual({ quantity: 200, unit: "g", grams: 200, guessed: true });
    expect(resolveAmount(food(171304), 1, null)).toEqual({ quantity: 100, unit: "g", grams: 100, guessed: true }); // no portions
    expect(resolveAmount(food(171304), 1 / 3, null)).toEqual({ quantity: 33.3, unit: "g", grams: 33.3, guessed: true });
    expect(resolveAmount(food(171890), 1, "large")).toMatchObject({ unit: "g", guessed: true }); // "a large coffee"
  });
});

describe("toCandidate", () => {
  it("bundles the food, its units, the resolved amount and its nutrition", () => {
    const chicken = food(ROASTED_CHICKEN);
    const candidate = toCandidate(chicken, 6, "oz");
    expect(candidate).toEqual({
      fdcId: 171477,
      name: "Chicken, broilers or fryers, breast, meat only, cooked, roasted",
      dataType: "SR Legacy",
      brand: null,
      per100g: { kcal: 165, protein: 31, carbs: 0, fat: 3.57 },
      units: unitOptions(chicken),
      amount: { quantity: 6, unit: "oz", grams: 170.1, guessed: false },
      nutrition: { calories: 280.7, proteinG: 52.7, carbsG: 0, fatG: 6.1 },
    });
  });

  it("computes nutrition for a guessed amount too", () => {
    const candidate = toCandidate(food(ROASTED_CHICKEN), 1, "slice");
    expect(candidate.amount.guessed).toBe(true);
    expect(candidate.nutrition).toEqual(nutritionFor(candidate.per100g, 100));
  });

  it("keeps every amount within what an entry can hold, and flags the ones it changed", () => {
    const chicken = food(ROASTED_CHICKEN);
    const egg = food(FOUNDATION_EGG);
    // Over 5 kg: as much as fits, rounded down so it never goes over.
    expect(toCandidate(egg, 200, null).amount).toEqual({ quantity: 99.4, unit: "each", grams: 4999.8, guessed: true });
    expect(toCandidate(chicken, 1000, "lb").amount).toEqual({ quantity: 11.02, unit: "lb", grams: 4998.6, guessed: true });
    expect(toCandidate(chicken, 60, "slice").amount).toEqual({ quantity: 5000, unit: "g", grams: 5000, guessed: true });
    // Up to 5 kg, guessed or spoken grams pass through as they are.
    expect(toCandidate(chicken, 12, "slice").amount).toEqual({ quantity: 1200, unit: "g", grams: 1200, guessed: true });
    expect(toCandidate(chicken, 2000, "g").amount).toEqual({ quantity: 2000, unit: "g", grams: 2000, guessed: false });
    expect(toCandidate(chicken, 5000, "g").amount).toEqual({ quantity: 5000, unit: "g", grams: 5000, guessed: false });
    // Under 0.01 of a unit rounds to nothing.
    expect(toCandidate(chicken, 0.001, "cup").amount).toEqual({ quantity: 0.01, unit: "cup", grams: 1.4, guessed: true });
    const capped = toCandidate(egg, 200, null);
    expect(capped.nutrition).toEqual(nutritionFor(capped.per100g, 4999.8));
  });

  it("carries the brand for Branded foods", () => {
    expect(toCandidate(food(9900001), 1, null)).toMatchObject({
      brand: "CHOBANI",
      amount: { quantity: 1, unit: "serving", grams: 170, guessed: false },
      nutrition: { calories: 100, proteinG: 17, carbsG: 6, fatG: 0 },
    });
  });
});

describe("unitless amounts for poured or scooped foods", () => {
  it("uses the cup the common-foods table gives poured and scooped staples", () => {
    // "a glass of milk", "a bowl of oatmeal": the parser drops the container and passes no unit.
    expect(resolveAmount(food(171265), 1, null)).toMatchObject({ quantity: 1, unit: "cup", grams: 244, guessed: false });
    expect(resolveAmount(food(173905), 1, null)).toMatchObject({ quantity: 1, unit: "cup", guessed: false });
  });

  it("never guesses a cup for a food outside the table, since a cup-only food can be a powder", () => {
    // Updated: this test used to expect a cup here. A cup at the end of the unitless order also turned
    // "two eggs" into 2 cups of dried egg white (about 800 kcal) when that record was picked. A flagged
    // 100 g guess asks the user to check; a cup looked certain.
    expect(resolveAmount(food(746782), 1, null)).toEqual({ quantity: 100, unit: "g", grams: 100, guessed: true });
    expect(resolveAmount(food(746782), 1, "cup")).toMatchObject({ quantity: 1, unit: "cup", guessed: false });
  });
});
