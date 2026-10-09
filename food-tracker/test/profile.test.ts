import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { localDate } from "../src/dates";
import { makeSigner } from "./helpers";

const signer = await makeSigner();
const app = createApp({ keys: signer.keys });
const testEnv: Cloudflare.Env = { ...env, DEV_USER_EMAIL: undefined };

let counter = 0;
const newEmail = () => `user${++counter}-${crypto.randomUUID().slice(0, 8)}@example.com`;

async function as(email: string, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { "Cf-Access-Jwt-Assertion": await signer.sign({ email }) };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(
    `https://food.example.com${path}`,
    { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) },
    testEnv,
  );
}

const setup = {
  displayName: "Ava",
  timezone: "America/Chicago",
  trackWeight: false,
  goals: { calories: 1800, proteinG: 120, carbsG: null, fatG: 60 },
};

async function goalRows(email: string) {
  const { results } = await env.DB.prepare(
    "SELECT g.calories, g.effective_from FROM goals g JOIN users u ON u.id = g.user_id WHERE u.email = ? ORDER BY g.id",
  )
    .bind(email)
    .all<{ calories: number; effective_from: string }>();
  return results;
}

describe("first run", () => {
  it("GET /api/me is 404 before setup", async () => {
    const email = newEmail();
    const res = await as(email, "GET", "/api/me");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "no_profile", email });
  });

  it("creates the profile and first goals together", async () => {
    const email = newEmail();
    const res = await as(email, "POST", "/api/me", setup);
    expect(res.status).toBe(201);
    const me = await res.json();
    expect(me).toMatchObject({
      email,
      displayName: "Ava",
      timezone: "America/Chicago",
      trackWeight: false,
      today: localDate("America/Chicago"),
      goals: { calories: 1800, proteinG: 120, carbsG: null, fatG: 60, goalWeightLb: null },
      latestWeight: null,
    });
    expect((await as(email, "GET", "/api/me")).status).toBe(200);
  });

  it("requires a calorie goal on setup", async () => {
    const res = await as(newEmail(), "POST", "/api/me", { ...setup, goals: undefined });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_input", fields: { "goals.calories": expect.any(String) } });
  });

  it("stores today's weight when tracking is on", async () => {
    const email = newEmail();
    const res = await as(email, "POST", "/api/me", {
      ...setup,
      trackWeight: true,
      currentWeightLb: "182.45",
      goals: { ...setup.goals, goalWeightLb: 170 },
    });
    const me = await res.json<{ latestWeight: unknown; goals: { goalWeightLb: number } }>();
    expect(me.latestWeight).toEqual({ weightLb: 182.5, date: localDate("America/Chicago") });
    expect(me.goals.goalWeightLb).toBe(170);
  });

  it("ignores a current weight when tracking is off", async () => {
    const email = newEmail();
    await as(email, "POST", "/api/me", { ...setup, currentWeightLb: 180 });
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM weight_entries w JOIN users u ON u.id = w.user_id WHERE u.email = ?",
    )
      .bind(email)
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});

describe("validation", () => {
  it.each([
    [{ ...setup, displayName: "  " }, "displayName"],
    [{ ...setup, displayName: "x".repeat(51) }, "displayName"],
    [{ ...setup, timezone: "Mars/Olympus" }, "timezone"],
    [{ ...setup, trackWeight: "yes" }, "trackWeight"],
    [{ ...setup, goals: { calories: 0 } }, "goals.calories"],
    [{ ...setup, goals: { calories: 1800.5 } }, "goals.calories"],
    [{ ...setup, goals: { calories: "lots" } }, "goals.calories"],
    [{ ...setup, goals: { calories: 1800, proteinG: -5 } }, "goals.proteinG"],
    [{ ...setup, trackWeight: true, currentWeightLb: 20 }, "currentWeightLb"],
  ])("rejects bad input (%#: %s)", async (body, field) => {
    const res = await as(newEmail(), "POST", "/api/me", body);
    expect(res.status).toBe(400);
    const json = await res.json<{ fields: Record<string, string> }>();
    expect(Object.keys(json.fields)).toContain(field);
  });

  it("rejects a body that isn't JSON", async () => {
    const res = await as(newEmail(), "POST", "/api/me", "{not json");
    expect(res.status).toBe(400);
  });

  it("accepts a low calorie goal (the app only shows a gentle note)", async () => {
    const res = await as(newEmail(), "POST", "/api/me", { ...setup, goals: { calories: 900 } });
    expect(res.status).toBe(201);
  });

  it("accepts numbers sent as strings from form fields", async () => {
    const res = await as(newEmail(), "POST", "/api/me", {
      ...setup,
      goals: { calories: "2000", proteinG: "", carbsG: "200", fatG: null },
    });
    expect(await res.json()).toMatchObject({ goals: { calories: 2000, proteinG: null, carbsG: 200, fatG: null } });
  });
});

describe("updating", () => {
  it("updates the profile without touching goals", async () => {
    const email = newEmail();
    await as(email, "POST", "/api/me", setup);
    const res = await as(email, "POST", "/api/me", { displayName: "Ava K", timezone: "America/New_York", trackWeight: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ displayName: "Ava K", timezone: "America/New_York", trackWeight: true, goals: { calories: 1800 } });
    expect(await goalRows(email)).toHaveLength(1);
  });

  it("POST /api/goals adds a new row effective today and keeps history", async () => {
    const email = newEmail();
    await as(email, "POST", "/api/me", setup);
    await env.DB.prepare("UPDATE goals SET effective_from = '2026-01-01' WHERE user_id = (SELECT id FROM users WHERE email = ?)")
      .bind(email)
      .run();

    const res = await as(email, "POST", "/api/goals", { calories: 2100, proteinG: 140 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      goals: { calories: 2100, proteinG: 140, carbsG: null, fatG: null, effectiveFrom: localDate("America/Chicago") },
    });
    expect((await goalRows(email)).map((r) => r.calories)).toEqual([1800, 2100]);
  });

  it("does not add a row when the goals didn't change", async () => {
    const email = newEmail();
    await as(email, "POST", "/api/me", setup);
    await as(email, "POST", "/api/goals", setup.goals);
    await as(email, "POST", "/api/me", setup);
    expect(await goalRows(email)).toHaveLength(1);
  });

  it("latest change on the same day wins", async () => {
    const email = newEmail();
    await as(email, "POST", "/api/me", setup);
    await as(email, "POST", "/api/goals", { calories: 2000 });
    const res = await as(email, "POST", "/api/goals", { calories: 2200 });
    expect(await res.json()).toMatchObject({ goals: { calories: 2200 } });
  });

  it("POST /api/goals is 404 before setup", async () => {
    expect((await as(newEmail(), "POST", "/api/goals", { calories: 2000 })).status).toBe(404);
  });
});

describe("isolation", () => {
  it("one user never sees or changes another user's profile or goals", async () => {
    const a = newEmail();
    const b = newEmail();
    await as(a, "POST", "/api/me", setup);

    // B has no profile, even though A does.
    expect((await as(b, "GET", "/api/me")).status).toBe(404);

    // A user_id in the body is ignored; B's goals change only B.
    await as(b, "POST", "/api/me", { ...setup, displayName: "Ben", user_id: 1, userId: 1, email: a });
    await as(b, "POST", "/api/goals", { calories: 3000, user_id: 1 });

    const aMe = await (await as(a, "GET", "/api/me")).json();
    expect(aMe).toMatchObject({ email: a, displayName: "Ava", goals: { calories: 1800 } });
    const bMe = await (await as(b, "GET", "/api/me")).json();
    expect(bMe).toMatchObject({ email: b, displayName: "Ben", goals: { calories: 3000 } });
  });
});
