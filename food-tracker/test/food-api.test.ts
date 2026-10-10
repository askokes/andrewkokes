import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { addDays, localDate } from "../src/dates";
import devMock from "../src/dev-mock";
import { extractFood, nutritionFor } from "../src/food/nutrition";
import { USDA_CALLS_PER_REQUEST, USDA_CALLS_PER_USER_HOUR } from "../src/food/routes";
import {
  MAX_GRAMS,
  type Candidate,
  type DayView,
  type EntryView,
  type FoodRecord,
  type Nutrition,
  type ParseResponse,
  type SearchResponse,
} from "../src/food/types";
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
const SKIPPED = "That's a lot of foods at once. Search for this one separately, or enter it yourself.";

const fixtureFoods = new Map(
  foodsFile.foods.map((raw) => extractFood(raw)).filter((f): f is FoodRecord => f !== null).map((f) => [f.fdcId, f]),
);
const food = (id: number) => fixtureFoods.get(id)!;
const ROAST_CHICKEN = 171477; // Chicken breast, cooked, roasted: 1 breast = 172 g, 1 cup chopped = 140 g
const BRAISED_CHICKEN = 331960; // Foundation chicken breast with a 174 g "piece" and no cup
const GRILLED_CHICKEN = 171534; // SR grilled breast with a 196 g "piece": an alternative in the common-foods table
const LARGE_EGG = 748967; // 1 egg = 50.3 g
const BROWN_RICE = 169704; // Rice, brown, long-grain, cooked: 1 cup = 202 g

/** Every response body seen in this file. The last test checks none of them holds the USDA key. */
const bodies: string[] = [];

let counter = 0;
const newEmail = () => `eater${++counter}-${crypto.randomUUID().slice(0, 8)}@example.com`;

/** `headers` are added to the defaults; null removes one (e.g. the JSON Content-Type a body gets). */
type Call = (
  email: string,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string | null>,
) => Promise<Response>;

/** An app with its own fake USDA, so a test can count the USDA calls it causes. */
function client(options: FakeUsdaOptions = {}, e: Cloudflare.Env = testEnv, usdaFetch?: typeof fetch) {
  const usda = createFakeUsda(options);
  const app = createApp({ keys: signer.keys, usdaFetch: usdaFetch ?? usda.fetch });
  const as: Call = async (email, method, path, body, extra = {}) => {
    const headers: Record<string, string> = { "Cf-Access-Jwt-Assertion": await signer.sign({ email }) };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    for (const [name, value] of Object.entries(extra)) {
      if (value === null) delete headers[name];
      else headers[name] = value;
    }
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
    // The common-foods table's whole egg, read as large eggs (eggs are sold large).
    expect(egg.name).toBe("Egg, whole, raw, fresh");
    expect(egg.amount).toEqual({ quantity: 2, unit: "large", grams: 100, guessed: false });
    expect(egg.amount.grams).toBe(round1(2 * egg.units.find((u) => u.unit === "large")!.grams));
    for (const c of eggs.candidates) expect(c.amount.guessed).toBe(false);
    // The table's cooked eggs come next, still as large eggs.
    expect(eggs.candidates[1]).toMatchObject({ fdcId: 172187, amount: { quantity: 2, unit: "large", grams: 122 } });
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

    // By weight, the table's roasted breast comes first. Fewer foods have a "piece": the table's grilled
    // breast is the first of them, and the search's Foundation breast is among them too.
    expect((await parse("6 oz of chicken breast"))[0].fdcId).toBe(171477);
    const piece = await parse("a piece of chicken breast");
    expect(piece[0].fdcId).toBe(GRILLED_CHICKEN);
    expect(piece[0].amount).toEqual({ quantity: 1, unit: "piece", grams: 196, guessed: false });

    for (const text of ["a piece of chicken breast", "a cup of banana", "a cup of chicken breast", "a slice of toast"]) {
      const guessed = (await parse(text)).map((c) => c.amount.guessed);
      expect(guessed, text).toEqual([...guessed].sort((a, b) => Number(a) - Number(b)));
      expect(guessed[0], text).toBe(false);
    }
  });

  it("looks up the first 8 foods and says which ones it skipped", async () => {
    const { as, usda } = client();
    const email = await signUp(as);
    const text = "an apple, a banana, an orange, two eggs, a bagel, toast, rice, milk, butter and spinach";
    const { items } = await (await as(email, "POST", "/api/parse", { text })).json<ParseResponse>();
    expect(items.map((i) => i.food)).toEqual([
      "apple", "banana", "orange", "eggs", "bagel", "toast", "rice", "milk", "butter", "spinach",
    ]);
    // Eight foods never seen before fit in one request's share of the USDA key.
    for (const item of items.slice(0, 8)) expect(item.status, item.food).toBe("ok");
    expect(usda.calls.length).toBeLessThanOrEqual(USDA_CALLS_PER_REQUEST);
    for (const item of items.slice(8)) {
      expect(item).toEqual({
        quantity: 1,
        unit: null,
        food: item.food,
        text: item.food,
        status: "skipped",
        message: SKIPPED,
        candidates: [],
      });
    }
    expect(usda.calls.filter((url) => /query=(butter|spinach)\b/.test(url))).toEqual([]);
  });

  it("spends at most one request's share of the USDA key, however many foods miss", async () => {
    // Every search answers with foods that don't name what was asked for, so each
    // lookup would also try the Branded fallback: up to 4 USDA calls per food.
    const fake = createFakeUsda();
    let calls = 0;
    const unhelpful = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname.endsWith("/foods/search")) {
        url.searchParams.set("query", url.searchParams.get("dataType")?.includes("Branded") ? "egg" : "rice");
        url.searchParams.set("dataType", "Foundation,SR Legacy");
      }
      return fake.fetch(url.toString(), init);
    }) as typeof fetch;
    const { as } = client({}, testEnv, unhelpful);
    const email = await signUp(as);
    const res = await as(email, "POST", "/api/parse", { text: "a qwv, a plx, a zrk, a mnb, a vcx, a lkj, a hgf, a dsa" });
    expect(res.status).toBe(200);
    const { items } = await res.json<ParseResponse>();
    expect(items).toHaveLength(8);
    expect(calls).toBeLessThanOrEqual(USDA_CALLS_PER_REQUEST);
    const skipped = items.filter((i) => i.status === "skipped");
    expect(skipped.length).toBeGreaterThan(0);
    for (const item of skipped) expect(item).toMatchObject({ message: SKIPPED, candidates: [] });
    for (const item of items) expect(["ok", "skipped"]).toContain(item.status);
  });

  it("stops one user from spending the shared key, without stopping anyone else", async () => {
    const { as, usda } = client();
    const heavy = await signUp(as);
    const other = await signUp(as);
    const hour = () => new Date().toISOString().slice(0, 13);
    const usage = async (email: string) =>
      (await env.DB.prepare("SELECT hour, calls FROM usda_usage WHERE user_id = ?").bind(await userId(email)).first()) ??
      null;
    const parse = async (email: string, text: string) =>
      (await (await as(email, "POST", "/api/parse", { text })).json<ParseResponse>()).items[0];

    // Every USDA call is counted against the user who caused it; cache hits are free.
    expect((await parse(other, "two eggs")).status).toBe("ok");
    expect(usda.calls.length).toBeGreaterThan(0);
    expect(await usage(other)).toEqual({ hour: hour(), calls: usda.calls.length });
    const before = usda.calls.length;
    expect((await parse(other, "two eggs")).status).toBe("ok");
    expect(usda.calls.length).toBe(before);

    // At the hourly limit, a user's new lookups wait, and USDA isn't called.
    await env.DB.prepare("INSERT INTO usda_usage (user_id, hour, calls) VALUES (?, ?, ?)")
      .bind(await userId(heavy), hour(), USDA_CALLS_PER_USER_HOUR)
      .run();
    expect(await parse(heavy, "a banana")).toMatchObject({ status: "rate_limited", message: BUSY, candidates: [] });
    const search = await as(heavy, "GET", "/api/foods/search?q=salmon");
    expect(await search.json()).toMatchObject({ status: "rate_limited", message: BUSY });
    expect(usda.calls.length).toBe(before);
    expect(await usage(heavy)).toEqual({ hour: hour(), calls: USDA_CALLS_PER_USER_HOUR });

    // Foods already cached still work for them, and everyone else is unaffected.
    expect((await parse(heavy, "two eggs")).status).toBe("ok");
    expect((await parse(other, "a banana")).status).toBe("ok");

    // A new hour starts a new count.
    await env.DB.prepare("UPDATE usda_usage SET hour = '2000-01-01T00' WHERE user_id = ?").bind(await userId(heavy)).run();
    const calls = usda.calls.length;
    expect((await parse(heavy, "some salmon")).status).toBe("ok");
    expect(await usage(heavy)).toEqual({ hour: hour(), calls: usda.calls.length - calls });
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
    expect(body.candidates[0].fdcId).toBe(GRILLED_CHICKEN);
    const pieces = body.candidates.filter((c) => !c.amount.guessed).map((c) => c.fdcId);
    expect(pieces).toContain(BRAISED_CHICKEN);
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
      usdaName: null,
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
    [{ items: [{ ...chickenItem, quantity: 0.009 }] }, "items.0.quantity"],
    [{ items: [{ ...chickenItem, quantity: 177 }] }, "items.0.quantity"], // 5,018 g
    [{ items: [{ ...chickenItem, quantity: 5001, unit: "g" }] }, "items.0.quantity"],
    [{ items: [{ ...chickenItem, quantity: 1000, unit: "lb" }] }, "items.0.quantity"],
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
    [{ items: [{ ...cookieItem, quantity: 1e-307 }] }, "items.0.quantity"],
    [{ items: [{ ...cookieItem, quantity: "1e-308" }] }, "items.0.quantity"],
    [{ items: [{ ...cookieItem, quantity: 0.001 }] }, "items.0.quantity"],
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

  it("stores the plain name the client sends and still reports the USDA name", async () => {
    const { as } = client();
    const email = await signUp(as);
    const day = await logFoods(as, email, [
      { ...chickenItem, name: "  Chicken   breast " },
      { ...eggsItem, name: "   " },
      { ...eggsItem, name: 42 },
      { ...eggsItem, name: "x".repeat(150) },
    ]);
    const [chicken, blank, wrongType, long] = day.entries;
    expect(chicken).toMatchObject({ foodName: "Chicken breast", usdaName: food(ROAST_CHICKEN).description });
    // A missing, blank or odd name never fails the save; it falls back to the USDA description.
    expect(blank.foodName).toBe(food(LARGE_EGG).description);
    expect(wrongType.foodName).toBe(food(LARGE_EGG).description);
    expect(long.foodName).toHaveLength(100);
    expect(day.entries.every((e) => e.usdaName === food(e.fdcId!).description)).toBe(true);

    const manual = await logFoods(as, email, [cookieItem]);
    expect(manual.entries.at(-1)).toMatchObject({ foodName: "Grandma's cookie", fdcId: null, usdaName: null });
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

describe("parse and search to entries", () => {
  it("only offer amounts that can be saved as offered", async () => {
    const { as } = client();
    const email = await signUp(as);
    const offered: { text: string; candidate: Candidate }[] = [];
    const sentences = [
      "6 oz of chicken breast and two eggs",
      "12 slices of chicken breast", // no slice portion: guessed at 1,200 g
      "60 slices of chicken breast", // a 6 kg guess, brought down to 5 kg
      "2000 grams of rice",
      "200 eggs",
      "0.001 cups of milk",
      "a coke and fries", // units only the common-foods table gives: a can, a medium order
    ];
    for (const text of sentences) {
      const { items } = await (await as(email, "POST", "/api/parse", { text })).json<ParseResponse>();
      for (const item of items) {
        expect(item.status, text).toBe("ok");
        for (const candidate of item.candidates) offered.push({ text, candidate });
      }
    }
    for (const query of ["q=steak&quantity=11&unit=slice", "q=steak&quantity=1000&unit=lb", "q=rice&quantity=5000&unit=g"]) {
      const { candidates } = await (await as(email, "GET", `/api/foods/search?${query}`)).json<SearchResponse>();
      expect(candidates.length, query).toBeGreaterThan(0);
      for (const candidate of candidates) offered.push({ text: query, candidate });
    }

    for (const { text, candidate } of offered) {
      const { quantity, unit, grams } = candidate.amount;
      expect(grams, text).toBeLessThanOrEqual(MAX_GRAMS);
      const res = await as(email, "POST", "/api/entries", {
        date: today(),
        meal: null,
        items: [{ fdcId: candidate.fdcId, quantity, unit }],
      });
      expect(res.status, `${text}: ${candidate.name} ${quantity} ${unit}`).toBe(201);
      const saved = (await res.json<DayView>()).entries.at(-1)!;
      expect(saved, text).toMatchObject({ fdcId: candidate.fdcId, quantity, unit, grams, nutrition: candidate.nutrition });
    }

    const amountOf = (text: string) => offered.find((o) => o.text === text)!.candidate.amount;
    expect(amountOf("12 slices of chicken breast")).toEqual({ quantity: 1200, unit: "g", grams: 1200, guessed: true });
    expect(amountOf("60 slices of chicken breast")).toEqual({ quantity: 5000, unit: "g", grams: 5000, guessed: true });
    expect(amountOf("2000 grams of rice")).toEqual({ quantity: 2000, unit: "g", grams: 2000, guessed: false });
    expect(amountOf("200 eggs")).toMatchObject({ guessed: true });
    expect(amountOf("0.001 cups of milk")).toMatchObject({ quantity: 0.01, unit: "cup", guessed: true });
    expect(amountOf("a coke and fries")).toEqual({ quantity: 1, unit: "can", grams: 370, guessed: false });
  });

  it("offers the common-foods table's units and saves entries in them", async () => {
    const { as } = client();
    const email = await signUp(as);
    const { items } = await (await as(email, "POST", "/api/parse", { text: "a coke and some fries" })).json<ParseResponse>();
    const [coke, fries] = items.map((i) => i.candidates[0]);
    expect(coke).toMatchObject({ fdcId: 174852, amount: { quantity: 1, unit: "can", grams: 370, guessed: false } });
    expect(coke.units.map((u) => u.unit)).toEqual(expect.arrayContaining(["can", "bottle", "small", "medium", "large"]));
    expect(fries).toMatchObject({ fdcId: 170698, amount: { quantity: 1, unit: "medium", grams: 117, guessed: false } });

    const day = await logFoods(as, email, [
      { fdcId: 174852, quantity: 2, unit: "can", name: "Coke" },
      { fdcId: 170698, quantity: 1, unit: "large", name: "Fries" },
    ]);
    expect(day.entries.map((e) => [e.unit, e.unitLabel, e.grams])).toEqual([
      ["can", "can (12 fl oz)", 740],
      ["large", "large order", 154],
    ]);
    // Changing the unit keeps the weight, to 2 decimals of a unit: two cans (740 g) are 1.21 bottles.
    const res = await as(email, "PATCH", `/api/entries/${day.entries[0].id}`, { unit: "bottle" });
    expect(res.status).toBe(200);
    expect((await res.json<DayView>()).entries[0]).toMatchObject({ quantity: 1.21, unit: "bottle", grams: 742.9 });
  });
});

describe("writes from other pages", () => {
  // The body a page on another site can send with <form enctype="text/plain">.
  const forged = () => JSON.stringify({ date: today(), items: [{ manual: { name: "csrf", calories: 5000 } }], x: "=1" });

  it("need a JSON content type, which a form on another site can't send", async () => {
    const { as, usda } = client();
    const email = await signUp(as);
    const { id } = (await logFoods(as, email, [cookieItem])).entries[0];
    const before = await dayOf(as, email);
    const me = await (await as(email, "GET", "/api/me")).json();

    const writes: [string, string, unknown][] = [
      ["POST", "/api/entries", forged()],
      ["POST", "/api/entries", { date: today(), meal: null, items: [eggsItem] }],
      ["POST", "/api/parse", { text: "two eggs" }],
      ["PATCH", `/api/entries/${id}`, { quantity: 3 }],
      ["POST", "/api/goals", { calories: 900 }],
      ["POST", "/api/me", { ...profile, displayName: "Mallory" }],
    ];
    const types = ["text/plain", "text/plain;charset=UTF-8", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", ""];
    for (const [method, path, body] of writes) {
      for (const type of types) {
        const res = await as(email, method, path, body, { "Content-Type": type });
        expect(res.status, `${method} ${path} as "${type}"`).toBe(415);
        expect(await res.json()).toEqual({ error: "unsupported_media_type", message: "Send the request as JSON." });
      }
      const none = await as(email, method, path, body, { "Content-Type": null });
      expect(none.status, `${method} ${path} with no type`).toBe(415);
    }
    expect(await dayOf(as, email)).toEqual(before);
    expect(await (await as(email, "GET", "/api/me")).json()).toEqual(me);
    expect(usda.calls).toEqual([]);

    // JSON with a charset is still JSON.
    const ok = await as(email, "POST", "/api/entries", { date: today(), meal: null, items: [cookieItem] }, {
      "Content-Type": "Application/JSON; charset=utf-8",
    });
    expect(ok.status).toBe(201);
  });

  it("are refused when the browser says another site started them", async () => {
    const { as } = client();
    const email = await signUp(as);
    const { id } = (await logFoods(as, email, [cookieItem])).entries[0];
    const before = await dayOf(as, email);

    for (const site of ["cross-site", "same-site"]) {
      const headers = { "Sec-Fetch-Site": site };
      const writes: [string, string, unknown?][] = [
        ["POST", "/api/entries", { date: today(), meal: null, items: [cookieItem] }],
        ["PATCH", `/api/entries/${id}`, { quantity: 3 }],
        ["DELETE", `/api/entries/${id}`],
        ["POST", "/api/goals", { calories: 900 }],
      ];
      for (const [method, path, body] of writes) {
        const res = await as(email, method, path, body, headers);
        expect(res.status, `${method} ${path} from ${site}`).toBe(403);
        expect(await res.json()).toMatchObject({ error: "forbidden" });
      }
      // Reading is fine: another site can't read the response anyway.
      expect((await as(email, "GET", "/api/entries", undefined, headers)).status).toBe(200);
    }
    expect(await dayOf(as, email)).toEqual(before);

    // The app's own pages, and requests the user typed in, still work.
    const own = await as(email, "PATCH", `/api/entries/${id}`, { quantity: 3 }, { "Sec-Fetch-Site": "same-origin" });
    expect(own.status).toBe(200);
    expect((await as(email, "DELETE", `/api/entries/${id}`, undefined, { "Sec-Fetch-Site": "none" })).status).toBe(200);
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
    // A new unit alone keeps the weight: one 172 g breast is 1.23 cups at 140 g a cup.
    expect(await patch({ unit: "cup" })).toMatchObject({
      quantity: 1.23,
      unit: "cup",
      unitLabel: "cup, chopped",
      grams: 172.2,
      nutrition: nutritionFor(per100g, 172.2),
    });
    expect(await patch({ quantity: "1.5", unit: "LB" })).toMatchObject({ quantity: 1.5, unit: "lb", grams: 680.4 });
  });

  it("converts the amount when only the unit changes, so the food weighs the same", async () => {
    const { as } = client();
    const email = await signUp(as);
    const day = await logFoods(as, email, [{ fdcId: BROWN_RICE, quantity: 150, unit: "g" }]);
    const { id } = day.entries[0];
    const per100g = food(BROWN_RICE).per100g;
    expect(day.totals.calories).toBe(nutritionFor(per100g, 150).calories);

    const patch = async (body: unknown) => {
      const res = await as(email, "PATCH", `/api/entries/${id}`, body);
      expect(res.status).toBe(200);
      return res.json<DayView>();
    };
    // 150 g is 0.74 of a 202 g cup, not 150 cups (30 kg).
    const cups = await patch({ unit: "cup" });
    expect(await entryIn(cups, id)).toMatchObject({
      quantity: 0.74,
      unit: "cup",
      grams: 149.5,
      nutrition: nutritionFor(per100g, 149.5),
    });
    expect(cups.totals.calories).toBeLessThan(200);
    expect(await entryIn(await patch({ unit: "oz" }), id)).toMatchObject({ quantity: 5.27, unit: "oz", grams: 149.4 });
    expect(await entryIn(await patch({ unit: "g" }), id)).toMatchObject({ quantity: 149.4, unit: "g", grams: 149.4 });

    // Converting to a unit too small or too big to hold the amount asks for another unit.
    const tiny = (await logFoods(as, email, [{ fdcId: BROWN_RICE, quantity: 1, unit: "g" }])).entries[1];
    const tooSmall = await as(email, "PATCH", `/api/entries/${tiny.id}`, { unit: "lb" });
    expect(tooSmall.status).toBe(400);
    expect(await tooSmall.json()).toMatchObject({ fields: { unit: expect.stringContaining("Pick a smaller unit") } });
    const big = (await logFoods(as, email, [{ fdcId: BROWN_RICE, quantity: 4500, unit: "g" }])).entries[2];
    const tooBig = await as(email, "PATCH", `/api/entries/${big.id}`, { unit: "tsp" });
    expect(tooBig.status).toBe(400);
    expect(await tooBig.json()).toMatchObject({ fields: { unit: expect.stringContaining("Pick a bigger unit") } });
    expect((await dayOf(as, email)).entries.map((e) => [e.quantity, e.unit])).toEqual([
      [149.4, "g"],
      [1, "g"],
      [4500, "g"],
    ]);
  });

  it("gives back the same numbers however often an amount is changed", async () => {
    const { as } = client();
    const email = await signUp(as);
    const cookie = { manual: { name: "cookie", calories: 45, proteinG: 0.4, carbsG: 6.8, fatG: 2.3 }, quantity: 1 };
    const { id } = (await logFoods(as, email, [cookie])).entries[0];
    const patch = async (quantity: number) => {
      const res = await as(email, "PATCH", `/api/entries/${id}`, { quantity });
      expect(res.status).toBe(200);
      const day = await res.json<DayView>();
      expect(day.totals).toEqual(sumOf(day.entries));
      return (await entryIn(day, id)).nutrition;
    };
    const one = { calories: 45, proteinG: 0.4, carbsG: 6.8, fatG: 2.3 };
    expect(await patch(0.25)).toEqual({ calories: 11.3, proteinG: 0.1, carbsG: 1.7, fatG: 0.6 });
    expect(await patch(1)).toEqual(one);
    expect(await patch(0.1)).toEqual({ calories: 4.5, proteinG: 0, carbsG: 0.7, fatG: 0.2 });
    expect(await patch(1)).toEqual(one);
    expect(await patch(0.01)).toEqual({ calories: 0.5, proteinG: 0, carbsG: 0.1, fatG: 0 });
    // The same as logging two cookies in the first place.
    const fresh = (await logFoods(as, email, [{ ...cookie, quantity: 2 }])).entries[1];
    expect(await patch(2)).toEqual(fresh.nutrition);
    expect(fresh.nutrition).toEqual({ calories: 90, proteinG: 0.8, carbsG: 13.6, fatG: 4.6 });
  });

  it("rescales a USDA food whose record lost the entry's unit, without drifting", async () => {
    const { as } = client();
    const email = await signUp(as);
    const before = (await logFoods(as, email, [{ fdcId: ROAST_CHICKEN, quantity: 1, unit: "each" }])).entries[0];
    expect(before).toMatchObject({ unit: "each", grams: 172 });
    await env.DB.prepare("UPDATE usda_cache SET portions_json = '[]' WHERE fdc_id = ?").bind(ROAST_CHICKEN).run();

    const patch = async (quantity: number) => {
      const res = await as(email, "PATCH", `/api/entries/${before.id}`, { quantity });
      expect(res.status).toBe(200);
      return entryIn(await res.json<DayView>(), before.id);
    };
    expect(await patch(2)).toMatchObject({ quantity: 2, unit: "each", grams: 344 });
    await patch(0.3);
    await patch(0.07);
    const back = await patch(1);
    expect(back).toMatchObject({ quantity: 1, unit: "each", grams: 172, nutrition: before.nutrition });

    // Past 5 kg is too much here too: 30 breasts.
    const res = await as(email, "PATCH", `/api/entries/${before.id}`, { quantity: 30 });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ fields: { quantity: expect.stringContaining("5 kg") } });
  });

  it("won't rescale a row saved with a vanishingly small amount, rather than failing", async () => {
    const { as } = client();
    const email = await signUp(as);
    // Rows like this could be saved before amounts had a 0.01 minimum.
    const row = await env.DB.prepare(
      `INSERT INTO food_entries (user_id, log_date, food_name, quantity, unit, grams, calories, protein_g, carbs_g, fat_g)
       VALUES (?, ?, 'x', 1e-320, 'serving', 0, 0.1, 0, 0, 0) RETURNING id`,
    )
      .bind(await userId(email), today())
      .first<{ id: number }>();
    const res = await as(email, "PATCH", `/api/entries/${row!.id}`, { quantity: 100 });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_input", fields: { quantity: expect.any(String) } });
    expect((await dayOf(as, email)).entries[0]).toMatchObject({ quantity: 1e-320, nutrition: { calories: 0.1 } });
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
    [{ quantity: 177 }, "quantity"], // 177 oz is over 5 kg
    [{ quantity: 5001, unit: "g" }, "quantity"],
    [{ quantity: 1e-307 }, "quantity"],
    [{ quantity: 0.009 }, "quantity"],
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
