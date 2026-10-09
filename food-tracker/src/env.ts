export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Zero Trust team domain, e.g. "yourteam.cloudflareaccess.com". */
  ACCESS_TEAM_DOMAIN: string;
  /** Audience (AUD) tag of the Access application. */
  ACCESS_AUD: string;
  /** Worker secret. Never log it or return it. */
  USDA_API_KEY?: string;
  /** Local dev only, from .dev.vars. Ignored unless the request host is localhost. */
  DEV_USER_EMAIL?: string;
}

/** Hono context types shared by the app and its route modules. */
export type AppEnv = { Bindings: Env; Variables: { email: string } };
