// Dashboard math, kept free of DOM and Chart.js so it can be unit tested.
import type { DaySummary, WeightEntry } from "../../src/food/types";

export type Period = "today" | "week" | "month";
export const PERIOD_DAYS: Record<Exclude<Period, "today">, number> = { week: 7, month: 30 };

/** Days in a 7-day average window: the day itself and the 6 before it. */
export const AVG_WINDOW = 7;

const round1 = (n: number) => Math.round(n * 10) / 10;

function shift(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The 7-day average weight on each date: the mean of the weigh-ins from that
 * day and the 6 before it, or null when there were none. `weights` may start
 * before `dates` so the first days of a chart still have a full window.
 */
export function movingAverage(dates: string[], weights: WeightEntry[]): (number | null)[] {
  const byDate = new Map(weights.map((w) => [w.date, w.weightLb]));
  return dates.map((date) => {
    const window: number[] = [];
    for (let i = 0; i < AVG_WINDOW; i++) {
      const w = byDate.get(shift(date, -i));
      if (w !== undefined) window.push(w);
    }
    return window.length ? round1(window.reduce((a, b) => a + b, 0) / window.length) : null;
  });
}

export interface PeriodStats {
  /** Mean calories over the days that have anything logged; null when none do. */
  avgCalories: number | null;
  avgProtein: number | null;
  daysLogged: number;
  days: number;
  /** Change in the 7-day average from the first day it exists to the last; null without enough data. */
  weightChange: number | null;
  /** The goal in effect on the last day, for "of 2,000 cal". */
  goalCalories: number | null;
  goalProtein: number | null;
  /** The calories the user burns in a normal day, as set on the last day; null when not set. */
  baselineCalories: number | null;
}

/**
 * Trend rule (SPEC section 10): weight talk always uses the 7-day average over
 * several days, never one day's swing. The change needs two averages at least
 * 3 days apart.
 */
export function periodStats(days: DaySummary[], averages: (number | null)[]): PeriodStats {
  const logged = days.filter((d) => d.entries > 0);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const avgCalories = mean(logged.map((d) => d.calories));
  const avgProtein = mean(logged.map((d) => d.proteinG));

  const firstIdx = averages.findIndex((a) => a !== null);
  let lastIdx = -1;
  for (let i = averages.length - 1; i >= 0; i--) if (averages[i] !== null) { lastIdx = i; break; }
  const weightChange = firstIdx >= 0 && lastIdx - firstIdx >= 3 ? round1(averages[lastIdx]! - averages[firstIdx]!) : null;

  const last = days.at(-1)?.goal ?? null;
  return {
    avgCalories: avgCalories === null ? null : Math.round(avgCalories),
    avgProtein: avgProtein === null ? null : Math.round(avgProtein),
    daysLogged: logged.length,
    days: days.length,
    weightChange,
    goalCalories: last?.calories ?? null,
    goalProtein: last?.proteinG ?? null,
    baselineCalories: last?.baselineCalories ?? null,
  };
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** One calm, plain sentence about the period. Never about a single day. */
export function summarySentence(stats: PeriodStats, period: Exclude<Period, "today">, trackWeight: boolean): string {
  const span = period === "week" ? "this week" : "over the last 30 days";
  if (stats.daysLogged === 0) return "Log a few days of food to see your progress here.";
  let intake = `You averaged ${fmt(stats.avgCalories!)} cal a day on the ${stats.daysLogged === 1 ? "day" : `${stats.daysLogged} days`} you logged.`;
  if (stats.baselineCalories) {
    // Against what they burn, so a goal set below it doesn't hide eating above it.
    const diff = Math.round((stats.avgCalories! - stats.baselineCalories) / 10) * 10;
    intake += Math.abs(diff) < 50 ? " That's about even with what you burn." : ` That's about ${fmt(Math.abs(diff))} ${diff < 0 ? "below" : "above"} what you burn.`;
  }
  if (!trackWeight) return intake;
  if (stats.weightChange === null) return `${intake} Log your weight a few times to see your trend.`;
  const change = stats.weightChange;
  const weight =
    Math.abs(change) < 0.2
      ? `Your 7-day average weight held steady ${span}.`
      : `Your 7-day average weight is ${change < 0 ? "down" : "up"} ${Math.abs(change)} lb ${span}.`;
  return `${weight} ${intake}`;
}

/** Calories from each macro, for the stacked bars (4 / 4 / 9 cal per gram). */
export function macroCalories(d: DaySummary) {
  return { protein: d.proteinG * 4, carbs: d.carbsG * 4, fat: d.fatG * 9 };
}

export { shift as shiftDate };

/**
 * Days logged in a row, ending today, or yesterday while today is still empty
 * (so the count doesn't vanish each morning before breakfast is logged).
 * `days` is in date order and ends on `today`.
 */
export function loggedStreak(days: DaySummary[], today: string): number {
  const logged = new Set(days.filter((d) => d.entries > 0).map((d) => d.date));
  let date = logged.has(today) ? today : shift(today, -1);
  let count = 0;
  while (logged.has(date)) {
    count++;
    date = shift(date, -1);
  }
  return count;
}

/** Morning, afternoon or evening, from the hour on the phone. */
export function greeting(hour: number, displayName: string): string {
  const part = hour < 5 ? "Hi" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const first = displayName.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : `${part}!`;
}
