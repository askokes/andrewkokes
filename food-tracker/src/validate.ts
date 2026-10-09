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

export interface ProfileInput {
  displayName: string;
  timezone: string;
  trackWeight: boolean;
  goals: GoalsInput | null;
  currentWeightLb: number | null;
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

  const currentWeightLb = trackWeight
    ? optionalWeight(raw.currentWeightLb, "currentWeightLb", "Current weight", errors)
    : null;

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { displayName, timezone, trackWeight, goals, currentWeightLb } };
}
