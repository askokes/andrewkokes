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

## First deploy (food.pivotaiglobal.com)

Needs `pivotaiglobal.com` active as a zone in your Cloudflare account, and Zero Trust
opened once at one.dash.cloudflare.com so a team name exists (free plan is fine).

1. **API token:** Cloudflare dashboard > My Profile > API Tokens > Create Token >
   use the **Edit Cloudflare Workers** template, then add these rows (skip any already there):
   - Account > D1 > Edit
   - Account > Access: Apps and Policies > Edit
   - Account > Access: Organizations, Identity Providers, and Groups > Edit
   - Zone > DNS > Edit

   Zone resources: pivotaiglobal.com. Keep the token on your laptop only.
2. **Shell setup** (from `food-tracker/`):
   ```sh
   npm install
   export CLOUDFLARE_API_TOKEN=...      # from step 1
   export CLOUDFLARE_ACCOUNT_ID=...     # dashboard home, right sidebar
   ```
3. **Access app** (do this before deploying, so the site is never public):
   ```sh
   ALLOWED_EMAILS="you@example.com,her@example.com" node scripts/setup-access.mjs
   ```
   Turns on one-time PIN login, creates the allow list, and writes `ACCESS_TEAM_DOMAIN`
   and `ACCESS_AUD` into `wrangler.jsonc`. Re-run any time to change the email list.
4. **Database:** `npx wrangler d1 create food-tracker`, then paste the `database_id` into `wrangler.jsonc`.
5. **USDA key:** `npx wrangler secret put USDA_API_KEY` and enter `DEMO_KEY` for now.
6. **Ship:** `npm run deploy` (builds, applies remote migrations, deploys).
7. Commit the updated `wrangler.jsonc` (the AUD tag and database id are not secrets).

The Worker has `workers_dev` and preview URLs turned off, so the only way in is the Access-protected subdomain.
