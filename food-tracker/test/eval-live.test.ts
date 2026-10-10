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
import { describe, expect, it } from "vitest";
import { COMMON_FOODS } from "../src/food/common";
import { extractSearchHit } from "../src/food/nutrition";
import type { FoodRecord } from "../src/food/types";
import { commonFor, normalizeQuery, rankHits, SEARCH_PAGE_SIZE } from "../src/food/usda";
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
