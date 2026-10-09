# Food Tracker

Voice-first food logging for family and friends. `SPEC.md` is the source of truth.

**Status:** Phase 1 (scaffold, D1, migrations, Access JWT validation, "Hello, email" page).

## Layout

```
src/            Worker (Hono). app.ts = routes, auth.ts = Access JWT validation
web/            Frontend (Vite, vanilla TS). Built to dist/, served as static assets
migrations/     D1 migrations (wrangler)
test/           Vitest, runs inside the Workers runtime with a local D1
```

## Local dev

```sh
npm install
cp .dev.vars.example .dev.vars        # set DEV_USER_EMAIL to any email
npm run db:migrate:local
npm run dev                           # http://localhost:8787
npm test
npm run typecheck
```

`DEV_USER_EMAIL` skips Access only when the request host is `localhost` or `127.0.0.1`.
It lives in `.dev.vars`, which wrangler never uploads, so it can't switch on in production.

## First deploy

1. **Log in:** `npx wrangler login` (or export `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`).
2. **Database:** `npx wrangler d1 create food-tracker`, then paste the `database_id` into `wrangler.jsonc`.
3. **Domain:** in `wrangler.jsonc`, uncomment `routes` and set the subdomain, e.g. `food.example.com`.
4. **Access** (Zero Trust dashboard, do this before deploying):
   - Settings > Authentication: make sure **One-time PIN** is enabled.
   - Access > Applications > Add > **Self-hosted**. Domain = the subdomain above.
   - Policy: Action **Allow**, Include **Emails** = the people allowed in.
   - Copy the app's **Application Audience (AUD) tag** into `ACCESS_AUD` in `wrangler.jsonc`.
   - Copy the team domain (`<team>.cloudflareaccess.com`) into `ACCESS_TEAM_DOMAIN`.
5. **USDA key:** `npx wrangler secret put USDA_API_KEY` (use `DEMO_KEY` until the real key arrives).
6. **Ship:** `npm run deploy` (builds, applies remote migrations, deploys).

The Worker has `workers_dev` and preview URLs turned off, so the only way in is the Access-protected subdomain.
