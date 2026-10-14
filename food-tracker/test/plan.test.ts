import { describe, expect, it } from "vitest";
import { weightPlan, type PlanInput } from "../src/plan";

const andrew: PlanInput = { goal: "lose", lb: 1, per: "week", burned: 2400, weightLb: 180, goalWeightLb: null, sex: "male", age: 52, today: "2026-10-14" };
const planOf = (changes: Partial<PlanInput>) => {
  const r = weightPlan({ ...andrew, ...changes });
  if (!r.ok) throw new Error(r.reason);
  return r.plan;
};

describe("weight plan", () => {
  it("eats 500 a day under what's burned to lose a pound a week, with macros to match", () => {
    expect(planOf({})).toEqual({
      calories: 1900,
      // 0.8 g a pound (144), fat 30% of calories (63), carbs the rest.
      proteinG: 145,
      fatG: 65,
      carbsG: 185,
      weeklyLb: -1,
      dailyChange: -500,
      notes: [],
      reachBy: null,
    });
  });

  it("takes pounds a month too", () => {
    const p = planOf({ lb: 4, per: "month" });
    expect(p.weeklyLb).toBeCloseTo(-4 / (30.44 / 7), 5);
    expect(p.calories).toBe(1940);
  });

  it("keeps the pace to 2 lb a week and 1% of body weight", () => {
    const fast = planOf({ lb: 3 });
    expect(fast.weeklyLb).toBeCloseTo(-1.8, 5);
    expect(fast.notes).toEqual(["We kept it to 1.8 lb a week, about the most that's safe to lose."]);
    const heavy = planOf({ lb: 3, weightLb: 300, burned: 3200 });
    expect(heavy.weeklyLb).toBe(-2);
    expect(heavy.calories).toBe(2200);
    expect(planOf({ goal: "gain", lb: 2 }).weeklyLb).toBe(1);
  });

  it("never goes under 1,200 cal (women) or 1,500 (men), and says what that does to the pace", () => {
    const p = planOf({ sex: "female", burned: 1700, weightLb: 150, lb: 1.5 });
    expect(p.calories).toBe(1200);
    expect(p.weeklyLb).toBeCloseTo(-1, 5);
    expect(p.notes).toEqual(["We kept it at 1,200 cal a day, the least most adults should eat without a doctor's help. That's about 1 lb a week."]);
    expect(planOf({ burned: 1800, lb: 1 }).calories).toBe(1500);
  });

  it("offers no loss plan to anyone under 18, or when there's no room under the floor", () => {
    expect(weightPlan({ ...andrew, age: 15 })).toMatchObject({ ok: false, reason: expect.stringMatching(/under 18/) });
    expect(weightPlan({ ...andrew, age: 15, goal: "keep" }).ok).toBe(true);
    expect(weightPlan({ ...andrew, sex: "female", burned: 1250 })).toMatchObject({ ok: false, reason: expect.stringMatching(/doctor/) });
    // Keeping weight steady on little is just eating what's burned.
    expect(planOf({ goal: "keep", sex: "female", burned: 1250 }).calories).toBe(1250);
  });

  it("asks for pounds unless keeping weight steady", () => {
    expect(weightPlan({ ...andrew, lb: null })).toEqual({ ok: false, reason: "Type how many pounds." });
    expect(weightPlan({ ...andrew, lb: 0 }).ok).toBe(false);
    expect(planOf({ goal: "keep", lb: null })).toMatchObject({ calories: 2400, weeklyLb: 0, dailyChange: 0 });
  });

  it("gains by eating over what's burned", () => {
    expect(planOf({ goal: "gain", lb: 0.5 })).toMatchObject({ calories: 2650, weeklyLb: 0.5, dailyChange: 250 });
  });

  it("works out when the goal weight is reached, and sizes protein to it when losing", () => {
    const p = planOf({ goalWeightLb: 170 });
    expect(p.reachBy).toBe("2026-12-23"); // 10 lb at 1 lb a week: 70 days
    expect(p.proteinG).toBe(135); // 0.8 x 170 = 136
    expect(planOf({ goalWeightLb: 190 }).reachBy).toBeNull(); // losing away from it
    expect(planOf({ goal: "keep", goalWeightLb: 170 }).reachBy).toBeNull();
    expect(planOf({ goal: "gain", lb: 0.5, goalWeightLb: 185 }).reachBy).toBe("2026-12-23");
  });

  it("keeps protein to 35% of calories", () => {
    const p = planOf({ weightLb: 320, burned: 2000, lb: 1 });
    expect(p.calories).toBe(1500);
    expect(p.proteinG).toBe(130); // 0.35 x 1500 / 4 = 131, not 0.8 x 320 = 256
    expect(p.carbsG).toBeGreaterThan(0);
  });
});
