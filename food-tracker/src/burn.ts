// The calories a person burns in a normal day (their "baseline"), worked out
// from sex, age, weight and activity, with height when they give it. Shared by
// the Worker (charts, the day's totals) and the app (the live estimate on the
// Goals tab), so both always agree.
//
// Resting calories: Mifflin-St Jeor when height is known and the person is an
// adult (what most calculators use); otherwise the WHO/FAO/UNU equations,
// which need only weight, age and sex and also cover 10 to 17 year olds. Then
// times the usual activity factor, rounded to the nearest 10.

export type Sex = "male" | "female";
export type Activity = "sedentary" | "light" | "moderate" | "very" | "extra";

export const ACTIVITY_LEVELS: readonly { value: Activity; label: string; factor: number }[] = [
  { value: "sedentary", label: "Mostly sitting", factor: 1.2 },
  { value: "light", label: "Light: 1 to 3 workouts a week", factor: 1.375 },
  { value: "moderate", label: "Active: 3 to 5 workouts a week", factor: 1.55 },
  { value: "very", label: "Very active: 6 or 7 a week", factor: 1.725 },
  { value: "extra", label: "Extra active: physical job", factor: 1.9 },
];

export const isSex = (v: unknown): v is Sex => v === "male" || v === "female";
export const isActivity = (v: unknown): v is Activity => ACTIVITY_LEVELS.some((a) => a.value === v);

/** Everything but weight, as kept on the profile. Any null means there's no estimate. */
export interface BurnProfile {
  sex: Sex | null;
  birthYear: number | null;
  /** Optional: makes the estimate a little closer for adults. */
  heightIn: number | null;
  activity: Activity | null;
}

const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;

/** WHO/FAO/UNU (1985) resting calories by age band: [up to age, per kg, plus]. */
const WHO: Record<Sex, [number, number, number][]> = {
  male: [
    [9, 22.7, 495],
    [17, 17.5, 651],
    [29, 15.3, 679],
    [59, 11.6, 879],
    [Infinity, 13.5, 487],
  ],
  female: [
    [9, 22.5, 499],
    [17, 12.2, 746],
    [29, 14.7, 496],
    [59, 8.7, 829],
    [Infinity, 10.5, 596],
  ],
};

/** Calories burned at rest in a day. */
export function restingCalories(sex: Sex, age: number, weightLb: number, heightIn: number | null): number {
  const kg = weightLb * KG_PER_LB;
  if (heightIn !== null && age >= 18) {
    return 10 * kg + 6.25 * heightIn * CM_PER_IN - 5 * age + (sex === "male" ? 5 : -161);
  }
  const [, perKg, plus] = WHO[sex].find(([upTo]) => age <= upTo)!;
  return perKg * kg + plus;
}

/** Age on a day, from the birth year: close enough for an estimate. */
export const ageOn = (birthYear: number, date: string) => Number(date.slice(0, 4)) - birthYear;

/**
 * Calories burned in a normal day, to the nearest 10, or null when something
 * it needs is missing (sex, age, activity or a weight).
 */
export function caloriesBurned(p: BurnProfile, weightLb: number | null, date: string): number | null {
  if (!p.sex || p.birthYear === null || !p.activity || weightLb === null || !(weightLb > 0)) return null;
  const factor = ACTIVITY_LEVELS.find((a) => a.value === p.activity)!.factor;
  const resting = restingCalories(p.sex, ageOn(p.birthYear, date), weightLb, p.heightIn);
  return Math.round((resting * factor) / 10) * 10;
}

/**
 * The weight the estimate uses on a day: the average of the weigh-ins in the
 * 7 days ending then (so one heavy morning doesn't move it), else the last one
 * before, else the first one after. `weights` are sorted by date.
 */
export function weightOn(weights: readonly { date: string; weightLb: number }[], date: string): number | null {
  if (!weights.length) return null;
  const from = shiftDays(date, -6);
  const recent = weights.filter((w) => w.date >= from && w.date <= date);
  if (recent.length) return recent.reduce((s, w) => s + w.weightLb, 0) / recent.length;
  const before = weights.filter((w) => w.date < date);
  return (before.at(-1) ?? weights[0]).weightLb;
}

function shiftDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
