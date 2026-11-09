import { Hono, type Context, type Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import { accessKeys, type KeyResolver } from "./auth";
import type { AppEnv } from "./env";
import { foodRoutes } from "./food/routes";
import { inviteRoutes } from "./invites";
import { authRoutes, identify, passkeyRoutes } from "./passkeys";
import { profileRoutes } from "./profile";
import { progressRoutes } from "./progress";
import { WATCH_SYNC_PATH, watchRoutes, watchSync } from "./watch";

export interface AppDeps {
  /** Access signing keys. Tests pass a local key set. */
  keys: KeyResolver;
  /** fetch used for USDA FoodData Central. Tests and dev:mock pass a fake. */
  usdaFetch: typeof fetch;
  /** fetch used for Cloudflare's API (invites). Tests pass a fake. */
  cfFetch: typeof fetch;
  /** fetch used for Open Food Facts (barcodes USDA doesn't have). Tests and dev:mock pass a fake. */
  offFetch: typeof fetch;
}

export function createApp(overrides: Partial<AppDeps> = {}) {
  const deps: AppDeps = {
    keys: accessKeys,
    usdaFetch: (input, init) => fetch(input, init),
    cfFetch: (input, init) => fetch(input, init),
    offFetch: (input, init) => fetch(input, init),
    ...overrides,
  };
  const app = new Hono<AppEnv>();
  const api = new Hono<AppEnv>();

  // Writes must come from the app's own pages. A page on another site can make
  // the browser send a form POST with the sign-in cookie attached, and
  // c.req.json() would read a text/plain body that happens to be JSON. A form
  // can't send application/json, and a script on another origin can't either
  // without a CORS preflight, which this API never answers. Sec-Fetch-Site also
  // catches same-site pages (other subdomains), which SameSite=Lax cookies don't stop.
  const sameSiteJsonWrites = async (c: Context<AppEnv>, next: Next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") return next();
    const site = c.req.header("Sec-Fetch-Site");
    if (site !== undefined && site !== "same-origin" && site !== "none") {
      return c.json({ error: "forbidden", message: "That request didn't come from this app." }, 403);
    }
    const type = (c.req.header("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
    if (c.req.method !== "DELETE" && type !== "application/json") {
      return c.json({ error: "unsupported_media_type", message: "Send the request as JSON." }, 415);
    }
    return next();
  };
  const smallBodies = bodyLimit({
    maxSize: 32 * 1024,
    onError: (c) => c.json({ error: "too_large", message: "That request is too big." }, 413),
  });

  // Signing in (Face ID) needs no sign-in, so it comes before the check below.
  const auth = new Hono<AppEnv>();
  auth.use("*", sameSiteJsonWrites, smallBodies);
  auth.route("/", authRoutes(deps));

  api.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    const who = await identify(c, deps.keys);
    if (who.email === null) {
      return c.json({ error: "unauthorized", message: who.expired ? "Your sign-in has expired. Please reload." : "Please sign in." }, 401);
    }
    c.set("email", who.email);
    return next();
  });

  api.use("*", sameSiteJsonWrites);

  api.use("*", smallBodies);

  api.route("/", profileRoutes);
  api.route("/", foodRoutes(deps));
  api.route("/", progressRoutes);
  api.route("/", inviteRoutes(deps));
  api.route("/", watchRoutes);
  api.route("/", passkeyRoutes);

  // Registered last so unknown API paths get JSON, never the SPA's index.html.
  api.all("*", (c) => c.json({ error: "not_found", message: "No such endpoint." }, 404));

  // The Apple Watch Shortcut signs in with its sync key, not Access, so it's
  // answered before the API's sign-in check. Any other method or path under
  // it still goes through that check.
  app.post(WATCH_SYNC_PATH, watchSync);
  app.route("/api/auth", auth);
  app.route("/api", api);

  // Lets the iPhone app (ios/) use this site's passkeys. Needs the Apple Developer team id.
  app.get("/.well-known/apple-app-site-association", (c) => {
    const team = c.env.APPLE_TEAM_ID?.trim();
    if (!team || !/^[A-Z0-9]{10}$/.test(team)) return c.notFound();
    return c.json({ webcredentials: { apps: [`${team}.com.pivotaiglobal.foodtracker`] } });
  });

  app.onError((err, c) => {
    console.error("unhandled error", err instanceof Error ? err.message : err);
    return c.json({ error: "server_error", message: "Something went wrong. Please try again." }, 500);
  });

  // Anything else that reaches the Worker is a static asset request.
  app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

  return app;
}
