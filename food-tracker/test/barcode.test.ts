import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { localDate } from "../src/dates";
import { lookupBarcode, offFood, productName } from "../src/food/barcode";
import { barcodeForms, expandUpcE, OFF_ID_MIN, productCode, readBarcode } from "../src/food/gtin";
import type { BarcodeResponse, DayView, FoodRecord, UsualResponse } from "../src/food/types";
import { createFakeOff, createFakeUsda, type FakeUsdaOptions } from "./fixtures/usda/fake-fetch";
import { makeSigner } from "./helpers";

const signer = await makeSigner();
const testEnv: Cloudflare.Env = { ...env, USDA_API_KEY: "usda-barcode-key-7c1e", DEV_USER_EMAIL: undefined };

const CEREAL = "012345678905"; // USDA, two records
const BAR = "099999999990"; // Open Food Facts only, filed as 0099999999990
const ELDERFLOWER = "5012345678900"; // Open Food Facts, kJ per serving only
const NO_NUTRITION = "041000000027"; // Open Food Facts, no nutrition
const NOBODY = "072500000019";

function client(usdaOptions: FakeUsdaOptions = {}, offOptions: { down?: boolean } = {}) {
  const usda = createFakeUsda(usdaOptions);
  const off = createFakeOff(offOptions);
  const app = createApp({ keys: signer.keys, usdaFetch: usda.fetch, offFetch: off.fetch });
  const as = async (email: string, method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { "Cf-Access-Jwt-Assertion": await signer.sign({ email }) };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return app.request(`https://food.example.com${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, testEnv);
  };
  return { usda, off, as };
}

let counter = 0;
async function signUp(as: ReturnType<typeof client>["as"]) {
  const email = `scanner${++counter}-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const res = await as(email, "POST", "/api/me", { displayName: "Sam", timezone: "America/Chicago", trackWeight: false, goals: { calories: 2000 } });
  expect(res.status).toBe(201);
  return email;
}

async function scan(as: ReturnType<typeof client>["as"], email: string, code: string) {
  const res = await as(email, "GET", `/api/foods/barcode?code=${encodeURIComponent(code)}`);
  expect(res.status).toBe(200);
  return res.json<BarcodeResponse>();
}

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM barcode_cache"), env.DB.prepare("DELETE FROM usda_cache")]);
});

describe("barcodes", () => {
  it.each([
    ["016000275287", "016000275287"],
    ["0 16000 27528 7", "016000275287"],
    ["5012345678900", "5012345678900"],
    ["96385074", "96385074"],
    ["00012345678905", "00012345678905"],
  ])("reads %j", (raw, code) => {
    expect(readBarcode(raw)).toBe(code);
  });

  it.each(["", "abc", "12345", "016000275288", "0000000000000", "01600027528", 16000275287, null])("turns away %j", (raw) => {
    expect(readBarcode(raw)).toBeNull();
  });

  it("knows a UPC-A and its EAN-13 are the same product", () => {
    expect(barcodeForms("016000275287")).toEqual(["016000275287", "0016000275287"]);
    expect(barcodeForms("0016000275287")).toEqual(["0016000275287", "016000275287"]);
    expect(barcodeForms("5012345678900")).toEqual(["5012345678900"]);
  });

  it("reads the product code in GS1 QR codes, and nothing from other QR codes", () => {
    expect(productCode("https://id.gs1.org/01/00016000275287", "qr_code")).toBe("00016000275287");
    expect(productCode("https://brand.example.com/01/00016000275287/10/ABC123?s=1", "qr_code")).toBe("00016000275287");
    expect(productCode("(01)00016000275287(17)271231", "qr_code")).toBe("00016000275287");
    expect(productCode("\u001d0100016000275287172712311", "data_matrix")).toBe("00016000275287");
    expect(productCode("https://www.smartlabel.org/product/123", "qr_code")).toBeNull();
    expect(productCode("https://id.gs1.org/01/00016000275288", "qr_code")).toBeNull(); // bad check digit
    expect(productCode("04252614", "upc_e")).toBe("042100005264");
    expect(productCode(" 016000275287 ", "upc_a")).toBe("016000275287");
  });

  it("expands the short UPC-E on small packages", () => {
    expect(expandUpcE("04252614")).toBe("042100005264");
    expect(expandUpcE("01234565")).toBe("012345000065");
    expect(expandUpcE("04252615")).toBeNull(); // wrong check digit
    expect(expandUpcE("94252614")).toBeNull();
  });
});

describe("Open Food Facts products", () => {
  it("work out per 100 g from a serving, and kcal from kJ", () => {
    const food = offFood("5012345678900", {
      product_name: "Sparkling Elderflower",
      brands: "Hedgerow, Other",
      serving_size: "1 can (330 ml)",
      serving_quantity: "330",
      serving_quantity_unit: "ml",
      nutriments: { "energy-kj_serving": 469, carbohydrates_serving: 26.7 },
    })!;
    expect(food.fdcId).toBe(OFF_ID_MIN + 5012345678900);
    expect(food.brand).toBe("Hedgerow");
    expect(food.per100g.kcal).toBeCloseTo(469 / 4.184 / 3.3, 3);
    expect(food.per100g.carbs).toBeCloseTo(26.7 / 3.3, 3);
    expect(food.per100g.protein).toBe(0);
    expect(food.portions).toEqual([{ amount: 1, gramWeight: 330, unitName: "serving", modifier: null, description: "1 can (330 ml)" }]);
  });

  it("are no use without a name or believable calories", () => {
    expect(offFood("1", { product_name: "Nothing on file", nutriments: {} })).toBeNull();
    expect(offFood("1", { nutriments: { "energy-kcal_100g": 100 } })).toBeNull();
    expect(offFood("1", { product_name: "Typo", nutriments: { "energy-kcal_100g": 2400 } })).toBeNull();
    // A serving in ounces can't be weighed, so per-serving numbers alone aren't enough.
    expect(offFood("1", { product_name: "Oz", serving_quantity: 1, serving_quantity_unit: "oz", nutriments: { "energy-kcal_serving": 100 } })).toBeNull();
  });

  it("are named brand first, without saying the brand twice", () => {
    const named = (description: string, brand: string | null) => productName({ description, brand } as FoodRecord);
    expect(named("TOASTED OAT CEREAL", "SUNNY MORNING")).toBe("Sunny Morning Toasted Oat Cereal");
    expect(named("CHEERIOS", "CHEERIOS")).toBe("Cheerios");
    expect(named("Chocolate Peanut Protein Bar", "Fitbar")).toBe("Fitbar Chocolate Peanut Protein Bar");
    expect(named("KELLOGG'S FROSTED FLAKES", "Kellogg's")).toBe("Kellogg's Frosted Flakes");
    expect(named("Plain yogurt", null)).toBe("Plain yogurt");
  });
});

describe("GET /api/foods/barcode", () => {
  it("finds a USDA branded food by its barcode, at one label serving, from the newest record", async () => {
    const { as, usda, off } = client();
    const email = await signUp(as);
    const res = await scan(as, email, CEREAL);
    expect(res).toMatchObject({ code: CEREAL, status: "ok" });
    expect(res.candidates).toHaveLength(1);
    const [cereal] = res.candidates;
    expect(cereal).toMatchObject({
      fdcId: 2700001,
      name: "TOASTED OAT CEREAL",
      brand: "SUNNY MORNING",
      dataType: "Branded",
      entryName: "Sunny Morning Toasted Oat Cereal",
      amount: { quantity: 1, unit: "serving", grams: 39, guessed: false },
      nutrition: { calories: 140, proteinG: 5, carbsG: 29, fatG: 2.5 },
    });
    // One search and one details call; nothing asked of Open Food Facts.
    expect(usda.calls.map((u) => new URL(u).pathname)).toEqual(["/fdc/v1/foods/search", "/fdc/v1/foods"]);
    expect(usda.calls[0]).toContain(`query=${CEREAL}`);
    expect(off.calls).toEqual([]);

    // The same product scanned again, or as its EAN-13, is the cache's answer.
    expect((await scan(as, email, `0${CEREAL}`)).candidates[0].fdcId).toBe(2700001);
    expect(usda.calls).toHaveLength(2);
  });

  it("tries the 12 and 13 digit forms of a code", async () => {
    const { as, usda } = client();
    const email = await signUp(as);
    const res = await scan(as, email, `0${CEREAL}`);
    expect(res.candidates[0].fdcId).toBe(2700001);
    expect(usda.calls.filter((u) => u.includes("/foods/search")).map((u) => new URL(u).searchParams.get("query"))).toEqual([`0${CEREAL}`, CEREAL]);
  });

  it("asks Open Food Facts for what USDA doesn't have, and logs it like any food", async () => {
    const { as, usda, off } = client();
    const email = await signUp(as);
    const res = await scan(as, email, BAR);
    expect(res.status).toBe("ok");
    const [bar] = res.candidates;
    expect(bar).toMatchObject({
      fdcId: OFF_ID_MIN + 99999999990,
      dataType: "Open Food Facts",
      brand: "Fitbar",
      entryName: "Fitbar Chocolate Peanut Protein Bar",
      amount: { quantity: 1, unit: "serving", grams: 60 },
      nutrition: { calories: 210, proteinG: 20, carbsG: 24, fatG: 7 },
    });
    expect(off.calls.map((u) => new URL(u).pathname)).toEqual(["/api/v2/product/099999999990.json", "/api/v2/product/0099999999990.json"]);
    expect(new Set(off.agents)).toEqual(new Set(["FoodTracker/1.0 (food.pivotaiglobal.com)"]));

    // Saved, shown and offered again without asking anyone.
    const before = usda.calls.length;
    const saved = await as(email, "POST", "/api/entries", {
      date: localDate("America/Chicago"),
      meal: "snack",
      spokenText: `Barcode ${BAR}`,
      items: [{ fdcId: bar.fdcId, quantity: 2, unit: "serving", name: bar.entryName }],
    });
    expect(saved.status).toBe(201);
    const day = await saved.json<DayView>();
    expect(day.entries[0]).toMatchObject({ foodName: "Fitbar Chocolate Peanut Protein Bar", quantity: 2, grams: 120, nutrition: { calories: 420 } });
    const usual = await (await as(email, "GET", "/api/foods/usual")).json<UsualResponse>();
    expect(usual.foods[0].entry).toEqual({ fdcId: bar.fdcId, quantity: 2, unit: "serving", name: "Fitbar Chocolate Peanut Protein Bar" });
    expect(usda.calls.length).toBe(before);
    expect(off.calls).toHaveLength(2);
  });

  it("works out calories from kilojoules per serving", async () => {
    const { as } = client();
    const email = await signUp(as);
    const [drink] = (await scan(as, email, ELDERFLOWER)).candidates;
    expect(drink).toMatchObject({ entryName: "Hedgerow Sparkling Elderflower", amount: { quantity: 1, unit: "serving", grams: 330 } });
    expect(drink.nutrition.calories).toBeCloseTo(469 / 4.184, 0);
  });

  it("says plainly when nobody knows a barcode, and doesn't ask again for a week", async () => {
    const { as, usda, off } = client();
    const email = await signUp(as);
    for (const code of [NOBODY, NO_NUTRITION]) {
      const res = await scan(as, email, code);
      expect(res).toEqual({
        code,
        status: "not_found",
        message: "We don't know this barcode yet. Search for it by name, or enter the numbers from the label.",
        candidates: [],
      });
    }
    const calls = usda.calls.length + off.calls.length;
    expect((await scan(as, email, NOBODY)).status).toBe("not_found");
    expect(usda.calls.length + off.calls.length).toBe(calls);

    // A week on, it's asked again.
    const deps = { apiKey: "k", fetch: usda.fetch, offFetch: off.fetch, db: env.DB, now: () => new Date(Date.now() + 8 * 24 * 3600 * 1000) };
    expect(await lookupBarcode(deps, NOBODY)).toBeNull();
    expect(usda.calls.length + off.calls.length).toBeGreaterThan(calls);
  });

  it("still finds Open Food Facts products while USDA is down, and remembers nothing it couldn't check", async () => {
    const down = client({ down: true });
    const email = await signUp(down.as);
    expect((await scan(down.as, email, BAR)).status).toBe("ok");
    const unknown = await scan(down.as, email, CEREAL);
    expect(unknown).toMatchObject({ status: "unavailable", candidates: [] });
    expect(unknown.message).toMatch(/couldn't reach the food database/);

    const both = client({ down: true }, { down: true });
    expect((await scan(both.as, email, NOBODY)).status).toBe("unavailable");

    // Once USDA is back, the product is found: the failure wasn't cached as "not found".
    const { as } = client();
    expect((await scan(as, email, CEREAL)).candidates[0].fdcId).toBe(2700001);
    expect((await scan(as, email, NOBODY)).status).toBe("not_found");
  });

  it("turns away codes that can't be barcodes, without asking anyone", async () => {
    const { as, usda, off } = client();
    const email = await signUp(as);
    for (const code of ["", "123", "012345678906", "abc", "0".repeat(13)]) {
      const res = await as(email, "GET", `/api/foods/barcode?code=${code}`);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_input", fields: { code: expect.any(String) } });
    }
    expect((await as(email, "GET", "/api/foods/barcode")).status).toBe(400);
    expect(usda.calls).toEqual([]);
    expect(off.calls).toEqual([]);
  });

  it("needs a profile", async () => {
    const { as, usda, off } = client();
    const res = await as("nobody-yet@example.com", "GET", `/api/foods/barcode?code=${CEREAL}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "no_profile" });
    expect(usda.calls.length + off.calls.length).toBe(0);
  });
});
