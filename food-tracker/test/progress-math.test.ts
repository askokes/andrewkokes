import { describe, expect, it } from "vitest";
import type { DaySummary, WeightEntry } from "../src/food/types";
import { greeting, loggedStreak, macroCalories, movingAverage, periodStats, summarySentence } from "../web/src/progress";

const day = (date: string, calories: number, entries = calories > 0 ? 1 : 0, proteinG = 0): DaySummary => ({
  date, calories, proteinG, carbsG: 0, fatG: 0, entries, goal: { calories: 2000, proteinG: 120, carbsG: null, fatG: null, baselineCalories: null },
});
const w = (date: string, weightLb: number): WeightEntry => ({ id: 0, date, weightLb });
const dates = (n: number, end = "2026-10-11") =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(`${end}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (n - 1 - i));
    return d.toISOString().slice(0, 10);
  });

describe("movingAverage", () => {
  it("averages the weigh-ins in each 7-day window, using ones before the chart starts", () => {
    const ds = dates(3);
    const avg = movingAverage(ds, [w("2026-10-03", 182), w("2026-10-09", 180), w("2026-10-11", 179)]);
    // Oct 9 window (Oct 3-9): 182 and 180. Oct 10 window (Oct 4-10): only 180. Oct 11: 180 and 179.
    expect(avg).toEqual([181, 180, 179.5]);
  });

  it("is null where a window has no weigh-ins", () => {
    expect(movingAverage(dates(2), [])).toEqual([null, null]);
  });
});

describe("periodStats", () => {
  it("averages only logged days and measures the trend on the 7-day average", () => {
    const ds = dates(7);
    const days = ds.map((d, i) => day(d, i === 2 ? 0 : 1800 + i * 10, undefined, 100));
    const stats = periodStats(days, [182, 181.8, null, 181.5, 181.2, 181, 180.7]);
    expect(stats.daysLogged).toBe(6);
    expect(stats.avgCalories).toBe(Math.round((1800 + 1810 + 1830 + 1840 + 1850 + 1860) / 6));
    expect(stats.avgProtein).toBe(100);
    expect(stats.weightChange).toBe(-1.3);
    expect(stats.goalCalories).toBe(2000);
  });

  it("won't call a trend from averages less than 3 days apart", () => {
    const stats = periodStats(dates(3).map((d) => day(d, 1500)), [null, 180, 179]);
    expect(stats.weightChange).toBeNull();
  });

  it("handles a period with nothing logged", () => {
    const stats = periodStats(dates(7).map((d) => day(d, 0)), Array(7).fill(null));
    expect(stats).toMatchObject({ avgCalories: null, daysLogged: 0, weightChange: null });
  });
});

describe("summarySentence", () => {
  const base = { avgCalories: 1846, avgProtein: 110, daysLogged: 6, days: 7, goalCalories: 2000, goalProtein: 120, baselineCalories: null };
  it("talks about the 7-day average and the intake, calmly", () => {
    expect(summarySentence({ ...base, weightChange: -1.2 }, "month", true)).toBe(
      "Your 7-day average weight is down 1.2 lb over the last 30 days. You averaged 1,846 cal a day on the 6 days you logged.",
    );
    expect(summarySentence({ ...base, weightChange: 0.1 }, "week", true)).toMatch(/^Your 7-day average weight held steady this week\./);
    expect(summarySentence({ ...base, weightChange: null }, "week", true)).toMatch(/Log your weight a few times/);
    expect(summarySentence({ ...base, weightChange: -3 }, "week", false)).toBe("You averaged 1,846 cal a day on the 6 days you logged.");
    expect(summarySentence({ ...base, daysLogged: 0, avgCalories: null, weightChange: null }, "week", true)).toMatch(/^Log a few days/);
  });

  it("compares the average to what the user burns, when they've set it", () => {
    expect(summarySentence({ ...base, weightChange: null, baselineCalories: 2500 }, "week", false)).toBe(
      "You averaged 1,846 cal a day on the 6 days you logged. That's about 650 below what you burn.",
    );
    expect(summarySentence({ ...base, avgCalories: 2620, weightChange: null, baselineCalories: 2500 }, "week", false)).toMatch(/about 120 above what you burn\.$/);
    expect(summarySentence({ ...base, avgCalories: 2480, weightChange: null, baselineCalories: 2500 }, "week", false)).toMatch(/about even with what you burn\.$/);
  });
});

describe("macroCalories", () => {
  const withMacros = (calories: number, proteinG: number, carbsG: number, fatG: number) => ({ ...day("2026-10-11", calories), proteinG, carbsG, fatG });

  it("uses 4, 4 and 9 calories per gram", () => {
    expect(macroCalories(withMacros(165, 10, 20, 5))).toEqual({ protein: 40, carbs: 80, fat: 45, other: 0 });
  });

  it("puts what the macros don't account for in other, so the bar is the day's calories", () => {
    // A 1,500 cal dinner typed in with calories only, on top of 165 cal with macros.
    expect(macroCalories(withMacros(1665, 10, 20, 5))).toEqual({ protein: 40, carbs: 80, fat: 45, other: 1500 });
    // Calories only, all day.
    expect(macroCalories(withMacros(600, 0, 0, 0))).toEqual({ protein: 0, carbs: 0, fat: 0, other: 600 });
  });

  it("scales the macros to the total when they're only a few percent off", () => {
    const s = macroCalories(withMacros(160, 10, 20, 5)); // macros say 165
    expect(s.other).toBe(0);
    expect(s.protein + s.carbs + s.fat).toBeCloseTo(160, 6);
    const under = macroCalories(withMacros(170, 10, 20, 5)); // 5 short of 170: rounding, not a missing food
    expect(under.other).toBe(0);
    expect(under.protein + under.carbs + under.fat).toBeCloseTo(170, 6);
  });

  it("leaves a gap under 10% out of other, and shows one over it", () => {
    // 6 oz chicken breast: about 52 g protein and 6 g fat is 262 by 4 / 4 / 9, but USDA says 281.
    const chicken = macroCalories(withMacros(281, 52, 0, 6));
    expect(chicken.other).toBe(0);
    expect(chicken.protein + chicken.fat).toBeCloseTo(281, 6);
    // 165 with macros plus a 25 cal calories-only food: 13% of the day.
    expect(macroCalories(withMacros(190, 10, 20, 5)).other).toBe(25);
  });
});

describe("loggedStreak", () => {
  const days = (logged: boolean[]) => logged.map((l, i) => day(`2026-10-${String(i + 1).padStart(2, "0")}`, l ? 1500 : 0));

  it("counts back from today when today is logged", () => {
    expect(loggedStreak(days([false, true, true, true]), "2026-10-04")).toBe(3);
  });

  it("counts back from yesterday while today is still empty", () => {
    expect(loggedStreak(days([true, true, true, false]), "2026-10-04")).toBe(3);
  });

  it("is zero after a missed day", () => {
    expect(loggedStreak(days([true, true, false, false]), "2026-10-04")).toBe(0);
  });
});

describe("greeting", () => {
  it("follows the clock and uses the first name", () => {
    expect(greeting(8, "Emma Kokes")).toBe("Good morning, Emma");
    expect(greeting(13, "Emma")).toBe("Good afternoon, Emma");
    expect(greeting(19, "Emma")).toBe("Good evening, Emma");
    expect(greeting(2, "Emma")).toBe("Hi, Emma");
    expect(greeting(8, "  ")).toBe("Good morning!");
  });
});
