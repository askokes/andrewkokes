// Face ID sign-in: passkeys (WebAuthn) and the app's own sign-in sessions, so the app no longer needs
// Cloudflare Access's emailed codes. A passkey lives in the person's iCloud Keychain (Face ID or Touch
// ID unlocks it) and is tied to this site. Signing in with it starts a session: a random token in an
// HttpOnly cookie, only its SHA-256 stored, good for a year from the last use.
//
// Who may make a passkey: someone already signed in (by Access while it's still in front of the app,
// or by an earlier passkey on another device), or someone holding an invite link an admin made.
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { isAdmin } from "./admins";
import { devUserEmail, verifyAccessJwt, type KeyResolver } from "./auth";
import type { AppEnv } from "./env";
import { readJson } from "./profile";
import { isObject } from "./validate";

export const SESSION_COOKIE = "__Host-ft_session";
const SESSION_DAYS = 365;
/** A session's expiry moves forward at most once a day, so most requests don't write. */
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
const CHALLENGE_MS = 5 * 60 * 1000;
const INVITE_DAYS = 7;
/** Plenty for a family; stops a runaway loop filling the table. */
const MAX_PASSKEYS = 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Ctx = Context<AppEnv>;

const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (ms = Date.now()) => new Date(ms).toISOString();

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text: string) {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
}

export const randomToken = (bytes = 32) => base64url(crypto.getRandomValues(new Uint8Array(bytes)));

export async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The site passkeys belong to: APP_ORIGIN when set (production), else the address asked for (dev, tests). */
function site(c: Ctx) {
  const origin = c.env.APP_ORIGIN?.trim() || new URL(c.req.url).origin;
  return { origin, rpID: new URL(origin).hostname };
}

/** "iPhone", "iPad", "Mac", "Android" or "Windows" from the User-Agent, for the Goals list. */
export function deviceLabel(userAgent: string | undefined) {
  const ua = userAgent ?? "";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh|Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "This device";
}

// ---------------------------------------------------------------- sessions

/** The signed-in email from the session cookie, refreshing a session in use. Null when there's none. */
async function sessionEmail(c: Ctx): Promise<string | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token || token.length > 100) return null;
  const hash = await sha256(token);
  const row = await c.env.DB.prepare("SELECT email, last_seen_at, expires_at FROM sessions WHERE token_hash = ?")
    .bind(hash)
    .first<{ email: string; last_seen_at: string; expires_at: string }>();
  if (!row || row.expires_at <= iso()) return null;
  if (Date.now() - Date.parse(row.last_seen_at) > REFRESH_AFTER_MS) {
    await c.env.DB.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?")
      .bind(iso(), iso(Date.now() + SESSION_DAYS * DAY_MS), hash)
      .run();
    writeCookie(c, token);
  }
  return row.email;
}

function writeCookie(c: Ctx, token: string) {
  setCookie(c, SESSION_COOKIE, token, { path: "/", secure: true, httpOnly: true, sameSite: "Lax", maxAge: SESSION_DAYS * 24 * 60 * 60 });
}

async function startSession(c: Ctx, email: string) {
  const token = randomToken();
  const now = iso();
  await c.env.DB.prepare("INSERT INTO sessions (token_hash, email, device, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(await sha256(token), email, deviceLabel(c.req.header("User-Agent")), now, now, iso(Date.now() + SESSION_DAYS * DAY_MS))
    .run();
  writeCookie(c, token);
}

/**
 * Who is asking: the local dev user, a Face ID session, or (while it's still in front of the app)
 * Cloudflare Access's signed header. Null when none of them says.
 */
export async function identify(c: Ctx, keys: KeyResolver): Promise<{ email: string } | { email: null; expired: boolean }> {
  const dev = devUserEmail(c.env.DEV_USER_EMAIL, c.req.url);
  if (dev) return { email: dev };
  const fromSession = await sessionEmail(c);
  if (fromSession) return { email: fromSession };
  const token = c.req.header("Cf-Access-Jwt-Assertion");
  if (!token) return { email: null, expired: false };
  try {
    return { email: await verifyAccessJwt(token, { teamDomain: c.env.ACCESS_TEAM_DOMAIN ?? "", aud: c.env.ACCESS_AUD ?? "", keys }) };
  } catch {
    return { email: null, expired: true };
  }
}

// ---------------------------------------------------------------- challenges and invites

async function saveChallenge(c: Ctx, row: { challenge: string; purpose: "register" | "signin"; email?: string; inviteHash?: string }) {
  const id = randomToken(16);
  const db = c.env.DB;
  await db.batch([
    db.prepare("DELETE FROM auth_challenges WHERE expires_at < ?").bind(iso()),
    db.prepare("INSERT INTO auth_challenges (id, challenge, purpose, email, invite_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, row.challenge, row.purpose, row.email ?? null, row.inviteHash ?? null, iso(Date.now() + CHALLENGE_MS)),
  ]);
  return id;
}

/** Takes a challenge: it can't be used twice, and an old one is gone. */
async function takeChallenge(c: Ctx, id: unknown, purpose: "register" | "signin") {
  if (typeof id !== "string" || id.length > 64) return null;
  const row = await c.env.DB.prepare("DELETE FROM auth_challenges WHERE id = ? AND purpose = ? RETURNING challenge, email, invite_hash, expires_at")
    .bind(id, purpose)
    .first<{ challenge: string; email: string | null; invite_hash: string | null; expires_at: string }>();
  return row && row.expires_at > iso() ? row : null;
}

/** An invite link that can still be used, by its token. */
async function openInvite(c: Ctx, token: unknown) {
  if (typeof token !== "string" || !token || token.length > 100) return null;
  const hash = await sha256(token);
  const row = await c.env.DB.prepare("SELECT email, expires_at, used_at FROM invite_links WHERE token_hash = ?")
    .bind(hash)
    .first<{ email: string; expires_at: string; used_at: string | null }>();
  return row && !row.used_at && row.expires_at > iso() ? { hash, email: row.email } : null;
}

/** A new invite link for `email`, made by an admin. Older unused links for the same email stop working. */
export async function createInviteLink(c: Ctx, email: string, createdBy: string) {
  const token = randomToken();
  const now = iso();
  const expiresAt = iso(Date.now() + INVITE_DAYS * DAY_MS);
  const db = c.env.DB;
  await db.batch([
    db.prepare("UPDATE invite_links SET used_at = ? WHERE email = ? AND used_at IS NULL").bind(now, email),
    db.prepare("INSERT INTO invite_links (token_hash, email, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
      .bind(await sha256(token), email, createdBy, now, expiresAt),
  ]);
  return { url: `${site(c).origin}/join#${token}`, expiresAt };
}

// ---------------------------------------------------------------- routes

const userIdFor = async (email: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`food-tracker:${email}`));
  return new Uint8Array(digest);
};

const bad = (c: Ctx, message: string, status: 400 | 401 | 403 = 400) => c.json({ error: status === 400 ? "invalid_input" : "unauthorized", message }, status);

interface PasskeyRow {
  id: string;
  email: string;
  public_key: string;
  counter: number;
  transports: string | null;
}

/**
 * /api/auth: reachable without signing in, since this is how people sign in. The write checks in
 * app.ts (same site, JSON only) still apply.
 */
export function authRoutes(deps: { keys: KeyResolver }) {
  const routes = new Hono<AppEnv>();
  routes.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    return next();
  });

  // The join page: whose invite this is, so it can say so.
  routes.post("/invite", async (c) => {
    const body = await readJson(c);
    const invite = await openInvite(c, isObject(body) ? body.token : null);
    if (!invite) return c.json({ valid: false });
    return c.json({ valid: true, email: invite.email });
  });

  // Make a passkey: as the signed-in person, or as whoever an invite link names.
  routes.post("/register/options", async (c) => {
    const body = await readJson(c);
    const invite = isObject(body) && body.invite !== undefined ? await openInvite(c, body.invite) : null;
    if (isObject(body) && body.invite !== undefined && !invite) return bad(c, "This invite link has expired or was already used. Ask for a new one.", 403);
    const email = invite?.email ?? (await identify(c, deps.keys)).email;
    if (!email) return bad(c, "Please sign in first.", 401);

    const { results: existing } = await c.env.DB.prepare("SELECT id, transports FROM passkeys WHERE email = ?").bind(email).all<{ id: string; transports: string | null }>();
    if (existing.length >= MAX_PASSKEYS) return bad(c, `You already have ${MAX_PASSKEYS} devices set up. Remove one on the Goals tab first.`);
    const { rpID } = site(c);
    const options = await generateRegistrationOptions({
      rpName: "Food Tracker",
      rpID,
      userName: email,
      userDisplayName: email,
      userID: await userIdFor(email),
      attestationType: "none",
      excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports ? (JSON.parse(p.transports) as string[]) : undefined })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    const challengeId = await saveChallenge(c, { challenge: options.challenge, purpose: "register", email, inviteHash: invite?.hash });
    return c.json({ challengeId, options });
  });

  routes.post("/register/verify", async (c) => {
    const body = await readJson(c);
    if (!isObject(body) || !isObject(body.response)) return bad(c, "Missing the passkey.");
    const challenge = await takeChallenge(c, body.challengeId, "register");
    if (!challenge?.email) return bad(c, "That took too long. Please try again.");
    // An invite used to start this must still be good, and is used up now.
    if (challenge.invite_hash) {
      const used = await c.env.DB.prepare("UPDATE invite_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING email")
        .bind(iso(), challenge.invite_hash, iso())
        .first<{ email: string }>();
      if (used?.email !== challenge.email) return bad(c, "This invite link has expired or was already used. Ask for a new one.", 403);
    }
    const { origin, rpID } = site(c);
    let verified;
    try {
      verified = await verifyRegistrationResponse({
        response: body.response as unknown as RegistrationResponseJSON,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
    } catch {
      return bad(c, "That passkey didn't check out. Please try again.");
    }
    if (!verified.verified) return bad(c, "That passkey didn't check out. Please try again.");
    const cred = verified.registrationInfo.credential;
    await c.env.DB.prepare(
      "INSERT INTO passkeys (id, email, public_key, counter, transports, device, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
    )
      .bind(cred.id, challenge.email, base64url(cred.publicKey), cred.counter, cred.transports ? JSON.stringify(cred.transports) : null, deviceLabel(c.req.header("User-Agent")), iso())
      .run();
    await startSession(c, challenge.email);
    return c.json({ email: challenge.email }, 201);
  });

  // Sign in: the phone offers whichever passkey it has for this site.
  routes.post("/signin/options", async (c) => {
    const options = await generateAuthenticationOptions({ rpID: site(c).rpID, userVerification: "required" });
    const challengeId = await saveChallenge(c, { challenge: options.challenge, purpose: "signin" });
    return c.json({ challengeId, options });
  });

  routes.post("/signin/verify", async (c) => {
    const body = await readJson(c);
    if (!isObject(body) || !isObject(body.response) || typeof body.response.id !== "string") return bad(c, "Missing the passkey.");
    const challenge = await takeChallenge(c, body.challengeId, "signin");
    if (!challenge) return bad(c, "That took too long. Please try again.");
    const passkey = await c.env.DB.prepare("SELECT id, email, public_key, counter, transports FROM passkeys WHERE id = ?")
      .bind(body.response.id)
      .first<PasskeyRow>();
    if (!passkey) return bad(c, "This device's passkey was removed. Ask for a new invite link.", 401);
    const { origin, rpID } = site(c);
    let verified;
    try {
      verified = await verifyAuthenticationResponse({
        response: body.response as unknown as AuthenticationResponseJSON,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: passkey.id,
          publicKey: fromBase64url(passkey.public_key),
          counter: passkey.counter,
          transports: passkey.transports ? (JSON.parse(passkey.transports) as string[]) : undefined,
        } as Parameters<typeof verifyAuthenticationResponse>[0]["credential"],
      });
    } catch {
      return bad(c, "That passkey didn't check out. Please try again.", 401);
    }
    if (!verified.verified) return bad(c, "That passkey didn't check out. Please try again.", 401);
    await c.env.DB.prepare("UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?").bind(verified.authenticationInfo.newCounter, iso(), passkey.id).run();
    await startSession(c, passkey.email);
    return c.json({ email: passkey.email });
  });

  // Sign out of this device: its session ends. Its passkey stays, so Face ID signs back in.
  routes.post("/signout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token && token.length <= 100) await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
    deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
    return c.json({ ok: true });
  });

  return routes;
}

/** Signed-in routes: the person's own passkeys, and invite links for admins. */
export const passkeyRoutes = new Hono<AppEnv>();

passkeyRoutes.get("/passkeys", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id, device, created_at, last_used_at FROM passkeys WHERE email = ? ORDER BY created_at")
    .bind(c.get("email"))
    .all<{ id: string; device: string | null; created_at: string; last_used_at: string | null }>();
  return c.json({ passkeys: results.map((p) => ({ id: p.id, device: p.device ?? "Device", createdAt: p.created_at, lastUsedAt: p.last_used_at })) });
});

passkeyRoutes.delete("/passkeys/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM passkeys WHERE id = ? AND email = ?").bind(c.req.param("id"), c.get("email")).run();
  return c.json({ ok: true });
});

// A sign-in link for someone: a new person, or someone who lost their phone.
passkeyRoutes.post("/invite-links", async (c) => {
  if (!isAdmin(c.env, c.get("email"))) return c.json({ error: "forbidden", message: "Only the app's owner can make invite links." }, 403);
  const body = await readJson(c);
  const email = isObject(body) && typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 254) {
    return c.json({ error: "invalid_input", message: "That doesn't look like an email.", fields: { email: "That doesn't look like an email." } }, 400);
  }
  return c.json({ email, ...(await createInviteLink(c, email, c.get("email"))) }, 201);
});
