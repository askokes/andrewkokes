import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { makeSigner } from "./helpers";

const signer = await makeSigner();
const app = createApp({ keys: signer.keys });
// Tests must not depend on a developer's local .dev.vars.
const testEnv: Cloudflare.Env = { ...env, DEV_USER_EMAIL: undefined };

function call(path: string, init: RequestInit = {}, host = "https://food.example.com", e = testEnv) {
  return app.request(`${host}${path}`, init, e);
}

async function authed(path: string, claims?: Record<string, unknown>) {
  return call(path, { headers: { "Cf-Access-Jwt-Assertion": await signer.sign(claims) } });
}

describe("API auth", () => {
  it("returns 401 JSON with no token", async () => {
    const res = await call("/api/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
  });

  it("returns 401 for an invalid token", async () => {
    const res = await call("/api/me", { headers: { "Cf-Access-Jwt-Assertion": "garbage" } });
    expect(res.status).toBe(401);
  });

  it("does not trust the email header on its own", async () => {
    const res = await call("/api/me", {
      headers: { "Cf-Access-Authenticated-User-Email": "someone@example.com" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 for a token minted for another Access app", async () => {
    const token = await signer.sign(undefined, { aud: "other-app" });
    const res = await call("/api/me", { headers: { "Cf-Access-Jwt-Assertion": token } });
    expect(res.status).toBe(401);
  });

  it("requires auth on unknown API paths too", async () => {
    expect((await call("/api/nope")).status).toBe(401);
    const res = await authed("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_found" });
  });

  it("ignores DEV_USER_EMAIL on a non-local host", async () => {
    const res = await call("/api/me", {}, "https://food.example.com", {
      ...testEnv,
      DEV_USER_EMAIL: "dev@example.com",
    });
    expect(res.status).toBe(401);
  });

  it("honors DEV_USER_EMAIL on localhost", async () => {
    const res = await call("/api/me", {}, "http://localhost:8787", {
      ...testEnv,
      DEV_USER_EMAIL: "dev@example.com",
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "no_profile", email: "dev@example.com" });
  });
});

describe("schema", () => {
  it("has every table from the spec", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'd1_%' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual(["food_entries", "goals", "usda_cache", "users", "weight_entries"]);
  });
});
