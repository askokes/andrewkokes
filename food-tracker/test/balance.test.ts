import { describe, expect, it } from "vitest";
import type { EntryView } from "../src/food/types";
import { balanceSentence, bandFor, dayBalance } from "../web/src/balance";

const food = (foodName: string, grams: number, calories: number, extra: Partial<EntryView> = {}): EntryView =>
  ({ foodName, grams, nutrition: { calories, proteinG: 0, carbsG: 0, fatG: 0 }, usdaName: null, ...extra }) as EntryView;

describe("bandFor", () => {
  it.each([
    ["Broccoli", 91, 31, "light"],
    ["Apple", 182, 95, "light"],
    ["Rice", 158, 205, "moderate"],
    ["Chicken breast", 172, 284, "moderate"],
    ["Cheddar cheese", 28, 115, "rich"],
    ["Almonds", 28, 164, "rich"],
  ])("%s is %s", (name, grams, cal, band) => {
    expect(bandFor(food(name, grams, cal))).toBe(band);
  });

  it("counts drinks with calories as moderate, and near-zero ones as light", () => {
    expect(bandFor(food("Coke", 355, 140, { usdaName: "Beverages, carbonated, cola" }))).toBe("moderate");
    expect(bandFor(food("Orange juice", 248, 112))).toBe("moderate");
    expect(bandFor(food("Black coffee", 240, 2, { usdaName: "Beverages, coffee, brewed" }))).toBe("light");
  });

  it("skips foods with no weight", () => {
    expect(bandFor(food("Big Mac", 0, 590, { noWeight: true }))).toBeNull();
    expect(bandFor(food("Typed in", 0, 300))).toBeNull();
  });
});

describe("dayBalance", () => {
  it("splits calories by band, shares add up to 100, unweighed foods set aside", () => {
    const b = dayBalance([food("Broccoli", 200, 100), food("Rice", 100, 130), food("Almonds", 10, 58), food("Big Mac", 0, 590, { noWeight: true })]);
    expect(b.calories).toEqual({ light: 100, moderate: 130, rich: 58 });
    expect(b.unknown).toBe(590);
    expect(b.pct.light + b.pct.moderate + b.pct.rich).toBe(100);
    expect(b.pct).toEqual({ light: 35, moderate: 45, rich: 20 });
  });

  it("is all zero for an empty day", () => {
    expect(dayBalance([]).pct).toEqual({ light: 0, moderate: 0, rich: 0 });
  });
});

describe("balanceSentence", () => {
  it("praises a day with plenty of light foods and nudges otherwise, never scolds", () => {
    expect(balanceSentence(dayBalance([food("Broccoli", 300, 100), food("Rice", 100, 130)]))).toMatch(/^Nice balance/);
    expect(balanceSentence(dayBalance([food("Almonds", 50, 290), food("Rice", 100, 130)]))).toMatch(/^Mostly rich/);
    expect(balanceSentence(dayBalance([food("Rice", 100, 130)]))).toMatch(/light foods/);
    expect(balanceSentence(dayBalance([]))).toMatch(/^Log a food/);
  });
});
