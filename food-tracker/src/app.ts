import { Hono } from "hono";
import { accessKeys, devUserEmail, verifyAccessJwt, type KeyResolver } from "./auth";
import type { Env } from "./env";

type AppEnv = { Bindings: Env; Variables: { email: string } };

export interface AppDeps {
  keys: KeyResolver;
}

export function createApp(deps: AppDeps = { keys: accessKeys }) {
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

  // Phase 1 proof of life: who am I, and can we reach D1?
  api.get("/whoami", async (c) => {
    const email = c.get("email");
    const user = await c.env.DB.prepare("SELECT display_name FROM users WHERE email = ?")
      .bind(email)
      .first<{ display_name: string }>();
    return c.json({
      email,
      hasProfile: user !== null,
      displayName: user?.display_name ?? null,
    });
  });

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
