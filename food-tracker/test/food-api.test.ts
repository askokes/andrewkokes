import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { addDays, localDate } from "../src/dates";
import devMock from "../src/dev-mock";
import { extractFood, nutritionFor } from "../src/food/nutrition";
import type { DayView, EntryView, FoodRecord, Nutrition, ParseResponse, SearchResponse } from "../src/food/types";
import { createFakeUsda, type FakeUsdaOptions } from "./fixtures/usda/fake-fetch";
import foodsFile from "./fixtures/usda/foods.json";
import { makeSigner } from "./helpers";

const signer = await makeSigner();
const API_KEY = "usda-route-key-5f2a91";
// Tests must not depend on a developer's local .dev.vars.
const testEnv: Cloudflare.Env = { ...env, USDA_API_KEY: API_KEY, DEV_USER_EMAIL: undefined };
const TZ = "America/Chicago";
const today = () => localDate(TZ);

const EMPTY = 'Tell me what you ate, like "two eggs and a slice of toast".';
const BUSY = "The food database is busy right now. Try again in a minute, or enter it yourself.";
const DOWN = "We couldn't reach the food database. Try again in a minute, or enter it yourself.";

const fixtureFoods = new Map(
  foodsFile.foods.map((raw) => extractFood(raw)).filter((f): f is FoodRecord => f !== null).map((f) => [f.fdcId, f]),
);
const food = (id: number) => fixtureFoods.get(id)!;
const ROAST_CHICKEN = 171477; // Chicken breast, cooked, roasted: 1 breast = 172 g, 1 cup chopped = 140 g
const BRAISED_CHICKEN = 331960; // Foundation chicken breast with a 174 g "piece" and no cup
const LARGE_EGG = 748967; // 1 egg = 50.3 g

/** Every response body seen in this file. The last test checks none of them holds the USDA key. */
const bodies: string[] = [];

let counter = 0;
const newEmail = () => `eater${++counter}-${crypto.randomUUID().slice(0, 8)}@example.com`;

type Call = (email: string, method: string, path: string, body?: unknown) => Promise<Response>;

/** An app with its own fake USDA, so a test can count the USDA calls it causes. */
function client(options: FakeUsdaOptions = {}, e: Cloudflare.Env = testEnv, usdaFetch?: typeof fetch) {
  const usda = createFakeUsda(options);
  const app = createApp({ keys: signer.keys, usdaFetch: usdaFetch ?? usda.fetch });
  const as: Call = async (email, method, path, body) => {
    const headers: Record<string, string> = { "Cf-Access-Jwt-Assertion": await signer.sign({ email }) };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await app.request(
      `https://food.example.com${path}`,
      { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) },
      e,
    );
    bodies.push(await res.clone().text());
    return res;
  };
  return { usda, as };
}

const profile = {
  displayName: "Ava",
  timezone: TZ,
  trackWeight: false,
  goals: { calories: 1800, proteinG: 120, carbsG: null, fatG: 60 },
};

async function signUp(as: Call, email = newEmail()) {
  expect((await as(email, "POST", "/api/me", profile)).status).toBe(201);
  return email;
}

async function userId(email: string) {
  const row = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: number }>();
  return row!.id;
}

async function clearUsdaCache() {
  await env.DB.batch([env.DB.prepare("DELETE FROM usda_cache"), env.DB.prepare("DELETE FROM usda_search_cache")]);
}

const chickenItem = { fdcId: ROAST_CHICKEN, quantity: 6, unit: "oz" };
const eggsItem = { fdcId: LARGE_EGG, quantity: 2, unit: "each" };
const cookieItem = {
  manual: { name: "Grandma's cookie", calories: 120, proteinG: "2", carbsG: 15.5, fatG: "6" },
  quantity: 2,
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const sumOf = (entries: EntryView[]): Nutrition => {
  const sum = (k: keyof Nutrition) => round1(entries.reduce((t, e) => t + e.nutrition[k], 0));
  return { calories: sum("calories"), proteinG: sum("proteinG"), carbsG: sum("carbsG"), fatG: sum("fatG") };
};

async function logFoods(as: Call, email: string, items: unknown[], extra: Record<string, unknown> = {}) {
  const res = await as(email, "POST", "/api/entries", { date: today(), meal: "lunch", items, ...extra });
  expect(res.status).toBe(201);
  return res.json<DayView>();
}

async function dayOf(as: Call, email: string, date = today()) {
  const res = await as(email, "GET", `/api/entries?date=${date}`);
  expect(res.status).toBe(200);
  return res.json<DayView>();
}

beforeEach(clearUsdaCache);
afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/parse", () => {
  it("reads the meal and matches each food, priced for the spoken amount", async () => {
    const { as } = client();
    const email = await signUp(as);
    const res = await as(email, "POST", "/api/parse", { text: "6 ounces of chicken breast and two eggs for lunch" });
    expect(res.status).toBe(200);
    const body = await res.json<ParseResponse>();
    expect(body.meal).toBe("lunch");
    expect(body.items).toHaveLength(2);
    const [chicken, eggs] = body.items;

    expect(chicken).toMatchObject({ quantity: 6, unit: "oz", food: "chicken breast", status: "ok" });
    expect(chicken.message).toBeUndefined();
    expect(chicken.candidates.length).toBeGreaterThan(1);
    expect(chicken.candidates.length).toBeLessThanOrEqual(5);
    const top = chicken.candidates[0];
    expect(top.name).toMatch(/^Chicken\b.*\bbreast\b.*\bcooked\b/);
    expect(top.name).not.toMatch(/\b(raw|fried)\b/);
    expect(top.amount).toEqual({ quantity: 6, unit: "oz", grams: 170.1, guessed: false });
    expect(top.nutrition).toEqual(nutritionFor(top.per100g, 170.1));
    expect(top.units.slice(0, 3).map((u) => u.unit)).toEqual(["oz", "lb", "g"]);
    for (const c of chicken.candidates) expect(c.amount.grams).toBe(170.1);

    expect(eggs).toMatchObject({ quantity: 2, unit: null, food: "eggs", status: "ok" });
    const egg = eggs.candidates[0];
    expect(egg.name).toMatch(/^Eggs?\b/);
    expect(egg.amount).toMatchObject({ quantity: 2, unit: "each", guessed: false });
    expect(egg.amount.grams).toBe(round1(2 * egg.units.find((u) => u.unit === "each")!.grams));
    for (const c of eggs.candidates) expect(c.amount.guessed).toBe(false);
  });

  it("serves a repeat parse from the cache, with zero USDA calls", async () => {
    const { as, usda } = client();
    const email = await signUp(as);
    const text = "6 ounces of chicken breast and two eggs for lunch";
    const first = await (await as(email, "POST", "/api/parse", { text })).json();
    const calls = usda.calls.length;
    expect(calls).toBeGreaterThan(0);

    const second = await (await as(email, "POST", "/api/parse", { text })).json();
    expect(usda.calls.length).toBe(calls);
    expect(second).toEqual(first);
  });

  it("says when a food can't be found, without failing the rest", async () => {
    const { as } = client();
    const email = await signUp(as);
    const res = await as(email, "POST", "/api/parse", { text: "two eggs and some zzzz" });
    expect(res.status).toBe(200);
    const { items } = await res.json<ParseResponse>();
    expect(items[0].status).toBe("ok");
    expect(items[1]).toEqual({
      quantity: 1,
      unit: null,
      food: "zzzz",
      text: expect.any(String),
      status: "not_found",
      message: `We couldn't find "zzzz". Try other words, or enter it yourself.`,
      candidates: [],
    });
  });

  it.each([
    [{ rateLimited: true }, "rate_limited", BUSY],
    [{ down: true }, "unavailable", DOWN],
  ] as const)("reports USDA trouble per item (%o)", async (options, status, message) => {
    const { as } = client(options);
    const email = await signUp(as);
    const res = await as(email, "POST", "/api/parse", { text: "two eggs and a banana" });
    expect(res.status).toBe(200);
    const { items } = await res.json<ParseResponse>();
    expect(items).toHaveLength(2);
    for (const item of items) expect(item).toMatchObject({ status, message, candidates: [] });
  });

  it("is unavailable, without calling USDA, when the key isn't set", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { as, usda } = client({}, { ...testEnv, USDA_API_KEY: undefined });
    const email = await signUp(as);
    const { items } = await (await as(email, "POST", "/api/parse", { text: "two eggs" })).json<ParseResponse>();
    expect(items[0]).toMatchObject({ status: "unavailable", message: DOWN, candidates: [] });
    expect(usda.calls).toEqual([]);
  });

  it("still finds cached foods while USDA is down", async () => {
    const working = client();
    const email = await signUp(working.as);
    await working.as(email, "POST", "/api/parse", { text: "two eggs" });

    const down = client({ down: true });
    const { items } = await (await down.as(email, "POST", "/api/parse", { text: "two eggs and a banana" })).json<ParseResponse>();
    expect(items.map((i) => i.status)).toEqual(["ok", "unavailable"]);
    expect(items[0].candidates.length).toBeGreaterThan(0);
  });

  it("puts foods that have the spoken unit first", async () => {
    const { as } = client();
    const email = await signUp(as);
    const parse = async (text: string) =>
      (await (await as(email, "POST", "/api/parse", { text })).json<ParseResponse>()).items[0].candidates;

    // By weight, the roasted SR Legacy record ranks first; only the Foundation one has a "piece".
    expect((await parse("6 oz of chicken breast"))[0].fdcId).not.toBe(BRAISED_CHICKEN);
    const piece = await parse("a piece of chicken breast");
    expect(piece[0].fdcId).toBe(BRAISED_CHICKEN);
    expect(piece[0].amount).toEqual({ quantity: 1, unit: "piece", grams: 174, guessed: false });

    for (const text of ["a piece of chicken breast", "a cup of banana", "a cup of chicken breast", "a slice of toast"]) {
      const guessed = (await parse(text)).map((c) => c.amount.guessed);
      expect(guessed, text).toEqual([...guessed].sort((a, b) => Number(a) - Number(b)));
      expect(guessed[0], text).toBe(false);
    }
  });

  it("looks up at most 8 items", async () => {
    const { as } = client();
    const email = await signUp(as);
    const text = "an apple, a banana, an orange, two eggs, a bagel, toast, rice, milk, butter and spinach";
    const { items } = await (await as(email, "POST", "/api/parse", { text })).json<ParseResponse>();
    expect(items.map((i) => i.food)).toEqual(["apple", "banana", "orange", "eggs", "bagel", "toast", "rice", "milk"]);
    for (const item of items) expect(item.status).toBe("ok");
  });

  it.each([{ text: "" }, { text: "  " }, { text: "um, uh" }, { text: "for lunch" }, {}, { text: 42 }])(
    "asks what you ate when there's no food in %o",
    async (body) => {
      const { as, usda } = client();
      const email = await signUp(as);
      const res = await as(email, "POST", "/api/parse", body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_input", message: EMPTY });
      expect(usda.calls).toEqual([]);
    },
  );

  it("rejects text over 500 characters and bodies that aren't JSON", async () => {
    const { as } = client();
    const email = await signUp(as);
    const long = await as(email, "POST", "/api/parse", { text: "egg ".repeat(126) });
    expect(long.status).toBe(400);
    expect(await long.json()).toMatchObject({ error: "invalid_input", fields: { text: expect.any(String) } });
    expect((await as(email, "POST", "/api/parse", "{not json")).status).toBe(400);
  });
});

describe("GET /api/foods/search", () => {
  it("prices every candidate for the quantity and unit", async () => {
    const { as } = client();
    const email = await signUp(as);
    const res = await as(email, "GET", "/api/foods/search?q=milk&quantity=2&unit=cup");
    expect(res.status).toBe(200);
    const body = await res.json<SearchResponse>();
    expect(body).toMatchObject({ query: "milk", status: "ok" });
    expect(body.message).toBeUndefined();
    expect(body.candidates.length).toBeGreaterThan(0);
    expect(body.candidates.length).toBeLessThanOrEqual(8);
    const top = body.candidates[0];
    const cup = top.units.find((u) => u.unit === "cup")!;
    expect(top.amount).toEqual({ quantity: 2, unit: "cup", grams: round1(2 * cup.grams), guessed: false });
    expect(top.nutrition).toEqual(nutritionFor(top.per100g, top.amount.grams));
  });

  it("defaults to one of the food's natural units", async () => {
    const { as } = client();
    const email = await signUp(as);
    const body = await (await as(email, "GET", "/api/foods/search?q=banana")).json<SearchResponse>();
    expect(body.candidates[0].name).toMatch(/^Bananas/);
    expect(body.candidates[0].amount).toMatchObject({ quantity: 1, guessed: false });
  });

  it("puts foods that have the unit first", async () => {
    const { as } = client();
    const email = await signUp(as);
    const body = await (await as(email, "GET", "/api/foods/search?q=chicken%20breast&unit=piece")).json<SearchResponse>();
    expect(body.candidates[0].fdcId).toBe(BRAISED_CHICKEN);
  });

  it.each([
    ["", "q"],
    ["q=", "q"],
    ["q=%20%20", "q"],
    [`q=${"a".repeat(101)}`, "q"],
    ["q=egg&quantity=0", "quantity"],
    ["q=egg&quantity=-1", "quantity"],
    ["q=egg&quantity=lots", "quantity"],
    ["q=egg&quantity=1001", "quantity"],
  ])("rejects ?%s", async (query, field) => {
    const { as } = client();
    const email = await signUp(as);
    const res = await as(email, "GET", `/api/foods/search?${query}`);
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string; fields: Record<string, string> }>();
    expect(body.error).toBe("invalid_input");
    expect(Object.keys(body.fields)).toEqual([field]);
  });

  it("reports not found and USDA trouble with a 200", async () => {
    const { as } = client();
    const email = await signUp(as);
    expect(await (await as(email, "GET", "/api/foods/search?q=zzzz")).json()).toEqual({
      query: "zzzz",
      status: "not_found",
      message: `We couldn't find "zzzz". Try other words, or enter it yourself.`,
      candidates: [],
    });

    const busy = client({ rateLimited: true });
    const res = await busy.as(email, "GET", "/api/foods/search?q=steak&quantity=8&unit=oz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ query: "steak", status: "rate_limited", message: BUSY, candidates: [] });
  });
});

describe("entries", () => {
  it("saves USDA and typed-in foods together and shows the day", async () => {
    const { as } = client();
    const email = await signUp(as);
    const date = today();
    const spokenText = "six ounces of chicken breast, two eggs and two of grandma's cookies";
    const res = await as(email, "POST", "/api/entries", {
      date,
      meal: "lunch",
      spokenText,
      items: [chickenItem, eggsItem, cookieItem],
    });
    expect(res.status).toBe(201);
    const day = await res.json<DayView>();

    expect(day).toMatchObject({ date, today: date, goals: { calories: 1800, proteinG: 120, carbsG: null, fatG: 60 } });
    expect(day.entries).toHaveLength(3);
    const [chicken, eggs, cookie] = day.entries;

    expect(chicken).toMatchObject({
      meal: "lunch",
      foodName: food(ROAST_CHICKEN).description,
      fdcId: ROAST_CHICKEN,
      quantity: 6,
      unit: "oz",
      unitLabel: "oz",
      grams: 170.1,
      nutrition: nutritionFor(food(ROAST_CHICKEN).per100g, 170.1),
    });
    expect(chicken.units.map((u) => u.unit)).toEqual(expect.arrayContaining(["oz", "lb", "g", "each", "cup"]));
    expect(chicken.units.find((u) => u.unit === "each")).toEqual({ unit: "each", label: "breast", grams: 172 });
    expect(Number.isNaN(Date.parse(chicken.createdAt))).toBe(false);

    expect(eggs).toMatchObject({
      fdcId: LARGE_EGG,
      quantity: 2,
      unit: "each",
      unitLabel: "egg",
      grams: 100.6,
      nutrition: nutritionFor(food(LARGE_EGG).per100g, 100.6),
    });

    expect(cookie).toEqual({
      id: expect.any(Number),
      meal: "lunch",
      foodName: "Grandma's cookie",
      fdcId: null,
      quantity: 2,
      unit: "serving",
      unitLabel: "serving",
      grams: 0,
      nutrition: { calories: 240, proteinG: 4, carbsG: 31, fatG: 12 },
      units: [{ unit: "serving", label: "serving", grams: 0 }],
      createdAt: expect.any(String),
    });

    expect(day.totals).toEqual(sumOf(day.entries));
    expect(day.totals.calories).toBeCloseTo(280.7 + 148.9 + 240, 1);

    // The day reads back the same, and every row keeps what was said.
    expect(await dayOf(as, email, date)).toEqual(day);
    const { results } = await env.DB.prepare("SELECT spoken_text FROM food_entries WHERE user_id = ?")
      .bind(await userId(email))
      .all<{ spoken_text: string }>();
    expect(results.map((r) => r.spoken_text)).toEqual([spokenText, spokenText, spokenText]);
  });

  it("lists a day's entries in the order they were added", async () => {
    const { as } = client();
    const email = await signUp(as);
    await logFoods(as, email, [eggsItem], { meal: "breakfast" });
    const day = await logFoods(as, email, [chickenItem, cookieItem], { meal: "dinner" });
    expect(day.entries.map((e) => [e.meal, e.fdcId])).toEqual([
      ["breakfast", LARGE_EGG],
      ["dinner", ROAST_CHICKEN],
      ["dinner", null],
    ]);
  });

  it("shows today, empty, when no date is given", async () => {
    const { as } = client();
    const email = await signUp(as);
    const res = await as(email, "GET", "/api/entries");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      date: today(),
      today: today(),
      goals: { calories: 1800, proteinG: 120, carbsG: null, fatG: 60 },
      totals: { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
      entries: [],
    });
  });

  it("takes typed-in numbers as strings, with a default amount of one", async () => {
    const { as } = client();
    const email = await signUp(as);
    const day = await logFoods(as, email, [
      { manual: { name: "  Pho   from Saigon Cafe ", calories: "450", proteinG: "", carbsG: null }, unit: "Bowl" },
    ]);
    expect(day.entries[0]).toMatchObject({
      foodName: "Pho from Saigon Cafe",
      quantity: 1,
      unit: "bowl",
      unitLabel: "bowl",
      nutrition: { calories: 450, proteinG: 0, carbsG: 0, fatG: 0 },
    });
  });

  it("shows the goals in effect on each day", async () => {
    const { as } = client();
    const email = await signUp(as);
    const t = today();
    // Setup goals (1800) started 100 days ago, a change to 1900 started 50 days ago, and 2100 starts today.
    await env.DB.prepare("UPDATE goals SET effective_from = ? WHERE user_id = ?")
      .bind(addDays(t, -100), await userId(email))
      .run();
    await env.DB.prepare("INSERT INTO goals (user_id, calories, protein_g, effective_from) VALUES (?, 1900, 100, ?)")
      .bind(await userId(email), addDays(t, -50))
      .run();
    expect((await as(email, "POST", "/api/goals", { calories: 2100 })).status).toBe(200);

    const goalsOn = async (date: string) => (await dayOf(as, email, date)).goals;
    // Before any goals existed, the first ones apply.
    expect(await goalsOn(addDays(t, -200))).toEqual({ calories: 1800, proteinG: 120, carbsG: null, fatG: 60 });
    expect(await goalsOn(addDays(t, -100))).toMatchObject({ calories: 1800 });
    expect(await goalsOn(addDays(t, -51))).toMatchObject({ calories: 1800 });
    expect(await goalsOn(addDays(t, -50))).toEqual({ calories: 1900, proteinG: 100, carbsG: null, fatG: null });
    expect(await goalsOn(addDays(t, -1))).toMatchObject({ calories: 1900 });
    expect(await goalsOn(t)).toMatchObject({ calories: 2100 });
    expect(await goalsOn(addDays(t, 1))).toMatchObject({ calories: 2100 });

    await env.DB.prepare("DELETE FROM goals WHERE user_id = ?").bind(await userId(email)).run();
    expect(await goalsOn(t)).toBeNull();
  });

  it("only takes real dates from 2000 up to tomorrow", async () => {
    const { as } = client();
    const email = await signUp(as);
    const t = today();
    for (const date of ["2026-02-30", "yesterday", "2026-1-5", "1999-12-31", addDays(t, 2), ""]) {
      const res = await as(email, "GET", `/api/entries?date=${date}`);
      expect(res.status, date).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_input", fields: { date: expect.any(String) } });
    }
    expect((await as(email, "GET", "/api/entries?date=2000-01-01")).status).toBe(200);
    expect((await dayOf(as, email, addDays(t, 1))).today).toBe(t);

    const late = await as(email, "POST", "/api/entries", { date: addDays(t, 2), meal: null, items: [eggsItem] });
    expect(late.status).toBe(400);
    const tomorrow = await as(email, "POST", "/api/entries", { date: addDays(t, 1), meal: null, items: [eggsItem] });
    expect(tomorrow.status).toBe(201);
    expect(await tomorrow.json()).toMatchObject({ date: addDays(t, 1), entries: [{ meal: null }] });
  });

  const base = { date: "", meal: "lunch", items: [chickenItem] };
  it.each([
    [{ items: [{ ...chickenItem, unit: "slice" }] }, "items.0.unit"],
    [{ items: [{ ...chickenItem, unit: "" }] }, "items.0.unit"],
    [{ items: [{ ...chickenItem, quantity: 0 }] }, "items.0.quantity"],
    [{ items: [{ ...chickenItem, quantity: -2 }] }, "items.0.quantity"],
    [{ items: [{ ...chickenItem, quantity: 1001 }] }, "items.0.quantity"],
    [{ items: [{ ...chickenItem, quantity: "lots" }] }, "items.0.quantity"],
    [{ items: [{ ...chickenItem, fdcId: 0 }] }, "items.0.fdcId"],
    [{ items: [{ ...chickenItem, fdcId: "chicken" }] }, "items.0.fdcId"],
    [{ items: [{ ...chickenItem, fdcId: 1 }] }, "items.0.fdcId"],
    [{ items: [{ quantity: 1, unit: "oz" }] }, "items.0"],
    [{ items: ["chicken"] }, "items.0"],
    [{ items: [eggsItem, { ...cookieItem, manual: { ...cookieItem.manual, name: " " } }] }, "items.1.manual.name"],
    [{ items: [{ ...cookieItem, manual: { ...cookieItem.manual, name: "x".repeat(101) } }] }, "items.0.manual.name"],
    [{ items: [{ ...cookieItem, manual: { ...cookieItem.manual, calories: 10001 } }] }, "items.0.manual.calories"],
    [{ items: [{ ...cookieItem, manual: { ...cookieItem.manual, calories: "" } }] }, "items.0.manual.calories"],
    [{ items: [{ ...cookieItem, manual: { ...cookieItem.manual, proteinG: 1001 } }] }, "items.0.manual.proteinG"],
    [{ items: [{ ...cookieItem, manual: { ...cookieItem.manual, fatG: -1 } }] }, "items.0.manual.fatG"],
    [{ items: [{ ...cookieItem, quantity: 101 }] }, "items.0.quantity"],
    [{ items: [{ ...cookieItem, unit: "x".repeat(31) }] }, "items.0.unit"],
    [{ items: [] }, "items"],
    [{ items: Array.from({ length: 21 }, () => eggsItem) }, "items"],
    [{ items: undefined }, "items"],
    [{ meal: "brunch" }, "meal"],
    [{ spokenText: "x".repeat(501) }, "spokenText"],
    [{ date: "2026-02-30" }, "date"],
    [{ date: undefined }, "date"],
  ])("rejects bad input and saves nothing (%#: %s)", async (change, field) => {
    const { as } = client();
    const email = await signUp(as);
    const res = await as(email, "POST", "/api/entries", { ...base, date: today(), ...change });
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string; message: string; fields: Record<string, string> }>();
    expect(body.error).toBe("invalid_input");
    expect(Object.keys(body.fields)).toEqual([field]);
    expect(body.message).toBe(body.fields[field]);
    expect((await dayOf(as, email)).entries).toEqual([]);
  });

  it("saves nothing when one item of several is wrong", async () => {
    const { as } = client();
    const email = await signUp(as);
    const res = await as(email, "POST", "/api/entries", {
      date: today(),
      meal: null,
      items: [eggsItem, cookieItem, { ...chickenItem, unit: "slice" }],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ fields: { "items.2.unit": expect.any(String) } });
    expect((await dayOf(as, email)).entries).toEqual([]);
  });

  it("rejects a body that isn't JSON", async () => {
    const { as } = client();
    const email = await signUp(as);
    expect((await as(email, "POST", "/api/entries", "{not json")).status).toBe(400);
  });

  it("needs USDA only for foods it hasn't cached", async () => {
    const { as } = client({ down: true });
    const email = await signUp(as);
    const res = await as(email, "POST", "/api/entries", { date: today(), meal: null, items: [chickenItem] });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable", message: DOWN });
    expect((await dayOf(as, email)).entries).toEqual([]);

    // Typed-in foods never need USDA.
    expect((await as(email, "POST", "/api/entries", { date: today(), meal: null, items: [cookieItem] })).status).toBe(201);

    // Once a parse has cached the food, saving it works while USDA is down.
    const working = client();
    await working.as(email, "POST", "/api/parse", { text: "6 oz chicken breast" });
    const day = await logFoods(as, email, [chickenItem]);
    expect(day.entries.map((e) => e.fdcId)).toEqual([null, ROAST_CHICKEN]);
    // The day view reads units from the cache too.
    expect(day.entries[1].units.length).toBeGreaterThan(3);
  });

  it("still shows the day when a food's record can't be loaded", async () => {
    const working = client();
    const email = await signUp(working.as);
    await logFoods(working.as, email, [chickenItem]);
    await clearUsdaCache();

    vi.spyOn(console, "warn").mockImplementation(() => {});
    const down = client({ down: true });
    const day = await dayOf(down.as, email);
    expect(day.entries[0]).toMatchObject({ unit: "oz", unitLabel: "oz", grams: 170.1 });
    expect(day.entries[0].units).toEqual([{ unit: "oz", label: "oz", grams: 28.35 }]);
  });
});

describe("PATCH /api/entries/:id", () => {
  async function entryIn(day: DayView, id: number) {
    const entry = day.entries.find((e) => e.id === id);
    expect(entry).toBeDefined();
    return entry!;
  }

  it("recomputes a USDA food from its record", async () => {
    const { as } = client();
    const email = await signUp(as);
    const { id } = (await logFoods(as, email, [chickenItem])).entries[0];
    const per100g = food(ROAST_CHICKEN).per100g;
    const patch = async (body: unknown) => {
      const res = await as(email, "PATCH", `/api/entries/${id}`, body);
      expect(res.status).toBe(200);
      const day = await res.json<DayView>();
      expect(day.totals).toEqual(sumOf(day.entries));
      return entryIn(day, id);
    };

    expect(await patch({ quantity: 8 })).toMatchObject({
      quantity: 8,
      unit: "oz",
      grams: 226.8,
      nutrition: nutritionFor(per100g, 226.8),
    });
    expect(await patch({ quantity: 1, unit: "each" })).toMatchObject({
      quantity: 1,
      unit: "each",
      unitLabel: "breast",
      grams: 172,
      nutrition: nutritionFor(per100g, 172),
    });
    // The amount stays when only the unit changes.
    expect(await patch({ unit: "cup" })).toMatchObject({
      quantity: 1,
      unit: "cup",
      unitLabel: "cup, chopped",
      grams: 140,
      nutrition: nutritionFor(per100g, 140),
    });
    expect(await patch({ quantity: "1.5", unit: "LB" })).toMatchObject({ quantity: 1.5, unit: "lb", grams: 680.4 });
  });

  it("scales a typed-in food and keeps its unit", async () => {
    const { as } = client();
    const email = await signUp(as);
    const { id } = (await logFoods(as, email, [cookieItem])).entries[0];

    const res = await as(email, "PATCH", `/api/entries/${id}`, { quantity: 3 });
    expect(res.status).toBe(200);
    expect(await entryIn(await res.json<DayView>(), id)).toMatchObject({
      quantity: 3,
      unit: "serving",
      grams: 0,
      nutrition: { calories: 360, proteinG: 6, carbsG: 46.5, fatG: 18 },
    });

    const unit = await as(email, "PATCH", `/api/entries/${id}`, { unit: "bowl" });
    expect(unit.status).toBe(400);
    expect(await unit.json()).toMatchObject({ error: "invalid_input", fields: { unit: expect.any(String) } });

    const same = await as(email, "PATCH", `/api/entries/${id}`, { unit: "serving", quantity: 1 });
    expect(await entryIn(await same.json<DayView>(), id)).toMatchObject({
      quantity: 1,
      nutrition: { calories: 120, proteinG: 2, carbsG: 15.5, fatG: 6 },
    });

    const tooMany = await as(email, "PATCH", `/api/entries/${id}`, { quantity: 101 });
    expect(tooMany.status).toBe(400);
    expect(await tooMany.json()).toMatchObject({ fields: { quantity: expect.any(String) } });
  });

  it("moves an entry to another meal, or to none", async () => {
    const { as } = client();
    const email = await signUp(as);
    const before = (await logFoods(as, email, [chickenItem])).entries[0];

    const dinner = await as(email, "PATCH", `/api/entries/${before.id}`, { meal: "dinner" });
    expect(await entryIn(await dinner.json<DayView>(), before.id)).toEqual({ ...before, meal: "dinner" });
    const none = await as(email, "PATCH", `/api/entries/${before.id}`, { meal: null });
    expect(await entryIn(await none.json<DayView>(), before.id)).toEqual({ ...before, meal: null });
  });

  it.each([
    [{}, "body"],
    [{ quantity: 0 }, "quantity"],
    [{ quantity: 1001 }, "quantity"],
    [{ quantity: null }, "quantity"],
    [{ unit: "slice" }, "unit"],
    [{ unit: "" }, "unit"],
    [{ meal: "brunch" }, "meal"],
  ])("rejects %o", async (body, field) => {
    const { as } = client();
    const email = await signUp(as);
    const before = await logFoods(as, email, [chickenItem]);
    const res = await as(email, "PATCH", `/api/entries/${before.entries[0].id}`, body);
    expect(res.status).toBe(400);
    expect(Object.keys((await res.json<{ fields: Record<string, string> }>()).fields)).toEqual([field]);
    expect(await dayOf(as, email)).toEqual(before);
  });

  it("is 404 for an entry that doesn't exist", async () => {
    const { as } = client();
    const email = await signUp(as);
    for (const id of ["999999999", "0", "abc", "1.5", "99999999999999999999"]) {
      const res = await as(email, "PATCH", `/api/entries/${id}`, { quantity: 1 });
      expect(res.status, id).toBe(404);
      expect(await res.json()).toMatchObject({ error: "not_found" });
    }
  });
});

describe("DELETE /api/entries/:id", () => {
  it("removes the entry and returns its day", async () => {
    const { as } = client();
    const email = await signUp(as);
    const date = addDays(today(), -3);
    const day = await logFoods(as, email, [chickenItem, cookieItem], { date });
    const [chicken, cookie] = day.entries;

    const res = await as(email, "DELETE", `/api/entries/${chicken.id}`);
    expect(res.status).toBe(200);
    const after = await res.json<DayView>();
    expect(after.date).toBe(date);
    expect(after.entries).toEqual([cookie]);
    expect(after.totals).toEqual(cookie.nutrition);

    const again = await as(email, "DELETE", `/api/entries/${chicken.id}`);
    expect(again.status).toBe(404);
    expect(await again.json()).toMatchObject({ error: "not_found" });
    expect((await as(email, "DELETE", "/api/entries/abc")).status).toBe(404);
  });
});

describe("before profile setup", () => {
  it("every food route is 404 no_profile, and USDA is never called", async () => {
    const { as, usda } = client();
    const email = newEmail();
    const routes: [string, string, unknown?][] = [
      ["POST", "/api/parse", { text: "two eggs" }],
      ["GET", "/api/foods/search?q=egg"],
      ["GET", `/api/entries?date=${today()}`],
      ["GET", "/api/entries"],
      ["POST", "/api/entries", { date: today(), meal: null, items: [eggsItem] }],
      ["PATCH", "/api/entries/1", { quantity: 2 }],
      ["DELETE", "/api/entries/1"],
    ];
    for (const [method, path, body] of routes) {
      const res = await as(email, method, path, body);
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(await res.json()).toMatchObject({ error: "no_profile", email });
    }
    expect(usda.calls).toEqual([]);
  });
});

describe("isolation", () => {
  it("one user never sees, changes or deletes another user's entries", async () => {
    const { as } = client();
    const a = await signUp(as);
    const b = await signUp(as);
    const aId = await userId(a);
    const date = today();
    const aDay = await logFoods(as, a, [chickenItem, cookieItem]);
    const [aChicken, aCookie] = aDay.entries;

    // B asking for the same day sees only B's own (empty) day.
    expect((await dayOf(as, b, date)).entries).toEqual([]);

    // B can't change or delete A's entries, and can't tell them apart from missing ones.
    const missing = await (await as(b, "PATCH", "/api/entries/999999999", { quantity: 1 })).json();
    for (const entry of [aChicken, aCookie]) {
      const patch = await as(b, "PATCH", `/api/entries/${entry.id}`, { quantity: 1, meal: "snack", user_id: aId, userId: aId });
      expect(patch.status).toBe(404);
      expect(await patch.json()).toEqual(missing);
      const del = await as(b, "DELETE", `/api/entries/${entry.id}`);
      expect(del.status).toBe(404);
      expect(await del.json()).toEqual(missing);
    }

    // User ids in a body are ignored: B's new entry is B's.
    const bDay = await logFoods(as, b, [{ ...eggsItem, user_id: aId, userId: aId }], { user_id: aId, userId: aId });
    expect(bDay.entries).toHaveLength(1);
    const owner = await env.DB.prepare("SELECT user_id FROM food_entries WHERE id = ?")
      .bind(bDay.entries[0].id)
      .first<{ user_id: number }>();
    expect(owner?.user_id).toBe(await userId(b));

    // A can't touch B's entry either.
    expect((await as(a, "DELETE", `/api/entries/${bDay.entries[0].id}`)).status).toBe(404);

    // A's day is exactly as it was, and B's has only B's food.
    expect(await dayOf(as, a, date)).toEqual(aDay);
    expect(await dayOf(as, b, date)).toEqual(bDay);
  });
});

describe("npm run dev:mock", () => {
  it("serves the real routes with fixture data and no USDA key", async () => {
    const devEnv: Cloudflare.Env = { ...env, USDA_API_KEY: undefined, DEV_USER_EMAIL: "dev-mock@example.com" };
    const call = async (method: string, path: string, body?: unknown) => {
      const ctx = createExecutionContext();
      const request = new Request(`http://localhost:8787${path}`, {
        method,
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const res = await devMock.fetch(request as Parameters<typeof devMock.fetch>[0], devEnv, ctx);
      await waitOnExecutionContext(ctx);
      bodies.push(await res.clone().text());
      return res;
    };

    expect([200, 201]).toContain((await call("POST", "/api/me", profile)).status);
    const parsed = await (await call("POST", "/api/parse", { text: "two eggs and a slice of toast" })).json<ParseResponse>();
    expect(parsed.items.map((i) => i.status)).toEqual(["ok", "ok"]);
    const toast = parsed.items[1].candidates[0];
    const res = await call("POST", "/api/entries", {
      date: today(),
      meal: "breakfast",
      items: [{ fdcId: toast.fdcId, quantity: toast.amount.quantity, unit: toast.amount.unit }],
    });
    expect(res.status).toBe(201);
    expect((await res.json<DayView>()).entries.at(-1)).toMatchObject({ fdcId: toast.fdcId, unit: "slice" });
  });
});

describe("the USDA key", () => {
  it("never shows up in a response or a log line, whatever USDA does", async () => {
    const logs: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(" "));
      });
    }
    const echo = async (input: RequestInfo | URL) => {
      throw new Error(`could not connect to ${String(input instanceof Request ? input.url : input)}`);
    };
    const rejected = async () => new Response('{"error":"API_KEY_INVALID"}', { status: 403 });
    const garbage = async (input: RequestInfo | URL) => new Response(`<html>${String(input)}</html>`, { status: 200 });
    const setups = [
      client(),
      client({ rateLimited: true }),
      client({ down: true }),
      client({}, testEnv, echo as typeof fetch),
      client({}, testEnv, rejected as typeof fetch),
      client({}, testEnv, garbage as typeof fetch),
    ];
    for (const { as } of setups) {
      await clearUsdaCache();
      const email = await signUp(as);
      await as(email, "POST", "/api/parse", { text: "two eggs and a Chobani" });
      await as(email, "GET", "/api/foods/search?q=chicken%20breast&quantity=6&unit=oz");
      await as(email, "POST", "/api/entries", { date: today(), meal: null, items: [chickenItem, cookieItem] });
      await as(email, "GET", "/api/entries");
    }
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) expect(line).not.toContain(API_KEY);
  });

  // Runs last: covers every response this file received.
  it("is in none of the responses any test here received", () => {
    expect(bodies.length).toBeGreaterThan(100);
    for (const body of bodies) expect(body).not.toContain(API_KEY);
  });
});
