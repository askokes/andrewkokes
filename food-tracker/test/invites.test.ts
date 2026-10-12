import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { ALLOWED_POLICY, MAX_PEOPLE } from "../src/invites";
import { makeSigner } from "./helpers";

const signer = await makeSigner();
const ADMIN = "admin@example.com";
const baseEnv: Cloudflare.Env = { ...env, DEV_USER_EMAIL: undefined, ADMIN_EMAILS: ADMIN, CF_ACCOUNT_ID: "acct123", ACCESS_INVITE_TOKEN: "invite-key" };

/** A Cloudflare API with one Access policy, recording every call. */
function fakeCloudflare(opts: { emails?: string[]; status?: number; down?: boolean } = {}) {
  const policy = {
    id: "pol1",
    name: ALLOWED_POLICY,
    decision: "allow",
    include: (opts.emails ?? ["andrew@example.com"]).map((email) => ({ email: { email } })),
    exclude: [],
    require: [],
    session_duration: "720h",
  };
  const calls: { method: string; url: string; auth: string | null; body: unknown }[] = [];
  const cfFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, auth: new Headers(init?.headers).get("Authorization"), body });
    if (opts.down) throw new TypeError("network down");
    if (opts.status) return Response.json({ success: false, errors: [{ code: 10000, message: "Authentication error" }] }, { status: opts.status });
    if (method === "GET" && url.endsWith("/accounts/acct123/access/policies")) {
      return Response.json({ success: true, result: [{ id: "other", name: "Something else", include: [] }, policy] });
    }
    if (method === "PUT" && url.endsWith("/accounts/acct123/access/policies/pol1")) {
      Object.assign(policy, body);
      return Response.json({ success: true, result: policy });
    }
    return Response.json({ success: false }, { status: 404 });
  }) as typeof fetch;
  return { cfFetch, calls, policy };
}

function client(cf: ReturnType<typeof fakeCloudflare>, e: Cloudflare.Env = baseEnv) {
  const app = createApp({ keys: signer.keys, cfFetch: cf.cfFetch });
  return async (email: string, method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { "Cf-Access-Jwt-Assertion": await signer.sign({ email }) };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return app.request(`https://food.example.com${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, e);
  };
}

describe("invites", () => {
  it("are only for the people in ADMIN_EMAILS", async () => {
    const cf = fakeCloudflare();
    const as = client(cf);
    expect((await as("someone@example.com", "GET", "/api/people")).status).toBe(403);
    expect((await as("someone@example.com", "POST", "/api/invites", { email: "x@example.com" })).status).toBe(403);
    expect(cf.calls).toHaveLength(0);

    await as("someone@example.com", "POST", "/api/me", { displayName: "S", timezone: "America/Chicago", trackWeight: false, goals: { calories: 2000 } });
    expect(await (await as("someone@example.com", "GET", "/api/me")).json()).toMatchObject({ canInvite: false });
    await as(ADMIN, "POST", "/api/me", { displayName: "A", timezone: "America/Chicago", trackWeight: false, goals: { calories: 2000 } });
    expect(await (await as(ADMIN, "GET", "/api/me")).json()).toMatchObject({ canInvite: true });
  });

  it("list who can sign in", async () => {
    const as = client(fakeCloudflare({ emails: ["andrew@example.com", "caleb@example.com"] }));
    expect(await (await as(ADMIN, "GET", "/api/people")).json()).toEqual({ people: ["andrew@example.com", "caleb@example.com"] });
  });

  it("add the email to the Access policy, keeping everyone and everything else", async () => {
    const cf = fakeCloudflare();
    const as = client(cf);
    const res = await as(ADMIN, "POST", "/api/invites", { email: "  Sam@Example.com " });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ email: "sam@example.com", added: true, people: ["andrew@example.com", "sam@example.com"] });
    const put = cf.calls.find((c) => c.method === "PUT")!;
    expect(put.auth).toBe("Bearer invite-key");
    expect(put.body).toMatchObject({ name: ALLOWED_POLICY, decision: "allow", session_duration: "720h", include: [{ email: { email: "andrew@example.com" } }, { email: { email: "sam@example.com" } }] });
  });

  it("leave the policy alone for someone already in", async () => {
    const cf = fakeCloudflare();
    const res = await client(cf)(ADMIN, "POST", "/api/invites", { email: "ANDREW@example.com" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ added: false });
    expect(cf.calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it.each(["", "not-an-email", "a@b", "two words@example.com"])("turn away %j", async (email) => {
    const cf = fakeCloudflare();
    const res = await client(cf)(ADMIN, "POST", "/api/invites", { email });
    expect(res.status).toBe(400);
    expect(cf.calls).toHaveLength(0);
  });

  it(`stop at ${MAX_PEOPLE} people`, async () => {
    const cf = fakeCloudflare({ emails: Array.from({ length: MAX_PEOPLE }, (_, i) => `p${i}@example.com`) });
    const res = await client(cf)(ADMIN, "POST", "/api/invites", { email: "one-more@example.com" });
    expect(res.status).toBe(400);
    expect(cf.calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("say plainly when they can't work", async () => {
    const noKey = await client(fakeCloudflare(), { ...baseEnv, ACCESS_INVITE_TOKEN: undefined })(ADMIN, "POST", "/api/invites", { email: "x@example.com" });
    expect(noKey.status).toBe(503);
    expect((await noKey.json<{ message: string }>()).message).toMatch(/one more setup step/);

    const denied = await client(fakeCloudflare({ status: 403 }))(ADMIN, "POST", "/api/invites", { email: "x@example.com" });
    expect(denied.status).toBe(503);
    expect((await denied.json<{ message: string }>()).message).toMatch(/permissions/);

    const down = await client(fakeCloudflare({ down: true }))(ADMIN, "GET", "/api/people");
    expect(down.status).toBe(502);
    // The key never comes back in a response.
    expect(JSON.stringify(await down.json())).not.toContain("invite-key");
  });
});
