import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { addDays, localDate } from "../src/dates";
import { caloriesBurned } from "../src/burn";
import type { SummaryResponse, WeightResponse } from "../src/food/types";
import { makeSigner } from "./helpers";

const signer = await makeSigner();
const app = createApp({ keys: signer.keys });
const testEnv: Cloudflare.Env = { ...env, DEV_USER_EMAIL: undefined };
const TZ = "America/Chicago";
const today = () => localDate(TZ);

let counter = 0;
const newEmail = () => `progress${++counter}-${crypto.randomUUID().slice(0, 8)}@example.com`;

async function as(email: string, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { "Cf-Access-Jwt-Assertion": await signer.sign({ email }) };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(`https://food.example.com${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, testEnv);
}

async function signUp(email = newEmail(), trackWeight = true) {
  const res = await as(email, "POST", "/api/me", {
    displayName: "Ava",
    timezone: TZ,
    trackWeight,
    goals: { calories: 1800, proteinG: 120, carbsG: null, fatG: 60 },
  });
  expect(res.status).toBe(201);
  return email;
}

const manual = (name: string, calories: number, proteinG = 0, carbsG = 0, fatG = 0) => ({ manual: { name, calories, proteinG, carbsG, fatG } });

async function log(email: string, date: string, items: unknown[]) {
  const res = await as(email, "POST", "/api/entries", { date, meal: "lunch", items });
  expect(res.status).toBe(201);
}

describe("GET /api/summary", () => {
  it("defaults to the last 30 days ending today, with empty days as zeros", async () => {
    const email = await signUp();
    await log(email, today(), [manual("Sandwich", 500, 25, 50, 20), manual("Apple", 95, 0.5, 25, 0.3)]);
    await log(email, addDays(today(), -2), [manual("Pasta", 700, 20, 100, 15)]);

    const res = await as(email, "GET", "/api/summary");
    expect(res.status).toBe(200);
    const body = await res.json<SummaryResponse>();
    expect(body).toMatchObject({ from: addDays(today(), -29), to: today(), today: today() });
    expect(body.days).toHaveLength(30);
    expect(body.days.at(-1)).toEqual({
      date: today(),
      calories: 595,
      proteinG: 25.5,
      carbsG: 75,
      fatG: 20.3,
      entries: 2,
      goal: { calories: 1800, proteinG: 120, carbsG: null, fatG: 60, baselineCalories: null },
    });
    expect(body.days.at(-3)).toMatchObject({ calories: 700, entries: 1 });
    expect(body.days.at(-2)).toMatchObject({ calories: 0, proteinG: 0, entries: 0 });
  });

  it("follows goal history: each day gets the goals in effect then", async () => {
    const email = await signUp();
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: number }>();
    await env.DB.prepare("UPDATE goals SET effective_from = ? WHERE user_id = ?").bind(addDays(today(), -10), user!.id).run();
    await env.DB.prepare("INSERT INTO goals (user_id, calories, effective_from) VALUES (?, 2200, ?)").bind(user!.id, addDays(today(), -3)).run();

    const body = await (await as(email, "GET", `/api/summary?from=${addDays(today(), -12)}&to=${today()}`)).json<SummaryResponse>();
    const goalOn = (offset: number) => body.days.find((d) => d.date === addDays(today(), offset))!.goal?.calories;
    expect(goalOn(-12)).toBe(1800); // before any goals: the earliest ones
    expect(goalOn(-5)).toBe(1800);
    expect(goalOn(-3)).toBe(2200);
    expect(goalOn(0)).toBe(2200);
  });

  it("works out the calories burned for each day from that week's weigh-ins", async () => {
    const email = await signUp();
    await as(email, "POST", "/api/me", { displayName: "Ava", timezone: TZ, trackWeight: true, sex: "female", age: 40, activity: "moderate" });
    for (const [offset, weightLb] of [[-9, 200], [-2, 180], [-1, 182]] as const) {
      expect((await as(email, "POST", "/api/weight", { date: addDays(today(), offset), weightLb })).status).toBe(201);
    }
    const body = await (await as(email, "GET", `/api/summary?from=${addDays(today(), -12)}&to=${today()}`)).json<SummaryResponse>();
    const on = (offset: number) => body.days.find((d) => d.date === addDays(today(), offset))!.goal?.baselineCalories;
    const burned = (lb: number) => caloriesBurned({ sex: "female", birthYear: Number(today().slice(0, 4)) - 40, heightIn: null, activity: "moderate" }, lb, today());
    expect(on(-12)).toBe(burned(200)); // before any weigh-in: the first one
    expect(on(-3)).toBe(burned(200)); // the week ending then holds only the 200
    expect(on(-2)).toBe(burned(180)); // the 200 is more than a week back
    expect(on(0)).toBe(burned(181)); // two weigh-ins in the week: their average
    expect(on(0)).toBeLessThan(on(-12)!);
  });

  it("has no calories burned until the Goals tab is filled in", async () => {
    const email = await signUp();
    const body = await (await as(email, "GET", `/api/summary?from=${today()}&to=${today()}`)).json<SummaryResponse>();
    expect(body.days[0].goal?.baselineCalories).toBeNull();
  });

  it.each([
    ["from after to", (t: string) => `from=${t}&to=${addDays(t, -1)}`, "from"],
    ["over the range cap", (t: string) => `from=${addDays(t, -400)}&to=${t}`, "from"],
    ["a fake date", () => "from=2026-02-30", "from"],
    ["too far in the future", (t: string) => `to=${addDays(t, 2)}`, "to"],
  ])("rejects %s", async (_name, query, field) => {
    const email = await signUp();
    const res = await as(email, "GET", `/api/summary?${query(today())}`);
    expect(res.status).toBe(400);
    expect(Object.keys((await res.json<{ fields: Record<string, string> }>()).fields)).toContain(field);
  });

  it("is 404 before setup", async () => {
    expect((await as(newEmail(), "GET", "/api/summary")).status).toBe(404);
  });
});

describe("weight", () => {
  it("logs today's weight by default, one weigh-in per day with the latest winning", async () => {
    const email = await signUp();
    const first = await as(email, "POST", "/api/weight", { weightLb: 181.24 });
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ entry: { date: today(), weightLb: 181.2 }, today: today() });
    await as(email, "POST", "/api/weight", { weightLb: "180.8" });
    await as(email, "POST", "/api/weight", { date: addDays(today(), -3), weightLb: 182 });

    const body = await (await as(email, "GET", `/api/weight?from=${addDays(today(), -6)}&to=${today()}`)).json<WeightResponse>();
    expect(body.entries.map((e) => [e.date, e.weightLb])).toEqual([
      [addDays(today(), -3), 182],
      [today(), 180.8],
    ]);
  });

  it.each([[49], [1001], ["heavy"], [null], [Number.NaN]])("rejects weight %j", async (weightLb) => {
    const email = await signUp();
    const res = await as(email, "POST", "/api/weight", { weightLb });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ fields: { weightLb: expect.any(String) } });
  });

  it("rejects a date past tomorrow", async () => {
    const email = await signUp();
    const res = await as(email, "POST", "/api/weight", { weightLb: 180, date: addDays(today(), 2) });
    expect(res.status).toBe(400);
  });

  it("deletes a weigh-in", async () => {
    const email = await signUp();
    const { entry } = await (await as(email, "POST", "/api/weight", { weightLb: 175 })).json<{ entry: { id: number } }>();
    expect((await as(email, "DELETE", `/api/weight/${entry.id}`)).status).toBe(200);
    expect((await as(email, "DELETE", `/api/weight/${entry.id}`)).status).toBe(404);
    const body = await (await as(email, "GET", "/api/weight")).json<WeightResponse>();
    expect(body.entries).toEqual([]);
  });

  it("is 404 before setup", async () => {
    expect((await as(newEmail(), "POST", "/api/weight", { weightLb: 170 })).status).toBe(404);
    expect((await as(newEmail(), "GET", "/api/weight")).status).toBe(404);
  });
});

describe("isolation", () => {
  it("one user never sees or deletes another user's weigh-ins or totals", async () => {
    const a = await signUp();
    const b = await signUp();
    await log(a, today(), [manual("Cake", 900)]);
    const { entry } = await (await as(a, "POST", "/api/weight", { weightLb: 160 })).json<{ entry: { id: number } }>();

    // B can't delete A's weigh-in, and it's still there.
    expect((await as(b, "DELETE", `/api/weight/${entry.id}`)).status).toBe(404);
    expect((await (await as(a, "GET", "/api/weight")).json<WeightResponse>()).entries).toHaveLength(1);

    // B's own views are empty.
    expect((await (await as(b, "GET", "/api/weight")).json<WeightResponse>()).entries).toEqual([]);
    const bSummary = await (await as(b, "GET", "/api/summary")).json<SummaryResponse>();
    expect(bSummary.days.every((d) => d.calories === 0 && d.entries === 0)).toBe(true);

    // A user id in the body changes nothing.
    await as(b, "POST", "/api/weight", { weightLb: 200, user_id: 1, userId: 1 });
    const aWeights = (await (await as(a, "GET", "/api/weight")).json<WeightResponse>()).entries;
    expect(aWeights.map((e) => e.weightLb)).toEqual([160]);
  });
});
