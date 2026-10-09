// Word helpers shared by portion matching (units.ts) and search ranking (usda.ts).
// Matching is loose on purpose: "Bananas" matches "banana", "toasted" matches "toast".

const STOPWORDS = new Set(["a", "an", "and", "n", "of", "or", "the", "with", "in", "on"]);

/** Lowercase words, accents and apostrophes removed: "USDA's Jalapeño" -> ["usdas", "jalapeno"]. */
export function words(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** words() without "and", "with", "of" and friends. */
export function contentWords(text: string): string[] {
  return words(text).filter((w) => !STOPWORDS.has(w));
}

function stems(w: string): string[] {
  const out = [w];
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) out.push(w.slice(0, -1));
  if (w.length > 4 && w.endsWith("es")) out.push(w.slice(0, -2));
  if (w.length > 4 && w.endsWith("ies")) out.push(`${w.slice(0, -3)}y`);
  if (w.length > 5 && w.endsWith("ed")) out.push(w.slice(0, -2));
  return out;
}

/** Same word ignoring simple plurals and a trailing "-ed". Both arguments are lowercase words. */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const bs = stems(b);
  return stems(a).some((s) => bs.includes(s));
}
