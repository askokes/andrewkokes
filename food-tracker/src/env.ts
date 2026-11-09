export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Zero Trust team domain, e.g. "yourteam.cloudflareaccess.com". */
  ACCESS_TEAM_DOMAIN: string;
  /** Audience (AUD) tag of the Access application. */
  ACCESS_AUD: string;
  /** Worker secret. Never log it or return it. */
  USDA_API_KEY?: string;
  /** Invites (src/invites.ts): the Cloudflare account and who may invite. */
  CF_ACCOUNT_ID?: string;
  ADMIN_EMAILS?: string;
  /** Worker secret: a Cloudflare key limited to Access: Apps and Policies. Never log it or return it. */
  ACCESS_INVITE_TOKEN?: string;
  /** The app's address, e.g. "https://food.pivotaiglobal.com": the site passkeys belong to. Unset: the request's own. */
  APP_ORIGIN?: string;
  /** Apple Developer team id (10 characters), so the iPhone app may use this site's passkeys. */
  APPLE_TEAM_ID?: string;
  /** Local dev only, from .dev.vars. Ignored unless the request host is localhost. */
  DEV_USER_EMAIL?: string;
}

/** Hono context types shared by the app and its route modules. */
export type AppEnv = { Bindings: Env; Variables: { email: string } };
