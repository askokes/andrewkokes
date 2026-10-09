export interface Goals {
  calories: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  goalWeightLb: number | null;
  effectiveFrom: string;
}

export interface Me {
  email: string;
  displayName: string;
  timezone: string;
  trackWeight: boolean;
  today: string;
  goals: Goals | null;
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
