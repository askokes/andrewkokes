# Food Tracker

Voice-first food logging for family and friends. `SPEC.md` is the source of truth.

**Status:** Phase 3 (food logging by text: parser, USDA lookup with caching, confirm screen, Today with totals). Live at https://food.pivotaiglobal.com.

API so far: `GET/POST /api/me`, `POST /api/goals`, `POST /api/parse`, `GET /api/foods/search`,
`GET/POST /api/entries`, `PATCH/DELETE /api/entries/:id`. Shapes live in `src/food/types.ts`.
Every write must be `Content-Type: application/json` from the app's own origin.

`npm run dev:mock` runs the app locally with recorded USDA data (no API key needed).

Food logging (Phase 3, `src/food/routes.ts`; shapes in `src/food/types.ts`): `POST /api/parse`
(meal phrase in, every item back with ranked USDA matches priced for the spoken amount; the first
8 are looked up and the rest come back "skipped"; a USDA problem only marks the affected item),
`GET /api/foods/search?q=&quantity=&unit=`, `GET /api/entries?date=` (the day's entries, totals
and the goals in effect that day; no date means today), `POST /api/entries` (save confirmed items,
all or nothing; amounts from 0.01 up to 1,000 of a unit and 5 kg of a food), `PATCH /api/entries/:id`
(a new unit alone keeps the weight) and `DELETE /api/entries/:id` (both answer with the updated
day). Every food the app uses is cached in D1, so repeat lookups never call USDA, and the shared
USDA key is rationed: 16 calls per request and 150 per user per hour.

Matching: everyday phrases ("rice", "two eggs", "a coke") go straight to the record people mean
through the common-foods table (`src/food/common.ts`), with its alternatives and everyday units (a
can, a container); anything else is USDA's search, reranked by `rankHits` in `src/food/usda.ts`.
`test/eval-live.test.ts` scores both against independently labeled live USDA results
(`test/fixtures/usda/live`).

Every write (POST, PUT, PATCH) must send `Content-Type: application/json`, and writes a browser
marks as started by another site (`Sec-Fetch-Site`) are refused, so other pages can't post to the
API with a family member's sign-in.

`npm run dev:mock` runs the same app with USDA replaced by the recorded fixtures in
`test/fixtures/usda`, so no USDA key is needed (run `npm run db:migrate:local` once first).

## Layout

```
src/            Worker (Hono). app.ts = API shell, auth.ts = Access JWT, profile.ts = /me and /goals
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
