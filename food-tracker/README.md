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

Needs Node 20+ and `pivotaiglobal.com` active as a site in your Cloudflare account.
Open https://one.dash.cloudflare.com once first and pick a team name (Free plan).

```sh
git clone https://github.com/askokes/andrewkokes.git
cd andrewkokes/food-tracker
git checkout claude/phase-1-scaffold-deploy-rwsafu
npm install
npm run setup
```

`npm run setup` asks for the API token (hidden), the allowed emails, and the USDA key
(Enter = `DEMO_KEY`). Then it sets up one-time PIN sign-in, creates the database and
tables, deploys, and waits until the site answers behind the sign-in page. Safe to re-run.

API token: Cloudflare dashboard > My Profile > API Tokens > Create Token > **Edit Cloudflare
Workers** template, plus Account > D1 > Edit, Account > Access: Apps and Policies > Edit,
Account > Access: Organizations, Identity Providers, and Groups > Edit, Zone > DNS > Edit.

Afterwards, commit the updated `wrangler.jsonc` (the AUD tag and database id are not secrets).

**Change who's allowed in:** `export CLOUDFLARE_API_TOKEN=...` then `npm run access`.
**Later deploys:** `npm run deploy`.

The Worker has `workers_dev` and preview URLs turned off, so the only way in is the Access-protected subdomain.
