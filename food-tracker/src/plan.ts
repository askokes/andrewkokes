// A weight plan: how much to eat a day to lose or gain weight at a chosen pace,
// built on the calories burned in a day (burn.ts). Shared by the Goals tab
// (worked out live as you type) and the tests.
//
// The usual rule of thumb: a pound of body weight is about 3,500 calories, so
// losing a pound a week means eating about 500 a day under what you burn. The
// pace is capped at what's generally considered safe, and calories never go
// under the floor most guidance gives for adults without a doctor's help.

import type { Sex } from "./burn";

export type PlanGoal = "lose" | "keep" | "gain";
export type PlanPer = "week" | "month";

export const PLAN_GOALS: readonly PlanGoal[] = ["lose", "keep", "gain"];
export const isPlanGoal = (v: unknown): v is PlanGoal => PLAN_GOALS.includes(v as PlanGoal);
export const isPlanPer = (v: unknown): v is PlanPer => v === "week" || v === "month";

export const KCAL_PER_LB = 3500;
/** An average month: 30.44 days. */
export const WEEKS_PER_MONTH = 30.44 / 7;
/** Most to lose in a week: 2 lb, and never more than 1% of body weight. */
export const MAX_LOSS_LB_WEEK = 2;
export const MAX_LOSS_SHARE_WEEK = 0.01;
/** Most to gain in a week. */
export const MAX_GAIN_LB_WEEK = 1;
/** The least most adults should eat in a day without a doctor's help. */
export const MIN_CALORIES: Record<Sex, number> = { female: 1200, male: 1500 };
/** Protein per pound of body weight (Andrew's call: 1 g a pound). */
export const PROTEIN_G_PER_LB = 1;
/** Protein never more than this share of calories, fat this share. Carbs are the rest. */
export const MAX_PROTEIN_SHARE = 0.4;
export const FAT_SHARE = 0.3;
/** A goal weight further off than this at the chosen pace gets no date. */
const MAX_WEEKS_TO_GOAL = 5 * 52;

export interface PlanInput {
  goal: PlanGoal;
  /** Pounds per `per`. Ignored when keeping weight steady. */
  lb: number | null;
  per: PlanPer;
  /** Calories burned in a normal day (caloriesBurned). */
  burned: number;
  weightLb: number;
  goalWeightLb: number | null;
  sex: Sex;
  age: number;
  /** YYYY-MM-DD, for the date the goal weight is reached. */
  today: string;
}

export interface Plan {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** Pounds a week this plan works out to, after any cap or floor: negative to lose. */
  weeklyLb: number;
  /** Calories a day under (negative) or over what's burned. */
  dailyChange: number;
  /** Plain sentences about anything that was adjusted. */
  notes: string[];
  /** YYYY-MM-DD the goal weight is reached at this pace, when there's one to reach. */
  reachBy: string | null;
}

export type PlanResult = { ok: true; plan: Plan } | { ok: false; reason: string };

const round5 = (n: number) => Math.round(n / 5) * 5;
const round10 = (n: number) => Math.round(n / 10) * 10;
/** "1.5", "2", "0.8": pounds for a sentence. */
export const lbText = (n: number) => String(Math.round(n * 10) / 10);

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Daily calories and macros for a plan, or why there's no plan to show. */
export function weightPlan(input: PlanInput): PlanResult {
  const { goal, sex, weightLb, burned } = input;
  if (goal === "lose" && input.age < 18) {
    return { ok: false, reason: "For anyone under 18, a weight-loss goal is best set with a doctor. Keeping your weight steady is fine to plan here." };
  }
  const floor = MIN_CALORIES[sex];
  if (goal === "lose" && burned - floor < 100) {
    return { ok: false, reason: `What you burn is already close to ${floor.toLocaleString("en-US")} cal a day, the least most adults should eat, so a weight-loss plan is best made with a doctor.` };
  }

  const notes: string[] = [];
  let weekly = 0;
  if (goal !== "keep") {
    if (input.lb === null || !(input.lb > 0)) return { ok: false, reason: "Type how many pounds." };
    weekly = input.per === "week" ? input.lb : input.lb / WEEKS_PER_MONTH;
    const max = goal === "lose" ? Math.min(MAX_LOSS_LB_WEEK, weightLb * MAX_LOSS_SHARE_WEEK) : MAX_GAIN_LB_WEEK;
    if (weekly > max + 1e-9) {
      weekly = max;
      notes.push(
        goal === "lose"
          ? `We kept it to ${lbText(max)} lb a week, about the most that's safe to lose.`
          : `We kept it to ${lbText(max)} lb a week, about the most that's useful to gain.`,
      );
    }
  }

  const sign = goal === "lose" ? -1 : 1;
  let calories = round10(burned + (sign * weekly * KCAL_PER_LB) / 7);
  // Only a loss plan eats under what's burned, so only it can go under the floor.
  if (goal === "lose" && calories < floor) {
    calories = floor;
    weekly = ((burned - calories) * 7) / KCAL_PER_LB;
    notes.push(`We kept it at ${floor.toLocaleString("en-US")} cal a day, the least most adults should eat without a doctor's help. That's about ${lbText(weekly)} lb a week.`);
  }
  const weeklyLb = goal === "keep" ? 0 : sign * weekly;

  // Protein by body weight, fat a share of calories, carbs the rest.
  const proteinG = round5(Math.min(PROTEIN_G_PER_LB * weightLb, (MAX_PROTEIN_SHARE * calories) / 4));
  const fatG = round5((FAT_SHARE * calories) / 9);
  const carbsG = Math.max(0, round5((calories - proteinG * 4 - fatG * 9) / 4));

  let reachBy: string | null = null;
  const g = input.goalWeightLb;
  if (g !== null && weekly > 0 && ((goal === "lose" && g < weightLb) || (goal === "gain" && g > weightLb))) {
    const weeks = Math.abs(weightLb - g) / weekly;
    if (weeks <= MAX_WEEKS_TO_GOAL) reachBy = addDays(input.today, Math.ceil(weeks * 7));
  }

  return { ok: true, plan: { calories, proteinG, carbsG, fatG, weeklyLb, dailyChange: calories - burned, notes, reachBy } };
}
