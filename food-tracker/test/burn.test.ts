import { describe, expect, it } from "vitest";
import { caloriesBurned, restingCalories, weightOn, type BurnProfile } from "../src/burn";

const profile = (p: Partial<BurnProfile>): BurnProfile => ({ sex: "male", birthYear: 1976, heightIn: null, activity: "light", ...p });

describe("caloriesBurned", () => {
  it("uses WHO/FAO with no height: a 50-year-old man of 180 lb, lightly active", () => {
    // 11.6 x 81.6 kg + 879 = 1,826 at rest, x 1.375
    expect(caloriesBurned(profile({}), 180, "2026-10-11")).toBe(2510);
  });

  it("uses Mifflin-St Jeor for an adult whose height is known", () => {
    // 10 x 81.6 kg + 6.25 x 177.8 cm - 5 x 50 + 5 = 1,683 at rest, x 1.375
    expect(caloriesBurned(profile({ heightIn: 70 }), 180, "2026-10-11")).toBe(2310);
  });

  it("uses WHO/FAO for a teenager even with a height", () => {
    // 16-year-old girl, 120 lb: 12.2 x 54.4 kg + 746 = 1,410 at rest, x 1.55
    expect(caloriesBurned(profile({ sex: "female", birthYear: 2010, heightIn: 64, activity: "moderate" }), 120, "2026-10-11")).toBe(2190);
  });

  it("goes up with activity and down with age", () => {
    const at = (p: Partial<BurnProfile>) => caloriesBurned(profile(p), 180, "2026-10-11")!;
    expect(at({ activity: "sedentary" })).toBeLessThan(at({ activity: "light" }));
    expect(at({ activity: "extra" })).toBeGreaterThan(at({ activity: "very" }));
    expect(restingCalories("female", 40, 150, 65)).toBeLessThan(restingCalories("female", 30, 150, 65));
  });

  it("has no estimate until sex, age, activity and weight are all known", () => {
    expect(caloriesBurned(profile({ sex: null }), 180, "2026-10-11")).toBeNull();
    expect(caloriesBurned(profile({ birthYear: null }), 180, "2026-10-11")).toBeNull();
    expect(caloriesBurned(profile({ activity: null }), 180, "2026-10-11")).toBeNull();
    expect(caloriesBurned(profile({}), null, "2026-10-11")).toBeNull();
  });
});

describe("weightOn", () => {
  const weights = [
    { date: "2026-10-01", weightLb: 184 },
    { date: "2026-10-08", weightLb: 181 },
    { date: "2026-10-10", weightLb: 179 },
  ];
  it("averages the last week's weigh-ins", () => {
    expect(weightOn(weights, "2026-10-10")).toBe(180);
  });
  it("uses the last one before when the week has none, and the first one for days before any", () => {
    expect(weightOn(weights, "2026-10-07")).toBe(184);
    expect(weightOn(weights, "2026-09-20")).toBe(184);
    expect(weightOn([], "2026-10-10")).toBeNull();
  });
});
