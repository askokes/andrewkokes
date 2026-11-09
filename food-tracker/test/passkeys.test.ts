import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { SESSION_COOKIE } from "../src/passkeys";
import { makeSigner } from "./helpers";
import { softPasskey } from "./passkey-helper";

const signer = await makeSigner();
const app = createApp({ keys: signer.keys });
const ORIGIN = "https://food.example.com";
const testEnv: Cloudflare.Env = { ...env, DEV_USER_EMAIL: undefined, APP_ORIGIN: ORIGIN, ADMIN_EMAILS: "admin@example.com" };

let n = 0;
const newEmail = () => `pk${++n}-${crypto.randomUUID().slice(0, 8)}@example.com`;

type Auth = { access?: string; cookie?: string; ua?: string; site?: string };

async function call(method: string, path: string, body: unknown, auth: Auth = {}) {
  const headers: Record<string, string> = { "User-Agent": auth.ua ?? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" };
  if (auth.access) headers["Cf-Access-Jwt-Assertion"] = await signer.sign({ email: auth.access });
  if (auth.cookie) headers.Cookie = `${SESSION_COOKIE}=${auth.cookie}`;
  if (auth.site) headers["Sec-Fetch-Site"] = auth.site;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(`${ORIGIN}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, testEnv);
}

/** The session token a response set, if any. */
function sessionFrom(res: Response) {
  const set = res.headers.get("Set-Cookie") ?? "";
  return new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(set)?.[1] ?? null;
}

async function registerWhileSignedIn(email: string, key = undefined as Awaited<ReturnType<typeof softPasskey>> | undefined) {
  const passkey = key ?? (await softPasskey(ORIGIN));
  const opts = await (await call("POST", "/api/auth/register/options", {}, { access: email })).json<{ challengeId: string; options: { challenge: string } }>();
  const res = await call("POST", "/api/auth/register/verify", { challengeId: opts.challengeId, response: await passkey.register(opts.options) }, { access: email });
  return { passkey, res };
}

async function signIn(passkey: Awaited<ReturnType<typeof softPasskey>>, at = ORIGIN) {
  const opts = await (await call("POST", "/api/auth/signin/options", {})).json<{ challengeId: string; options: { challenge: string } }>();
  return call("POST", "/api/auth/signin/verify", { challengeId: opts.challengeId, response: await passkey.signIn(opts.options, at) });
}

describe("Face ID sign-in", () => {
  it("sets up a passkey for the signed-in person, then signs in with it alone", async () => {
    const email = newEmail();
    const { passkey, res } = await registerWhileSignedIn(email);
    expect(res.status).toBe(201);
    const set = res.headers.get("Set-Cookie")!;
    expect(set).toContain("HttpOnly");
    expect(set).toContain("Secure");
    expect(set).toContain("SameSite=Lax");
    expect(set).toContain("Path=/");

    // No Access, no cookie: Face ID alone.
    const signedIn = await signIn(passkey);
    expect(signedIn.status).toBe(200);
    expect(await signedIn.json()).toEqual({ email });
    const cookie = sessionFrom(signedIn)!;
    const me = await call("GET", "/api/passkeys", undefined, { cookie });
    expect(me.status).toBe(200);
    const list = await me.json<{ passkeys: { id: string; device: string; lastUsedAt: string | null }[] }>();
    expect(list.passkeys).toHaveLength(1);
    expect(list.passkeys[0]).toMatchObject({ id: passkey.id, device: "iPhone" });
    expect(list.passkeys[0].lastUsedAt).not.toBeNull();

    // Only a hash of the token is kept.
    const stored = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?").bind(cookie).first<{ n: number }>();
    expect(stored!.n).toBe(0);
  });

  it("needs a sign-in or an invite to set up a passkey", async () => {
    const res = await call("POST", "/api/auth/register/options", {});
    expect(res.status).toBe(401);
  });

  it("turns away a passkey made for another site, a reused challenge, and an unknown passkey", async () => {
    const email = newEmail();
    const { passkey } = await registerWhileSignedIn(email);
    expect((await signIn(passkey, "https://evil.example.net")).status).toBe(401);

    const opts = await (await call("POST", "/api/auth/signin/options", {})).json<{ challengeId: string; options: { challenge: string } }>();
    const response = await passkey.signIn(opts.options);
    expect((await call("POST", "/api/auth/signin/verify", { challengeId: opts.challengeId, response })).status).toBe(200);
    expect((await call("POST", "/api/auth/signin/verify", { challengeId: opts.challengeId, response })).status).toBe(400);

    const stranger = await softPasskey(ORIGIN);
    expect((await signIn(stranger)).status).toBe(401);
  });

  it("rejects a forged signature", async () => {
    const email = newEmail();
    const { passkey } = await registerWhileSignedIn(email);
    const impostor = await softPasskey(ORIGIN);
    const opts = await (await call("POST", "/api/auth/signin/options", {})).json<{ challengeId: string; options: { challenge: string } }>();
    // The impostor signs, but claims the real passkey's id.
    const forged = await impostor.signIn(opts.options);
    forged.id = passkey.id;
    forged.rawId = passkey.id;
    expect((await call("POST", "/api/auth/signin/verify", { challengeId: opts.challengeId, response: forged })).status).toBe(401);
  });

  it("an admin's invite link sets up a passkey as that person, once, and only within a week", async () => {
    const email = newEmail();
    const made = await call("POST", "/api/invite-links", { email: email.toUpperCase() }, { access: "admin@example.com" });
    expect(made.status).toBe(201);
    const { url } = await made.json<{ url: string }>();
    expect(url).toMatch(new RegExp(`^${ORIGIN}/join#`));
    const token = url.split("#")[1];

    expect(await (await call("POST", "/api/auth/invite", { token })).json()).toEqual({ valid: true, email });

    const passkey = await softPasskey(ORIGIN);
    const opts = await (await call("POST", "/api/auth/register/options", { invite: token })).json<{ challengeId: string; options: { challenge: string } }>();
    const res = await call("POST", "/api/auth/register/verify", { challengeId: opts.challengeId, response: await passkey.register(opts.options) });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ email });

    // Used up.
    expect(await (await call("POST", "/api/auth/invite", { token })).json()).toEqual({ valid: false });
    expect((await call("POST", "/api/auth/register/options", { invite: token })).status).toBe(403);

    // Expired.
    const late = await call("POST", "/api/invite-links", { email: newEmail() }, { access: "admin@example.com" });
    const lateToken = (await late.json<{ url: string }>()).url.split("#")[1];
    await env.DB.prepare("UPDATE invite_links SET expires_at = '2000-01-01T00:00:00.000Z' WHERE used_at IS NULL").run();
    expect((await call("POST", "/api/auth/register/options", { invite: lateToken })).status).toBe(403);
  });

  it("only admins make invite links", async () => {
    expect((await call("POST", "/api/invite-links", { email: newEmail() }, { access: newEmail() })).status).toBe(403);
  });

  it("signs out of one device, keeps the passkey, and a removed passkey can't sign in", async () => {
    const email = newEmail();
    const { passkey } = await registerWhileSignedIn(email);
    const cookie = sessionFrom(await signIn(passkey))!;
    expect((await call("POST", "/api/auth/signout", {}, { cookie })).status).toBe(200);
    expect((await call("GET", "/api/passkeys", undefined, { cookie })).status).toBe(401);

    const again = sessionFrom(await signIn(passkey))!;
    expect((await call("DELETE", `/api/passkeys/${passkey.id}`, undefined, { cookie: again })).status).toBe(200);
    expect((await signIn(passkey)).status).toBe(401);
  });

  it("keeps the write checks on sign-in routes", async () => {
    expect((await call("POST", "/api/auth/signin/options", {}, { site: "cross-site" })).status).toBe(403);
  });

  it("an expired session is not a sign-in", async () => {
    const email = newEmail();
    const { passkey } = await registerWhileSignedIn(email);
    const cookie = sessionFrom(await signIn(passkey))!;
    await env.DB.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE email = ?").bind(email).run();
    expect((await call("GET", "/api/passkeys", undefined, { cookie })).status).toBe(401);
  });

  it("serves the iPhone app's passkey file only once the team id is set", async () => {
    expect((await app.request(`${ORIGIN}/.well-known/apple-app-site-association`, {}, testEnv)).status).toBe(404);
    const res = await app.request(`${ORIGIN}/.well-known/apple-app-site-association`, {}, { ...testEnv, APPLE_TEAM_ID: "ABCDE12345" });
    expect(await res.json()).toEqual({ webcredentials: { apps: ["ABCDE12345.com.pivotaiglobal.foodtracker"] } });
  });
});
