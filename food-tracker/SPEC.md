# Food Tracker: Build Spec (v1)

Hand this file to Claude Code as the source of truth. Build in the phases listed at the bottom, testing each phase before moving on.

## 1. What we're building

A mobile-first web app for logging food by voice. A user says "six ounces of chicken breast," the app looks the food up in the USDA FoodData Central database, scales the nutrition to the amount spoken, and adds it to the day's log. Each user has their own profile, daily goals, and optional weight tracking that shows calorie intake against body weight over time.

Users: a small group of family and friends (under 50 people). Not a public app.

Owner and builder: Andrew. Primary tester and user: his daughter (non-technical). The UI must be obvious to someone who has never seen it.

## 2. Tech stack

- **Hosting:** Cloudflare Workers with static assets (one Worker serves both the frontend and the API). Custom domain on a subdomain of Andrew's existing Cloudflare zone, for example `food.<domain>`.
- **API routing:** Hono on the Worker.
- **Database:** Cloudflare D1.
- **Auth:** Cloudflare Access (Zero Trust free plan) with email one-time PIN. See section 4.
- **Food data:** USDA FoodData Central API. Key stored as a Worker secret, never sent to the browser.
- **Frontend:** TypeScript, built with Vite. Keep it lightweight (vanilla TS or Preact). No heavy UI framework.
- **Charts:** Chart.js.
- **Voice:** Browser Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`).
- **Units:** US imperial by default (oz, lb, cups). Store everything in grams internally.

All of this fits inside Cloudflare's free tier. Total cost: $0.

## 3. Secrets and config

- `USDA_API_KEY` as a Worker secret (`wrangler secret put USDA_API_KEY`). Free key from https://fdc.nal.usda.gov/api-key-signup.html. Use `DEMO_KEY` for local dev only.
- `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` as Worker vars for validating the Access JWT.
- D1 binding named `DB`.
- Never log or return the USDA key in any response.

## 4. Authentication

Use Cloudflare Access in front of the whole subdomain. Users sign in with their email and receive a one-time PIN. This means the app stores no passwords and Andrew controls who gets in.

- Access policy: allow a list of specific email addresses Andrew manages in the Zero Trust dashboard.
- The Worker validates the `Cf-Access-Jwt-Assertion` header on every API request (verify signature against the team's JWKS, check `aud` and expiry). Reject with 401 if missing or invalid. Do not trust the email header alone.
- The verified email is the user identity. On first visit with no profile row, route the user to profile setup.
- Local dev: a `DEV_USER_EMAIL` var that bypasses JWT validation only when running under `wrangler dev`. It must be impossible to enable in production.

Open decision for Andrew: if he later wants anyone to self-register without being added to an Access list, swap this for Google sign-in. Not in v1.

## 5. Data model (D1)

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  track_weight INTEGER NOT NULL DEFAULT 0,      -- 0/1, optional feature toggle
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE goals (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  calories INTEGER NOT NULL,
  protein_g INTEGER,
  carbs_g INTEGER,
  fat_g INTEGER,
  goal_weight_lb REAL,                          -- optional
  effective_from TEXT NOT NULL,                 -- YYYY-MM-DD; keep history, latest wins
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE food_entries (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  log_date TEXT NOT NULL,                       -- YYYY-MM-DD in the user's timezone
  meal TEXT,                                    -- breakfast | lunch | dinner | snack, nullable
  spoken_text TEXT,                             -- raw transcript, for debugging
  food_name TEXT NOT NULL,
  fdc_id INTEGER,                               -- null for manual entries
  quantity REAL NOT NULL,
  unit TEXT NOT NULL,
  grams REAL NOT NULL,
  calories REAL NOT NULL,
  protein_g REAL NOT NULL,
  carbs_g REAL NOT NULL,
  fat_g REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_food_user_date ON food_entries(user_id, log_date);

CREATE TABLE weight_entries (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  log_date TEXT NOT NULL,
  weight_lb REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, log_date)                     -- one weigh-in per day, latest overwrites
);

CREATE TABLE usda_cache (
  fdc_id INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  data_type TEXT NOT NULL,
  kcal_per_100g REAL NOT NULL,
  protein_per_100g REAL NOT NULL,
  carbs_per_100g REAL NOT NULL,
  fat_per_100g REAL NOT NULL,
  portions_json TEXT,                           -- USDA foodPortions, for cup/each/slice conversions
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Every query that touches user data must filter by the authenticated user's id. No endpoint accepts a `user_id` from the client.

Use Wrangler migrations (`migrations/0001_init.sql`).

## 6. USDA integration

Endpoints used:
- `GET https://api.nal.usda.gov/fdc/v1/foods/search?query=...&dataType=Foundation,SR Legacy&pageSize=10&api_key=...`
- `GET https://api.nal.usda.gov/fdc/v1/food/{fdcId}?api_key=...` for portion data

Rules:
- Search Foundation and SR Legacy first (generic foods like "chicken breast"). Only fall back to Branded if nothing reasonable comes back, or if the user names a brand.
- Nutrient IDs: energy kcal `1008` (if absent on Foundation foods, use `2047` or `2048`), protein `1003`, total fat `1004`, carbohydrate `1005`. Values are per 100 g for Foundation and SR Legacy.
- Cache every food the app uses in `usda_cache` so repeat lookups never hit the API.
- The default api.data.gov key allows roughly 1,000 requests per hour. Caching keeps us far below that. Handle 429 with a friendly "try again in a minute" message.
- If USDA is down or returns nothing, offer manual entry (name plus the four numbers).

## 7. Voice input and parsing

Flow:
1. User taps a large mic button. Use `SpeechRecognition` with `interimResults` on so they see words appear.
2. On final transcript, send it to `POST /api/parse`.
3. The Worker parses it into one or more items: quantity, unit, food phrase. Handle:
   - Numbers as words and digits: "six", "6", "a half", "one and a half", "a", "an"
   - Units: oz, ounce(s), lb, pound(s), g, gram(s), cup(s), tbsp, tablespoon(s), tsp, slice(s), piece(s), large/medium/small, and no unit ("two eggs", "a banana")
   - Multiple items in one sentence: "two eggs and a slice of toast"
   - Filler: "I had", "for breakfast", "of"
   - Meal hints: "for lunch" sets the meal field
4. For each item, the Worker searches USDA and returns the top match plus up to 4 alternatives, with computed nutrition for the spoken amount.
5. **Confirm screen (required).** Show each parsed item as a card: food name, amount, calories, P/C/F. User can tap to pick an alternative match, adjust the amount, or remove it. Nothing is saved until they tap "Add." This matters because voice and food matching will be wrong sometimes.

Unit conversion:
- Weight units convert directly (1 oz = 28.3495 g, 1 lb = 453.592 g).
- Volume and count units ("cup", "large", "slice", unitless "egg") use the USDA `foodPortions` gram weights for that food. If no portion matches, default to one standard serving (100 g) and flag it on the confirm card so the user can fix it.

Parsing should be deterministic rule-based code with unit tests. No LLM in v1.

Browser support: Web Speech works in Chrome and Safari (including iPhone). If unsupported, hide the mic and show a text box that goes through the same parse and confirm flow. The text box should always be available as a fallback anyway.

## 8. Screens

Mobile-first, one-handed use. Large tap targets. Light and dark mode.

**Today (home)**
- Date with prev/next day arrows.
- Calorie ring or bar against goal, plus P/C/F progress bars with "remaining" numbers.
- Big mic button, text input fallback beside it.
- Today's entries grouped by meal, each showing name, amount, calories. Swipe or tap to delete; tap to edit amount.

**Profile setup (first run)**
- Display name, timezone (default from browser).
- Daily calorie goal and optional macro goals in grams.
- "Track my weight" toggle, off by default. If on: current weight and optional goal weight.

**Weight** (only visible when tracking is on)
- Quick "log today's weight" input.
- Chart: daily weight dots, a 7-day moving average line, and daily calories as bars on a second axis. Default range 30 days, toggle 90 days.
- Summary line based on the trend, not a single day: e.g. "7-day average down 1.2 lb over the last two weeks. Average intake 1,850 cal/day."

**History**
- Last 30 days: daily calories vs goal as a simple bar chart, tap a day to open it.

**Settings**
- Edit goals (writes a new `goals` row effective today, keeping history).
- Toggle weight tracking.
- Export my data as CSV.
- Delete my account and all my data.

## 9. API

All under `/api`, all require a valid Access JWT, all scoped to the current user.

| Method | Path | Purpose |
|---|---|---|
| GET | /api/me | Profile plus current goals; 404 if no profile yet |
| POST | /api/me | Create or update profile |
| POST | /api/goals | Set new goals |
| POST | /api/parse | Transcript in, parsed items with matches and nutrition out |
| GET | /api/foods/search?q= | Manual food search (for picking alternatives) |
| GET | /api/entries?date= | Entries and totals for a day |
| POST | /api/entries | Save confirmed items (array) |
| PATCH | /api/entries/:id | Change quantity/unit; recompute nutrition |
| DELETE | /api/entries/:id | Delete entry |
| GET | /api/summary?from=&to= | Daily calorie totals for charts |
| GET | /api/weight?from=&to= | Weight entries |
| POST | /api/weight | Log weight for a date |
| DELETE | /api/weight/:id | Delete weight entry |
| GET | /api/export | CSV of all the user's data |
| DELETE | /api/me | Delete account and all data |

Validate all input. Return clear JSON errors.

## 10. Product principles

- Encouraging, neutral tone. No red "you failed" states. Over goal shows as a neutral color with the number.
- Weight insights always use the 7-day average and multi-week trend. Never comment on a single day's swing.
- Goal sanity check: if someone sets a very low calorie goal (under 1,200), show a gentle note suggesting they check it with a doctor or dietitian. Do not block it.
- Weight tracking stays fully optional and hidden unless turned on.
- Fast: logging a food by voice should take under 10 seconds end to end.

## 11. Testing

- Unit tests (Vitest) for the parser: at least 40 phrases covering numbers, units, multi-item sentences, and filler words.
- Unit tests for nutrition scaling and unit conversion.
- Integration tests for API routes using Wrangler's local D1, including a test that user A cannot read or modify user B's data.
- Manual test checklist for the daughter (plain-language steps) in `TESTING.md`.

## 12. Build phases

1. **Scaffold.** Worker with static assets, Hono, D1 binding, migrations, Vite frontend, deploy to the subdomain. Access configured. "Hello, <email>" page proves auth works end to end.
2. **Profile and goals.** First-run setup, settings screen, goals table.
3. **Food logging by text.** USDA search and caching, parser, confirm screen, entries CRUD, Today screen with totals against goals.
4. **Voice.** Mic button on top of the same parse and confirm flow.
5. **Weight tracking.** Toggle, weight logging, combined weight and calories chart, trend summary.
6. **History, export, delete account, polish.**

Stop after each phase so Andrew and his daughter can test on a phone before continuing.

## 13. Out of scope for v1 (planned for v2)

- Photo of a meal to estimate food and macros (needs a vision model API).
- Saved favorites and "log yesterday's breakfast again."
- Barcode scanning for packaged foods.
- Fiber, sugar, sodium.
- Native app or offline mode.

## 14. Before starting, Andrew provides

- The subdomain name.
- A USDA API key.
- The list of emails to allow in Cloudflare Access.
