import { isActivity, isSex, type Activity, type Sex } from "./burn";
import { isPlanGoal, isPlanPer, type PlanGoal, type PlanPer } from "./plan";
import { isValidTimeZone } from "./dates";

export type FieldErrors = Record<string, string>;
export type Result<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

export interface GoalsInput {
  calories: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  goalWeightLb: number | null;
}

/** What the calories-burned estimate needs besides weight (see burn.ts). Each may be left blank. */
export interface BurnInput {
  sex: Sex | null;
  age: number | null;
  heightIn: number | null;
  activity: Activity | null;
}

/** The weight plan's choices (see plan.ts). */
export interface PlanChoice {
  goal: PlanGoal;
  lb: number | null;
  per: PlanPer;
}

export interface ProfileInput {
  displayName: string;
  timezone: string;
  trackWeight: boolean;
  goals: GoalsInput | null;
  /** Null when the body says nothing about it: what's saved stays. */
  burn: BurnInput | null;
  currentWeightLb: number | null;
  /** Undefined when the body says nothing about it: what's saved stays. Null clears it. */
  plan?: PlanChoice | null;
}

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const isBlank = (v: unknown) => v === undefined || v === null || v === "";

function wholeNumber(
  v: unknown,
  field: string,
  label: string,
  min: number,
  max: number,
  errors: FieldErrors,
): number | null {
  const n = typeof v === "string" ? Number(v.trim()) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    errors[field] = `${label} should be a whole number from ${min.toLocaleString("en-US")} to ${max.toLocaleString("en-US")}.`;
    return null;
  }
  return n;
}

function optionalWholeNumber(v: unknown, field: string, label: string, min: number, max: number, errors: FieldErrors) {
  return isBlank(v) ? null : wholeNumber(v, field, label, min, max, errors);
}

function optionalWeight(v: unknown, field: string, label: string, errors: FieldErrors): number | null {
  if (isBlank(v)) return null;
  const n = typeof v === "string" ? Number(v.trim()) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 50 || n > 1000) {
    errors[field] = `${label} should be between 50 and 1,000 lb.`;
    return null;
  }
  return Math.round(n * 10) / 10;
}

function readGoals(raw: unknown, errors: FieldErrors, prefix = ""): GoalsInput | null {
  if (!isObject(raw) || isBlank(raw.calories)) {
    errors[`${prefix}calories`] = "Daily calorie goal is required.";
    return null;
  }
  const calories = wholeNumber(raw.calories, `${prefix}calories`, "Daily calories", 1, 10000, errors);
  const proteinG = optionalWholeNumber(raw.proteinG, `${prefix}proteinG`, "Protein", 0, 1000, errors);
  const carbsG = optionalWholeNumber(raw.carbsG, `${prefix}carbsG`, "Carbs", 0, 1000, errors);
  const fatG = optionalWholeNumber(raw.fatG, `${prefix}fatG`, "Fat", 0, 1000, errors);
  const goalWeightLb = optionalWeight(raw.goalWeightLb, `${prefix}goalWeightLb`, "Goal weight", errors);
  return calories === null ? null : { calories, proteinG, carbsG, fatG, goalWeightLb };
}

export function parseGoals(raw: unknown): Result<GoalsInput> {
  const errors: FieldErrors = {};
  const goals = readGoals(raw, errors);
  return Object.keys(errors).length || !goals ? { ok: false, errors } : { ok: true, value: goals };
}

/** `requireGoals` is true when creating a profile: setup always asks for a calorie goal. */
export function parseProfile(raw: unknown, requireGoals: boolean): Result<ProfileInput> {
  const errors: FieldErrors = {};
  if (!isObject(raw)) return { ok: false, errors: { body: "Expected a JSON object." } };

  const displayName = typeof raw.displayName === "string" ? raw.displayName.trim().replace(/\s+/g, " ") : "";
  if (!displayName) errors.displayName = "Please enter a name.";
  else if (displayName.length > 50) errors.displayName = "Keep the name under 50 characters.";

  const timezone = typeof raw.timezone === "string" ? raw.timezone.trim() : "";
  if (!isValidTimeZone(timezone)) errors.timezone = "Please pick a time zone from the list.";

  if (typeof raw.trackWeight !== "boolean") errors.trackWeight = "trackWeight must be true or false.";
  const trackWeight = raw.trackWeight === true;

  let goals: GoalsInput | null = null;
  if (requireGoals || !isBlank(raw.goals)) goals = readGoals(raw.goals, errors, "goals.");

  // Today's weight, from the weight card, or (tracking off) for the calories-burned estimate.
  const currentWeightLb = optionalWeight(raw.currentWeightLb, "currentWeightLb", "Weight", errors);
  const burn = BURN_KEYS.some((k) => k in raw) ? readBurn(raw, errors) : null;
  const plan = "plan" in raw ? readPlan(raw.plan, errors) : undefined;

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { displayName, timezone, trackWeight, goals, burn, currentWeightLb, ...(plan === undefined ? {} : { plan }) } };
}

/** The weight plan: blank clears it; pounds may be left out until typed, and are kept to a sane range. */
function readPlan(raw: unknown, errors: FieldErrors): PlanChoice | null {
  if (isBlank(raw) || (isObject(raw) && isBlank(raw.goal))) return null;
  if (!isObject(raw) || !isPlanGoal(raw.goal)) {
    errors["plan.goal"] = "Pick lose, keep or gain.";
    return null;
  }
  const per = isBlank(raw.per) ? "week" : isPlanPer(raw.per) ? raw.per : ((errors["plan.per"] = "Pick a week or a month."), "week");
  let lb: number | null = null;
  if (!isBlank(raw.lb)) {
    const n = typeof raw.lb === "string" ? Number(raw.lb.trim()) : raw.lb;
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0 || n > 20) errors["plan.lb"] = "Pounds should be a number from 0.1 to 20.";
    else lb = Math.round(n * 10) / 10;
  }
  return { goal: raw.goal, lb, per };
}

const BURN_KEYS = ["sex", "age", "heightIn", "activity"] as const;

function readBurn(raw: Record<string, unknown>, errors: FieldErrors): BurnInput {
  const sex = isBlank(raw.sex) ? null : isSex(raw.sex) ? raw.sex : ((errors.sex = "Pick male or female."), null);
  const age = optionalWholeNumber(raw.age, "age", "Age", 10, 100, errors);
  let heightIn: number | null = null;
  if (!isBlank(raw.heightIn)) {
    const n = typeof raw.heightIn === "string" ? Number(raw.heightIn.trim()) : raw.heightIn;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 48 || n > 90) errors.heightIn = "Height should be between 4 and 7 1/2 feet.";
    else heightIn = Math.round(n * 10) / 10;
  }
  const activity = isBlank(raw.activity) ? null : isActivity(raw.activity) ? raw.activity : ((errors.activity = "Pick an activity level from the list."), null);
  return { sex, age, heightIn, activity };
}
