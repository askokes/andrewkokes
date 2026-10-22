import type { EntryView } from "../../src/food/types";

/**
 * Food balance: each food sorted by how many calories it packs per gram (energy density). Light foods
 * (vegetables, fruit, soup, lean protein cooked in water) fill you up for few calories; rich ones (oils,
 * nuts, cheese, sweets, chips) pack a lot into a little. Nothing is "bad": a day with some of each is
 * fine, and the card only nudges toward more light foods when there are few.
 *
 * Bands are the usual energy-density ones: under 1 cal/g, 1 to 2.4, over 2.4.
 */
export type Band = "light" | "moderate" | "rich";

export const BANDS: readonly { key: Band; label: string; color: string; example: string }[] = [
  { key: "light", label: "Light", color: "--light", example: "vegetables, fruit, soup" },
  { key: "moderate", label: "Moderate", color: "--moderate", example: "grains, lean meat, eggs" },
  { key: "rich", label: "Rich", color: "--rich", example: "cheese, nuts, sweets, oils" },
] as const;

// Drinks are mostly water, so by weight even soda and juice look light. With calories, they count as
// moderate at least; near zero (water, black coffee, diet soda, tea) stays light.
const DRINK = /\b(beverage|drink|soda|cola|pop|juice|beer|wine|liquor|spirits|cocktail|latte|cappuccino|mocha|frappuccino|smoothie|shake|lemonade|sweet tea|energy drink|sports drink|kombucha)\b/i;

/** The band for a food, or null when it has no weight to judge by. */
export function bandFor(e: Pick<EntryView, "grams" | "noWeight" | "foodName" | "usdaName"> & { nutrition: { calories: number } }): Band | null {
  if (e.noWeight || !(e.grams > 0)) return null;
  const density = e.nutrition.calories / e.grams;
  if (DRINK.test(`${e.foodName} ${e.usdaName ?? ""}`)) return density < 0.1 ? "light" : density > 2.4 ? "rich" : "moderate";
  if (density < 1) return "light";
  if (density <= 2.4) return "moderate";
  return "rich";
}

export interface Balance {
  /** Calories in each band. */
  calories: Record<Band, number>;
  /** Calories from foods with no weight (some restaurant items), left out of the shares. */
  unknown: number;
  /** Whole-number shares of the judged calories, summing to 100 (or all 0 when nothing is judged). */
  pct: Record<Band, number>;
}

export function dayBalance(entries: readonly EntryView[]): Balance {
  const calories: Record<Band, number> = { light: 0, moderate: 0, rich: 0 };
  let unknown = 0;
  for (const e of entries) {
    const band = bandFor(e);
    if (band) calories[band] += e.nutrition.calories;
    else unknown += e.nutrition.calories;
  }
  const total = calories.light + calories.moderate + calories.rich;
  const pct: Record<Band, number> = { light: 0, moderate: 0, rich: 0 };
  if (total > 0) {
    // Largest remainder, so the three always add up to exactly 100.
    const raw = BANDS.map((b) => ({ key: b.key, v: (calories[b.key] / total) * 100 }));
    for (const r of raw) pct[r.key] = Math.floor(r.v);
    let short = 100 - (pct.light + pct.moderate + pct.rich);
    for (const r of [...raw].sort((a, b) => (b.v % 1) - (a.v % 1))) {
      if (short-- <= 0) break;
      pct[r.key] += 1;
    }
  }
  return { calories, unknown, pct };
}

/** One calm sentence about the day's balance. Never a scolding: light foods are the only nudge. */
export function balanceSentence(b: Balance): string {
  const judged = b.calories.light + b.calories.moderate + b.calories.rich;
  if (judged <= 0) return "Log a food to see the balance of your day.";
  if (b.pct.light >= 30) return "Nice balance. Light foods are doing a lot of the filling up today.";
  if (b.pct.rich >= 50) return "Mostly rich foods so far. A side of vegetables, fruit or soup fills you up for far fewer calories.";
  return "A few more light foods, like vegetables, fruit or soup, would stretch your calories further.";
}
