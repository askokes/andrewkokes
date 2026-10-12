import type { Activity, Sex } from "../../src/burn";
export interface Goals {
  calories: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  goalWeightLb: number | null;
  /** Calories burned in a normal day, worked out from `Me.burn` and the weigh-ins; null until those are filled in. */
  baselineCalories: number | null;
  effectiveFrom: string;
}

/** What the calories-burned estimate uses (see src/burn.ts). */
export interface BurnSettings {
  sex: Sex | null;
  age: number | null;
  heightIn: number | null;
  activity: Activity | null;
  /** The weight it uses now: the last week's weigh-ins averaged, else the latest. */
  weightLb: number | null;
}

export interface Me {
  email: string;
  displayName: string;
  timezone: string;
  trackWeight: boolean;
  today: string;
  /** May invite people (Goals tab). */
  canInvite: boolean;
  goals: Goals | null;
  burn: BurnSettings;
  latestWeight: { weightLb: number; date: string } | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
    readonly fields: Record<string, string> = {},
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      // When the Access session lapses, Access answers with a redirect to its
      // login page. Reloading lets Access show that login.
      redirect: "manual",
    });
  } catch {
    throw new ApiError(0, "Couldn't reach the server. Check your connection and try again.", "network");
  }
  if (res.type === "opaqueredirect") {
    location.reload();
    return new Promise<T>(() => {});
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      typeof json.message === "string" ? json.message : "Something went wrong. Please try again.",
      typeof json.error === "string" ? json.error : "error",
      (json.fields as Record<string, string>) ?? {},
      json,
    );
  }
  return json as T;
}
