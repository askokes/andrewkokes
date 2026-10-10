// Accuracy against live USDA search results and independent labels.
//
// search-core.json holds what USDA's search really returned (Foundation and
// SR Legacy, top 50, USDA's order) for 153 everyday foods. labels.json says,
// for each, which record is best, which are acceptable (same as-eaten food,
// calories within about a quarter) and which would be a disaster at the top of
// the list (dried, raw where cooked is meant, a different food sharing a word).
// The labeler never saw src/food/common.ts.
//
// The app's top pick is worked out the way searchFoods does it: the common-foods
// table's record when the phrase is in the table, otherwise rankHits over the
// search hits (as extractSearchHit reads them), with the query normalizeQuery
// gives. It doesn't see what a Branded fallback would add for a food the core
// search can't find ("latte" and "coke" have no core hits at all).
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { COMMON_FOODS } from "../src/food/common";
import { extractSearchHit } from "../src/food/nutrition";
import { parseMeal } from "../src/food/parse";
import { lookup } from "../src/food/routes";
import type { Amount, FoodRecord } from "../src/food/types";
import { commonFor, isReasonable, looksLikeBrand, normalizeQuery, rankHits, SEARCH_PAGE_SIZE } from "../src/food/usda";
import { createFakeUsda } from "./fixtures/usda/fake-fetch";
import adversarialFile from "./fixtures/usda/live/adversarial.json";
import commonFile from "./fixtures/usda/live/common-foods.json";
import labelsFile from "./fixtures/usda/live/labels.json";
import live from "./fixtures/usda/live/search-core.json";

interface Label {
  query: string;
  best: number | null;
  acceptable: number[];
  disasters: number[];
  defaultAmount: string;
  note: string;
}
type Row = [number, string, string, number | null, number | null, number | null, number | null];

const labels = labelsFile.labels as unknown as Label[];
const queries = live.queries as unknown as Record<string, { totalHits: number; hits: Row[] }>;

/**
 * Where the labels and the table disagree, who is right. Each entry was
 * decided on the as-eaten form, what a teenager most likely means, and the
 * calories. "table" means the table was changed to the label's pick; "label"
 * would mean the label is wrong and the table keeps its record (an override
 * the scoring below honors). There are no "label" decisions: where the table
 * keeps a record other than the label's best, that record is one the label
 * accepts (see TABLE_KEEPS).
 */
const DECISIONS: { query: string; was: number; now: number; who: "table" | "label"; wasKept: boolean; why: string }[] = [
  {
    query: "chicken thigh",
    wasKept: true,
    was: 173625,
    now: 172388,
    who: "table",
    why: "Thighs are mostly bought boneless and skinless; with skin (232 kcal/100 g) is 30% more and stays the first alternative.",
  },
  {
    query: "chicken nuggets",
    wasKept: true,
    was: 170718,
    now: 172112,
    who: "table",
    why: "Generic white-meat nuggets (261) over a fast-food record (307); both are nuggets, but the label names the generic one and the fast-food one stays an alternative.",
  },
  {
    query: "chicken wings",
    wasKept: true,
    was: 173629,
    now: 173630,
    who: "table",
    why: "Restaurant wings are fried without a coating, near roasted wings (254) once sauced; flour-fried (321) is 26% more and stays an alternative.",
  },
  {
    query: "tofu",
    wasKept: false,
    was: 172475,
    now: 172448,
    who: "table",
    why: "Store firm tofu is about 80 kcal/100 g; the old record (144) is a dense kind, nearly twice as much. Dropped: it has no serving to offer as an alternative.",
  },
  {
    query: "chicken noodle soup",
    wasKept: true,
    was: 172909,
    now: 171148,
    who: "table",
    why: "Ready-to-serve, deli and homemade soups are about 41 kcal/100 g; condensed soup made up with water (24) undercounts them by 40% and stays an alternative.",
  },
  {
    query: "lasagna",
    wasKept: true,
    was: 173334,
    now: 169850,
    who: "table",
    why: "Homemade and restaurant lasagna is about 185 kcal/100 g; a frozen entree (124) undercounts it by a third and stays an alternative.",
  },
];

/**
 * Table records that aren't the label's best but are on its acceptable list,
 * and why the table keeps them. Listed so the difference is a decision, not a
 * silent pass.
 */
const TABLE_KEEPS: Record<string, string> = {
  eggs: "SR raw whole egg (143) over Foundation's (148): same egg, and SR's large/medium/small portions give 'two eggs' a weight.",
  egg: "As 'eggs'.",
  "almond milk": "Shelf-stable unsweetened (15) over refrigerated (19): both plain unsweetened almond milk.",
  avocado: "California (Hass) avocado, the one sold in US stores; 'all varieties' is 4% less.",
  "macaroni and cheese": "Box mix made up as the box says (164); the label's best is the same dinner made with 2% milk and margarine (190).",
  pancakes: "Buttermilk pancakes from a recipe; the label's plain pancakes have the same 227 kcal.",
  turkey: "Light meat roasted (147) as in sliced turkey breast; the label's whole bird meat is 159.",
  "ground beef": "80/20 crumbles, the usual supermarket blend; the label's unspecified-fat record is 240 to its 272.",
  steak: "Top sirloin trimmed lean (178); the label's best keeps the fat (243). Both are acceptable to the label.",
  shrimp: "Cooked moist heat (119) against the label's plain cooked (99): same shrimp.",
  "peanut butter": "SR smooth with salt (598) against Foundation creamy (589).",
  "cheddar cheese": "SR cheddar (403) against Foundation cheddar (408).",
  "greek yogurt": "Plain nonfat (61) against plain low-fat (73), as most single Greek yogurt cups are.",
  yogurt: "Low-fat fruit yogurt, 9 g protein (99) against 10 g (102).",
  peas: "Frozen peas boiled (78) against fresh peas boiled (84): most peas are bought frozen.",
  "bell pepper": "Green (20) against red (26): both raw sweet peppers.",
  sprite: "Generic lemon-lime soda (41) against the Sprite record (40).",
  "tortilla chips": "White corn (472) against yellow (497).",
  cake: "Yellow layer cake with chocolate frosting (379) against chocolate (389).",
  "fried rice": "Two SR copies of the same restaurant fried rice record; the table uses the other one.",
};

/**
 * Queries where the ranker alone (no table) still puts a labeled disaster first,
 * and why. All of them are in the table, so the app never shows these first.
 */
const KNOWN_RANKER_DISASTERS: Record<string, string> = {
  oatmeal: "Every one of USDA's 50 hits for 'oatmeal' is a labeled disaster (oatmeal bread, cookies, dry instant packets); the app searches 'oats cooked' instead.",
  soda: "'Club soda' and 'grape soda' read the same; nothing in the words says club soda has no calories.",
  lemonade: "A lemonade powder made up with water (14 kcal, sugar-free by its calories) reads like the concentrate made up with water.",
  "macaroni and cheese": "'Macaroni and Cheese, canned entree' reads as plainer than the box mix 'prepared with 2% milk and margarine'.",
  sandwich: "'Ice cream sandwich' reads like any other sandwich; the table maps 'sandwich' to a cold cut sub.",
};

function hitsFor(query: string): FoodRecord[] {
  const rows = queries[query]?.hits ?? [];
  return rows.slice(0, SEARCH_PAGE_SIZE).flatMap(([fdcId, dataType, description, kcal, protein, carbs, fat]) => {
    const nutrients: [number, number | null][] = [[1008, kcal], [1003, protein], [1005, carbs], [1004, fat]];
    const hit = extractSearchHit({
      fdcId,
      dataType,
      description,
      foodNutrients: nutrients.flatMap(([nutrientId, value]) => (value === null ? [] : [{ nutrientId, value }])),
    });
    return hit ? [hit] : [];
  });
}

const rankerPick = (query: string) => rankHits(normalizeQuery(query), hitsFor(query))[0]?.fdcId ?? null;
const appPick = (query: string) => commonFor(query)?.fdcId ?? rankerPick(query);

interface Score {
  query: string;
  pick: number | null;
  best: number | null;
  ok: boolean;
  disaster: boolean;
  covered: boolean;
}

function score(pickOf: (query: string) => number | null): Score[] {
  return labels.map((label) => {
    const pick = pickOf(label.query);
    const override = DECISIONS.find((d) => d.query === label.query && d.who === "label" && d.now === pick);
    return {
      query: label.query,
      pick,
      best: label.best,
      ok: pick !== null && (label.acceptable.includes(pick) || override !== undefined),
      disaster: pick !== null && label.disasters.includes(pick),
      covered: commonFor(label.query) !== null,
    };
  });
}

const descriptions = new Map<number, string>([
  ...Object.values(queries).flatMap((q) => q.hits.map((h): [number, string] => [h[0], h[2]])),
  ...(commonFile.foods as { fdcId: number; description: string }[]).map((f): [number, string] => [f.fdcId, f.description]),
]);
const describeRecord = (id: number | null) => (id === null ? "nothing" : `${id} ${descriptions.get(id) ?? ""}`.trim());
const percent = (n: number, of: number) => `${n}/${of} = ${((100 * n) / of).toFixed(1)}%`;

function report(title: string, scores: Score[]) {
  const labeled = scores.filter((s) => s.best !== null);
  const misses = labeled.filter((s) => !s.ok);
  const disasters = scores.filter((s) => s.disaster);
  console.log(
    [
      `${title}: top-1 acceptable ${percent(labeled.length - misses.length, labeled.length)}, disasters ${disasters.length}`,
      ...misses.map((s) => `  miss     ${s.query}: ${describeRecord(s.pick)} (best ${describeRecord(s.best)})`),
      ...disasters.map((s) => `  DISASTER ${s.query}: ${describeRecord(s.pick)}`),
    ].join("\n"),
  );
  return { labeled, misses, disasters };
}

describe("live USDA search, scored against independent labels", () => {
  it("has a label for every live query", () => {
    expect(labels.map((l) => l.query).sort()).toEqual(Object.keys(queries).sort());
    for (const label of labels) {
      if (label.best !== null) expect(label.acceptable, label.query).toContain(label.best);
      for (const id of label.acceptable) expect(label.disasters, `${label.query} ${id}`).not.toContain(id);
    }
  });

  it("never puts a labeled disaster first, and gets at least 95% right (every query the table covers)", () => {
    const scores = score(appPick);
    const { labeled, misses, disasters } = report("app (table, then ranked search)", scores);
    expect(disasters.map((s) => s.query)).toEqual([]);
    expect(labeled.length - misses.length).toBeGreaterThanOrEqual(Math.ceil(0.95 * labeled.length));
    expect(misses.filter((s) => s.covered).map((s) => `${s.query}: ${describeRecord(s.pick)}`)).toEqual([]);
  });

  it("covers most labeled queries with the table", () => {
    const covered = labels.filter((l) => commonFor(l.query) !== null);
    console.log(`table coverage: ${percent(covered.length, labels.length)} of the live queries`);
    expect(covered.length).toBeGreaterThanOrEqual(140);
  });

  it("scores the ranker alone, with the table switched off", () => {
    const { disasters } = report("ranker only (rankHits over the live hits)", score(rankerPick));
    // No accuracy floor here. Every disaster the ranker alone still makes is listed and explained above.
    expect(disasters.map((s) => s.query).filter((q) => !(q in KNOWN_RANKER_DISASTERS))).toEqual([]);
    for (const query of Object.keys(KNOWN_RANKER_DISASTERS)) expect(commonFor(query), query).not.toBeNull();
  });

  it("keeps its decisions honest: changed records are the label's pick, kept ones are acceptable", () => {
    for (const d of DECISIONS) {
      const label = labels.find((l) => l.query === d.query)!;
      expect(commonFor(d.query)?.fdcId, d.query).toBe(d.now);
      if (d.who === "table") expect(label.acceptable, d.query).toContain(d.now);
      const offered = COMMON_FOODS.some((e) => e.fdcId === d.was || e.alternatives?.includes(d.was));
      expect(offered, `${d.query}: ${d.was} still offered`).toBe(d.wasKept);
    }
    for (const [query, why] of Object.entries(TABLE_KEEPS)) {
      const label = labels.find((l) => l.query === query)!;
      const pick = commonFor(query)?.fdcId;
      expect(pick, `${query}: ${why}`).not.toBe(label.best);
      expect(label.acceptable, `${query}: ${why}`).toContain(pick);
    }
    // Every other table query is exactly the label's best.
    for (const label of labels) {
      const pick = commonFor(label.query)?.fdcId;
      if (pick === undefined || label.query in TABLE_KEEPS) continue;
      expect(pick, label.query).toBe(label.best);
    }
  });
});

// ---------------------------------------------------------------- adversarial phrases
//
// An adversarial live test of food matching (2026-10-10) found these phrases
// going badly wrong: gummy bears logged as bear meat, a bagel with cream cheese
// as cream cheese alone, a Slurpee as popping candy. adversarial.json holds the
// live USDA responses (core and Branded searches, details) the app needs for
// each one, served by fake-fetch.ts, so these run the real path offline:
// parseMeal, then lookup exactly as /api/parse calls it (table first, ranked
// search, Branded fallback, amounts). Calories are checked against what the
// phrase means to a teenager, from the test's expectations.

interface Pick {
  /** The parsed food phrase. */
  food: string;
  /** The record offered first, when the table or one clear record decides it. */
  fdcId?: number;
  /** Otherwise (Branded), what the first record's name must and mustn't say. */
  name?: RegExp;
  notName?: RegExp;
  /** Calories of the amount offered first. */
  kcal: [number, number];
  amount?: Partial<Amount>;
}

const ADVERSARIAL: { phrase: string; items: Pick[] }[] = [
  // Was bear meat at a guessed 100 g: gummy candy, a snack bag; counted gummies count.
  { phrase: "gummy bears", items: [{ food: "gummy bears", fdcId: 167989, kcal: [130, 160], amount: { unit: "bag", guessed: false } }] },
  { phrase: "10 gummy bears", items: [{ food: "gummy bears", fdcId: 167989, kcal: [80, 95], amount: { quantity: 10, unit: "piece" } }] },
  // Was the low-carb can at a guessed 100 g (5 kcal): regular Monster, a 16 fl oz can.
  { phrase: "a monster energy drink", items: [{ food: "monster energy drink", fdcId: 171935, kcal: [200, 240], amount: { unit: "can", grams: 480 } }] },
  { phrase: "an energy drink", items: [{ food: "energy drink", fdcId: 171935, kcal: [200, 240] }] },
  // "With" lost the first food; peanut butter and cream cheese are a 2 tbsp serving.
  {
    phrase: "a bagel with cream cheese",
    items: [
      { food: "bagel", fdcId: 174899, kcal: [250, 270] },
      { food: "cream cheese", fdcId: 173418, kcal: [95, 110], amount: { unit: "serving", grams: 29 } },
    ],
  },
  {
    phrase: "an apple with peanut butter",
    items: [
      { food: "apple", fdcId: 171688, kcal: [90, 100] },
      { food: "peanut butter", fdcId: 174266, kcal: [185, 200], amount: { unit: "serving", grams: 32 } },
    ],
  },
  {
    phrase: "a bowl of cereal with milk",
    items: [
      { food: "cereal", fdcId: 173884, kcal: [100, 110], amount: { unit: "cup" } },
      { food: "milk", fdcId: 171267, kcal: [60, 125] },
    ],
  },
  {
    phrase: "a cup of coffee with milk",
    items: [
      { food: "coffee", fdcId: 171890, kcal: [0, 5] },
      { food: "milk", fdcId: 171267, kcal: [10, 20], amount: { quantity: 2, unit: "tbsp" } },
    ],
  },
  {
    phrase: "an iced coffee with cream",
    items: [
      { food: "iced coffee", fdcId: 171890, kcal: [0, 5] },
      { food: "cream", fdcId: 170857, kcal: [50, 65], amount: { quantity: 2, unit: "tbsp" } }, // not cream cheese
    ],
  },
  // Was powdered sugar: "scoop" is a unit, protein powder is in the table.
  { phrase: "a scoop of protein powder", items: [{ food: "protein powder", fdcId: 173180, kcal: [100, 125], amount: { unit: "scoop" } }] },
  { phrase: "two scoops of ice cream", items: [{ food: "ice cream", fdcId: 167575, kcal: [250, 300], amount: { grams: 132 } }] },
  // Was a dry alfredo sauce mix: a dry mix isn't the food, so Branded is searched and finds the dish.
  { phrase: "chicken alfredo", items: [{ food: "chicken alfredo", name: /chicken alfredo/i, notName: /mix|sauce|dry/i, kcal: [500, 900] }] },
  // Was the empty 4 g cone.
  { phrase: "an ice cream cone", items: [{ food: "ice cream cone", fdcId: 173274, kcal: [170, 250] }] },
  // Was a 20 kcal side salad at a guessed 100 g; SR has no Caesar salad, Branded does.
  { phrase: "a caesar salad", items: [{ food: "caesar salad", name: /caesar salad/i, notName: /dressing|pasta/i, kcal: [150, 500] }] },
  // Was a Thai curry soup; SR has no pad thai, Branded's is a plate of it.
  { phrase: "pad thai", items: [{ food: "pad thai", name: /pad thai/i, notName: /sauce|seasoning|kit|noodles/i, kcal: [250, 700] }] },
  // Was a seasoning cube.
  { phrase: "pho", items: [{ food: "pho", name: /pho/i, notName: /seasoning|cube|broth|bomb/i, kcal: [400, 600] }] },
  // Was a popping-boba topping.
  { phrase: "boba", items: [{ food: "boba", name: /milk tea/i, notName: /kit|ice cream/i, kcal: [100, 450] }] },
  // Was a cookie straw.
  { phrase: "a caramel frappuccino", items: [{ food: "caramel frappuccino", name: /frappuccino.*coffee drink/i, kcal: [250, 400] }] },
  // Was popping candy: frozen soda, a medium.
  { phrase: "a slurpee", items: [{ food: "slurpee", fdcId: 174852, kcal: [150, 300], amount: { unit: "medium" } }] },
  // Was a dry chai powder.
  { phrase: "a chai latte", items: [{ food: "chai latte", fdcId: 173776, kcal: [200, 280], amount: { unit: "medium" } }] },
  // Was "CHEESY MAC" from Branded.
  { phrase: "a big mac", items: [{ food: "big mac", fdcId: 170720, kcal: [540, 600], amount: { unit: "each" } }] },
  // Was Sun Country wheat bran.
  { phrase: "a capri sun", items: [{ food: "capri sun", fdcId: 174176, kcal: [40, 90], amount: { unit: "pouch" } }] },
  // Was a French bread roll.
  { phrase: "a california roll", items: [{ food: "california roll", name: /california roll/i, kcal: [150, 350] }] },
  // Was PB&J oatmeal.
  { phrase: "a pb&j", items: [{ food: "pb and j", name: /peanut butter.*jelly sandwich/i, notName: /chocolate/i, kcal: [280, 450] }] },
  // Was meatless veggie gyro slices.
  { phrase: "a gyro", items: [{ food: "gyro", name: /gyro/i, notName: /veggie|vegan/i, kcal: [400, 800] }] },
  // Was a frozen chicken rice bowl.
  { phrase: "an acai bowl", items: [{ food: "acai bowl", name: /acai bowl/i, kcal: [150, 550] }] },
  // Was Nutella cookies: "spoonful" is a tablespoon.
  { phrase: "a spoonful of nutella", items: [{ food: "nutella", fdcId: 168000, kcal: [90, 110], amount: { unit: "tbsp" } }] },
  // Was bologna and broccoli: one dish.
  { phrase: "beef and broccoli", items: [{ food: "beef and broccoli", fdcId: 168072, kcal: [250, 350] }] },
  { phrase: "beef", items: [{ food: "beef", fdcId: 171799, kcal: [200, 260] }] },
  // Was a McGriddle at a guessed 100 g plus a second slice of cheese.
  { phrase: "a bacon egg and cheese", items: [{ food: "bacon egg and cheese", fdcId: 172029, kcal: [400, 500] }] },
  // Was a grilled club.
  { phrase: "a spicy chicken sandwich", items: [{ food: "spicy chicken sandwich", fdcId: 170295, kcal: [450, 500] }] },
  // Was a snack-size ranch wrap.
  { phrase: "a chicken caesar wrap", items: [{ food: "chicken caesar wrap", name: /chicken caesar wrap/i, kcal: [300, 700] }] },
  // Was a teriyaki rice bowl.
  { phrase: "a burrito bowl", items: [{ food: "burrito bowl", name: /burrito bowl/i, kcal: [300, 800] }] },
  // Was a slice of school-lunch pizza.
  { phrase: "pizza rolls", items: [{ food: "pizza rolls", fdcId: 168957, kcal: [200, 280], amount: { unit: "serving" } }] },
  // Was one pierogi: Asian dumplings, six of them unless counted.
  { phrase: "dumplings", items: [{ food: "dumplings", fdcId: 169773, kcal: [200, 300], amount: { unit: "serving" } }] },
  { phrase: "six dumplings", items: [{ food: "dumplings", fdcId: 169773, kcal: [200, 300], amount: { quantity: 6, unit: "piece" } }] },
  // Was sugar-cane candy.
  { phrase: "jello", items: [{ food: "jello", fdcId: 169596, kcal: [60, 90] }] },
  // Was pecan pie.
  { phrase: "a slice of pie", items: [{ food: "pie", fdcId: 175011, kcal: [280, 330], amount: { unit: "piece" } }] },
  // Were guessed 100 g: USDA's "1 item" and "6 inch sub" portions are read now.
  { phrase: "a quarter pounder", items: [{ food: "quarter pounder", fdcId: 170321, kcal: [400, 430], amount: { unit: "each", grams: 171 } }] },
  { phrase: "a tuna sandwich", items: [{ food: "tuna sandwich", fdcId: 170299, kcal: [450, 550], amount: { unit: "each", grams: 237 } }] },
  { phrase: "a yogurt parfait", items: [{ food: "yogurt parfait", fdcId: 170355, kcal: [120, 130], amount: { unit: "each", grams: 149 } }] },
  { phrase: "a slice of birthday cake", items: [{ food: "birthday cake", fdcId: 174944, kcal: [500, 560], amount: { unit: "piece" } }] },
  // Was a guessed 100 g: a plate.
  { phrase: "chicken and rice", items: [{ food: "chicken and rice", fdcId: 167659, kcal: [360, 500] }] },
  // Was one stick: an order, unless counted.
  { phrase: "mozzarella sticks", items: [{ food: "mozzarella sticks", fdcId: 169015, kcal: [400, 600], amount: { unit: "order" } }] },
  { phrase: "a mozzarella stick", items: [{ food: "mozzarella stick", fdcId: 169015, kcal: [90, 110], amount: { unit: "piece" } }] },
  // Was 163 kcal: chain tenders weigh more than USDA's 30 g strip.
  { phrase: "two chicken tenders", items: [{ food: "chicken tenders", fdcId: 173321, kcal: [220, 280] }] },
  // Was "fried rice, without meat".
  { phrase: "chicken fried rice", items: [{ food: "chicken fried rice", name: /chicken fried rice/i, notName: /without meat/i, kcal: [200, 450] }] },
  // Was a walking-taco kit.
  { phrase: "a bag of hot cheetos", items: [{ food: "hot cheetos", name: /cheetos.*hot/i, notName: /taco|mix/i, kcal: [150, 175] }] },
  // On yogurt, granola is the label's half cup, not a 597 kcal cup.
  {
    phrase: "yogurt with granola",
    items: [
      { food: "yogurt", fdcId: 170889, kcal: [150, 180] },
      { food: "granola", fdcId: 171646, kcal: [280, 310] },
    ],
  },
];

describe("adversarial phrases, through parse and lookup over live USDA responses", () => {
  beforeAll(async () => {
    await env.DB.batch([env.DB.prepare("DELETE FROM usda_cache"), env.DB.prepare("DELETE FROM usda_search_cache")]);
  });

  it.each(ADVERSARIAL)("$phrase", async ({ phrase, items }) => {
    const usda = { apiKey: "test-key", fetch: createFakeUsda().fetch, db: env.DB };
    const parsed = parseMeal(phrase).items;
    expect(parsed.map((i) => i.food)).toEqual(items.map((i) => i.food));
    for (const [i, item] of parsed.entries()) {
      const want = items[i];
      const result = await lookup(usda, item.food, item.quantity, item.unit, { limit: 5, brandHint: looksLikeBrand(item.text) });
      const top = result.candidates[0];
      expect(top, `${phrase}: ${item.food}`).toBeDefined();
      const what = `${phrase}: ${item.food} -> ${top.fdcId} ${top.name}, ${top.amount.quantity} ${top.amount.unit} = ${top.amount.grams} g, ${top.nutrition.calories} kcal`;
      if (want.fdcId !== undefined) expect(top.fdcId, what).toBe(want.fdcId);
      if (want.name) expect(top.name, what).toMatch(want.name);
      if (want.notName) expect(top.name, what).not.toMatch(want.notName);
      expect(top.amount.guessed, what).toBe(false);
      expect(top.nutrition.calories, what).toBeGreaterThanOrEqual(want.kcal[0]);
      expect(top.nutrition.calories, what).toBeLessThanOrEqual(want.kcal[1]);
      if (want.amount) expect(top.amount, what).toMatchObject(want.amount);
    }
  });

  it("ranks the regular kind over low-carb, and reads Branded names past sizes and repeats", () => {
    const hit = (fdcId: number, description: string, dataType = "SR Legacy", brand: string | null = null, kcal = 50) =>
      ({ fdcId, description, dataType, brand, per100g: { kcal } });
    const ranked = (query: string, hits: ReturnType<typeof hit>[]) => rankHits(query, hits).map((h) => h.fdcId);
    // "Low carb" is a diet variant, like "sugar free".
    expect(
      ranked("monster energy drink", [
        hit(173162, "Beverages, MONSTER energy drink, low carb", "SR Legacy", null, 5),
        hit(171935, "Beverages, Energy Drink, Monster, fortified with vitamins C, B2, B3, B6, B12", "SR Legacy", null, 47),
      ])[0],
    ).toBe(171935);
    // A package size isn't part of the name: "Cheetos Hot 9.5z" is hot Cheetos.
    expect(
      ranked("hot cheetos", [
        hit(1, "CHEETOS, CRUNCHY TOP N GO WALKING TACO, FLAMIN' HOT, FLAMIN' HOT", "Branded", "CHEETOS", 571),
        hit(2, "Cheetos Hot 9.5z", "Branded", "Cheetos", 571),
      ])[0],
    ).toBe(2);
    // Meatless is a different food unless asked for; a Branded name repeated after a comma ("GYRO PIZZA, GYRO")
    // is not a kind of the food, nor is a flavor ("MILK CHOCOLATE, PEANUT BUTTER & JELLY SANDWICH").
    const gyros = [
      hit(1, "VEGGIE GYROS", "Branded", "VIANA", 286),
      hit(2, "GYRO PIZZA, GYRO", "Branded", "ANTHONINO'S TAVERNA", 150),
      hit(3, "GYROS SLICES", "Branded", "KRONOS", 365),
    ];
    expect(ranked("gyro", gyros).at(-1)).toBe(1);
    expect(ranked("veggie gyro", gyros)[0]).toBe(1);
    expect(isReasonable("gyro", gyros[1])).toBe(false);
    expect(isReasonable("peanut butter and jelly sandwich", hit(4, "MILK CHOCOLATE, PEANUT BUTTER & JELLY SANDWICH", "Branded", "HEBERT", 484))).toBe(false);
    expect(isReasonable("peanut butter and jelly sandwich", hit(5, "PEANUT BUTTER & GRAPE JELLY SANDWICH", "Branded", "Taylor Fresh Foods, Inc.", 286))).toBe(true);
    // A drink at hundreds of kcal per 100 g is a mix however it's named; a soup the same.
    expect(isReasonable("chai latte", hit(6, "PACIFIC CHAI, SPICE CHAI LATTE", "Branded", "PACIFIC CHAI", 429))).toBe(false);
    expect(isReasonable("chai latte", hit(7, "LATTE, CHAI TEA", "Branded", "TEAS' TEA", 33))).toBe(true);
    expect(isReasonable("pho", hit(8, "VEGETABLE VIETNAMESE PHO", "Branded", "SNAPDRAGON", 356))).toBe(false);
    // Seasonings, broth bombs and kits are what a dish is made from.
    expect(isReasonable("pho", hit(9, "PHO BROTH BOMB, PHO", "Branded", "ACID LEAGUE", 33))).toBe(false);
    expect(isReasonable("boba milk tea", hit(10, "MILK TEA INSPIRED INSTANT BOBA DRINK KIT", "Branded", "BOBABAM", 200))).toBe(false);
  });

  it("offers a sugar-free can after the regular energy drink", async () => {
    const usda = { apiKey: "test-key", fetch: createFakeUsda().fetch, db: env.DB };
    const { candidates } = await lookup(usda, "energy drink", 1, null, { limit: 5, brandHint: false });
    const sugarFree = candidates.find((c) => c.fdcId === 174822);
    expect(sugarFree?.amount).toMatchObject({ unit: "can", guessed: false });
    expect(sugarFree!.nutrition.calories).toBeLessThan(25);
  });

  it("goes to Branded when the best core hit isn't the food as eaten", () => {
    type LiveRow = [number, string, string, string | null, string | null, number | null, string | null, string | null, number | null];
    const live = adversarialFile.search as unknown as Record<"core" | "branded", Record<string, { hits: LiveRow[] }>>;
    const hits = (scope: "core" | "branded", query: string) =>
      live[scope][query].hits.flatMap(([fdcId, dataType, description, brandName, brandOwner, , , , kcal]) => {
        const hit = extractSearchHit({
          fdcId,
          dataType,
          description,
          brandName,
          brandOwner,
          foodNutrients: kcal === null ? [] : [{ nutrientId: 1008, value: kcal }],
        });
        return hit ? [hit] : [];
      });
    const top = (scope: "core" | "branded", query: string) => rankHits(query, hits(scope, query))[0];
    // Bear meat for "gummy bears", soy chai for "chai latte" (both table foods now), a dry mix for
    // "chicken alfredo", a curry soup for "pad thai", a side salad for "caesar salad", meatless fried
    // rice for "chicken fried rice". Branded has each of the last four.
    for (const query of ["gummy bears", "chai latte", "chicken alfredo", "pad thai", "caesar salad", "chicken fried rice"]) {
      const core = top("core", query);
      expect(core === undefined || !isReasonable(query, core), `${query}: core ${core?.description}`).toBe(true);
    }
    for (const query of ["chicken alfredo", "pad thai", "caesar salad", "chicken fried rice"]) {
      expect(isReasonable(query, top("branded", query)), `${query}: Branded ${top("branded", query).description}`).toBe(true);
    }
    // The core search answers these itself.
    for (const query of ["quarter pounder", "spicy chicken sandwich", "tuna sandwich"]) {
      expect(isReasonable(query, top("core", query)), query).toBe(true);
    }
    // "Big" is a size USDA doesn't write ("a big salad" is a salad), so "CHEESY MAC" would pass for a Big
    // Mac; the table names it instead.
    expect(top("branded", "big mac").description).toBe("CHEESY MAC");
    expect(commonFor("big mac")?.fdcId).toBe(170720);

    // Branded ranking: the drink, dish or snack itself, over toppings, mixes, seasonings and look-alikes.
    const branded: [string, RegExp, number][] = [
      ["pho", /^PHO - CHICKEN/, 2439717], // not "PHO SOUP SEASONING SPICE CUBE" or a broth bomb
      ["caramel frappuccino", /FRAPPUCCINO, CHILLED COFFEE DRINK$/, 2046373], // not "FRAPPUCCINO, COOKIE STRAW"
      ["gyro", /GYRO/, 2053269], // not "VEGGIE GYROS"
      ["hot cheetos", /^Cheetos Hot/, 1595557], // not the walking-taco kit
      ["peanut butter and jelly sandwich", /^PEANUT BUTTER & GRAPE JELLY SANDWICH$/, 1877309], // not the chocolate bar
      ["slurpee", /SLURPEE/, -1], // all candy: nothing reasonable, so the table answers it
    ];
    for (const [query, name, notThis] of branded) {
      const first = top("branded", query);
      expect(first.fdcId, `${query}: ${first.description}`).not.toBe(notThis);
      expect(first.description, query).toMatch(name);
    }
    expect(hits("branded", "slurpee").some((h) => isReasonable("slurpee", h))).toBe(false);
    expect(commonFor("slurpee")?.fdcId).toBe(174852);
  });
});
