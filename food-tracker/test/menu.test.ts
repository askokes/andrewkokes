import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { localDate } from "../src/dates";
import { MENU_ID_MIN, MENUS, menuFood, menuMatch, menuUnits } from "../src/food/menu";
import { parseMeal } from "../src/food/parse";
import type { DayView, ParseResponse } from "../src/food/types";
import { toCandidate } from "../src/food/units";
import { makeSigner } from "./helpers";

// ---------------------------------------------------------------- the data

describe("restaurant menu data", () => {
  const sizes = MENUS.flatMap((c) => c.items.flatMap((it) => it.sizes.map((s) => ({ chain: c, item: it, size: s }))));

  it("has all nine chains Andrew asked for", () => {
    expect(MENUS.map((c) => c.chain)).toEqual([
      "McDonald's",
      "Chick-fil-A",
      "Subway",
      "Jimmy John's",
      "Jersey Mike's",
      "Taco Bell",
      "Chipotle",
      "Panera Bread",
      "Panda Express",
    ]);
    for (const c of MENUS) expect(c.items.length, c.chain).toBeGreaterThan(20);
  });

  it("gives every size its own id, in its chain's range, never a USDA one", () => {
    const ids = sizes.map((s) => s.size.id);
    expect(new Set(ids).size).toBe(ids.length);
    MENUS.forEach((c, i) => {
      const base = MENU_ID_MIN + (i + 1) * 100_000;
      for (const it of c.items) for (const s of it.sizes) expect(s.id > base && s.id < base + 100_000, `${c.chain} ${it.name}`).toBe(true);
    });
  });

  it("has one usual size per item and no negative numbers", () => {
    for (const c of MENUS) {
      for (const it of c.items) {
        expect(it.sizes.filter((s) => s.default), `${c.chain} ${it.name}`).toHaveLength(1);
        for (const s of it.sizes) {
          for (const n of [s.calories, s.proteinG, s.carbsG, s.fatG]) expect(n).toBeGreaterThanOrEqual(0);
          if (s.grams !== null) expect(s.grams).toBeGreaterThan(0);
        }
      }
    }
  });

  it("says where every item's numbers came from", () => {
    for (const { chain, item } of sizes) expect(item.source, `${chain.chain} ${item.name}`).toMatch(/^https:\/\//);
  });
});

// ---------------------------------------------------------------- matching

/** The top match for a sentence's foods, as /api/parse would look them up. */
function top(text: string) {
  return parseMeal(text).items.map((i) => {
    const m = menuMatch(i.food, { quantity: i.quantity, unit: i.unit, place: i.place });
    if (!m) return null;
    const c = toCandidate(m.foods[0], m.quantity, m.unit);
    return { name: c.name, entryName: c.entryName, quantity: c.amount.quantity, unit: c.amount.unit, calories: Math.round(c.nutrition.calories), noWeight: !!c.noWeight };
  });
}

describe("menuMatch", () => {
  it("finds a signature item with no chain named", () => {
    expect(top("a big mac")[0]).toMatchObject({ name: "McDonald's Big Mac", entryName: "McDonald's Big Mac", quantity: 1, unit: "each" });
    expect(top("a crunchwrap supreme")[0]).toMatchObject({ name: "Taco Bell Crunchwrap Supreme" });
  });

  it("leaves generic foods alone when no chain is named", () => {
    expect(top("fries")).toEqual([null]);
    expect(top("orange chicken")).toEqual([null]);
    expect(top("a chicken sandwich")).toEqual([null]);
  });

  it("uses the place for every food in the sentence, and the size said", () => {
    const [mac, fries] = top("a big mac and large fries from mcdonald's");
    expect(mac).toMatchObject({ name: "McDonald's Big Mac" });
    expect(fries).toMatchObject({ name: "McDonald's World Famous Fries (large)", entryName: "McDonald's World Famous Fries", quantity: 1, unit: "each" });
  });

  it("takes the chain from a food's own name, or a signature item, for the rest of the sentence", () => {
    expect(top("panda express orange chicken and chow mein")[1]).toMatchObject({ name: "Panda Express Chow Mein (side)" });
    expect(top("a crunchwrap supreme and a baja blast")[1]).toMatchObject({ name: "Taco Bell Mtn Dew Baja Blast (medium)" });
  });

  it("counts pieces for things sold by the count", () => {
    expect(top("20 chicken mcnuggets")[0]).toMatchObject({ name: "McDonald's Chicken McNuggets (20-count)", quantity: 1, unit: "each" });
    expect(top("8 piece nuggets from chick-fil-a")[0]).toMatchObject({ name: "Chick-fil-A Nuggets (8-count)", quantity: 1 });
    expect(top("an 8 count chick fil a nuggets")[0]).toMatchObject({ name: "Chick-fil-A Nuggets (8-count)", quantity: 1 });
    // No 7-count is sold: seven pieces of the usual size.
    expect(top("7 nuggets from chick fil a")[0]).toMatchObject({ name: "Chick-fil-A Nuggets (8-count)", quantity: 7, unit: "piece" });
    // Two of something not sold by the count stays two.
    expect(top("two big macs")[0]).toMatchObject({ name: "McDonald's Big Mac", quantity: 2 });
  });

  it("reads sub and soup sizes", () => {
    expect(top("a 6 inch italian bmt from subway")[0]).toMatchObject({ name: "Subway B.M.T. (6-inch)" });
    expect(top("a 12 inch steak and cheese from subway")[0]).toMatchObject({ name: "Subway Steak Philly (footlong)" });
    expect(top("a giant number 13 at jersey mikes")[0]).toMatchObject({ name: "Jersey Mike's #13 The Original Italian (giant)" });
    expect(top("a number 9 from jimmy john's")[0]).toMatchObject({ name: "Jimmy John's #9 Italian Night Club (8-inch)" });
    expect(top("broccoli cheddar in a bread bowl from panera")[0]).toMatchObject({ name: "Panera Bread Broccoli Cheddar Soup (bread bowl)" });
    expect(top("a cup of panera broccoli cheddar")[0]).toMatchObject({ name: "Panera Bread Broccoli Cheddar Soup (cup)" });
  });

  it("keeps a menu name with 'and' or 'with' whole, but only at that restaurant", () => {
    expect(top("a mini turkey and provolone from jersey mike's")).toEqual([
      expect.objectContaining({ name: "Jersey Mike's #7 Turkey and Provolone (mini)" }),
    ]);
    expect(top("chips and guac from chipotle")).toEqual([expect.objectContaining({ name: "Chipotle Chips & Guacamole (regular)" })]);
    expect(parseMeal("turkey and provolone").items.map((i) => i.food)).toEqual(["turkey", "provolone"]);
    expect(top("a mcflurry with oreo")).toHaveLength(1);
    // "With" after the place starts another food.
    expect(top("a spicy deluxe from chick fil a with waffle fries").map((t) => t?.name)).toEqual([
      "Chick-fil-A Spicy Deluxe Sandwich",
      "Chick-fil-A Waffle Potato Fries (medium)",
    ]);
  });

  it("measures chains that publish no weight in servings only", () => {
    const mac = top("a big mac")[0]!;
    expect(mac.noWeight).toBe(true);
    const id = menuMatch("big mac", { quantity: 1, unit: null })!.foods[0].fdcId;
    expect(menuUnits(id)!.map((u) => u.unit)).toEqual(["each"]);
    // Chick-fil-A publishes weights, so oz and g work there.
    const sandwich = menuMatch("sandwich", { quantity: 1, unit: null, place: "chick-fil-a" })!.foods[0];
    expect(menuUnits(sandwich.fdcId)!.map((u) => u.unit)).toEqual(["oz", "lb", "g", "each"]);
    expect(toCandidate(sandwich, 1, null).noWeight).toBeUndefined();
  });

  it("offers the item's other sizes, then like items at the same chain", () => {
    const m = menuMatch("fries", { quantity: 1, unit: "large", place: "mcdonalds" })!;
    expect(m.foods.map((f) => f.description).slice(0, 4)).toEqual([
      "McDonald's World Famous Fries (large)",
      "McDonald's World Famous Fries (kids)",
      "McDonald's World Famous Fries (small)",
      "McDonald's World Famous Fries (medium)",
    ]);
  });
});

// ---------------------------------------------------------------- through the API

const signer = await makeSigner();
const testEnv: Cloudflare.Env = { ...env, DEV_USER_EMAIL: undefined };
let usdaCalls = 0;
const app = createApp({
  keys: signer.keys,
  usdaFetch: async () => {
    usdaCalls++;
    return new Response("{}", { status: 500 });
  },
});

async function as(email: string, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { "Cf-Access-Jwt-Assertion": await signer.sign({ email }) };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(`https://food.example.com${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, testEnv);
}

describe("restaurant foods through the API", () => {
  it("parses, saves and shows a restaurant meal without calling USDA", async () => {
    const email = `menu-${crypto.randomUUID().slice(0, 8)}@example.com`;
    await as(email, "POST", "/api/me", { displayName: "Ava", timezone: "America/Chicago", trackWeight: false, goals: { calories: 2000 } });
    usdaCalls = 0;

    const parsed = await (await as(email, "POST", "/api/parse", { text: "a big mac and a large fries from mcdonald's" })).json<ParseResponse>();
    expect(usdaCalls).toBe(0);
    const [mac, fries] = parsed.items.map((i) => i.candidates[0]);
    expect(mac).toMatchObject({ dataType: "Restaurant", brand: "McDonald's", entryName: "McDonald's Big Mac", noWeight: true });
    expect(fries.name).toBe("McDonald's World Famous Fries (large)");

    const res = await as(email, "POST", "/api/entries", {
      date: localDate("America/Chicago"),
      meal: "lunch",
      items: [mac, fries].map((c) => ({ fdcId: c.fdcId, quantity: c.amount.quantity, unit: c.amount.unit, name: c.entryName })),
    });
    expect(res.status).toBe(201);
    const day = await res.json<DayView>();
    expect(usdaCalls).toBe(0);
    const big = day.entries.find((e) => e.fdcId === mac.fdcId)!;
    expect(big).toMatchObject({ foodName: "McDonald's Big Mac", unitLabel: "1 sandwich", noWeight: true, usdaName: "McDonald's Big Mac" });
    expect(big.nutrition.calories).toBe(mac.nutrition.calories);
    expect(day.totals.calories).toBe(Math.round((mac.nutrition.calories + fries.nutrition.calories) * 10) / 10);

    // Two of them in the edit sheet: twice the published numbers.
    const edited = await (await as(email, "PATCH", `/api/entries/${big.id}`, { quantity: 2 })).json<DayView>();
    expect(edited.entries.find((e) => e.id === big.id)!.nutrition.calories).toBe(Math.round(mac.nutrition.calories * 2 * 10) / 10);
  });

  it("finds restaurant items in the manual search too", async () => {
    const email = `menu-${crypto.randomUUID().slice(0, 8)}@example.com`;
    await as(email, "POST", "/api/me", { displayName: "Ava", timezone: "America/Chicago", trackWeight: false, goals: { calories: 2000 } });
    const res = await (await as(email, "GET", `/api/foods/search?q=${encodeURIComponent("chick fil a spicy deluxe")}`)).json<{ candidates: { name: string }[] }>();
    expect(res.candidates[0].name).toBe("Chick-fil-A Spicy Deluxe Sandwich");
  });

  it("serves menu foods as records any lookup can use", () => {
    const id = menuMatch("big mac", { quantity: 1, unit: null })!.foods[0].fdcId;
    expect(menuFood(id)).toMatchObject({ fdcId: id, dataType: "Restaurant", brand: "McDonald's", portions: [] });
    expect(menuFood(170720)).toBeNull();
  });
});
