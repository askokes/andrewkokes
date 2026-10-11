// Brings researched menu files into src/food/menus/<slug>.json, giving every
// size an id. Ids are for good (saved entries point at them): a size keeps its
// id across imports, matched by item name and size, and a new one takes the
// chain's next id, never one used before.
//
//   node scripts/import-menus.mjs <folder of researched <slug>.json files>
//
// Shape of a researched file: see the MenuChain type in src/food/menu.ts.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ORDER = ["mcdonalds", "chick-fil-a", "subway", "jimmy-johns", "jersey-mikes", "taco-bell", "chipotle", "panera", "panda-express"];
const MENU_ID_MIN = 900_000_000;
const OUT = new URL("../src/food/menus/", import.meta.url).pathname;

/**
 * Choices made here rather than in the research, so they survive a fresh
 * import: drinks default to medium at every chain (Taco Bell's site defaults
 * to large), and a few names people say that the research left out.
 */
const ADJUST = {
  "chick-fil-a": { items: { "Chicken Sandwich": { says: ["sandwich", "chick fil a sandwich"] } } },
  "taco-bell": {
    drinkDefault: "medium",
    items: { "Chalupa Supreme - Beef": { signature: ["chalupa"] } },
  },
};

const from = process.argv[2];
if (!from) {
  console.error("Usage: node scripts/import-menus.mjs <folder>");
  process.exit(1);
}

const num = (v, what) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new Error(`${what} should be a number of 0 or more, got ${v}`);
  return v;
};
const lower = (list) => [...new Set((list ?? []).map((s) => String(s).toLowerCase().trim()).filter(Boolean))];

for (const [i, slug] of ORDER.entries()) {
  const src = join(from, `${slug}.json`);
  if (!existsSync(src)) {
    console.log(`${slug}: no researched file, left as is`);
    continue;
  }
  const data = JSON.parse(readFileSync(src, "utf8"));
  const outPath = join(OUT, `${slug}.json`);
  const old = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : null;
  const base = MENU_ID_MIN + (i + 1) * 100_000;
  // Only ids in this chain's own range count; anything else (a placeholder file's) is reassigned.
  const ours = (id) => Number.isInteger(id) && id > base && id < base + 100_000;
  const known = new Map();
  for (const item of old?.items ?? []) for (const s of item.sizes) if (ours(s.id)) known.set(`${item.name}|${s.size}`, s.id);
  let nextId = ours(old?.nextId) ? old.nextId : base + 1;
  for (const id of known.values()) nextId = Math.max(nextId, id + 1);

  const adjust = ADJUST[slug] ?? {};
  for (const item of data.items) {
    const extra = adjust.items?.[item.name];
    if (extra?.says) item.says = [...(item.says ?? []), ...extra.says];
    if (extra?.signature) item.signature = [...(item.signature ?? []), ...extra.signature];
    const usual = adjust.drinkDefault && item.category === "drink" && item.sizes.find((s) => s.size === adjust.drinkDefault);
    if (usual) for (const s of item.sizes) s.default = s === usual;
  }

  const names = new Set();
  const items = data.items.map((item) => {
    if (names.has(item.name)) throw new Error(`${slug}: "${item.name}" is listed twice`);
    names.add(item.name);
    if (!item.sizes?.length) throw new Error(`${slug}: "${item.name}" has no sizes`);
    const defaults = item.sizes.filter((s) => s.default).length;
    if (defaults > 1) throw new Error(`${slug}: "${item.name}" has ${defaults} default sizes`);
    const sizes = item.sizes.map((s, j) => {
      const what = `${slug}: ${item.name} (${s.size})`;
      const key = `${item.name}|${s.size}`;
      const id = known.get(key) ?? nextId++;
      return {
        id,
        size: String(s.size).toLowerCase(),
        label: s.label,
        grams: s.grams == null ? null : num(s.grams, `${what} grams`),
        calories: num(s.calories, `${what} calories`),
        proteinG: num(s.proteinG, `${what} protein`),
        carbsG: num(s.carbsG, `${what} carbs`),
        fatG: num(s.fatG, `${what} fat`),
        // No default said: the first size is the usual one.
        default: defaults ? !!s.default : j === 0,
      };
    });
    return {
      name: item.name,
      says: lower(item.says),
      signature: lower(item.signature),
      category: item.category,
      sizes,
      sourceKind: item.sourceKind,
      source: item.source,
      ...(item.note ? { note: item.note } : {}),
    };
  });
  if (nextId >= base + 100_000) throw new Error(`${slug}: out of ids`);

  const out = {
    chain: data.chain,
    chainSays: lower(data.chainSays),
    sources: data.sources ?? [],
    retrieved: data.retrieved,
    nextId,
    items,
  };
  writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`${slug}: ${items.length} items, ${items.reduce((n, it) => n + it.sizes.length, 0)} sizes`);
}
