import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { accessKeys, devUserEmail, verifyAccessJwt, type KeyResolver } from "./auth";
import type { AppEnv } from "./env";
import { foodRoutes } from "./food/routes";
import { profileRoutes } from "./profile";

export interface AppDeps {
  /** Access signing keys. Tests pass a local key set. */
  keys: KeyResolver;
  /** fetch used for USDA FoodData Central. Tests and dev:mock pass a fake. */
  usdaFetch: typeof fetch;
}

export function createApp(overrides: Partial<AppDeps> = {}) {
  const deps: AppDeps = { keys: accessKeys, usdaFetch: (input, init) => fetch(input, init), ...overrides };
  const app = new Hono<AppEnv>();
  const api = new Hono<AppEnv>();

  api.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");

    const devEmail = devUserEmail(c.env.DEV_USER_EMAIL, c.req.url);
    if (devEmail) {
      c.set("email", devEmail);
      return next();
    }

    const token = c.req.header("Cf-Access-Jwt-Assertion");
    if (!token) {
      return c.json({ error: "unauthorized", message: "Please sign in." }, 401);
    }
    try {
      const email = await verifyAccessJwt(token, {
        teamDomain: c.env.ACCESS_TEAM_DOMAIN ?? "",
        aud: c.env.ACCESS_AUD ?? "",
        keys: deps.keys,
      });
      c.set("email", email);
    } catch {
      return c.json({ error: "unauthorized", message: "Your sign-in has expired. Please reload." }, 401);
    }
    return next();
  });

  // Writes must come from the app's own pages. A page on another site can make
  // the browser send a form POST with the Access cookie attached (Access then
  // adds a valid JWT), and c.req.json() would read a text/plain body that
  // happens to be JSON. A form can't send application/json, and a script on
  // another origin can't either without a CORS preflight, which this API never
  // answers. Sec-Fetch-Site also catches same-site pages (other subdomains),
  // which SameSite=Lax cookies don't stop.
  api.use("*", async (c, next) => {
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
  });

  api.use(
    "*",
    bodyLimit({
      maxSize: 32 * 1024,
      onError: (c) => c.json({ error: "too_large", message: "That request is too big." }, 413),
    }),
  );

  api.route("/", profileRoutes);
  api.route("/", foodRoutes(deps));

  // Registered last so unknown API paths get JSON, never the SPA's index.html.
  api.all("*", (c) => c.json({ error: "not_found", message: "No such endpoint." }, 404));

  app.route("/api", api);

  app.onError((err, c) => {
    console.error("unhandled error", err instanceof Error ? err.message : err);
    return c.json({ error: "server_error", message: "Something went wrong. Please try again." }, 500);
  });

  // Anything else that reaches the Worker is a static asset request.
  app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

  return app;
}
