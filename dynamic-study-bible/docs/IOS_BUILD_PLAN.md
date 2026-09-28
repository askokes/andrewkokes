# Dynamic Study Bible: iOS Build Plan

Status: 2026-09-28. Replaces the earlier plan for a hired team. Written for Andrew building the app himself with Claude Code on a Mac. Licensing lives in `docs/LICENSING.md`, data shapes in `docs/DATA_MODEL.md`. "Verify" marks anything not yet confirmed.

## What v1 is

A free iPhone Bible in the NIV. The verse in focus drives a strip of connected verses from across the Bible. Each chip says where it goes, which way the reference runs, and why: "Direct quote", "Same story" or "Same topic". Tap a chip to peek. Tap Go to jump. A trail remembers every hop so you can always get back.

The decisions behind it:

- The NIV comes from the YouVersion Platform (Bible version 111) through YouVersion's Swift SDK, fetched at runtime and cached by the SDK for about 7 days. We never bundle, store, index or send it to an AI model. No offline NIV today.
- The public-domain Berean Standard Bible (BSB) ships inside the app: the offline fallback, always labelled "BSB", and the text our pipeline analyses to compute reasons.
- Free forever. No ads, in-app purchases, tips, subscriptions or paid tier. YouVersion removes access if any appear.
- No AI output in v1. Reasons come from fixed rules in `tools/reasons.py`: 60 of 60 on the hand-labelled set in `tests/gold_reasons.json`, roughly 80 to 100 percent precise per rule in hand audits. About 92 percent of chips read "Same topic"; quotes and stories stand out.
- The strip holds still by default. A Motion switch turns on a slow auto-scroll.
- No backend. The database ships in the app and the NIV comes straight from YouVersion.

Definition of done for v1:

1. Any chapter opens in the NIV with "NIV" and YouVersion's copyright string on screen.
2. Offline, a chapter the SDK has not cached opens in the BSB under an "Offline: showing BSB" banner.
3. The strip shows up to 12 chips for the verse in focus: reference, direction, reason with its match percentage, and the first words of the verse. A Match slider hides connections below a chosen percentage. The strip moves only when swiped, or when Motion is on.
4. The peek sheet shows the whole target verse in the NIV, the reason and its "because" sentence, the vote counts and Go.
5. Go, Back, Forward and the trail web work; the trail survives a relaunch.
6. Search by reference or word, plus a book and chapter picker.
7. Works with the largest Dynamic Type sizes, VoiceOver and Reduce Motion.
8. An About screen credits every source. No ads, purchases, accounts or AI output.
9. Live on the App Store.

## Architecture

```
+-----------------------------------------------------------------+
| SwiftUI views                                                   |
| Reader TickerStrip PeekSheet TrailBar TrailWeb Search About     |
+--------------------------------+--------------------------------+
| asb.sqlite, bundled, read with | YouVersion Swift SDK           |
| GRDB (read-only)               | NIV = version 111              |
|  books                         | chapter fetched on demand      |
|  verses: BSB text (fallback)   | cached by the SDK (~7 days)    |
|  ticker: top 12 per verse,     | copyright string from the API  |
|   direction, votes, weight,    |                                |
|   reason and "because" line    |                                |
|  search index over BSB         |                                |
+--------------------------------+--------------------------------+
| SwiftData: trails, bookmarks, reading position (verse ids only) |
| Settings (AppStorage): Motion switch                            |
+-----------------------------------------------------------------+
No backend. No accounts. No analytics. No AI.
```

Every verse has a permanent id (John 3:16 is `43003016`, spec section 3). The reader asks the SDK for the NIV chapter and our database for that chapter's ticker rows. Chips carry only references and reasons, so moving the strip makes no network calls. Our code keeps NIV text in memory only. SwiftData stores verse ids, never verse text.

SDK facts, read in the source of `youversion/platform-sdk-swift` 5.5.0 (latest commit 2026-09-23):

- Package `https://github.com/youversion/platform-sdk-swift.git`, library `YouVersionPlatform`, iOS 17 or later.
- Start-up: `YouVersionPlatformConfiguration.configure(appKey:appName:isSignInEnabled:permittedVersionIds:)` with `isSignInEnabled: false` and `permittedVersionIds: [111]`.
- Address: `BibleReference(versionId: 111, bookId: "JHN", chapter: 3, verse: 16)`. Book ids are USFM codes (GEN, JHN, 1JN), not our OSIS ids, so the app needs a 66-row mapping.
- Chapter text: `BibleChapterRepository.shared.chapter(withReference:)` returns chapter HTML and caches it in memory and on disk until the server's cache header expires, or 7 days by default. `YouVersionAPI.Bible.chapter(reference:)` skips the cache; do not use it.
- Rendering: `BibleTextNode(html:)` parses a chapter once; `BibleVersionRendering.textBlocks(from:reference:fonts:)` turns any verse range of it into styled text.
- Copyright: `BibleVersionRepository.shared.version(withId: 111)` returns a `BibleVersion` with `abbreviation` and `copyright`.
- Views: `BibleTextView` (text only, we add the copyright), `BibleCardView` (adds reference and copyright), `BibleReaderView` (a full reader).
- Offline: `downloadStatus(for:)` reports every version as `.notDownloadable` today.

Reader choice. `BibleReaderView` never reports which verse is on screen, and the ticker depends on that. So we fetch the chapter through `BibleChapterRepository`, parse it once, render each verse as its own row in our own SwiftUI scroll view, and watch which row sits one third down the screen. We lose paragraph indents, an acceptable v1 trade. Revisit if YouVersion adds a visible-verse callback.

## Before you start

- A Mac with the current Xcode.
- Apple Developer Program, $99 a year (https://developer.apple.com/programs/). An individual enrolls in a day or two; a company needs a D-U-N-S number and takes longer.
- An iPhone on iOS 18 or later, with Developer Mode on when Xcode asks.
- A YouVersion Platform account and app key: sign up at https://platform.youversion.com, register the app as non-commercial, and accept the NIV (version 111) license. Send YouVersion Support the questions in `docs/LICENSING.md` the same week; the email is drafted in `docs/licenses/youversion-support-email.md`.
- A clone of this repo on the Mac.
- Claude Code on a paid Claude plan. Start sessions from the `dynamic-study-bible` folder so it reads `CLAUDE.md`.

Allow a week, mostly waiting on accounts.

## Milestones

Estimates assume 10 to 15 hours a week. If a milestone runs long, ask Claude what is blocking before adding code. Test on your iPhone, not only the Simulator.

### 1. Create the project

Goal: an empty app on your iPhone with GRDB and the YouVersion SDK installed.

```
Read CLAUDE.md, docs/IOS_BUILD_PLAN.md and docs/LICENSING.md. Create a SwiftUI iPhone app in ios/ named DynamicStudyBible, with the display name "Dynamic Study Bible", iOS 18 minimum, Swift 6. Add the Swift packages GRDB (https://github.com/groue/GRDB.swift, version 7) and YouVersionPlatform (https://github.com/youversion/platform-sdk-swift.git, 5.5 or later). Configure the SDK at launch with isSignInEnabled false and permittedVersionIds [111]. Read the app key from ios/Secrets.xcconfig, keep that file out of git, and commit a Secrets.example.xcconfig. The first screen shows the NIV copyright string from BibleVersionRepository.shared.version(withId: 111). Then walk me through running it on my iPhone.
```

Check: the app opens on your phone and shows the NIV copyright line. An error here means the app key is wrong or the NIV license is not accepted yet.

Time: 0.5 to 1 week.

### 2. Bundle the database and show a chapter in BSB

Goal: John 3 in the BSB from the bundled database, with its ticker rows loaded.

```
Run python3 tools/build_dataset.py and python3 tools/compile_sqlite.py, then add data/full/asb.sqlite to the app bundle. Read tools/compile_sqlite.py for the tables: ticker rows carry reasonKind and reasonConfidence100, and reason_text holds each because sentence. On first launch copy the file to Application Support, exclude it from backup and open it read-only with a GRDB DatabasePool. Build a ChapterStore that loads one chapter's BSB verses and each verse's top 12 ticker rows, with reasons, in one query. Show John 3 with one row per verse and a "BSB" label. Add a unit test that John 3:16's first ticker row matches data/samples/chapters/John-3.json.
```

Check: turn on airplane mode. John 3 still appears instantly.

Time: 1 to 2 weeks.

### 3. The same chapter in the NIV, with a BSB fallback

Goal: the reader shows the NIV when online and the labelled BSB when not.

```
Add an NIVTextClient. Map our bookNo values to USFM book codes (GEN to REV) in a Swift table, with a test covering all 66. Fetch the chapter with BibleChapterRepository.shared.chapter(withReference:) for version 111, parse it once with BibleTextNode(html:), and render each verse as its own row with BibleVersionRendering.textBlocks(from:reference:fonts:). Show "NIV" and BibleVersion.copyright under the chapter. Never write NIV text to disk, SwiftData or logs. If the fetch fails, show the BSB chapter from our database under the banner "Offline: showing the Berean Standard Bible (BSB)". Show a clear message for YouVersionAPIError.notPermitted. List any chapters where NIV verse numbers differ from BSB.
```

Check: John 3 reads in the NIV with the copyright line. In airplane mode, a chapter you have never opened shows the BSB with the banner; one you opened today still shows the NIV from the SDK cache.

Time: 1 to 2 weeks.

### 4. Verse in focus and the ticker

Goal: the strip follows your reading and explains every chip.

```
Build verse-in-focus detection and TickerStrip. The focus verse is the row crossing the line one third down the visible area (ScrollPosition and onScrollVisibilityChange, debounced 80 ms), or the verse last tapped, whichever happened last. TickerStrip shows the focus verse's 12 ticker rows as chips: reference label, a direction glyph for out, in and both, a reason pill (Direct quote, Same story, Same topic) and the match percentage from reasonConfidence100 (for example "Quote 100%"). Line 2 of each chip shows the first words of the target verse. In NIV that is a partial-verse preview, which needs YouVersion's OK (question 3 in docs/LICENSING.md), and each chip's words come from the SDK's cached chapter for that verse. Until YouVersion answers, show the reference and reason only in NIV mode and the first words in BSB mode. Add a Match slider above the strip (0 to 100 percent in steps of 5, default 0): it re-runs the ticker query with reasonConfidence100 >= the slider value, still ordered by rank and limited to 12, and the header shows how many of the verse's connections pass ("7 of 110 at 80% or better"). The strip never moves on its own: the reader swipes it, and it returns to rank 1 when the focus changes. Add a Motion switch in Settings, off by default, that auto-scrolls in a loop with each chip dwelling 3.0 + 3.0 x weight seconds and pausing while touched. Build TickerStrip first as a standalone preview fed by data/samples/ticker/.
```

Check: scroll John 3 slowly. The chips change as each verse crosses the line, and nothing moves until you swipe. Turn Motion on: chips drift and linger longer on the bold ones.

Time: 2 to 3 weeks.

### 5. Peek sheet

Goal: see why a connection exists before you leave your place.

```
Tapping a chip opens PeekSheet with medium and large detents. It shows the target reference; the whole target verse in the NIV via BibleTextView, fetched only on tap and never shortened; "NIV" and the copyright string; the reason pill with its match percentage and because sentence (for example "Direct quote, 100% match: Matthew 27:46 quotes Psalm 22:1"); "cited N / cites back M" from votesOut and votesIn; and Go. For a range target show whole verses up to 5; for longer ranges or ranges that cross a chapter, show the first verse and "Go to read the rest". Offline, show the BSB verse labelled BSB. Record the peek on the trail.
```

Check: on John 3:16 tap John 3:15. The sheet shows the NIV verse, "Same story" and "Another part of the same passage in John 3".

Time: 1 to 2 weeks.

### 6. Jump, trail, Back and Forward, trail web

Goal: wander freely and always find your way back.

```
Implement the Trail from docs/DATA_MODEL.md section 2.10 in SwiftData, storing verse ids and labels only. Go pushes a jump hop, opens the target chapter at that verse and highlights it for 2 seconds. A TrailBar under the title shows Back, Forward and the path. Scrolling updates the current hop's anchor rather than adding a hop. Keep up to 200 hops, restore the active trail on relaunch and keep the last 20 trails. TrailWeb draws visited verses as nodes and jumps as lines with Canvas; tapping a node jumps there. Use data/samples/trail.json as a test fixture.
```

Check: go John 3:16, Romans 5:8, 1 John 3:16. Tap Back twice and Forward once. Force-quit and reopen: the trail is intact.

Time: 2 to 3 weeks.

### 7. Search and book picker

Goal: get anywhere fast.

```
Add a book and chapter picker from the books table. Add search: a typed reference such as "jn 3 16" or "1 John 4:9" goes straight there, using the aliases in data/full/books.json; words search our BSB full-text index and list references with a BSB snippet labelled "BSB". Tapping a result opens it in the NIV. Do not build any NIV search or index.
```

Check: search "rom 5 8", then "shepherd". Both land where you expect.

Time: 1 to 2 weeks.

### 8. Accessibility and About

Goal: usable by everyone, and every source credited.

```
Accessibility pass. Scripture and chips scale with Dynamic Type through the accessibility sizes, and the strip grows taller instead of truncating. VoiceOver reads the strip as one element ("12 connections, first Romans 5:8, Same topic"), exposes each chip as a custom action, and reads a chip as reference, direction and reason. Reduce Motion turns off the Motion auto-scroll and animated transitions. Add an About screen with the NIV copyright from the SDK, the BSB notice, the OpenBible.info credit exactly as in README.md's Attribution section, and the line "Connection reasons are computed by fixed rules, not AI." Check dark mode.
```

Check: on your iPhone turn on the largest text size, then VoiceOver, then Reduce Motion, and read a chapter with each.

Time: 1 to 2 weeks.

### 9. TestFlight

Goal: friends test the real app.

```
Prepare the first TestFlight build: a placeholder app icon, bundle id, version 1.0 build 1, ITSAppUsesNonExemptEncryption set to NO, and a PrivacyInfo.xcprivacy that declares no tracking. Walk me through creating the app in App Store Connect, archiving in Xcode and uploading.
```

Check: install from the TestFlight app on your phone, then invite 5 to 20 testers.

Time: 1 to 2 weeks, including fixes from feedback.

### 10. App Store

Goal: approved and live.

```
Draft App Store metadata for docs/IOS_BUILD_PLAN.md's submission section: name, subtitle, keywords, description, and review notes. Keep "NIV" out of the name, subtitle and keywords. Describe only features that exist in this build.
```

Check: the listing is live and installs on a friend's phone.

Time: 1 to 2 weeks. Reviews usually take a day or two (verify).

Total: about 12 to 21 weeks part time, so three to five months.

## TestFlight and App Store submission

1. In App Store Connect, create the app: name, bundle id, SKU, English (U.S.). This reserves the name.
2. In Xcode, Product > Archive, then Distribute App.
3. TestFlight: internal testers need no review; external testers need a short Beta App Review first.
4. Publish a privacy policy page and a support page; both URLs are required. GitHub Pages is free.
5. Privacy label. Our code collects nothing. The YouVersion SDK sends a random installation id, created on first launch, with every request (confirmed in the SDK source). Apple counts data as collected when it is kept longer than needed to answer the request (https://developer.apple.com/app-store/app-privacy-details/). Ask YouVersion whether they keep it. If not, answer "Data Not Collected". If they do, declare Identifiers > Device ID, not linked to the user, not used for tracking, for App Functionality.
6. Category: Reference.
7. Age rating: answer the questionnaire honestly (no user content, no web browsing, no purchases). Expect the lowest rating (verify).
8. Price: Free, with no in-app purchases.
9. Screenshots for the required iPhone size (verify the current size list in App Store Connect).
10. Review notes. Paste and fill in:

> This is a free study Bible with no ads, purchases, accounts or AI features. Texts: (1) New International Version, Bible version 111, delivered at runtime by the YouVersion Platform Swift SDK under YouVersion's non-commercial license, accepted on [date]. The app shows YouVersion's copyright string wherever this text appears and does not store it. (2) Berean Standard Bible, public domain (CC0), bundled as the offline fallback and labelled BSB. (3) Cross references from OpenBible.info under a Creative Commons Attribution license, credited on the About screen. Connection labels (Direct quote, Same story, Same topic) are computed by fixed rules over the public-domain BSB text, not AI. To test: open John 3, scroll slowly, tap a chip in the strip, then tap Go.

## Open decisions

1. App Store name. Decided (2026-09-28): "Dynamic Study Bible". It has no "AI" in it, so nothing in the name overstates v1. One check before you reserve it in App Store Connect: an Android app called "Dynamic Bible" (a KJV study Bible with cross references, https://play.google.com/store/apps/details?id=walljm.dynamicbible) is close in name and purpose, and its users have asked for an iOS version. Search the App Store when you reserve the name, and use the subtitle to set yours apart (for example "See how every verse connects"). Keep "NIV" out of the name, subtitle and keywords.
2. Developer account. Recommendation: a company you already own, if you are happy to show it as the seller, since a later Biblica license needs a legal entity; otherwise enroll as an individual now.
3. Launch countries. Recommendation: the United States first, until YouVersion confirms where version 111 is licensed.
4. Peek length for long ranges. Recommendation: whole verses, 5 at most, until YouVersion answers the display-limit question.
5. Confidence on screen. Decided (2026-09-28): every chip and peek sheet shows the match percentage. 100% means the same words or the same account; looser topical or word matches score lower, and topics never exceed 80%.
6. Designer. Recommendation: a small contract for the icon and screenshots after milestone 8.
7. Analytics and crash tools. Recommendation: none. Xcode Organizer's opt-in crash reports keep the privacy label clean.

## Budget

| Item | Cost | Notes |
|---|---|---|
| Apple Developer Program | $99 a year | https://developer.apple.com/programs/ |
| YouVersion Platform | $0 | Non-commercial apps only |
| Hosting for v1 | $0 | No backend; privacy and support pages on GitHub Pages |
| Claude | $20 a month (Pro) to $100 or $200 a month (Max) | Claude Code is included in paid plans (verify: https://claude.com/pricing) |
| Designer, optional | $500 to $3,000 | Icon and screenshots; a rough market range, get quotes |
| Mac and iPhone | $0 if you own them | |

## Later: AI notes

Not in v1. The data model keeps the slots: the `ai_context` table, `AIVerseContext` and `AIConnection` (spec 2.11), and a reason `source` of "ai". Before any AI output reaches a user:

1. YouVersion's written approval. Their terms require it for AI output anywhere in the app. Ask now; it takes time.
2. If the AI reads NIV text, a Biblica license that expressly permits AI use. Writing notes from the public-domain BSB avoids this, but not step 1.
3. Stay backend-free if possible: generate notes at build time from the BSB, review a sample by hand, and bundle them in `asb.sqlite`.
4. Label every note as AI-written, not Scripture, and possibly wrong, with a way to report it.
