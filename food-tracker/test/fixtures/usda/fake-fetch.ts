// A stand-in for api.nal.usda.gov, serving the recorded fixtures. Used by the
// tests and by `npm run dev:mock`. Never imported by the production entry point.
import foodsFile from "./foods.json";
import commonFile from "./live/common-foods.json";
import searchFile from "./search.json";

type Json = Record<string, unknown>;
const foods = new Map<number, Json>((foodsFile.foods as Json[]).map((f) => [f.fdcId as number, f]));
/** Real records for every food in src/food/common.ts. Only the bulk endpoint serves them; foods.json wins on overlap. */
const common = new Map<number, Json>((commonFile.foods as Json[]).map((f) => [f.fdcId as number, f]));
const core = searchFile.foundationAndSr as Record<string, Json>;
const branded = searchFile.branded as Record<string, Json>;

export interface FakeUsdaOptions {
  /** Answer every request with 429, like an exhausted API key. */
  rateLimited?: boolean;
  /** Answer every request with 503. */
  down?: boolean;
}

export interface FakeUsda {
  fetch: typeof fetch;
  /** Every URL requested, in order, with the api_key value replaced by "***". */
  calls: string[];
  options: FakeUsdaOptions;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function emptySearch(query: string) {
  return { totalHits: 0, currentPage: 1, totalPages: 0, foodSearchCriteria: { query }, foods: [] };
}

export function createFakeUsda(options: FakeUsdaOptions = {}): FakeUsda {
  const calls: string[] = [];

  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const redacted = new URL(url);
    if (redacted.searchParams.has("api_key")) redacted.searchParams.set("api_key", "***");
    calls.push(decodeURIComponent(redacted.toString()));

    if (url.hostname !== "api.nal.usda.gov") return json({ error: "unexpected host" }, 599);
    if (!url.searchParams.get("api_key")) return json({ error: { code: "API_KEY_MISSING" } }, 403);
    if (options.down) return new Response("Service Unavailable", { status: 503 });
    if (options.rateLimited) return json({ error: { code: "OVER_RATE_LIMIT", message: "rate limit" } }, 429);

    const path = url.pathname.replace(/\/+$/, "");
    if (path === "/fdc/v1/foods/search") {
      const query = (url.searchParams.get("query") ?? "").trim().toLowerCase();
      const types = url.searchParams.getAll("dataType").flatMap((t) => t.split(",")).map((t) => t.trim());
      const table = types.includes("Branded") ? branded : core;
      return json(table[query] ?? emptySearch(query));
    }
    if (path === "/fdc/v1/foods") {
      const ids = url.searchParams
        .getAll("fdcIds")
        .flatMap((v) => v.split(","))
        .map((v) => Number(v.trim()))
        .filter(Number.isFinite);
      return json(ids.map((id) => foods.get(id) ?? common.get(id)).filter(Boolean));
    }
    const one = path.match(/^\/fdc\/v1\/food\/(\d+)$/);
    if (one) {
      const food = foods.get(Number(one[1]));
      return food ? json(food) : json({ error: "not found" }, 404);
    }
    return json({ error: "unknown endpoint" }, 404);
  };

  return { fetch: fakeFetch as typeof fetch, calls, options };
}
