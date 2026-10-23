import type { Activity, Sex } from "../../src/burn";
import type { WatchStatus } from "../../src/food/types";
import type { PlanGoal, PlanPer } from "../../src/plan";
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
  /** The weight plan's choices on the Goals tab, or null until one is picked. */
  plan: { goal: PlanGoal; lb: number | null; per: PlanPer } | null;
  /** Apple Watch sync (Goals tab): whether a key is set and when anything last came in. */
  watch: WatchStatus;
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

/** How long a request may take before the app gives up and says so, instead of waiting forever. */
const TIMEOUT_MS = 20_000;
/** When the app last reloaded to renew the sign-in, so a reload that doesn't help can't repeat forever. */
const SIGNIN_KEY = "food.signinReload";
const SIGNIN_WINDOW_MS = 60_000;

function lastSigninReload(): number {
  try {
    return Number(sessionStorage.getItem(SIGNIN_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** The app loaded fine: a later lapse may reload again. */
export function signinWorked() {
  try {
    sessionStorage.removeItem(SIGNIN_KEY);
  } catch {
    // Storage blocked: nothing was saved either.
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      // When the Access session lapses, Access answers with a redirect to its
      // login page. Reloading lets Access show that login.
      redirect: "manual",
      signal: abort.signal,
    });
  } catch {
    if (abort.signal.aborted) throw new ApiError(0, "The server took too long to answer. Check your connection and try again.", "timeout");
    throw new ApiError(0, "Couldn't reach the server. Check your connection and try again.", "network");
  } finally {
    clearTimeout(timer);
  }
  if (res.type === "opaqueredirect") {
    // Reload once so Access can renew the sign-in. If that already happened a moment ago and the
    // sign-in still bounces (a home screen app can come back without Access's page), say so instead
    // of reloading forever behind "Loading…".
    if (Date.now() - lastSigninReload() > SIGNIN_WINDOW_MS) {
      try {
        sessionStorage.setItem(SIGNIN_KEY, String(Date.now()));
      } catch {
        throw new ApiError(401, "Your sign-in needs renewing.", "signin");
      }
      location.reload();
      return new Promise<T>(() => {});
    }
    throw new ApiError(401, "Your sign-in needs renewing.", "signin");
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
