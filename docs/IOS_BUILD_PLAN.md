# AI Study Bible: iOS Build Plan

Status: plan for building the real iPhone app from `docs/DATA_MODEL.md` (v2). Numbers come from the spec, `manifest.json` and the measured dataset (31,102 verses, 343,608 edges, 840,072 merged ticker items) unless marked "verify". Licensing detail lives in `docs/LICENSING.md`.

## 1. What we are building

A native iPhone reader where the verse you are looking at drives a strip of ranked cross references that moves like a stock ticker. Tap a chip to peek at the other verse, tap Go to jump there, and a trail remembers the path so you can spiderweb across the whole Bible and get back. Text is the public-domain Berean Standard Bible at launch, with the NIV added as a licensed online text layer. AI study notes (one per verse, one per connection) come from a small backend that calls the Anthropic API; the phone never holds a key.

Definition of done for v1: an App Store build that opens any chapter, Psalm 119 included, in under 50 ms from SQLite on an iPhone XS and shows the first verse under 400 ms from a cold launch, shows the top 12 connections for the verse in focus with no lookup, supports peek, jump, back, forward and trails up to 200 hops with the active trail restored on relaunch and the last 20 trails kept, shows AI notes for the ~5,000 most connected verses from the bundle and fetches the rest on demand, renders every required attribution, ships with a truthful privacy label (section 8), and holds a 99.5% crash-free rate across a 200-user TestFlight, measured from Xcode Organizer's opt-in crash reports rather than a third-party SDK.

## 2. Architecture

SwiftUI, iOS 18 minimum. iOS 18 runs on every iPhone from the XS onward, the same list as iOS 17, and gives us `ScrollPosition`, `onScrollVisibilityChange` and `onScrollGeometryChange` without a fallback path (`ScrollPosition` is iOS 18 only: https://developer.apple.com/documentation/swiftui/scrollposition). If the founder insists on 17, the binding becomes `.scrollPosition(id: $focusVid, anchor: .top)` on an `Int?` and each row falls back to `onGeometryChange`; this plan assumes 18.

Scripture and the graph live in a prebuilt, read-only `asb.sqlite` shipped in the app bundle and read with GRDB 7 (Swift 6 strict concurrency). GRDB rather than SwiftData for this data because it is about 870,000 rows (31,102 verses, 840,072 ticker items) of static, indexed, SQL-shaped reads. SwiftData cannot run FTS5 or the composite-key range reads the ticker needs, and gives no control over indexes or page layout. GRDB does, and reads a prebuilt file as-is. SwiftData holds only what the user creates: trail, bookmarks, highlights, reading position, fetched AI rows. A small backend serves AI context and NIV text. No API keys on the phone.

```
+---------------------------------------------------------------+
| SwiftUI views     ReaderScreen  TickerStrip  PeekSheet  Trail |
+---------------------------------------------------------------+
| Stores (actors)   ChapterStore  TrailStore  AIContextClient   |
|                   NIVTextClient  PackManager                  |
+------------------------------+--------------------------------+
| GRDB (read-only)             | SwiftData (user data)          |
| asb.sqlite 44.7 MB with FTS5 | Trail (200 hops, last 20 kept) |
| ~60 MB with scope A notes    | Bookmark, Highlight            |
|   books        66            | ReadingPosition                |
|   translations               | AIContextRow (fetched cache)   |
|   verses       31,102 x T    +--------------------------------+
|     text, snippet, heading,  | Memory only (license rule)     |
|     paragraphStart           | NIV chapters, LRU 5 + prefetch |
|   ticker       840,072       +--------------------------------+
|     PK (vid, rank)           | Network (HTTPS, App Attest)    |
|   ai_context   key PK        | POST /v1/context  (AI notes)   |
|   verses_fts   FTS5 (~8 MB)  | GET  /v1/text/niv/{chapterId}  |
| packs.sqlite (attached)      | GET  /manifest.json            |
|   imported offline packs     | GET  packs/*.json.gz (sha256)  |
+------------------------------+--------------------------------+
| edges and incoming stay in   | Backend: FastAPI on Fly.io     |
| the tooling build (73 MB)    | Postgres cache, Anthropic API  |
+------------------------------+--------------------------------+
```

First launch copies `asb.sqlite` from the bundle to Application Support (a file copy, never a JSON parse) and opens it read-only with a `DatabasePool`. Size: 44.7 MB measured with FTS5, about 60 MB once scope A notes are compiled in, roughly 20 MB compressed as the App Store delivers it; re-measure with `compile_sqlite.py` after the batch. `asb.sqlite` stays read-only and is replaced wholesale when `datasetVersion` changes. Imported packs go to a second file, `packs.sqlite`, attached at open, so an update never deletes a pack. Both files are marked `isExcludedFromBackup`.

## 3. The reader screen and the ticker

Chapter loading. `ChapterStore` is an actor with one method, `bundle(for chapterId:)`. A miss runs one indexed query over `verses` joined to `ticker` (36 x 12 rows for John 3) and assembles a `ChapterBundle` as spec section 2.7 defines it. It keeps an LRU of 5 bundles and prefetches `prevChapter` and `nextChapter` after each load. Psalm 119 (176 verses) is the worst case and still one query.

Verse in focus. The focus verse is the one whose frame contains the point one third down the visible area, or the verse the user tapped, whichever happened last. `ChapterView` is a `ScrollView` over a `LazyVStack` of `VerseRow`s with `.scrollTargetLayout()`, bound to a `ScrollPosition` via `.scrollPosition($position)`. Each row reports through `onScrollVisibilityChange(threshold: 0.5)` and `ChapterView` picks the visible row nearest the one-third line, debounced at 80 ms. A focus change updates the current trail hop's `scroll.anchor` in place (spec decision 8: scroll is not a hop).

The ticker strip. `TickerStrip` takes the focus verse's 12 inlined `TickerItem`s and renders `TickerChip`s in a horizontal auto-scrolling marquee. Motion is time-based: a `TimelineView(.animation)` computes the x offset from elapsed time against a cumulative schedule in which chip i occupies `dwellSeconds = 1.6 + 1.2 * weight` of travel, so a 1.0 chip holds 2.8 s and a 0.3 chip 1.96 s, as the spec's `motion` block says. The chip row is laid out twice back to back so the loop has no visible seam. `weight` also sets chip opacity and size; `direction` sets the glyph; `sameBook` gets a quieter tint. Re-anchoring: on focus change the strip resets elapsed time to zero so rank 1 shows first, and crossfades the chip set over 200 ms. A touch pauses motion; it resumes 3 s after release. VoiceOver, Reduce Motion and Dynamic Type are Phase 1 acceptance items (section 7).

The peek sheet. Tapping a chip opens `PeekSheet` at 40% and full detents. It shows the target verse in full with one verse each side (one indexed read; decision 6 in section 9), "cited 178 / cites back 33", direction, the `viaRange` note when present, and the AI `why` with an AI marker when `aiStatus == cached`. On a miss the sheet starts generation as it opens and fills in as text streams (section 6). Buttons: Go and See all. A peek appends to `trail.peeks`.

The jump. Go builds a `Hop(kind: .jump, via: ...)`, pushes it onto `TrailStore`, loads the target chapter, sets `position` to the target vid and highlights `to.start...to.end` for 2 s. See all opens `ConnectionsList`, the uncapped merged list (spec 2.8) from one `ticker` query.

The trail. `TrailStore` is the SwiftData model of spec 2.10: `hops`, `forward`, `peeks`, `web`, `cursor`; trails up to 200 hops, the active trail restored on relaunch, the last 20 trails kept. `TrailBar` sits under the title with Back, Forward and the path ("John 3:16 > Romans 5:8 > 1 John 3:16"). Back pops the hop into `forward` and restores the previous chapter and `scroll.anchor`. `TrailWebView` draws `trail.web` with `Canvas`: visited vids as nodes, votes as edge width, tap a node to jump.

## 4. Data pipeline

`tools/build_dataset.py` reads `BSB.json` and `cross_references.txt` through `tools/sources.py` and `canon.json`, then: parses 343,609 lines, clamps 4 range ends to 3 John 1:14 and drops the 1 edge sourced from 3 John 1:15 (343,608 remain; take both numbers from `manifest.graph` in future edits); expands range targets into incoming rows with `votesEff = votes / sqrt(span)`, skipping the 295 ranges over 40 verses (596,218 rows); merges per verse by start vid, applies `score = votesOut + 0.5 * sum(votesEff)`, per-verse `weight`, global `tier` and the order rule; cuts 110-character snippets; writes `books.json`, `graph/`, `incoming/`, `text/bsb/` (66 shards each), `attribution.md` and `manifest.json` with bytes, gzipBytes and sha256 per shard, plus the sample bundles for the prototype.

`tools/compile_sqlite.py` reads the shards and writes `asb.sqlite` with the ship profile: `books`, `translations`, `verses`, `ticker`, `ai_context`, `verses_fts`; raw `edges` and `incoming` stay in the tooling build (`--profile full`, 73 MB). Primary-key indexes, FTS5, `page_size = 4096`, `journal_mode = DELETE` (no WAL sidecar in a read-only bundle), then `VACUUM`. It asserts row counts against the manifest.

Versioning. `datasetVersion` (`2026.09.1`) changes when a source or the pipeline output changes; `rankingVersion` (`asb.rank.v2`) only when a ranking constant changes. Both are stamped into every bundle and the manifest. A `rankingVersion` bump invalidates verse notes (their inputs include the top 12 connections) but not edge notes, per the spec's `invalidateOn` lists.

Translation packs. `tools/build_text_pack.py --translation niv --source <licensed file>` writes `text/niv/{bookNo}-{osis}.json.gz` with text, snippets, headings and `paragraphStart`, and appends a `translations[]` entry with `textVersion`, `packUrl` and `sha256`. NIV packs are never committed. A pack whose license allows offline use is imported by `PackManager` into `packs.sqlite` (+5 MB per translation), never into `asb.sqlite`; for such a pack, switching translation re-runs the chapter query with another `translation` value and the graph does not change. A streaming-only translation never touches disk (section 5).

OTA verification. `PackManager` fetches `manifest.json` over HTTPS from our domain, downloads each `.json.gz`, hashes it with CryptoKit and rejects any file whose sha256 differs from the manifest before it reaches the database. The manifest itself carries an Ed25519 signature checked against a public key compiled into the app, so a compromised CDN cannot swap it.

## 5. Translation and licensing path

Ship v1 on the Berean Standard Bible: public domain (CC0, 2023), nothing to negotiate, commercial from day one. The NIV is the target translation, and Biblica's rule per the research notes is that NIV text may be streamed to an app but not licensed for offline or downloadable use, and Biblica does not license software still in development (verify: https://www.biblica.com/permissions/). So the NIV is a license-gated, online-first text layer (decision 1 in section 9). `NIVTextClient` fetches one chapter at a time from our backend, keeps an LRU of 5 plus prev/next in memory only, and falls back to BSB with a banner when offline. We apply to Biblica with the finished TestFlight build in Phase 3. API.Bible does not offer NIV for commercial use (verify: https://care.api.bible/article/369-understanding-api-bible-licensing).

Chip snippets are translation-specific and live on the target verse's row (spec 2.3, 2.6), in other chapters, so a chapter-only NIV feed would put BSB words on NIV chips. `GET /v1/text/niv/{chapterId}` therefore returns the chapter text plus NIV snippets for every chip target in the chapter (about 430 rows, ~25 KB) and the peek contexts for the top 12 of each verse. That keeps NIV to one request per chapter and keeps NIV words on NIV chips. Anything not in the response, and everything offline, falls back to BSB with a BSB tag on the chip.

The app must display, on `AboutScreen` and in each document's `attribution` block: the BSB notice from the manifest ("The Holy Bible, Berean Standard Bible, BSB is produced in cooperation with Bible Hub, Discovery Bible, OpenBible.com, and the Berean Bible Translation Committee..."), the OpenBible.info Creative Commons Attribution credit (version to confirm before printing) including the sentence that ranking and range handling are our own, the AI disclaimer ("AI-generated study aid, not authoritative commentary"), and, once licensed, the exact NIV copyright line Biblica supplies (the standard form names Biblica, Inc. and the 1973, 1978, 1984, 2011 dates; verify wording against the license).

## 6. AI layer

Backend: Python with FastAPI on Fly.io, Postgres for the `ai_context` cache, Cloudflare R2 plus CDN for packs. Python because the pipeline is already Python and the backend reuses `sources.py`, the canon table and the cache-key builder unchanged; Fly.io because one small VM with attached Postgres covers years of this traffic. The service uses the official Python SDK. Generation model: `claude-opus-5` ($5 input / $25 output per million tokens) for on-demand calls and the scope A batch; `claude-sonnet-5` ($2 / $10) is the single alternative for scope B (decision 5 in section 9). Every request uses adaptive thinking (`thinking: {type: "adaptive"}`, effort `medium`), prompt caching on the shared system prompt, and structured outputs (`output_config.format` with the JSON schema of `AIVerseContext.content` or `AIConnection.content`). Offline jobs go through the Message Batches API at 50% off. The phone never calls the API.

Two prompt jobs. `verse-context` (v3): input is the verse with two verses of context each side, book, chapter, genre hint, and the top 12 connection labels and snippets; output is `summary, context, speaker, genre, themes[], entities[], questions[], readingTip`. `edge-why` (v2): input is both verses, direction, `votesOut`, `votesIn` and the `relationVocabulary`; output is `why, relation, confidence, sharedThemes[], readNext[]`. Both prompts forbid doctrinal verdicts and cap `why` at 60 words. The batch runner checks `stop_reason` on every result; `refusal`, `max_tokens` and schema failures go to a retry lane with a plain-text fallback prompt, and the job report lists any key still empty.

Pre-generation scope A (spec open question 4): the top ~5,000 verses by degree get a verse note and their top 3 chips get a `why`: 20,000 batch requests, written to `ai/verse/` and `ai/edge/` shards and compiled into the bundled `ai_context` table with `cache.source = bundled`. Scope B is every verse plus every strong and solid chip (9.8% of 840,072 items, roughly 45,000 unique edges once both directions share a key): about 76,000 requests.

Translation and notes. Cache keys carry `{translation}:{textVersion}` and every bundled note is `bsb:bsb-2023`, so NIV would miss on all of them. Under NIV the app shows the BSB-keyed note with the line "written from the BSB wording"; no NIV regeneration in v1. The Biblica application states that verse text is sent to our AI provider to generate study notes and is not retained by it, relying on Anthropic's commercial terms: API inputs are not used for training and are held only for a short trust-and-safety window (verify the current period and zero-retention eligibility: https://www.anthropic.com/legal/commercial-terms).

On demand: a miss in the bundle and the SwiftData cache posts to `/v1/context` with the spec's cache key (`ai:verse:{vid}:{translation}:{textVersion}:{promptVersion}` or the edge form). The backend checks Postgres by key, generates on a miss with `claude-opus-5`, stores and returns it; the phone saves the row with `cache.source = fetched`, `ttlDays = 365`. Generation starts when the peek sheet opens, not on a tap; the backend streams the note and the sheet fills in as text arrives; the phone caches the result. Target under 10 s to first sentence; 600 output tokens plus thinking is more like 8 to 20 s end to end (verify in the Phase 2 pilot). If the pilot shows worse, on-demand runs at effort `low` and the batch keeps `medium`.

Abuse control: the app attests once with App Attest (`DCAppAttestService.generateKey` and `attestKey` against a server challenge) and receives an anonymous device token. Both endpoints require the device token and a fresh assertion; the backend allows 60 generations per device per day and 5 per minute, and NIV chapters are limited to 120 per device per day. Global cap of 3,000 generations per day and a hard monthly ceiling of $300, enforced in the backend and mirrored by a spend limit in the Anthropic Console; past the cap the app shows "more notes tomorrow" instead of generating. The backend logs chapter counts per month in aggregate for licensor reporting. App Attest does not run in the Simulator, so a debug build talks to a staging backend that accepts a developer key.

Cost math. Assumptions: system prompt ~1,500 tokens, cached after the first call (minimum cacheable prefix 512 tokens on `claude-opus-5`, 1,024 on `claude-sonnet-5`; `claude-haiku-4-5` needs 4,096, so it never caches here and is out); verse-note input ~1,200 uncached tokens, edge input ~400; cache reads at about 10% of input price; batch halves everything. Output is the open variable: the verse-note JSON alone is ~400 tokens and adaptive thinking at effort `medium` is billed as output and can add 500 to 2,000 tokens per request, so the figures are ranges until the Phase 2 review set reports `usage.output_tokens`.

| Scope | Requests | Uncached input | Cache reads | claude-opus-5 batch | claude-sonnet-5 batch |
|---|---|---|---|---|---|
| A: 5,000 verses + 15,000 whys | 20,000 | 12 M | 25.5 M | $150 to $350 | $60 to $140 |
| B: 31,102 verses + ~45,000 whys | ~76,000 | 55 M | 101 M | $620 to $1,400 | $250 to $560 |

Replace the ranges with measured numbers after the pilot. The spec's 10x for scope B was an estimate; counted, it is about 4x. On-demand generation on `claude-opus-5` costs about 2 to 5 cents per verse note and 1 to 3 cents per `why`; the monthly line in section 10 assumes 1,000 active readers, 10 uncached notes each, with the $300 ceiling as the stop. The spec's $60 to $130 figure counted input only.

## 7. Phased delivery

Effort assumes one senior iOS engineer plus the founder using AI coding tools, and one product designer on contract for Phase 0.5.

Phase 0, data pipeline and SQLite (this repo). Deliverables: `build_dataset.py`, `compile_sqlite.py`, `asb.sqlite` under 65 MB with scope A notes compiled in, manifest with hashes, JSON schemas, CI that rebuilds and diffs counts. 2 engineer-weeks, mostly the founder. Risk: versification mismatches beyond the 5 known edges when a new text pack arrives; every pack is validated against `books.json` verse counts.

Phase 0.5, product design. Deliverables: reader, strip, peek, trail web, icon, store screenshots. 2 to 3 weeks, $10k to $20k contract (verify rates), before Phase 1. Risk: the strip is a novel motion UI with nothing to copy; prototype the motion in the design tool first.

Phase 1, reader, ticker and trail on BSB (TestFlight). Deliverables: every view in section 3, GRDB layer, SwiftData trail, search, About screen, 200-tester TestFlight. Acceptance includes accessibility, because it changes how `TickerStrip` is built: scripture and chips honour Dynamic Type through the accessibility sizes, with the strip growing in height rather than truncating; VoiceOver treats `TickerStrip` as one element ("12 connections, strongest Romans 5:8, both directions"), pauses motion and exposes each chip as a custom action; Reduce Motion turns the marquee into advance-on-focus, rank 1 shown statically with horizontal paging. 6 engineer-weeks. Risk: marquee and focus detection fighting on fast scrolls and large Dynamic Type; build `TickerStrip` first as a standalone preview fed by recorded feeds.

Phase 2, AI context. Deliverables: FastAPI service, App Attest, staging backend, Postgres cache, spend caps, 200-verse review set with measured output tokens and latency, scope A batch job, bundled `ai_context`, streaming peek-sheet AI panel, `AIContextClient`. 4 engineer-weeks. Risk: a bad note embarrassing the product in a religious context; grade the review set before the batch runs and add "Report this note".

Phase 3, NIV licensing and online text layer. Deliverables: Biblica application with the TestFlight build, `NIVTextClient`, text endpoint with snippets and peek contexts, translation switcher, copyright notices, usage reporting. 3 engineer-weeks plus calendar time waiting on Biblica. Risk: Biblica declines or prices out a small app; the product ships on BSB regardless.

Phase 4, polish and App Store. Deliverables: accessibility audit against the Phase 1 acceptance, dark mode, onboarding, store assets from Phase 0.5, privacy label, review. 4 engineer-weeks. Risk: App Review objecting to AI-generated religious content; the visible AI marker and disclaimer on every note is the answer.

Total: 19 engineer-weeks of build, plus 4 weeks contingency and QA: about 23 engineer-weeks, plus the Phase 0.5 design contract.

## 8. App Store and operational considerations

Category: Reference, where the leading Bible apps sit (verify: https://apps.apple.com/us/app/bible/id282935706); secondary Books. Age rating 4+: no user-generated content, no browser, no in-app purchases if decision 2 in section 9 goes as recommended. Privacy label: Apple counts data as collected when it leaves the device and we can access it beyond the request (https://developer.apple.com/app-store/app-privacy-details/); the device token is kept server-side to rate-limit across days, so "Data Not Collected" would be false. Declare "Identifiers: Device ID, not linked to you, App Functionality"; server logs keep IP addresses for 7 days, never joined to the token; "Report this note" sends the note key and nothing typed. Get the wording checked before submission, and change it first if analytics or a crash SDK are ever added; crash-free rate comes from Xcode Organizer's opt-in reports. Offline-first: BSB text, graph, ticker, trail and bundled AI notes need no network; only NIV and on-demand notes do. Accessibility is built in Phase 1 (section 7), not bolted on. Dark mode from day one via semantic colours. iPad later: the reader is one column and the data layer is device-agnostic, so an iPad build with a sidebar trail is a Phase 5 item.

## 9. Decisions the founder must make before Phase 1

1. NIV path: Biblica direct after TestFlight, BSB as launch and offline text. Recommendation: yes; it is the only path that clearly permits a commercial app.
2. Commercial model: free, paid up-front, freemium or subscription. Recommendation: paid up-front at launch with no in-app purchase, so v1 needs no StoreKit, paywall or restore work; Apple keeps 15% under the Small Business Program. Revisit a subscription when the NIV is signed, which adds 2 weeks for StoreKit 2 and a paywall. Licensors, API.Bible included, treat any revenue model as commercial, freemium too.
3. Ticker motion: auto-scroll loop with re-anchor (current) or advance-on-focus-then-hold. Recommendation: auto-scroll, with advance-on-focus as the Reduce Motion behaviour, so both get built.
4. Incoming references: merged strip with a direction glyph, or a separate "Who quotes this?" lane. Recommendation: merged; the score already balances the two.
5. AI scope: scope A pre-generated plus on-demand, or scope B. Recommendation: scope A on `claude-opus-5`, $150 to $350 until measured; `claude-sonnet-5` only if scope B is chosen.
6. Peek depth: snippet only or full verse with context. Recommendation: full verse with one verse each side.
7. Ranking constants (12 chips, 0.5 incoming factor, 1/sqrt(span), 40-verse cap, tiers 10 / 4). Recommendation: confirm after a week with the prototype; a change later is a `rankingVersion` bump, not a rewrite.
8. Trail persistence: on-device (last 20 trails) or iCloud sync with shareable replay links. Recommendation: on-device for v1; sharing adds a deep-link scheme and changes the privacy label.
9. Editorial overlay and reader upvotes. Recommendation: no for v1; both change the pipeline and the data-collection disclosure.

## 10. Rough budget

| Item | Estimate | Basis |
|---|---|---|
| Engineering | $120k to $180k | 23 engineer-weeks at senior contract rates, contingency and QA included; less if the founder takes Phase 0 and the backend |
| Product design | $10k to $20k | Phase 0.5, 2 to 3 weeks contract (verify rates) |
| Apple Developer Program | $99 per year | https://developer.apple.com/programs/whats-included/ |
| Backend hosting | $30 to $80 per month | One Fly.io VM, Postgres, R2 and CDN egress |
| AI generation | $150 to $350 once (scope A) plus up to $300 per month on demand | Section 6 ranges; 1,000 active readers, 10 uncached notes each per month, $300 hard ceiling |
| NIV license | Unknown | Submit Biblica's Permission Request Form with the TestFlight build and ask for the streaming fee schedule and reporting terms; ask HarperCollins Christian Publishing (Zondervan) who handles US digital licensing; verify at https://www.biblica.com/permissions/ |

Sources outside the spec: SwiftUI scroll APIs (https://developer.apple.com/documentation/swiftui/scrollposition, https://augmentedcode.io/2024/07/01/scroll-geometry-and-position-view-modifiers-in-swiftui-on-ios-18/), SwiftData prebuilt stores (https://developer.apple.com/documentation/swiftdata/modelconfiguration), GRDB 7 (https://swiftpackageindex.com/groue/GRDB.swift), App Attest (https://github.com/veehaitch/devicecheck-appattest), privacy labels (https://developer.apple.com/app-store/app-privacy-details/), Batches pricing (https://platform.claude.com/docs/en/build-with-claude/batch-processing), Anthropic commercial terms (https://www.anthropic.com/legal/commercial-terms, verify).
