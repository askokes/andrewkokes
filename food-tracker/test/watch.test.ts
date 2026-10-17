import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { addDays, localDate } from "../src/dates";
import type { DayView, SummaryResponse, WatchKeyResponse, WatchStatus } from "../src/food/types";
import { hashSyncKey, newSyncKey, parseSync, readAmount, WATCH_SYNC_PATH } from "../src/watch";
import { makeSigner } from "./helpers";

const signer = await makeSigner();
const app = createApp({ keys: signer.keys });
const testEnv: Cloudflare.Env = { ...env, DEV_USER_EMAIL: undefined };
const TZ = "America/Chicago";
const today = () => localDate(TZ);

let counter = 0;
const newEmail = () => `watch${++counter}-${crypto.randomUUID().slice(0, 8)}@example.com`;

async function as(email: string, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { "Cf-Access-Jwt-Assertion": await signer.sign({ email }) };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(`https://food.example.com${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, testEnv);
}

/** What the Shortcut does: no Access token, no cookies, the key in a JSON body. */
function sync(body: unknown, init: { raw?: string; method?: string; path?: string } = {}) {
  return app.request(
    `https://food.example.com${init.path ?? WATCH_SYNC_PATH}`,
    { method: init.method ?? "POST", headers: { "Content-Type": "application/json" }, body: init.raw ?? JSON.stringify(body) },
    testEnv,
  );
}

async function signUp(email = newEmail(), timezone = TZ) {
  const res = await as(email, "POST", "/api/me", { displayName: "Andrew", timezone, trackWeight: false, goals: { calories: 2000 } });
  expect(res.status).toBe(201);
  return email;
}

async function connect(email: string) {
  const res = await as(email, "POST", "/api/watch/key", {});
  expect(res.status).toBe(201);
  return res.json<WatchKeyResponse>();
}

const me = async (email: string) => (await as(email, "GET", "/api/me")).json<{ watch: WatchStatus }>();
const todayView = async (email: string) => (await as(email, "GET", "/api/entries")).json<DayView>();

describe("readAmount", () => {
  it("reads numbers the way a Shortcut sends them", () => {
    expect(readAmount(612.4)).toBe(612.4);
    expect(readAmount("612 kcal")).toBe(612);
    expect(readAmount("8,412")).toBe(8412);
    expect(readAmount("1,820.5 kcal")).toBe(1820.5);
    expect(readAmount(" 95 ")).toBe(95);
  });

  it("adds up a list: samples not grouped by day, or one per line", () => {
    expect(readAmount([400, "212 kcal"])).toBe(612);
    expect(readAmount("400 kcal\n212 kcal")).toBe(612);
  });

  it("tells nothing sent apart from something that isn't a number", () => {
    for (const nothing of [undefined, null, "", "  ", []]) expect(readAmount(nothing)).toBeUndefined();
    for (const bad of ["abc", "-5", -5, "612,5", { value: 3 }, Infinity, true]) expect(readAmount(bad)).toBeNaN();
  });
});

describe("parseSync", () => {
  const key = newSyncKey();

  it("needs a key that looks like one", () => {
    expect(parseSync({ active: 5 })).toMatchObject({ ok: false, status: 401 });
    expect(parseSync({ key: "short", active: 5 })).toMatchObject({ ok: false, status: 401 });
    expect(parseSync("text")).toMatchObject({ ok: false, status: 400 });
  });

  it("rounds, skips what wasn't sent, and says which field is wrong", () => {
    expect(parseSync({ key, active: "612.6 kcal", steps: "" })).toEqual({ ok: true, key, values: { active: 613 } });
    expect(parseSync({ key, steps: "lots" })).toMatchObject({ ok: false, message: expect.stringContaining("steps field should be a number") });
    expect(parseSync({ key, resting: 9000 })).toMatchObject({ ok: false, message: expect.stringContaining("9,000 resting calories is more than a day can hold") });
    expect(parseSync({ key })).toMatchObject({ ok: false, message: expect.stringContaining("named active, resting and steps") });
  });
});

describe("Apple Watch sync", () => {
  it("makes a key, stores only its hash, and shows as connected", async () => {
    const email = await signUp();
    expect((await me(email)).watch).toEqual({ connected: false, lastSync: null });
    const { key, syncUrl } = await connect(email);
    expect(key).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(syncUrl).toBe(`https://food.example.com${WATCH_SYNC_PATH}`);
    const row = await env.DB.prepare("SELECT watch_key_hash FROM users WHERE email = ?").bind(email).first<{ watch_key_hash: string }>();
    expect(row!.watch_key_hash).toBe(await hashSyncKey(key));
    expect(row!.watch_key_hash).not.toContain(key);
    expect((await me(email)).watch).toEqual({ connected: true, lastSync: null });
  });

  it("needs a profile to make a key", async () => {
    expect((await as(newEmail(), "POST", "/api/watch/key", {})).status).toBe(404);
  });

  it("takes the day's totals with only the key, and shows them on today and the charts", async () => {
    const email = await signUp();
    const { key } = await connect(email);
    const res = await sync({ key, active: "612 kcal", resting: 1820.4, steps: "8,412" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect(await res.text()).toBe("Synced today: 612 active cal, 1,820 resting cal, 8,412 steps.");

    const watch = (await todayView(email)).watch;
    expect(watch).toMatchObject({ activeKcal: 612, restingKcal: 1820, steps: 8412 });
    expect(Date.now() - Date.parse(watch!.syncedAt)).toBeLessThan(60_000);
    expect((await me(email)).watch).toEqual({ connected: true, lastSync: watch!.syncedAt });

    const summary = await (await as(email, "GET", `/api/summary?from=${addDays(today(), -1)}&to=${today()}`)).json<SummaryResponse>();
    expect(summary.days[0].watch).toBeNull();
    expect(summary.days[1].watch).toMatchObject({ activeKcal: 612, restingKcal: 1820, steps: 8412 });
  });

  it("files the sync under today in the person's own time zone", async () => {
    const email = await signUp(newEmail(), "Pacific/Kiritimati");
    const { key } = await connect(email);
    expect((await sync({ key, steps: 100 })).status).toBe(200);
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: number }>();
    const row = await env.DB.prepare("SELECT log_date FROM watch_days WHERE user_id = ?").bind(user!.id).first<{ log_date: string }>();
    expect(row!.log_date).toBe(localDate("Pacific/Kiritimati"));
  });

  it("keeps what a later sync leaves out, and never lets a zero replace a real number", async () => {
    const email = await signUp();
    const { key } = await connect(email);
    await sync({ key, active: 300, resting: 900, steps: 4000 });
    await sync({ key, steps: 5000 });
    expect((await todayView(email)).watch).toMatchObject({ activeKcal: 300, restingKcal: 900, steps: 5000 });
    // A locked phone can read as zero.
    await sync({ key, active: 0, resting: 0, steps: 0 });
    expect((await todayView(email)).watch).toMatchObject({ activeKcal: 300, restingKcal: 900, steps: 5000 });
    // A smaller real number is a correction (say the Shortcut counted the phone's steps twice): it wins.
    await sync({ key, steps: 4200 });
    expect((await todayView(email)).watch).toMatchObject({ steps: 4200 });
  });

  it("turns away a wrong, old or missing key, and keeps each person's days apart", async () => {
    const email = await signUp();
    const other = await signUp();
    const first = await connect(email);
    const second = await connect(email);
    const otherKey = (await connect(other)).key;

    const old = await sync({ key: first.key, steps: 10 });
    expect(old.status).toBe(401);
    expect(await old.text()).toContain("That sync key isn't right");
    expect((await sync({ key: newSyncKey(), steps: 10 })).status).toBe(401);
    expect((await sync({ steps: 10 })).status).toBe(401);

    expect((await sync({ key: second.key, steps: 10 })).status).toBe(200);
    expect((await sync({ key: otherKey, steps: 20 })).status).toBe(200);
    expect((await todayView(email)).watch?.steps).toBe(10);
    expect((await todayView(other)).watch?.steps).toBe(20);
  });

  it("stops taking syncs after disconnecting, and keeps what came in", async () => {
    const email = await signUp();
    const { key } = await connect(email);
    await sync({ key, active: 250 });
    const res = await as(email, "DELETE", "/api/watch/key");
    expect(res.status).toBe(200);
    const status = await res.json<WatchStatus>();
    expect(status.connected).toBe(false);
    expect(status.lastSync).not.toBeNull();
    expect((await sync({ key, active: 300 })).status).toBe(401);
    expect((await todayView(email)).watch?.activeKcal).toBe(250);
  });

  it("explains a bad sync in words the Shortcut can show", async () => {
    const email = await signUp();
    const { key } = await connect(email);
    const notJson = await sync(undefined, { raw: "active=5" });
    expect(notJson.status).toBe(400);
    expect(await notJson.text()).toContain("Set its Request Body to JSON");
    const tooMany = await sync({ key, steps: 500_000 });
    expect(tooMany.status).toBe(400);
    expect(await tooMany.text()).toContain("500,000 steps is more than a day can hold");
    expect((await sync(undefined, { raw: JSON.stringify({ key, steps: 1, pad: "x".repeat(5000) }) })).status).toBe(413);
    expect((await todayView(email)).watch).toBeNull();
  });

  it("opens only that one path to the key: everything else still needs Access", async () => {
    const json = await sync(undefined, { method: "GET" });
    expect(json.status).toBe(401);
    expect(await json.json()).toMatchObject({ error: "unauthorized" });
    expect((await sync({ key: newSyncKey(), steps: 1 }, { path: `${WATCH_SYNC_PATH}/more` })).status).toBe(401);
    expect((await sync({}, { path: "/api/watch/key" })).status).toBe(401);
  });
});
