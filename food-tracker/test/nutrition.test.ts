import { describe, expect, it } from "vitest";
import { extractFood, extractSearchHit, nutritionFor } from "../src/food/nutrition";
import foodsFile from "./fixtures/usda/foods.json";
import searchFile from "./fixtures/usda/search.json";

type Json = Record<string, unknown>;
const foods = foodsFile.foods as unknown as Json[];
const raw = (fdcId: number) => {
  const found = foods.find((f) => f.fdcId === fdcId);
  if (!found) throw new Error(`fixture ${fdcId} missing`);
  return structuredClone(found);
};
const searchHits = (scope: "foundationAndSr" | "branded", query: string) =>
  ((searchFile[scope] as Record<string, { foods: Json[] }>)[query]).foods;

describe("extractFood (detail format)", () => {
  it("reads an SR Legacy record with its portions", () => {
    const food = extractFood(raw(171477));
    expect(food).toEqual({
      fdcId: 171477,
      description: "Chicken, broilers or fryers, breast, meat only, cooked, roasted",
      dataType: "SR Legacy",
      brand: null,
      per100g: { kcal: 165, protein: 31, carbs: 0, fat: 3.57 },
      portions: [
        { amount: 1, gramWeight: 140, unitName: "undetermined", modifier: "cup, chopped or diced", description: null },
        {
          amount: 1,
          gramWeight: 52,
          unitName: "undetermined",
          modifier: "unit (yield from 1 lb ready-to-cook chicken)",
          description: null,
        },
        { amount: 0.5, gramWeight: 86, unitName: "undetermined", modifier: "breast, bone and skin removed", description: null },
      ],
    });
  });

  it("reads Foundation portions, keeping the unit name and turning an empty modifier into null", () => {
    expect(extractFood(raw(1105314))?.portions).toEqual([
      { amount: 1, gramWeight: 115, unitName: "Banana", modifier: "Peeled", description: null },
      { amount: 1, gramWeight: 140, unitName: "RACC", modifier: null, description: null },
    ]);
    expect(extractFood(raw(323604))?.portions[0]).toMatchObject({ unitName: "oz", modifier: null });
  });

  it("falls back to Atwater specific (2048) energy, then general (2047), when 1008 is missing", () => {
    // 2727569 has 2047 = 127 and 2048 = 133; 2747660 has only 2047 = 23.9.
    expect(extractFood(raw(2727569))?.per100g.kcal).toBe(133);
    expect(extractFood(raw(2747660))?.per100g.kcal).toBe(23.9);
    // 1008 wins when present.
    expect(extractFood(raw(748967))?.per100g.kcal).toBe(148);
  });

  it("clamps negative values to 0 (Foundation 2727569 reports -0.428 g carbs)", () => {
    expect(extractFood(raw(2727569))?.per100g).toEqual({ kcal: 133, protein: 21.4, carbs: 0, fat: 4.78 });
  });

  it("treats missing protein, fat or carbs as 0", () => {
    const record = raw(171477);
    record.foodNutrients = (record.foodNutrients as Json[]).filter(
      (n) => (n.nutrient as Json).id === 1008,
    );
    expect(extractFood(record)?.per100g).toEqual({ kcal: 165, protein: 0, carbs: 0, fat: 0 });
  });

  it("skips foods with no energy value at all, and junk input", () => {
    const record = raw(171477);
    record.foodNutrients = (record.foodNutrients as Json[]).filter((n) => (n.nutrient as Json).id !== 1008);
    expect(extractFood(record)).toBeNull();
    expect(extractFood(null)).toBeNull();
    expect(extractFood("chicken")).toBeNull();
    expect(extractFood({ ...raw(171477), fdcId: "abc" })).toBeNull();
    expect(extractFood({ ...raw(171477), description: "  " })).toBeNull();
  });

  it("synthesizes one serving portion for a Branded record", () => {
    expect(extractFood(raw(9900001))).toEqual({
      fdcId: 9900001,
      description: "GREEK NONFAT YOGURT, PLAIN",
      dataType: "Branded",
      brand: "CHOBANI",
      per100g: { kcal: 58.8, protein: 10, carbs: 3.53, fat: 0 },
      portions: [{ amount: 1, gramWeight: 170, unitName: "serving", modifier: null, description: "1 container" }],
    });
  });

  it("treats a Branded serving in ml as grams, and ignores other serving units", () => {
    const ml = extractFood({ ...raw(9900001), servingSize: 240, servingSizeUnit: "ml" });
    expect(ml?.portions).toMatchObject([{ gramWeight: 240, unitName: "serving" }]);
    expect(extractFood({ ...raw(9900001), servingSizeUnit: "oz" })?.portions).toEqual([]);
    expect(extractFood({ ...raw(9900001), servingSize: 0 })?.portions).toEqual([]);
  });

  it("reads the abridged nutrient shape (nutrient number + amount)", () => {
    const abridged = {
      fdcId: 1,
      description: "Test food",
      dataType: "SR Legacy",
      foodNutrients: [
        { number: "208", name: "Energy", amount: 200, unitName: "KCAL" },
        { number: "203", name: "Protein", amount: 10, unitName: "G" },
        { number: "204", name: "Total lipid (fat)", amount: 5, unitName: "G" },
        { number: "205", name: "Carbohydrate, by difference", amount: 30, unitName: "G" },
      ],
    };
    expect(extractFood(abridged)?.per100g).toEqual({ kcal: 200, protein: 10, carbs: 30, fat: 5 });
    const atwater = { ...abridged, foodNutrients: [{ number: "958", amount: 90 }, { number: "957", amount: 80 }] };
    expect(extractFood(atwater)?.per100g.kcal).toBe(90);
  });
});

describe("extractSearchHit (search format)", () => {
  it("reads nutrientId + value, with the same energy fallback and clamping", () => {
    const hit = searchHits("foundationAndSr", "chicken breast").find((h) => h.fdcId === 2727569);
    expect(extractSearchHit(hit)).toEqual({
      fdcId: 2727569,
      description: "Chicken, breast, meat and skin, raw",
      dataType: "Foundation",
      brand: null,
      per100g: { kcal: 133, protein: 21.4, carbs: 0, fat: 4.78 },
      portions: [],
    });
  });

  it("keeps a Branded hit's brand and label serving", () => {
    const [hit] = searchHits("branded", "chobani");
    expect(extractSearchHit(hit)).toMatchObject({
      fdcId: 9900001,
      brand: "CHOBANI",
      per100g: { kcal: 58.8, protein: 10, carbs: 3.53, fat: 0 },
      portions: [{ amount: 1, gramWeight: 170, unitName: "serving", description: "1 container" }],
    });
  });

  it("can read every hit in the search fixtures", () => {
    for (const scope of ["foundationAndSr", "branded"] as const) {
      for (const response of Object.values(searchFile[scope] as Record<string, { foods: Json[] }>)) {
        for (const hit of response.foods) expect(extractSearchHit(hit), String(hit.fdcId)).not.toBeNull();
      }
    }
  });
});

describe("nutritionFor", () => {
  it("scales per-100 g values and rounds each to 1 decimal", () => {
    const roasted = extractFood(raw(171477))!;
    // One breast (172 g): 165 * 1.72 = 283.8, 31 * 1.72 = 53.32, 3.57 * 1.72 = 6.14.
    expect(nutritionFor(roasted.per100g, 172)).toEqual({ calories: 283.8, proteinG: 53.3, carbsG: 0, fatG: 6.1 });
  });

  it("handles small and zero amounts", () => {
    const per100g = { kcal: 884, protein: 0, carbs: 0, fat: 100 };
    expect(nutritionFor(per100g, 13.5)).toEqual({ calories: 119.3, proteinG: 0, carbsG: 0, fatG: 13.5 });
    expect(nutritionFor(per100g, 0)).toEqual({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  });
});
