# Food Tracker

Voice-first food logging for family and friends. `SPEC.md` is the source of truth.

**Status:** Phases 1 to 5 (voice, and weight with the dashboard) are live at https://food.pivotaiglobal.com.
Phase 6 (history, export CSV, delete account, polish) is next.

Voice (`web/src/voice.ts`): a big round mic floats in the middle, just above the tabs, hidden where
the browser has no `SpeechRecognition` / `webkitSpeechRecognition`. From any tab it opens the Diary
and listens in the same tap. Words show in the food box as they're heard, and the final transcript
goes through the same `POST /api/parse` and confirm screen as typing.

Restaurants (`src/food/menu.ts`, data in `src/food/menus/*.json`): McDonald's, Chick-fil-A, Subway, Jimmy
John's, Jersey Mike's, Taco Bell, Chipotle, Panera and Panda Express, about 425 items, from each chain's own
published nutrition (every item cites its source URL; retrieved October 2026). Each size is a food with a
made-up id from 900,000,000 up, so units, saved entries and the edit sheet treat it like a USDA food, and a
size keeps the chain's own numbers. A food matches a menu item when the sentence names the chain ("from
McDonald's", "Panda Express orange chicken", which also covers the sentence's other foods) or says a name
only one chain uses ("a Big Mac", "a Crunchwrap"); anything else goes to USDA as before. Sizes ("large",
"footlong", "bread bowl", "#13 giant") and counts ("20 McNuggets", "7 nuggets") are read from the phrase.
McDonald's, Panera and Jersey Mike's publish no weights, so their items are measured in servings only and
show no grams. Chipotle publishes ingredients only; its burritos, bowls, salads and tacos are one standard
build per protein, summed from those (the build is in each item's note). To refresh a menu, research it
into the same JSON shape and run `node scripts/import-menus.mjs <folder>`: ids are kept for good.

Calories burned (`src/burn.ts`): worked out, never typed in. Goals asks for sex, age, activity level and,
optionally, height (`users.sex`, `birth_year`, `height_in`, `activity`, migration 0008); weight comes from
the weigh-ins, the last week's averaged (with tracking off, Goals asks for a weight and keeps it as a
weigh-in). Resting calories are Mifflin-St Jeor for an adult with a height, otherwise the WHO/FAO/UNU
equations (weight, age and sex only, and they cover teenagers), times the usual activity factor (1.2 to
1.9), to the nearest 10. Each day gets its own number from that week's weight, so the chart's dashed line
follows the weight; the Week / Month sentence compares the average to it, and Today says how far over or
under it the day is, so a goal set below it never hides eating above it. The typed-in
`goals.baseline_calories` from migration 0007 is no longer read.

Fun touches Andrew picked: Overview greets by first name and time of day, shows "N days logged in a
row" once there are two (it counts logging, never amounts), and draws today as a big calorie ring with
protein, carbs and fat rings in the chart colors (past a goal a ring closes in the neutral "over"
color). The Diary gives each meal and food a little emoji (`web/src/emoji.ts`, decoration only), and
a short confetti burst plays once per day when breakfast, lunch and dinner are all logged (skipped for
reduced motion).

API so far: `GET/POST /api/me`, `POST /api/goals`, `POST /api/parse`, `GET /api/foods/search`,
`GET/POST /api/entries`, `PATCH/DELETE /api/entries/:id`, `GET /api/summary`, `GET/POST /api/weight`,
`DELETE /api/weight/:id`. Shapes live in `src/food/types.ts`.

Home is a dashboard: Today / Week / Month. Week and Month show one Chart.js chart, calories stacked by
macro on the left axis and the 7-day average weight plus weigh-ins on a right axis (Andrew chose the
combined two-axis chart over two aligned charts). Colors are validated for color-blind separation.
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
can, a container, a pint, a shot); anything else is USDA's search, reranked by `rankHits` in
`src/food/usda.ts`. The table also names popular beer, hard seltzer and cider brands USDA has no
record of ("a blue moon", "a white claw"), liquor brands ("a shot of Fireball"), wine by its grape
("a glass of Cabernet") and drinks whose brands USDA's search answers badly ("a Prime", "a fanta",
"an AriZona"), each mapped to the generic record nearest its label. A flavor around a table drink is
that drink ("a White Claw Mango", "a cherry coke"), but a juice after a liquor is a mixer ("a vodka
cranberry"). Mixed drinks USDA has no record of ("a mojito", "a Long Island iced tea") are not found
without a search: USDA's hits for them are mixers, candies and teas.
A search result is offered only when it is that food (`isReasonable`: it names every word of the
phrase that says which food it is, so "blue cheese" is no Blue Moon and "white claw" not claw crab
meat; a beer grade is no "Prime", a teaspoon of pale ale mustard no pale ale, THE CAPTAIN'S cocktail
sauce no "captain"); otherwise Branded is searched, then a brand USDA doesn't know falls back to the
table food its last words name ("kirkland trail mix" is trail mix), or to the table food it names
before saying its kind ("a stella beer" is a Stella), a shot of an unknown brand to liquor, and
failing that the phrase is not found. A Branded record whose calories are far off its brand's others
ranks last. A drink said with no unit is its can or bottle, a breakfast cereal a cup.
`test/eval-live.test.ts` scores both against independently labeled live USDA results
(`test/fixtures/usda/live`), and `test/brands.test.ts` and `test/drinks.test.ts` replay live searches
for brand names, drinks and the phrases two adversarial live tests found.

**Deviations from SPEC.md (pending Andrew's OK):** section 6 says to search with `pageSize=10`; the app
asks for 50, because USDA's ranking often leaves the everyday food out of the top 10 (still one call).
And the common-foods table above is an addition: it answers everyday phrases before USDA's search.
At Andrew's request (October 2026) the screens in section 8 are arranged as three bottom tabs:
**Overview** (`/`: today's totals or the Week / Month chart, and the weigh-in), **Diary**
(`/diary`, `/diary/YYYY-MM-DD`: the day, the food box and mic, the meals) and **Goals** (`/goals`:
goals, weight tracking, profile, sign out; Phase 6 adds export and delete here). The old `/settings`
and `/day/...` addresses redirect. Section 6 names USDA as the food source; at Andrew's request restaurant items come from the chains'
own published nutrition instead (see Restaurants above). Section 8 also asks for light and dark mode; Andrew prefers light
only, so the dark theme is gone. SPEC.md itself is unchanged.

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
The one exception is the home-screen icon and its friends (`PUBLIC_FILES` in `scripts/cloudflare.mjs`: the
icon PNGs, `icon.svg` and the manifest). iOS fetches the icon without the sign-in cookie, got Access's login
page and drew a letter instead, so a second Access app, "Food Tracker: public icons", lets anyone load just
those files. `npm run access` keeps it in place.
