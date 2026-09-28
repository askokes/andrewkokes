# AI-Assisted Study Bible: Data Model (v2.1)

Status: final synthesis of three proposals and two judge reviews. Dataset facts below were measured with python3 against `data/sources/BSB.json` (31,102 verses, 1,189 chapters) and `data/sources/cross_references.txt` (343,609 OpenBible links, 2016-02-01) on 2026-09-27.

Updated 2026-09-28 after the founder's decisions: every connection now carries a reason (section 2.6.1), the ticker holds still by default, the NIV is the launch translation through the YouVersion Platform (references only, never stored), the app is free, and AI notes are deferred.

## 1. Overview

The model treats the Bible as one connected map. Every verse is a point on that map with a permanent number (John 3:16 is `43003016`: book 43, chapter 3, verse 16), and every OpenBible cross reference is a line between two points, carrying the crowd's vote count for how relevant the link is. The words of each verse live in a separate "text pack" per translation (the public-domain Berean Standard Bible today, the NIV once licensed), so swapping translations never touches the map. On top of that, the AI layer adds optional study notes in two places: a note about a verse (summary, themes, who is speaking) and a note about a connection (why these two verses belong together), each stamped with which model wrote it, which prompt version, and when.

The ticker and the spiderweb fall straight out of this. At build time, for each verse we gather every line that touches it, in both directions ("John 3:16 points to Romans 5:8" and "who points back at John 3:16?"), fold both directions into one entry per neighbour, score it, rank it, and attach a short preview snippet. The reader screen loads one chapter document in which each verse already carries its top 12 ranked connections, so as the verse in focus changes while you scroll, the ticker strip renders the next verse's chips with no lookup. Tapping a chip opens a peek sheet from the same data; tapping Go jumps to the target chapter and pushes a hop onto the trail, which remembers the exact connection you travelled. The trail is the spiderweb: a list of hops plus the small web of verses and lines you have visited, drawn from the same ids, so you can always see the path and step back.

Every connection also says why it is there. The pipeline labels each one a direct quote, the same story, or the same topic, with a one-line reason such as "Matthew 27:46 quotes Psalm 22:1", "Another part of the same passage in John 3" or "Shared theme: loved". The labels come from deterministic rules over the public-domain Berean text, so no licensed text is ever processed. At launch the reader shows the NIV, fetched at runtime from the YouVersion Platform; the model stores only verse references for it, never NIV words. Chips therefore show the reference and the reason, and the whole NIV verse appears when the reader taps. The ticker holds still on the verse in focus; auto-scroll is an option the reader turns on.

## 2. Entities

All keys are camelCase words (no single-letter keys). Every document that a screen renders is for exactly one translation, and carries a short `attribution` block; full provenance lives once in the manifest. Verse ids (`vid`) are integers; human refs (`ref`, OSIS style) and display `label`s travel next to them wherever a founder or a log will read them.

### 2.1 Book (books.json, one file for the canon)

| Field | Type | Required | Meaning |
|---|---|---|---|
| bookNo | int 1-66 | yes | Protestant canon order; the first digits of every vid |
| osis | string | yes | OpenBible key (`Gen`, `1John`, `Rev`) |
| name | string | yes | Display name used in labels, singular ("Psalm", "1 John", "Revelation") |
| short | string | yes | Abbreviation for tight chips ("Ps", "1Jn") |
| sourceName | string | yes | Name as it appears in the text source ("Psalms", "I John", "Revelation of John") |
| aliases | string[] | no | Other spellings for search |
| testament | "OT" / "NT" | yes | |
| chapters | int | yes | Chapter count |
| verses | int | yes | Verse count in the book |
| firstVid, firstOrdinal | int | yes | First verse id and its 0-based position in the canon (range expansion uses ordinals) |
| verseCounts | int[] | yes | Verses per chapter; validates ids and expands ranges without loading text |

### 2.2 Translation (in manifest.translations[] and at the top of every ChapterBundle)

| Field | Type | Required | Meaning |
|---|---|---|---|
| id | string | yes | Lowercase slug: `bsb`, `niv` |
| name, abbr | string | yes | "Berean Standard Bible", "BSB" |
| textVersion | string | yes when bundled | Edition id (`bsb-2023`); part of every AI cache key |
| license, attribution | string | yes | Rendered in Settings > About |
| copyrightNotice | string | yes | Exact notice the licensor requires in-app; for the NIV, the `copyright` string the YouVersion API returns, shown wherever NIV text appears |
| role | string | no | BSB: "offline fallback and the analysis text for connection reasons"; NIV: "launch translation, fetched at runtime" |
| bundled | bool | yes | Ships inside the app (BSB) or is fetched at runtime (NIV) |
| delivery | "bundled" / "pack" / "youversionPlatform" | yes | How the text reaches the phone; the NIV comes from the YouVersion Platform SDK |
| youversionVersionId | int | NIV only | YouVersion Bible version id (NIV = 111) |
| packUrl, sha256 | string / null | when not bundled | OTA pack location and integrity hash |
| headings | bool | yes | Whether the pack supplies section headings |

### 2.3 VerseText (text pack row; table `verses` on device)

| Field | Type | Required | Meaning |
|---|---|---|---|
| vid | int | yes | Verse id |
| translation | string | yes | Translation id |
| text | string | yes | Full verse text |
| snippet | string | yes | First <= 110 chars, cut at a word boundary, ellipsis appended; precomputed so chips never do string work |
| heading | string / null | no | Section heading that appears before this verse (translation-supplied) |
| paragraphStart | bool | yes | Whether a paragraph starts here |

### 2.4 Edge (graph shard, one per source book; table `edges`)

| Field | Type | Required | Meaning |
|---|---|---|---|
| from | int | yes | Source verse (sources are never ranges in the data: 0 of 343,609) |
| to.start, to.end | int | yes | Target verse or inclusive range; `end == start` for a single verse (never null) |
| votes | int | yes | Raw OpenBible votes (observed 1..340; pipeline clamps < 1 to 1) |
| rank | int | yes | 1-based position among this source's outgoing edges (votes desc, single before range, start asc) |
| sourceId | string | yes | `openbible-xref-2016-02-01` (a future `editorsPicks` overlay uses the same shape) |

### 2.5 IncomingRow (incoming shard, one per target book; table `incoming`)

| Field | Type | Required | Meaning |
|---|---|---|---|
| vid | int | yes | The verse being cited (one row per verse a range covers) |
| from | int | yes | Citing verse |
| to.start, to.end | int | yes | The range the citation actually pointed at |
| span | int | yes | Verses in that range (1 for direct citations) |
| viaRange | bool | yes | `span > 1` |
| votes | int | yes | Raw votes |
| votesEff | number | yes | `votes / sqrt(span)`; ranges over 40 verses are not expanded (295 edges, max span 182) |
| rank | int | yes | Position among this verse's incoming rows |

### 2.6 TickerItem (the chip; inlined in ChapterBundle.verses[].ticker, TickerFeed.items, Connections.items)

| Field | Type | Required | Meaning |
|---|---|---|---|
| rank | int | yes | 1-based position in this verse's merged list |
| to | {start, end, ref, label} | yes | Jump target: ids, OSIS ref, display label ("1 John 4:9–10") |
| direction | "out" / "in" / "both" | yes | This verse cites it / it cites this verse / both |
| votesOut | int | yes | Raw votes on this verse's outgoing edge (0 if none) |
| votesIn | int | yes | Raw votes on the incoming edge(s) from that neighbour (0 if none); the peek sheet shows both numbers |
| score | number | yes | Merged relevance, see section 3 |
| weight | number 0..1 | yes | Per-verse emphasis; drives chip opacity, size and dwell time |
| tier | "strong" / "solid" / "light" | yes | Global filter band from score |
| sameBook | bool | yes | Lets the strip style cross-book jumps differently |
| viaRange | {start, end, label, span} / null | yes | Present when the incoming citation pointed at a range covering this verse |
| snippet | string | yes | Target verse preview in the bundled public-domain text. Never stored for the NIV: the app fetches the whole NIV verse when the reader taps the chip |
| reason | Reason | yes | Why this verse is connected: direct quote, same story or same topic (2.6.1) |
| why | string / null | in bundle and feed | Deferred AI one-liner for the connection; null in v1 |
| aiStatus | "cached" / "not_generated" | in bundle and feed | Explains a null `why`; "not_generated" in v1 |
| alsoCites | {ref, label, votes}[] | Connections doc only | Other outgoing ranges from this verse that share the same start verse |
| dwellSeconds | number | TickerFeed only | `3.0 + 3.0 * weight`; used only when the reader turns auto-scroll on |

### 2.6.1 Reason (why a verse is connected; `reason` on every TickerItem)

| Field | Type | Required | Meaning |
|---|---|---|---|
| kind | "quote" / "story" / "topic" | yes | The founder's three reasons |
| label | "Direct quote" / "Same story" / "Same topic" | yes | The words on the chip's pill |
| because | string | yes | One plain sentence the chip and peek sheet show |
| basis | string | yes | Which rule fired (below) |
| confidence | number 0..1 | yes | The match strength, shown to readers as a percentage: 1.0 means the passages are literally the same thing (the same words or the same account); lower means a looser match |
| source | "rule" / "ai" / "editor" | yes | "rule" in v1; an AI pass or an editor may replace a reason later |
| evidence | {phrase?, names?, words?, parallel?} | no | What the rule matched, for tooling and debugging; not shown to readers |

Rules, first match wins (tools/reasons.py):

| Basis | Kind | Fires when | Example `because` |
|---|---|---|---|
| parallelAccount | story | The same account told twice: distinctive shared wording between parallel books (the Gospels; Samuel, Kings and Chronicles; Kings with Isaiah or Jeremiah; Chronicles, Ezra and Nehemiah; Joshua and Judges; Genesis and Chronicles), or inside one narrative book when the passages also share a name | "The same account told in Matthew and Mark" |
| samePassage | story | Same chapter, at most 20 verses apart (not Proverbs) | "Another part of the same passage in John 3" |
| sharedWording | quote | At least two shared word trigrams that occur in at most 30 verses each, forming a run of four or more words with real content | "Matthew 1:23 quotes Isaiah 7:14" |
| quotation | quote | A New Testament quotation inside quotation marks reuses most of the Old Testament verse's words | "Matthew 4:10 quotes Deuteronomy 6:13" |
| retelling | story | Old Testament passages share distinctive wording and two names in a narrative book | "Both retell the account of Sihon and Og" |
| sharedNames | story | Both refer to the same specific people: a person named in at most 150 verses plus another shared word, two people, a person and a place, or two rare places; a single place is not enough | "Both tell of Moses" |
| theme | topic | Everything else, with the most distinctive shared words when there are any | "Shared theme: loved" / "Linked by theme" |

Match percentage (`confidence`), by rule. "Run coverage" is how much of the shorter passage, or of the marked quotation, the longest shared run of words covers. "Theme coverage" is the share of the focus verse's distinctive vocabulary (idf-weighted stems) that the other passage uses. "Votes" is ln(1 + score) / ln(61), capped at 1.

| Basis | Match | Range seen |
|---|---|---|
| sharedWording | 0.80 + 0.20 x run coverage (for New Testament quotes, coverage of the marked quotation) | 81 to 100% |
| quotation | 0.74 + 0.16 x share of the quotation's words reused | 84 to 90% |
| parallelAccount | 0.82 + 0.18 x run coverage; 0.72 + 0.13 x theme coverage without a long shared run | 74 to 100% |
| retelling | 0.72 + 0.18 x the larger of run and theme coverage | 75 to 90% |
| samePassage | 0.84 - 0.004 x verses apart + 0.12 x theme coverage | 76 to 96% |
| sharedNames | 0.58 + 0.06 x shared names (up to 3) + 0.15 x theme coverage, capped at 0.85 | 65 to 85% |
| theme (topic) | 0.30 + 0.30 x theme coverage + 0.30 x votes, capped at 0.80 | 31 to 80%, median 41% |

Examples: Psalm 22:1 and Matthew 27:46 100%, Matthew 13:5 and Mark 4:5 100%, Matthew 1:23 and Isaiah 7:14 95%, John 3:16 and John 3:15 89%, John 3:14 and Numbers 21:7-9 70%, John 3:16 and Romans 5:8 65%. Topics stay at or below 80% because a looser topical or word match is never "the same thing".

Analysis text: the public-domain BSB, for every translation, so reasons never depend on licensed text. Names are told apart from places by how the text uses them (places follow "in", "to", "from"; people follow "son of" or precede "said"). Theme words match on light stems, so "loved" matches "love".

Measured on the real data: across all 840,072 connections, 776,847 topic (92.5%), 47,824 story (5.7%) and 15,401 quote (1.8%). Among the 343,635 chips the ticker shows (top 12 per verse), 87.2% topic, 9.5% story and 3.3% quote. Accuracy: all 60 hand-labelled pairs in tests/gold_reasons.json are correct (for example Matthew 1:23 and Isaiah 7:14 quote, John 3:14 and Numbers 21:9 story, John 3:16 and Romans 5:8 topic). Hand audits of random samples found roughly 13 of 15 parallel accounts, 12 of 15 shared-name stories and 12 of 12 quotes correct after tuning; same-passage links are correct by construction. Treat reasons as a strong first pass; an AI or editorial pass can refine them later, and an AI pass needs YouVersion's written approval before its output reaches readers.

### 2.7 ChapterBundle (the reader screen document; built at runtime from SQLite, also emitted by the pipeline for the prototype)

| Field | Type | Required | Meaning |
|---|---|---|---|
| schema, datasetVersion, rankingVersion | string | yes | `asb.chapter/2`, `2026.09.1`, `asb.rank.v2` |
| translation | Translation (subset) | yes | Exactly one translation per bundle |
| book | {bookNo, osis, name, short} | yes | |
| chapter, chapterId | int | yes | `chapterId` is the zero-verse id (43003000) |
| verseCount, prevChapter, nextChapter | int / null | yes | Neighbour chapter ids for prefetch |
| headings | {beforeVerse, title}[] | yes | Empty when the translation supplies none |
| tickerInline | int | yes | Number of chips inlined per verse (12, from manifest) |
| verses[] | Verse | yes | See below |
| attribution | {text, crossReferences, ai} | yes | Short strings; full provenance in manifest |

Verse (inside a bundle): `vid`, `verse`, `ref`, `label`, `text`, `paragraphStart`, `heading?`, `counts {out, in, inDirect, inViaRange, unique, shown, more}`, `ticker[]` (TickerItem x tickerInline), `connections` (path of the See-all document), `ai {verse: cacheKey, status}`.

### 2.8 Connections (the "See all" document, `connections/{vid}.json`; one SQLite query on device)

Same header as a verse (`vid`, `ref`, `label`, `counts`) plus `items[]`: every merged TickerItem, uncapped, including `alsoCites`. Romans 5:8 appears once in a verse's data, as one merged item; the raw out and in lists are not duplicated anywhere in UI documents.

### 2.9 TickerFeed (the strip for one focus verse; derived from the bundle, shown separately so the motion is in the data)

`focus {vid, ref, label}`, `counts`, `order` (sentence), `motion {mode, loop, baseSeconds, perWeightSeconds, dwellFormula, advanceOnFocusChange}`, `items[]` with `dwellSeconds`, `attribution`. `mode` is "hold" by default: the strip sits still on the verse in focus and the reader swipes it. "autoScroll" is the reader's opt-in.

### 2.10 Trail (spiderweb navigation state; SwiftData on device)

| Field | Type | Required | Meaning |
|---|---|---|---|
| id, translation, cursor | string, string, int | yes | Cursor indexes `hops` |
| hops[] | Hop | yes | `index`, `kind` (open / jump / search / bookmarkOpen), `vid`, `ref`, `label`, `book`, `via` (null or {from{vid,ref,label}, to{start,end,ref,label}, direction, votesOut, votesIn, score, rank}), `scroll {chapter, anchor, highlight{start,end}/null}`, `at` |
| forward[] | Hop | yes | Hops popped by Back, so Forward works |
| peeks[] | {fromHop, to, votesOut, at, jumped} | yes | References previewed but not jumped to |
| peek | object / null | yes | The currently open peek sheet |
| web | {nodes: int[], edges: [from, to, votes][], peekOnlyEdges, booksTouched, loopClosed} | yes | Data for the map view; all ids are integer vids |
| rules | object | yes | Self-documenting behaviour: `pushOn`, `notPushed`, `scrollUpdatesCurrentHop`, `maxHops`, `persist` |

### 2.11 AIVerseContext and AIConnection (table `ai_context`, keyed cache; deferred)

AI notes are deferred: v1 ships no AI output and the table ships empty. YouVersion's platform terms require written approval before an app shows readers AI output, and Biblica requires a license that expressly permits AI use of NIV content. The slots stay so the feature can return without a schema change.

| Field | Type | Required | Meaning |
|---|---|---|---|
| key | string | yes | `ai:verse:{vid}:{translation}:{textVersion}:{promptVersion}` or `ai:edge:{from}>{start}[-{end}]:{translation}:{textVersion}:{promptVersion}` |
| kind | "verse" / "edge" | yes | |
| vid / from + to | int / objects | yes | Subject; `from` and `to` carry ref and label |
| translation, textVersion | string | yes | The text the model read |
| content | object | yes | verse: `summary, context, speaker, genre, themes[], entities[], questions[], readingTip`; edge: `why, relation, confidence, sharedThemes[], readNext[] {to, why}` |
| relationVocabulary | string[] | edge | quotation, allusion, fulfillment, parallel, contrast, context, thematic |
| provenance | object | yes | `generator, model, promptId, promptVersion, schemaVersion, inputs, inputHash, generatedAt, backendJob, tokens {input, output}, reviewed, disclaimer` |
| cache | object | yes | `source` (bundled / fetched / userRequested), `fetchedAt`, `ttlDays`, `invalidateOn[]` |

### 2.12 Manifest (manifest.json)

`schema, datasetVersion, builtAt, pipeline, canon, graph` (measured counts), `ranking` (every constant of asb.rank.v2, including `motion {defaultMode, baseSeconds, perWeightSeconds}`), `reasons` (rules version, analysis text, labels, measured share and counts, test note), `translations[]`, `sources[]` (id, kind, license, url, attribution, retrievedAt), `shards[]` (path, kind, book, translation, bytes, gzipBytes, sha256), `onDevice`.

## 3. Id scheme and ranking formula

### Ids

- `vid = bookNo * 1,000,000 + chapter * 1,000 + verse` (Int32). John 3:16 = 43003016, Romans 5:8 = 45005008, Genesis 22:12 = 1022012, Revelation 22:21 = 66022021. Sorts in canonical reading order; `vid / 1000` is the chapter (43003), `vid / 1,000,000` the book; a chapter is addressed by its zero-verse id (43003000).
- `ordinal` = 0-based position in the 31,102-verse canon (John 3:16 = 26136), used only at build time to expand ranges across chapter boundaries.
- `ref` = OSIS string as in the OpenBible file (`John.3.16`, ranges `1John.4.9-1John.4.10`); `label` = display form ("1 John 4:9–10", en dash; cross-chapter "Isaiah 52:13–53:12"). Labels use the singular `name` from books.json ("Psalm 2:7", never "Psalms 2:7"). Cross-book ranges (18 in the data, such as 2 John 1:1 to 3 John 1:14) label as "2 John 1:1–3 John 1:14".
- Ranges are always `{start, end}` with `end == start` for a single verse. Sources are never ranges (0 in the data); 87,934 targets are ranges (average 4.06 verses, 650 cross chapter, 295 longer than 40 verses, longest 182).
- Edge identity is the composite `(from, to.start, to.end)`; its string form for AI keys is `43003016>45005008` or `43003016>62004009-62004010`.
- Versification: OpenBible follows a 15-verse 3 John; BSB has 14. The pipeline clamps a target outside the canon to the last verse of its chapter (4 edges, all ranges ending at 3 John 1:15) and drops the one edge whose source is 3 John 1:15, leaving 343,608 edges.

### Ranking: asb.rank.v2 (computed at build time; every constant is stored in manifest.ranking)

1. Incoming attribution. For each edge S -> [T.start..T.end] with `votes` and `span` n (verses covered), each covered verse gets an incoming row with `votesEff = votes / sqrt(n)`. Direct citations keep full weight. Ranges longer than 40 verses are not attributed (a whole-chapter citation would otherwise put a near-zero chip on every verse in it). Result: 596,218 incoming rows.
2. Merge per neighbour. For the verse in focus V, outgoing edges V -> N and incoming rows N -> V are keyed by N's start vid. Direction is `out`, `in` or `both`. Collision rule: if V has two outgoing edges with the same start and different ends, the higher-voted one is the item's target and the others are listed in `alsoCites`; nothing is summed. The 2016 dump contains 0 such pairs; the rule exists so a future dump ranks deterministically. `votesIn` and `votesEff` from several incoming rows with the same source are summed.
3. Score. `score = votesOut + 0.5 * sum(votesEff)`. Incoming votes count half because they were cast from the other verse's point of view; incoming-only items still surface (John 10:10 is rank 2 on John 3:17 with 20 incoming votes and none outgoing).
4. Weight (per verse). `weight = round(ln(1 + score) / ln(1 + maxScore of this verse), 3)`. The top chip of every verse is exactly 1.0, so a quiet verse still gets a graded strip. Because it is computed on the merged score, outgoing and incoming chips sit on one scale.
5. Tier (global). `strong` if score >= 10, `solid` if score >= 4, else `light`. Measured over all 840,072 merged items: 0.8% strong, 9.0% solid, 90.2% light (raw votes: 1.0% of edges have >= 10 votes, 16.7% have >= 4). 28,345 of 30,988 connected verses have a best score under 10, which is why emphasis must come from `weight`, not `tier`.
6. Order. score desc, then out/both before in-only, then start vid asc. `rank` is the 1-based position. The bundle inlines the top `tickerInline = 12`; `counts.more = unique - shown`.
7. Motion. The strip holds on the focus verse by default: rank 1 first, the reader swipes for more, and it re-anchors when the focus verse changes. Auto-scroll is the reader's opt-in; each chip then dwells `3.0 + 3.0 * weight` seconds, so a 1.0 chip holds 6 s and a 0.3 chip 3.9 s.
8. Reason. Each ranked item gets its reason (2.6.1). Reasons do not change the order.

### Worked example: John 3:16 -> Romans 5:8

Real rows: `John.3.16 -> Rom.5.8 178` and `Rom.5.8 -> John.3.16 33` (both direct, span 1).

- votesOut = 178, votesIn = 33, votesEff = 33 / sqrt(1) = 33
- score = 178 + 0.5 * 33 = 194.5
- John 3:16's maxScore is this item, so weight = ln(195.5) / ln(195.5) = 5.2756 / 5.2756 = 1.000
- tier: 194.5 >= 10, strong. direction: both. rank 1 of 110 merged items (23 outgoing + 104 incoming rows: 53 direct + 51 via ranges). dwellSeconds = 3.0 + 3.0 * 1.0 = 6.0 when auto-scroll is on
- reason: Same topic, "Shared theme: loved" (John 3:16 says "loved", Romans 5:8 says "love"; no rare shared phrase, no shared names)

Second chip for contrast, 1 John 4:9–10: out 122 (to the range), in 13 (from 1 John 4:9, direct, folded onto the same start vid 62004009), score = 122 + 6.5 = 128.5, weight = ln(129.5) / ln(195.5) = 4.8637 / 5.2756 = 0.922, strong, rank 2. On John 3:17 the top item (1 John 4:14) scores only 10.06 and still gets weight 1.000.

## 4. Example JSON (real data)

Verse text is BSB; every vote count, snippet, id and label below was produced by the pipeline script from the two source files. AI `why`, `summary` and similar prose strings are illustrative sample output and are marked as such in each document's `_note`.

### 4.1 Chapter bundle: John 3 (verses 15–17 shown, 12 chips each)

```json
{
  "schema": "asb.chapter/2",
  "datasetVersion": "2026.09.1",
  "rankingVersion": "asb.rank.v2",
  "translation": {
    "id": "bsb",
    "name": "Berean Standard Bible",
    "abbr": "BSB",
    "textVersion": "bsb-2023",
    "license": "Public domain (CC0), BSB Publishing 2023",
    "copyrightNotice": "The Holy Bible, Berean Standard Bible, BSB is produced in cooperation with Bible Hub, Discovery Bible, OpenBible.com, and the Berean Bible Translation Committee. This text of God's Word has been dedicated to the public domain."
  },
  "book": {
    "bookNo": 43,
    "osis": "John",
    "name": "John",
    "short": "John"
  },
  "chapter": 3,
  "chapterId": 43003000,
  "verseCount": 36,
  "prevChapter": 43002000,
  "nextChapter": 43004000,
  "headings": [],
  "tickerInline": 12,
  "verses": [
    {
      "vid": 43003015,
      "verse": 15,
      "ref": "John.3.15",
      "label": "John 3:15",
      "text": "that everyone who believes in Him may have eternal life.",
      "omitted": false,
      "paragraphStart": false,
      "counts": {
        "out": 33,
        "in": 44,
        "inDirect": 3,
        "inViaRange": 41,
        "unique": 68,
        "shown": 12,
        "more": 56
      },
      "ticker": [
        {
          "rank": 1,
          "to": {
            "start": 43003016,
            "end": 43003016,
            "ref": "John.3.16",
            "label": "John 3:16"
          },
          "direction": "both",
          "votesOut": 8,
          "votesIn": 90,
          "score": 53.0,
          "weight": 1.0,
          "tier": "strong",
          "sameBook": true,
          "viaRange": null,
          "snippet": "For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not…",
          "reason": {
            "kind": "story",
            "label": "Same story",
            "because": "Another part of the same passage in John 3",
            "basis": "samePassage",
            "confidence": 0.96,
            "source": "rule",
            "evidence": {}
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 2,
          "to": {
            "start": 43003036,
            "end": 43003036,
            "ref": "John.3.36",
            "label": "John 3:36"
          },
          "direction": "both",
          "votesOut": 7,
          "votesIn": 10,
          "score": 10.54,
          "weight": 0.613,
          "tier": "strong",
          "sameBook": true,
          "viaRange": {
            "start": 43003015,
            "end": 43003016,
            "label": "John 3:15–16",
            "span": 2
          },
          "snippet": "Whoever believes in the Son has eternal life. Whoever rejects the Son will not see life. Instead, the wrath…",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Shared theme: eternal, believes and life",
            "basis": "theme",
            "confidence": 0.78,
            "source": "rule",
            "evidence": {
              "words": [
                "eternal",
                "believes",
                "life"
              ]
            }
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 3,
          "to": {
            "start": 62005011,
            "end": 62005013,
            "ref": "1John.5.11-1John.5.13",
            "label": "1 John 5:11–13"
          },
          "direction": "both",
          "votesOut": 8,
          "votesIn": 2,
          "score": 8.71,
          "weight": 0.57,
          "tier": "solid",
          "sameBook": false,
          "viaRange": {
            "start": 43003015,
            "end": 43003016,
            "label": "John 3:15–16",
            "span": 2
          },
          "snippet": "And this is that testimony: God has given us eternal life, and this life is in His Son.",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Shared theme: eternal, believes and life",
            "basis": "theme",
            "confidence": 0.77,
            "source": "rule",
            "evidence": {
              "words": [
                "eternal",
                "believes",
                "life"
              ]
            }
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 4,
          "to": {
            "start": 41016016,
            "end": 41016016,
            "ref": "Mark.16.16",
            "label": "Mark 16:16"
          },
          "direction": "both",
          "votesOut": 3,
          "votesIn": 14,
          "score": 7.95,
          "weight": 0.549,
          "tier": "solid",
          "sameBook": false,
          "viaRange": {
            "start": 43003015,
            "end": 43003016,
            "label": "John 3:15–16",
            "span": 2
          },
          "snippet": "Whoever believes and is baptized will be saved, but whoever does not believe will be condemned.",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Shared theme: believes",
            "basis": "theme",
            "confidence": 0.56,
            "source": "rule",
            "evidence": {
              "words": [
                "believes"
              ]
            }
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 5,
          "to": {
            "start": 43020031,
            "end": 43020031,
            "ref": "John.20.31",
            "label": "John 20:31"
          },
          "direction": "both",
          "votesOut": 4,
          "votesIn": 5,
          "score": 5.77,
          "weight": 0.479,
          "tier": "solid",
          "sameBook": true,
          "viaRange": {
            "start": 43003015,
            "end": 43003016,
            "label": "John 3:15–16",
            "span": 2
          },
          "snippet": "But these are written so that you may believe that Jesus is the Christ, the Son of God, and that by believing…",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Shared theme: believes and life",
            "basis": "theme",
            "confidence": 0.62,
            "source": "rule",
            "evidence": {
              "words": [
                "believes",
                "life"
              ]
            }
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 6,
          "to": {
            "start": 43006040,
            "end": 43006040,
            "ref": "John.6.40",
            "label": "John 6:40"
          },
          "direction": "both",
          "votesOut": 5,
          "votesIn": 3,
          "score": 5.75,
          "weight": 0.479,
          "tier": "solid",
          "sameBook": true,
          "viaRange": {
            "start": 43003015,
            "end": 43003018,
            "label": "John 3:15–18",
            "span": 4
          },
          "snippet": "For it is My Father’s will that everyone who looks to the Son and believes in Him shall have eternal life…",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Shared theme: eternal, believes and life",
            "basis": "theme",
            "confidence": 0.74,
            "source": "rule",
            "evidence": {
              "words": [
                "eternal",
                "believes",
                "life"
              ]
            }
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 7,
          "to": {
            "start": 23045022,
            "end": 23045022,
            "ref": "Isa.45.22",
            "label": "Isaiah 45:22"
          },
          "direction": "both",
          "votesOut": 4,
          "votesIn": 4,
          "score": 5.0,
          "weight": 0.449,
          "tier": "solid",
          "sameBook": false,
          "viaRange": {
            "start": 43003013,
            "end": 43003016,
            "label": "John 3:13–16",
            "span": 4
          },
          "snippet": "Turn to Me and be saved, all the ends of the earth; for I am God, and there is no other.",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Linked by theme",
            "basis": "theme",
            "confidence": 0.43,
            "source": "rule",
            "evidence": {}
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 8,
          "to": {
            "start": 58007025,
            "end": 58007025,
            "ref": "Heb.7.25",
            "label": "Hebrews 7:25"
          },
          "direction": "out",
          "votesOut": 5,
          "votesIn": 0,
          "score": 5.0,
          "weight": 0.449,
          "tier": "solid",
          "sameBook": false,
          "viaRange": null,
          "snippet": "Therefore He is able to save completely those who draw near to God through Him, since He always lives to…",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Linked by theme",
            "basis": "theme",
            "confidence": 0.43,
            "source": "rule",
            "evidence": {}
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 9,
          "to": {
            "start": 43010028,
            "end": 43010030,
            "ref": "John.10.28-John.10.30",
            "label": "John 10:28–30"
          },
          "direction": "both",
          "votesOut": 4,
          "votesIn": 2,
          "score": 4.71,
          "weight": 0.437,
          "tier": "solid",
          "sameBook": true,
          "viaRange": {
            "start": 43003015,
            "end": 43003016,
            "label": "John 3:15–16",
            "span": 2
          },
          "snippet": "I give them eternal life, and they will never perish. No one can snatch them out of My hand.",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Shared theme: eternal and life",
            "basis": "theme",
            "confidence": 0.63,
            "source": "rule",
            "evidence": {
              "words": [
                "eternal",
                "life"
              ]
            }
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 10,
          "to": {
            "start": 58010039,
            "end": 58010039,
            "ref": "Heb.10.39",
            "label": "Hebrews 10:39"
          },
          "direction": "both",
          "votesOut": 4,
          "votesIn": 2,
          "score": 4.71,
          "weight": 0.437,
          "tier": "solid",
          "sameBook": false,
          "viaRange": {
            "start": 43003015,
            "end": 43003016,
            "label": "John 3:15–16",
            "span": 2
          },
          "snippet": "But we are not of those who shrink back and are destroyed, but of those who have faith and preserve their…",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Linked by theme",
            "basis": "theme",
            "confidence": 0.43,
            "source": "rule",
            "evidence": {}
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 11,
          "to": {
            "start": 43005024,
            "end": 43005024,
            "ref": "John.5.24",
            "label": "John 5:24"
          },
          "direction": "out",
          "votesOut": 4,
          "votesIn": 0,
          "score": 4.0,
          "weight": 0.403,
          "tier": "solid",
          "sameBook": true,
          "viaRange": null,
          "snippet": "Truly, truly, I tell you, whoever hears My word and believes Him who sent Me has eternal life and will not…",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Shared theme: eternal, believes and life",
            "basis": "theme",
            "confidence": 0.72,
            "source": "rule",
            "evidence": {
              "words": [
                "eternal",
                "believes",
                "life"
              ]
            }
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 12,
          "to": {
            "start": 43011025,
            "end": 43011026,
            "ref": "John.11.25-John.11.26",
            "label": "John 11:25–26"
          },
          "direction": "out",
          "votesOut": 4,
          "votesIn": 0,
          "score": 4.0,
          "weight": 0.403,
          "tier": "solid",
          "sameBook": true,
          "viaRange": null,
          "snippet": "Jesus said to her, “I am the resurrection and the life. Whoever believes in Me will live, even though he dies.",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Shared theme: believes and life",
            "basis": "theme",
            "confidence": 0.6,
            "source": "rule",
            "evidence": {
              "words": [
                "believes",
                "life"
              ]
            }
          },
          "why": null,
          "aiStatus": "not_generated"
        }
      ],
      "connections": "connections/43003015.json",
      "ai": {
        "verse": "ai:verse:43003015:bsb:bsb-2023:v3",
        "status": "not_generated"
      }
    },
    {
      "vid": 43003016,
      "verse": 16,
      "ref": "John.3.16",
      "label": "John 3:16",
      "text": "For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life.",
      "omitted": false,
      "paragraphStart": false,
      "counts": {
        "out": 23,
        "in": 104,
        "inDirect": 53,
        "inViaRange": 51,
        "unique": 110,
        "shown": 12,
        "more": 98
      },
      "ticker": [
        {
          "rank": 1,
          "to": {
            "start": 45005008,
            "end": 45005008,
            "ref": "Rom.5.8",
            "label": "Romans 5:8"
          },
          "direction": "both",
          "votesOut": 178,
          "votesIn": 33,
          "score": 194.5,
          "weight": 1.0,
          "tier": "strong",
          "sameBook": false,
          "viaRange": null,
          "snippet": "But God proves His love for us in this: While we were still sinners, Christ died for us.",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Shared theme: loved",
            "basis": "theme",
            "confidence": 0.65,
            "source": "rule",
            "evidence": {
              "words": [
                "loved"
              ]
            }
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 2,
          "to": {
            "start": 62004009,
            "end": 62004010,
            "ref": "1John.4.9-1John.4.10",
            "label": "1 John 4:9–10"
          },
          "direction": "both",
          "votesOut": 122,
          "votesIn": 13,
          "score": 128.5,
          "weight": 0.922,
          "tier": "strong",
          "sameBook": false,
          "viaRange": null,
          "snippet": "This is how God’s love was revealed among us: God sent His one and only Son into the world, so that we might…",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Shared theme: world and loved",
            "basis": "theme",
            "confidence": 0.72,
            "source": "rule",
            "evidence": {
              "words": [
                "world",
                "loved"
              ]
            }
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 3,
          "to": {
            "start": 43003015,
            "end": 43003015,
            "ref": "John.3.15",
            "label": "John 3:15"
          },
          "direction": "both",
          "votesOut": 90,
          "votesIn": 8,
          "score": 94.0,
          "weight": 0.863,
          "tier": "strong",
          "sameBook": true,
          "viaRange": null,
          "snippet": "that everyone who believes in Him may have eternal life.",
          "reason": {
            "kind": "story",
            "label": "Same story",
            "because": "Another part of the same passage in John 3",
            "basis": "samePassage",
            "confidence": 0.89,
            "source": "rule",
            "evidence": {}
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 4,
          "to": {
            "start": 43011025,
            "end": 43011026,
            "ref": "John.11.25-John.11.26",
            "label": "John 11:25–26"
          },
          "direction": "out",
          "votesOut": 81,
          "votesIn": 0,
          "score": 81.0,
          "weight": 0.835,
          "tier": "strong",
          "sameBook": true,
          "viaRange": null,
          "snippet": "Jesus said to her, “I am the resurrection and the life. Whoever believes in Me will live, even though he dies.",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Shared theme: believes and life",
            "basis": "theme",
            "confidence": 0.68,
            "source": "rule",
            "evidence": {
              "words": [
                "believes",
                "life"
              ]
            }
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 5,
          "to": {
            "start": 43006040,
            "end": 43006040,
            "ref": "John.6.40",
            "label": "John 6:40"
          },
          "direction": "both",
          "votesOut": 72,
          "votesIn": 3,
          "score": 72.75,
          "weight": 0.815,
          "tier": "strong",
          "sameBook": true,
          "viaRange": {
            "start": 43003015,
            "end": 43003018,
            "label": "John 3:15–18",
            "span": 4
          },
          "snippet": "For it is My Father’s will that everyone who looks to the Son and believes in Him shall have eternal life…",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Shared theme: eternal, believes and life",
            "basis": "theme",
            "confidence": 0.75,
            "source": "rule",
            "evidence": {
              "words": [
                "eternal",
                "believes",
                "life"
              ]
            }
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 6,
          "to": {
            "start": 45008032,
            "end": 45008032,
            "ref": "Rom.8.32",
            "label": "Romans 8:32"
          },
          "direction": "both",
          "votesOut": 68,
          "votesIn": 6,
          "score": 71.0,
          "weight": 0.811,
          "tier": "strong",
          "sameBook": false,
          "viaRange": null,
          "snippet": "He who did not spare His own Son but gave Him up for us all, how will He not also, along with Him, freely…",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Linked by theme",
            "basis": "theme",
            "confidence": 0.62,
            "source": "rule",
            "evidence": {}
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 7,
          "to": {
            "start": 43003036,
            "end": 43003036,
            "ref": "John.3.36",
            "label": "John 3:36"
          },
          "direction": "both",
          "votesOut": 63,
          "votesIn": 10,
          "score": 66.54,
          "weight": 0.799,
          "tier": "strong",
          "sameBook": true,
          "viaRange": {
            "start": 43003015,
            "end": 43003016,
            "label": "John 3:15–16",
            "span": 2
          },
          "snippet": "Whoever believes in the Son has eternal life. Whoever rejects the Son will not see life. Instead, the wrath…",
          "reason": {
            "kind": "story",
            "label": "Same story",
            "because": "Another part of the same passage in John 3",
            "basis": "samePassage",
            "confidence": 0.83,
            "source": "rule",
            "evidence": {}
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 8,
          "to": {
            "start": 62004019,
            "end": 62004019,
            "ref": "1John.4.19",
            "label": "1 John 4:19"
          },
          "direction": "both",
          "votesOut": 59,
          "votesIn": 3,
          "score": 60.5,
          "weight": 0.781,
          "tier": "strong",
          "sameBook": false,
          "viaRange": null,
          "snippet": "We love because He first loved us.",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Shared theme: loved",
            "basis": "theme",
            "confidence": 0.63,
            "source": "rule",
            "evidence": {
              "words": [
                "loved"
              ]
            }
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 9,
          "to": {
            "start": 54001015,
            "end": 54001016,
            "ref": "1Tim.1.15-1Tim.1.16",
            "label": "1 Timothy 1:15–16"
          },
          "direction": "both",
          "votesOut": 49,
          "votesIn": 8,
          "score": 51.83,
          "weight": 0.752,
          "tier": "strong",
          "sameBook": false,
          "viaRange": {
            "start": 43003016,
            "end": 43003017,
            "label": "John 3:16–17",
            "span": 2
          },
          "snippet": "This is a trustworthy saying, worthy of full acceptance: Christ Jesus came into the world to save sinners, of…",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Shared theme: eternal, world and believes",
            "basis": "theme",
            "confidence": 0.77,
            "source": "rule",
            "evidence": {
              "words": [
                "eternal",
                "world",
                "believes"
              ]
            }
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 10,
          "to": {
            "start": 43010028,
            "end": 43010028,
            "ref": "John.10.28",
            "label": "John 10:28"
          },
          "direction": "both",
          "votesOut": 50,
          "votesIn": 2,
          "score": 50.71,
          "weight": 0.748,
          "tier": "strong",
          "sameBook": true,
          "viaRange": {
            "start": 43003015,
            "end": 43003016,
            "label": "John 3:15–16",
            "span": 2
          },
          "snippet": "I give them eternal life, and they will never perish. No one can snatch them out of My hand.",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Shared theme: eternal, perish and life",
            "basis": "theme",
            "confidence": 0.73,
            "source": "rule",
            "evidence": {
              "words": [
                "eternal",
                "perish",
                "life"
              ]
            }
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 11,
          "to": {
            "start": 43001029,
            "end": 43001029,
            "ref": "John.1.29",
            "label": "John 1:29"
          },
          "direction": "both",
          "votesOut": 46,
          "votesIn": 3,
          "score": 47.5,
          "weight": 0.736,
          "tier": "strong",
          "sameBook": true,
          "viaRange": null,
          "snippet": "The next day John saw Jesus coming toward him and said, “Look, the Lamb of God, who takes away the sin of the…",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Shared theme: world",
            "basis": "theme",
            "confidence": 0.65,
            "source": "rule",
            "evidence": {
              "words": [
                "world"
              ]
            }
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 12,
          "to": {
            "start": 45005010,
            "end": 45005010,
            "ref": "Rom.5.10",
            "label": "Romans 5:10"
          },
          "direction": "out",
          "votesOut": 46,
          "votesIn": 0,
          "score": 46.0,
          "weight": 0.73,
          "tier": "strong",
          "sameBook": false,
          "viaRange": null,
          "snippet": "For if, when we were enemies of God, we were reconciled to Him through the death of His Son, how much more…",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Shared theme: life",
            "basis": "theme",
            "confidence": 0.66,
            "source": "rule",
            "evidence": {
              "words": [
                "life"
              ]
            }
          },
          "why": null,
          "aiStatus": "not_generated"
        }
      ],
      "connections": "connections/43003016.json",
      "ai": {
        "verse": "ai:verse:43003016:bsb:bsb-2023:v3",
        "status": "not_generated"
      }
    },
    {
      "vid": 43003017,
      "verse": 17,
      "ref": "John.3.17",
      "label": "John 3:17",
      "text": "For God did not send His Son into the world to condemn the world, but to save the world through Him.",
      "omitted": false,
      "paragraphStart": false,
      "counts": {
        "out": 29,
        "in": 57,
        "inDirect": 21,
        "inViaRange": 36,
        "unique": 69,
        "shown": 12,
        "more": 57
      },
      "ticker": [
        {
          "rank": 1,
          "to": {
            "start": 62004014,
            "end": 62004014,
            "ref": "1John.4.14",
            "label": "1 John 4:14"
          },
          "direction": "both",
          "votesOut": 9,
          "votesIn": 3,
          "score": 10.06,
          "weight": 1.0,
          "tier": "strong",
          "sameBook": false,
          "viaRange": {
            "start": 43003016,
            "end": 43003017,
            "label": "John 3:16–17",
            "span": 2
          },
          "snippet": "And we have seen and testify that the Father has sent His Son to be the Savior of the world.",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Shared theme: world",
            "basis": "theme",
            "confidence": 0.58,
            "source": "rule",
            "evidence": {
              "words": [
                "world"
              ]
            }
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 2,
          "to": {
            "start": 43010010,
            "end": 43010010,
            "ref": "John.10.10",
            "label": "John 10:10"
          },
          "direction": "in",
          "votesOut": 0,
          "votesIn": 20,
          "score": 10.0,
          "weight": 0.998,
          "tier": "strong",
          "sameBook": true,
          "viaRange": null,
          "snippet": "The thief comes only to steal and kill and destroy. I have come that they may have life, and have it in all…",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Linked by theme",
            "basis": "theme",
            "confidence": 0.47,
            "source": "rule",
            "evidence": {}
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 3,
          "to": {
            "start": 43006057,
            "end": 43006057,
            "ref": "John.6.57",
            "label": "John 6:57"
          },
          "direction": "both",
          "votesOut": 8,
          "votesIn": 3,
          "score": 9.5,
          "weight": 0.978,
          "tier": "solid",
          "sameBook": true,
          "viaRange": null,
          "snippet": "Just as the living Father sent Me and I live because of the Father, so also the one who feeds on Me will live…",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Linked by theme",
            "basis": "theme",
            "confidence": 0.47,
            "source": "rule",
            "evidence": {}
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 4,
          "to": {
            "start": 43012047,
            "end": 43012048,
            "ref": "John.12.47-John.12.48",
            "label": "John 12:47–48"
          },
          "direction": "both",
          "votesOut": 4,
          "votesIn": 5,
          "score": 6.5,
          "weight": 0.838,
          "tier": "solid",
          "sameBook": true,
          "viaRange": null,
          "snippet": "As for anyone who hears My words and does not keep them, I do not judge him. For I have not come to judge the…",
          "reason": {
            "kind": "quote",
            "label": "Direct quote",
            "because": "John 3:17 and John 12:47–48 share the same words",
            "basis": "sharedWording",
            "confidence": 0.87,
            "source": "rule",
            "evidence": {
              "phrase": "the world but to save the world"
            }
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 5,
          "to": {
            "start": 42019010,
            "end": 42019010,
            "ref": "Luke.19.10",
            "label": "Luke 19:10"
          },
          "direction": "out",
          "votesOut": 6,
          "votesIn": 0,
          "score": 6.0,
          "weight": 0.81,
          "tier": "solid",
          "sameBook": false,
          "viaRange": null,
          "snippet": "For the Son of Man came to seek and to save the lost.”",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Shared theme: save",
            "basis": "theme",
            "confidence": 0.55,
            "source": "rule",
            "evidence": {
              "words": [
                "save"
              ]
            }
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 6,
          "to": {
            "start": 43011042,
            "end": 43011042,
            "ref": "John.11.42",
            "label": "John 11:42"
          },
          "direction": "both",
          "votesOut": 3,
          "votesIn": 6,
          "score": 6.0,
          "weight": 0.81,
          "tier": "solid",
          "sameBook": true,
          "viaRange": null,
          "snippet": "I knew that You always hear Me, but I say this for the benefit of the people standing here, so they may…",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Linked by theme",
            "basis": "theme",
            "confidence": 0.44,
            "source": "rule",
            "evidence": {}
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 7,
          "to": {
            "start": 43020021,
            "end": 43020021,
            "ref": "John.20.21",
            "label": "John 20:21"
          },
          "direction": "both",
          "votesOut": 3,
          "votesIn": 6,
          "score": 6.0,
          "weight": 0.81,
          "tier": "solid",
          "sameBook": true,
          "viaRange": null,
          "snippet": "Again Jesus said to them, “Peace be with you. As the Father has sent Me, so also I am sending you.”",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Linked by theme",
            "basis": "theme",
            "confidence": 0.44,
            "source": "rule",
            "evidence": {}
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 8,
          "to": {
            "start": 43006029,
            "end": 43006029,
            "ref": "John.6.29",
            "label": "John 6:29"
          },
          "direction": "both",
          "votesOut": 5,
          "votesIn": 2,
          "score": 5.58,
          "weight": 0.784,
          "tier": "solid",
          "sameBook": true,
          "viaRange": {
            "start": 43003016,
            "end": 43003018,
            "label": "John 3:16–18",
            "span": 3
          },
          "snippet": "Jesus replied, “The work of God is this: to believe in the One He has sent.”",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Linked by theme",
            "basis": "theme",
            "confidence": 0.47,
            "source": "rule",
            "evidence": {}
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 9,
          "to": {
            "start": 43010036,
            "end": 43010036,
            "ref": "John.10.36",
            "label": "John 10:36"
          },
          "direction": "both",
          "votesOut": 3,
          "votesIn": 5,
          "score": 5.5,
          "weight": 0.779,
          "tier": "solid",
          "sameBook": true,
          "viaRange": null,
          "snippet": "then what about the One whom the Father sanctified and sent into the world? How then can you accuse Me of…",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Shared theme: world",
            "basis": "theme",
            "confidence": 0.58,
            "source": "rule",
            "evidence": {
              "words": [
                "world"
              ]
            }
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 10,
          "to": {
            "start": 43017003,
            "end": 43017003,
            "ref": "John.17.3",
            "label": "John 17:3"
          },
          "direction": "both",
          "votesOut": 2,
          "votesIn": 7,
          "score": 5.5,
          "weight": 0.779,
          "tier": "solid",
          "sameBook": true,
          "viaRange": null,
          "snippet": "Now this is eternal life, that they may know You, the only true God, and Jesus Christ, whom You have sent.",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Linked by theme",
            "basis": "theme",
            "confidence": 0.47,
            "source": "rule",
            "evidence": {}
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 11,
          "to": {
            "start": 43008015,
            "end": 43008016,
            "ref": "John.8.15-John.8.16",
            "label": "John 8:15–16"
          },
          "direction": "both",
          "votesOut": 3,
          "votesIn": 4,
          "score": 5.0,
          "weight": 0.746,
          "tier": "solid",
          "sameBook": true,
          "viaRange": null,
          "snippet": "You judge according to the flesh; I judge no one.",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Linked by theme",
            "basis": "theme",
            "confidence": 0.43,
            "source": "rule",
            "evidence": {}
          },
          "why": null,
          "aiStatus": "not_generated"
        },
        {
          "rank": 12,
          "to": {
            "start": 43006040,
            "end": 43006040,
            "ref": "John.6.40",
            "label": "John 6:40"
          },
          "direction": "both",
          "votesOut": 4,
          "votesIn": 3,
          "score": 4.75,
          "weight": 0.728,
          "tier": "solid",
          "sameBook": true,
          "viaRange": {
            "start": 43003015,
            "end": 43003018,
            "label": "John 3:15–18",
            "span": 4
          },
          "snippet": "For it is My Father’s will that everyone who looks to the Son and believes in Him shall have eternal life…",
          "reason": {
            "kind": "topic",
            "label": "Same topic",
            "because": "Linked by theme",
            "basis": "theme",
            "confidence": 0.46,
            "source": "rule",
            "evidence": {}
          },
          "why": null,
          "aiStatus": "not_generated"
        }
      ],
      "connections": "connections/43003017.json",
      "ai": {
        "verse": "ai:verse:43003017:bsb:bsb-2023:v3",
        "status": "not_generated"
      }
    }
  ],
  "attribution": {
    "text": "Berean Standard Bible, public domain",
    "crossReferences": "Cross references from OpenBible.info, CC-BY (2016-02-01)",
    "ai": "No AI-generated content in this version. Connection reasons are computed by rules from the public-domain text."
  },
  "_note": "Sample trimmed to verses 15-17 of 36 (from data/samples/chapters/John-3.json); the real file carries every verse with the same shape. headings is empty because the BSB source has none. why and aiStatus stay empty while AI notes are deferred."
}
```

### 4.2 Ticker feed for John 3:16

```json
{
  "schema": "asb.ticker/2",
  "rankingVersion": "asb.rank.v2",
  "translation": "bsb",
  "focus": {
    "vid": 43003016,
    "ref": "John.3.16",
    "label": "John 3:16"
  },
  "counts": {
    "out": 23,
    "in": 104,
    "unique": 110,
    "shown": 12,
    "more": 98
  },
  "order": "score desc; out/both before in-only; then canonical order (start vid asc)",
  "motion": {
    "mode": "hold",
    "loop": true,
    "baseSeconds": 3.0,
    "perWeightSeconds": 3.0,
    "dwellFormula": "dwellSeconds = 3.0 + 3.0 * weight",
    "advanceOnFocusChange": true
  },
  "items": [
    {
      "rank": 1,
      "to": {
        "start": 45005008,
        "end": 45005008,
        "ref": "Rom.5.8",
        "label": "Romans 5:8"
      },
      "direction": "both",
      "votesOut": 178,
      "votesIn": 33,
      "score": 194.5,
      "weight": 1.0,
      "tier": "strong",
      "sameBook": false,
      "viaRange": null,
      "snippet": "But God proves His love for us in this: While we were still sinners, Christ died for us.",
      "reason": {
        "kind": "topic",
        "label": "Same topic",
        "because": "Shared theme: loved",
        "basis": "theme",
        "confidence": 0.65,
        "source": "rule",
        "evidence": {
          "words": [
            "loved"
          ]
        }
      },
      "why": null,
      "aiStatus": "not_generated",
      "dwellSeconds": 6.0
    },
    {
      "rank": 2,
      "to": {
        "start": 62004009,
        "end": 62004010,
        "ref": "1John.4.9-1John.4.10",
        "label": "1 John 4:9–10"
      },
      "direction": "both",
      "votesOut": 122,
      "votesIn": 13,
      "score": 128.5,
      "weight": 0.922,
      "tier": "strong",
      "sameBook": false,
      "viaRange": null,
      "snippet": "This is how God’s love was revealed among us: God sent His one and only Son into the world, so that we might…",
      "reason": {
        "kind": "topic",
        "label": "Same topic",
        "because": "Shared theme: world and loved",
        "basis": "theme",
        "confidence": 0.72,
        "source": "rule",
        "evidence": {
          "words": [
            "world",
            "loved"
          ]
        }
      },
      "why": null,
      "aiStatus": "not_generated",
      "dwellSeconds": 5.77
    },
    {
      "rank": 3,
      "to": {
        "start": 43003015,
        "end": 43003015,
        "ref": "John.3.15",
        "label": "John 3:15"
      },
      "direction": "both",
      "votesOut": 90,
      "votesIn": 8,
      "score": 94.0,
      "weight": 0.863,
      "tier": "strong",
      "sameBook": true,
      "viaRange": null,
      "snippet": "that everyone who believes in Him may have eternal life.",
      "reason": {
        "kind": "story",
        "label": "Same story",
        "because": "Another part of the same passage in John 3",
        "basis": "samePassage",
        "confidence": 0.89,
        "source": "rule",
        "evidence": {}
      },
      "why": null,
      "aiStatus": "not_generated",
      "dwellSeconds": 5.59
    },
    {
      "rank": 4,
      "to": {
        "start": 43011025,
        "end": 43011026,
        "ref": "John.11.25-John.11.26",
        "label": "John 11:25–26"
      },
      "direction": "out",
      "votesOut": 81,
      "votesIn": 0,
      "score": 81.0,
      "weight": 0.835,
      "tier": "strong",
      "sameBook": true,
      "viaRange": null,
      "snippet": "Jesus said to her, “I am the resurrection and the life. Whoever believes in Me will live, even though he dies.",
      "reason": {
        "kind": "topic",
        "label": "Same topic",
        "because": "Shared theme: believes and life",
        "basis": "theme",
        "confidence": 0.68,
        "source": "rule",
        "evidence": {
          "words": [
            "believes",
            "life"
          ]
        }
      },
      "why": null,
      "aiStatus": "not_generated",
      "dwellSeconds": 5.5
    },
    {
      "rank": 5,
      "to": {
        "start": 43006040,
        "end": 43006040,
        "ref": "John.6.40",
        "label": "John 6:40"
      },
      "direction": "both",
      "votesOut": 72,
      "votesIn": 3,
      "score": 72.75,
      "weight": 0.815,
      "tier": "strong",
      "sameBook": true,
      "viaRange": {
        "start": 43003015,
        "end": 43003018,
        "label": "John 3:15–18",
        "span": 4
      },
      "snippet": "For it is My Father’s will that everyone who looks to the Son and believes in Him shall have eternal life…",
      "reason": {
        "kind": "topic",
        "label": "Same topic",
        "because": "Shared theme: eternal, believes and life",
        "basis": "theme",
        "confidence": 0.75,
        "source": "rule",
        "evidence": {
          "words": [
            "eternal",
            "believes",
            "life"
          ]
        }
      },
      "why": null,
      "aiStatus": "not_generated",
      "dwellSeconds": 5.45
    },
    {
      "rank": 6,
      "to": {
        "start": 45008032,
        "end": 45008032,
        "ref": "Rom.8.32",
        "label": "Romans 8:32"
      },
      "direction": "both",
      "votesOut": 68,
      "votesIn": 6,
      "score": 71.0,
      "weight": 0.811,
      "tier": "strong",
      "sameBook": false,
      "viaRange": null,
      "snippet": "He who did not spare His own Son but gave Him up for us all, how will He not also, along with Him, freely…",
      "reason": {
        "kind": "topic",
        "label": "Same topic",
        "because": "Linked by theme",
        "basis": "theme",
        "confidence": 0.62,
        "source": "rule",
        "evidence": {}
      },
      "why": null,
      "aiStatus": "not_generated",
      "dwellSeconds": 5.43
    },
    {
      "rank": 7,
      "to": {
        "start": 43003036,
        "end": 43003036,
        "ref": "John.3.36",
        "label": "John 3:36"
      },
      "direction": "both",
      "votesOut": 63,
      "votesIn": 10,
      "score": 66.54,
      "weight": 0.799,
      "tier": "strong",
      "sameBook": true,
      "viaRange": {
        "start": 43003015,
        "end": 43003016,
        "label": "John 3:15–16",
        "span": 2
      },
      "snippet": "Whoever believes in the Son has eternal life. Whoever rejects the Son will not see life. Instead, the wrath…",
      "reason": {
        "kind": "story",
        "label": "Same story",
        "because": "Another part of the same passage in John 3",
        "basis": "samePassage",
        "confidence": 0.83,
        "source": "rule",
        "evidence": {}
      },
      "why": null,
      "aiStatus": "not_generated",
      "dwellSeconds": 5.4
    },
    {
      "rank": 8,
      "to": {
        "start": 62004019,
        "end": 62004019,
        "ref": "1John.4.19",
        "label": "1 John 4:19"
      },
      "direction": "both",
      "votesOut": 59,
      "votesIn": 3,
      "score": 60.5,
      "weight": 0.781,
      "tier": "strong",
      "sameBook": false,
      "viaRange": null,
      "snippet": "We love because He first loved us.",
      "reason": {
        "kind": "topic",
        "label": "Same topic",
        "because": "Shared theme: loved",
        "basis": "theme",
        "confidence": 0.63,
        "source": "rule",
        "evidence": {
          "words": [
            "loved"
          ]
        }
      },
      "why": null,
      "aiStatus": "not_generated",
      "dwellSeconds": 5.34
    },
    {
      "rank": 9,
      "to": {
        "start": 54001015,
        "end": 54001016,
        "ref": "1Tim.1.15-1Tim.1.16",
        "label": "1 Timothy 1:15–16"
      },
      "direction": "both",
      "votesOut": 49,
      "votesIn": 8,
      "score": 51.83,
      "weight": 0.752,
      "tier": "strong",
      "sameBook": false,
      "viaRange": {
        "start": 43003016,
        "end": 43003017,
        "label": "John 3:16–17",
        "span": 2
      },
      "snippet": "This is a trustworthy saying, worthy of full acceptance: Christ Jesus came into the world to save sinners, of…",
      "reason": {
        "kind": "topic",
        "label": "Same topic",
        "because": "Shared theme: eternal, world and believes",
        "basis": "theme",
        "confidence": 0.77,
        "source": "rule",
        "evidence": {
          "words": [
            "eternal",
            "world",
            "believes"
          ]
        }
      },
      "why": null,
      "aiStatus": "not_generated",
      "dwellSeconds": 5.26
    },
    {
      "rank": 10,
      "to": {
        "start": 43010028,
        "end": 43010028,
        "ref": "John.10.28",
        "label": "John 10:28"
      },
      "direction": "both",
      "votesOut": 50,
      "votesIn": 2,
      "score": 50.71,
      "weight": 0.748,
      "tier": "strong",
      "sameBook": true,
      "viaRange": {
        "start": 43003015,
        "end": 43003016,
        "label": "John 3:15–16",
        "span": 2
      },
      "snippet": "I give them eternal life, and they will never perish. No one can snatch them out of My hand.",
      "reason": {
        "kind": "topic",
        "label": "Same topic",
        "because": "Shared theme: eternal, perish and life",
        "basis": "theme",
        "confidence": 0.73,
        "source": "rule",
        "evidence": {
          "words": [
            "eternal",
            "perish",
            "life"
          ]
        }
      },
      "why": null,
      "aiStatus": "not_generated",
      "dwellSeconds": 5.24
    },
    {
      "rank": 11,
      "to": {
        "start": 43001029,
        "end": 43001029,
        "ref": "John.1.29",
        "label": "John 1:29"
      },
      "direction": "both",
      "votesOut": 46,
      "votesIn": 3,
      "score": 47.5,
      "weight": 0.736,
      "tier": "strong",
      "sameBook": true,
      "viaRange": null,
      "snippet": "The next day John saw Jesus coming toward him and said, “Look, the Lamb of God, who takes away the sin of the…",
      "reason": {
        "kind": "topic",
        "label": "Same topic",
        "because": "Shared theme: world",
        "basis": "theme",
        "confidence": 0.65,
        "source": "rule",
        "evidence": {
          "words": [
            "world"
          ]
        }
      },
      "why": null,
      "aiStatus": "not_generated",
      "dwellSeconds": 5.21
    },
    {
      "rank": 12,
      "to": {
        "start": 45005010,
        "end": 45005010,
        "ref": "Rom.5.10",
        "label": "Romans 5:10"
      },
      "direction": "out",
      "votesOut": 46,
      "votesIn": 0,
      "score": 46.0,
      "weight": 0.73,
      "tier": "strong",
      "sameBook": false,
      "viaRange": null,
      "snippet": "For if, when we were enemies of God, we were reconciled to Him through the death of His Son, how much more…",
      "reason": {
        "kind": "topic",
        "label": "Same topic",
        "because": "Shared theme: life",
        "basis": "theme",
        "confidence": 0.66,
        "source": "rule",
        "evidence": {
          "words": [
            "life"
          ]
        }
      },
      "why": null,
      "aiStatus": "not_generated",
      "dwellSeconds": 5.19
    }
  ],
  "attribution": "Cross references from OpenBible.info, CC-BY (2016-02-01). Text: Berean Standard Bible, public domain."
}
```

### 4.3 Trail: John 3:16 -> Romans 5:8 -> 1 John 3:16

Real edges: `John.3.16 -> Rom.5.8 178`, `Rom.5.8 -> 1John.3.16 19` (rank 4 on Romans 5:8, with 5 votes back), `1John.3.16 -> John.3.16 15` (the peek that closes the loop), `Rom.5.8 -> Rom.5.6 26` (a peek not taken).

```json
{
  "schema": "asb.trail/2",
  "id": "trail_2026-09-27T14:02:11Z_a8f3",
  "translation": "bsb",
  "cursor": 2,
  "hops": [
    {
      "index": 0,
      "kind": "open",
      "vid": 43003016,
      "ref": "John.3.16",
      "label": "John 3:16",
      "book": "John",
      "via": null,
      "scroll": {
        "chapter": 43003000,
        "anchor": 43003016,
        "highlight": null
      },
      "at": "2026-09-27T14:02:11Z"
    },
    {
      "index": 1,
      "kind": "jump",
      "vid": 45005008,
      "ref": "Rom.5.8",
      "label": "Romans 5:8",
      "book": "Romans",
      "via": {
        "from": {
          "vid": 43003016,
          "ref": "John.3.16",
          "label": "John 3:16"
        },
        "to": {
          "start": 45005008,
          "end": 45005008,
          "ref": "Rom.5.8",
          "label": "Romans 5:8"
        },
        "direction": "both",
        "votesOut": 178,
        "votesIn": 33,
        "score": 194.5,
        "rank": 1
      },
      "scroll": {
        "chapter": 45005000,
        "anchor": 45005008,
        "highlight": null
      },
      "at": "2026-09-27T14:03:40Z"
    },
    {
      "index": 2,
      "kind": "jump",
      "vid": 62003016,
      "ref": "1John.3.16",
      "label": "1 John 3:16",
      "book": "1 John",
      "via": {
        "from": {
          "vid": 45005008,
          "ref": "Rom.5.8",
          "label": "Romans 5:8"
        },
        "to": {
          "start": 62003016,
          "end": 62003016,
          "ref": "1John.3.16",
          "label": "1 John 3:16"
        },
        "direction": "both",
        "votesOut": 19,
        "votesIn": 5,
        "score": 21.5,
        "rank": 4
      },
      "scroll": {
        "chapter": 62003000,
        "anchor": 62003016,
        "highlight": null
      },
      "at": "2026-09-27T14:05:02Z"
    }
  ],
  "forward": [],
  "peeks": [
    {
      "fromHop": 1,
      "to": {
        "start": 45005006,
        "end": 45005006,
        "ref": "Rom.5.6",
        "label": "Romans 5:6"
      },
      "votesOut": 26,
      "at": "2026-09-27T14:04:10Z",
      "jumped": false
    },
    {
      "fromHop": 2,
      "to": {
        "start": 43003016,
        "end": 43003016,
        "ref": "John.3.16",
        "label": "John 3:16"
      },
      "votesOut": 15,
      "at": "2026-09-27T14:05:40Z",
      "jumped": false
    }
  ],
  "peek": {
    "open": true,
    "fromHop": 2,
    "to": {
      "start": 43003016,
      "end": 43003016,
      "ref": "John.3.16",
      "label": "John 3:16"
    },
    "direction": "out",
    "votesOut": 15,
    "snippet": "For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life.",
    "note": "a peek does not push a hop until the reader taps Go"
  },
  "web": {
    "nodes": [43003016, 45005008, 62003016],
    "edges": [
      [43003016, 45005008, 178],
      [45005008, 62003016, 19],
      [62003016, 43003016, 15]
    ],
    "peekOnlyEdges": [
      [62003016, 43003016]
    ],
    "booksTouched": [
      "John",
      "Romans",
      "1 John"
    ],
    "loopClosed": true
  },
  "rules": {
    "pushOn": [
      "open",
      "jump",
      "search",
      "bookmarkOpen"
    ],
    "notPushed": [
      "scroll",
      "peek",
      "back",
      "forward"
    ],
    "scrollUpdatesCurrentHop": true,
    "maxHops": 200,
    "persist": "SwiftData; active trail restored on relaunch; last 20 trails kept"
  }
}
```

### 4.4 AI context: verse John 3:16 and connection John 3:16 > Romans 5:8

Deferred. This hand-written example documents the shape for when AI notes return; nothing like it ships in v1, and the content strings are illustrative.

```json
{
  "schema": "asb.ai/2",
  "verse": {
    "key": "ai:verse:43003016:bsb:bsb-2023:v3",
    "kind": "verse",
    "vid": 43003016,
    "ref": "John.3.16",
    "translation": "bsb",
    "textVersion": "bsb-2023",
    "content": {
      "summary": "Jesus tells Nicodemus that God's love for the world is the reason He gave His one and only Son, and that trusting the Son is what separates perishing from eternal life.",
      "context": "Spoken at night to Nicodemus, a Pharisee (John 3:1-2). It follows the bronze-snake comparison in 3:14-15 (Numbers 21:8-9): as Israel lived by looking at the lifted-up snake, people live by believing in the lifted-up Son.",
      "speaker": "Jesus (to Nicodemus)",
      "genre": "Gospel discourse",
      "themes": [
        "love of God",
        "eternal life",
        "belief",
        "the Son given",
        "the world"
      ],
      "entities": [
        {
          "name": "God",
          "type": "person",
          "role": "giver"
        },
        {
          "name": "the Son",
          "type": "person",
          "alias": "Jesus",
          "role": "given"
        },
        {
          "name": "Nicodemus",
          "type": "person",
          "role": "listener",
          "vid": 43003001
        },
        {
          "name": "the world",
          "type": "group"
        }
      ],
      "questions": [
        "What does 'the world' include here, given 3:17?",
        "How do verses 14-15 set up 'gave' in verse 16?"
      ],
      "readingTip": "Read 3:14-18 as one unit: 'lifted up', 'gave', and 'not condemned' explain each other."
    },
    "provenance": {
      "generator": "claude",
      "model": "claude-opus-5",
      "promptId": "verse-context",
      "promptVersion": "v3",
      "schemaVersion": 2,
      "inputs": {
        "verses": [
          43003014,
          43003015,
          43003016,
          43003017,
          43003018
        ],
        "topConnections": 12,
        "rankingVersion": "asb.rank.v2",
        "translation": "bsb",
        "textVersion": "bsb-2023"
      },
      "inputHash": "sha256:5b1e4c0a9d2f7e6b1c3a8d4f0e9b7a6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a",
      "generatedAt": "2026-09-20T03:12:44Z",
      "backendJob": "batch_01J8Y2K7",
      "tokens": {
        "input": 1840,
        "output": 212
      },
      "reviewed": false,
      "disclaimer": "AI-generated study aid, not authoritative commentary and not part of the Bible text or the OpenBible dataset."
    },
    "cache": {
      "source": "bundled",
      "fetchedAt": null,
      "ttlDays": null,
      "invalidateOn": [
        "promptVersion",
        "textVersion",
        "rankingVersion"
      ]
    }
  },
  "connection": {
    "key": "ai:edge:43003016>45005008:bsb:bsb-2023:v2",
    "kind": "edge",
    "from": {
      "vid": 43003016,
      "ref": "John.3.16",
      "label": "John 3:16"
    },
    "to": {
      "start": 45005008,
      "end": 45005008,
      "ref": "Rom.5.8",
      "label": "Romans 5:8"
    },
    "direction": "both",
    "votesOut": 178,
    "votesIn": 33,
    "translation": "bsb",
    "textVersion": "bsb-2023",
    "content": {
      "why": "Both verses ground God's love in an act, not a feeling: John says God gave His Son; Paul says Christ died for us while we were still sinners. John states it as Jesus' teaching; Paul states it as the proof of God's love toward sinners.",
      "relation": "parallel",
      "confidence": 0.92,
      "sharedThemes": [
        "love of God",
        "the Son given",
        "sacrifice"
      ],
      "readNext": [
        {
          "to": {
            "start": 62004009,
            "end": 62004010,
            "ref": "1John.4.9-1John.4.10",
            "label": "1 John 4:9–10"
          },
          "why": "Restates both verses with 'sent His Son' and 'atoning sacrifice'."
        },
        {
          "to": {
            "start": 45008032,
            "end": 45008032,
            "ref": "Rom.8.32",
            "label": "Romans 8:32"
          },
          "why": "Paul's own echo of 'gave His Son': 'did not spare His own Son'."
        }
      ]
    },
    "relationVocabulary": [
      "quotation",
      "allusion",
      "fulfillment",
      "parallel",
      "contrast",
      "context",
      "thematic"
    ],
    "provenance": {
      "generator": "claude",
      "model": "claude-opus-5",
      "promptId": "edge-why",
      "promptVersion": "v2",
      "schemaVersion": 2,
      "inputs": {
        "verses": [
          43003016,
          45005008
        ],
        "votesOut": 178,
        "votesIn": 33,
        "translation": "bsb",
        "textVersion": "bsb-2023"
      },
      "inputHash": "sha256:91ad3f0b7c6e5d4a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f91",
      "generatedAt": "2026-09-21T11:48:52Z",
      "backendJob": "batch_01J8Y2K7",
      "tokens": {
        "input": 610,
        "output": 96
      },
      "reviewed": false,
      "disclaimer": "AI-generated study aid, not authoritative commentary and not part of the Bible text or the OpenBible dataset."
    },
    "cache": {
      "source": "fetched",
      "fetchedAt": "2026-09-27T14:04:00Z",
      "ttlDays": 365,
      "invalidateOn": [
        "promptVersion",
        "textVersion"
      ]
    }
  },
  "requestOnMiss": {
    "method": "POST",
    "path": "/v1/context",
    "body": {
      "kind": "edge",
      "from": 43003016,
      "to": {
        "start": 45005008,
        "end": 45005008
      },
      "translation": "bsb",
      "textVersion": "bsb-2023",
      "promptVersion": "v2"
    },
    "auth": "App Attest + anonymous device token; the phone never holds an Anthropic API key",
    "policy": "Generated on the backend with the Anthropic API (Batches API for pre-generation). Every AI field renders with an 'AI' marker; model and prompt version shown on long-press."
  },
  "_note": "Content strings are illustrative sample output; vids, refs, votes and snippets are real."
}
```

### 4.5 Books index entries

```json
{
  "schema": "asb.books/2",
  "canon": "protestant-66",
  "versification": "BSB (31,102 verses); OpenBible refs outside it are clamped to the chapter's last verse (3 John 1:15 -> 1:14)",
  "books": [
    {
      "bookNo": 43,
      "osis": "John",
      "name": "John",
      "short": "John",
      "sourceName": "John",
      "aliases": [
        "Gospel of John",
        "Jn"
      ],
      "testament": "NT",
      "chapters": 21,
      "verses": 879,
      "firstVid": 43001001,
      "firstOrdinal": 26045,
      "verseCounts": [51, 25, 36, 54, 47, 71, 53, 59, 41, 42, 57, 50, 38, 31, 27, 33, 26, 40, 42, 31, 25]
    },
    {
      "bookNo": 19,
      "osis": "Ps",
      "name": "Psalm",
      "short": "Ps",
      "sourceName": "Psalms",
      "aliases": [
        "Psalms",
        "Ps",
        "Psa",
        "Pss"
      ],
      "testament": "OT",
      "chapters": 150,
      "verses": 2461,
      "firstVid": 19001001,
      "firstOrdinal": 13940,
      "verseCounts": [6, 12, 8, 8, 12, 10, 17, 9, 20, 18, 7, 8, 6, 7, 5, 11, 15, 50, 14, 9, 13, 31, 6, 10, 22, 12, 14, 9, 11, 12, 24, 11, 22, 22, 28, 12, 40, 22, 13, 17, 13, 11, 5, 26, 17, 11, 9, 14, 20, 23, 19, 9, 6, 7, 23, 13, 11, 11, 17, 12, 8, 12, 11, 10, 13, 20, 7, 35, 36, 5, 24, 20, 28, 23, 10, 12, 20, 72, 13, 19, 16, 8, 18, 12, 13, 17, 7, 18, 52, 17, 16, 15, 5, 23, 11, 13, 12, 9, 9, 5, 8, 28, 22, 35, 45, 48, 43, 13, 31, 7, 10, 10, 9, 8, 18, 19, 2, 29, 176, 7, 8, 9, 4, 8, 5, 6, 5, 6, 8, 8, 3, 18, 3, 3, 21, 26, 9, 8, 24, 13, 10, 7, 12, 15, 21, 10, 20, 14, 9, 6]
    }
  ],
  "_note": "Two of 66 entries shown (from data/samples/books.json). name is the singular display form used in labels ('Psalm 2:7'); sourceName is the BSB.json book name; osis is the OpenBible key."
}
```

### 4.6 Dataset manifest

```json
{
  "schema": "asb.manifest/2",
  "datasetVersion": "2026.09.1",
  "builtAt": "2026-09-28T00:00:00Z",
  "pipeline": "tools/build_dataset.py",
  "canon": {
    "books": 66,
    "chapters": 1189,
    "verses": 31102,
    "versification": "BSB"
  },
  "graph": {
    "edges": 343608,
    "edgesDroppedForMissingVerse": 1,
    "edgesClampedToBsbVersification": 4,
    "rangeTargets": 87934,
    "crossChapterRanges": 650,
    "crossBookRanges": 18,
    "rangesOver40Verses": 295,
    "maxSpan": 182,
    "incomingRows": 596218,
    "votes": {
      "min": 1,
      "median": 2,
      "p90": 4,
      "p99": 10,
      "max": 340
    },
    "mergedTickerItems": 840072,
    "inlineTickerItems": 343635,
    "versesWithNoConnections": 114
  },
  "ranking": {
    "version": "asb.rank.v2",
    "incomingFactor": 0.5,
    "rangeDiscount": "votes / sqrt(span)",
    "spanCap": 40,
    "score": "votesOut + incomingFactor * sum(votesIn / sqrt(span))",
    "weight": "ln(1 + score) / ln(1 + maxScoreOfThisVerse), 3 decimals, per verse",
    "tiers": {
      "strong": ">= 10",
      "solid": ">= 4",
      "light": "< 4"
    },
    "tierShare": {
      "strong": 0.0079,
      "solid": 0.0899,
      "light": 0.9022
    },
    "order": "score desc; out/both before in-only; start vid asc",
    "collision": "same start, different end: keep higher votes, list others in alsoCites",
    "tickerInline": 12,
    "snippetMaxChars": 110,
    "dwellSeconds": "3.0 + 3.0 * weight",
    "motion": {
      "defaultMode": "hold",
      "baseSeconds": 3.0,
      "perWeightSeconds": 3.0
    }
  },
  "reasons": {
    "version": "asb.reasons.v1",
    "rules": "tools/reasons.py",
    "analysisText": "bsb-2023",
    "labels": {
      "quote": "Direct quote",
      "story": "Same story",
      "topic": "Same topic"
    },
    "bases": [
      "sharedWording",
      "quotation",
      "parallelAccount",
      "retelling",
      "samePassage",
      "sharedNames",
      "theme"
    ],
    "share": {
      "quote": 0.0183,
      "story": 0.0569,
      "topic": 0.9247
    },
    "counts": {
      "quote": 15401,
      "story": 47824,
      "topic": 776847
    },
    "confidence": "match strength 0..1, shown as a percentage: 1.0 = the same words or the same account; topics are capped at 0.8 (tools/reasons.py, docs/DATA_MODEL.md 2.6.1)",
    "tested": "tests/gold_reasons.json (60 hand-labelled connections, all correct)",
    "note": "Deterministic rules over the public-domain BSB text, so no licensed text is processed. An AI pass may later replace a reason (source 'ai'), only with YouVersion's written approval."
  },
  "translations": [
    {
      "id": "bsb",
      "name": "Berean Standard Bible",
      "abbr": "BSB",
      "textVersion": "bsb-2023",
      "license": "Public domain (CC0), BSB Publishing 2023",
      "copyrightNotice": "The Holy Bible, Berean Standard Bible, BSB is produced in cooperation with Bible Hub, Discovery Bible, OpenBible.com, and the Berean Bible Translation Committee. This text of God's Word has been dedicated to the public domain.",
      "attribution": "Berean Standard Bible, BSB Publishing 2023, public domain",
      "role": "offline fallback and the analysis text for connection reasons",
      "bundled": true,
      "delivery": "bundled",
      "packUrl": null,
      "sha256": "65cec9123b09bec8b99b664280e321e82d39fe77703539eebe889aa50e232cf9",
      "headings": false
    },
    {
      "id": "niv",
      "name": "New International Version",
      "abbr": "NIV",
      "textVersion": null,
      "license": "Copyright Biblica, Inc. Delivered by the YouVersion Platform under its non-commercial license",
      "attribution": null,
      "copyrightNotice": "<the copyright string returned by the YouVersion API, shown wherever NIV text appears>",
      "role": "launch translation, fetched at runtime; never bundled, stored or indexed",
      "bundled": false,
      "delivery": "youversionPlatform",
      "youversionVersionId": 111,
      "packUrl": null,
      "sha256": null,
      "headings": true
    }
  ],
  "sources": [
    {
      "id": "openbible-xref-2016-02-01",
      "kind": "crossReferences",
      "name": "OpenBible.info Cross References",
      "version": "2016-02-01",
      "license": "CC-BY",
      "url": "https://www.openbible.info/labs/cross-references/",
      "attribution": "Cross references from OpenBible.info (https://www.openbible.info/labs/cross-references/), used under a Creative Commons Attribution license. Dataset dated 2016-02-01. Vote counts reflect OpenBible.info user voting. Ranking, range handling and connection reasons are our own.",
      "via": "https://github.com/scrollmapper/bible_databases (2024 branch, cross_references.txt)",
      "retrievedAt": "2026-09-28"
    },
    {
      "id": "bsb-2023",
      "kind": "text",
      "name": "Berean Standard Bible",
      "version": "2023",
      "license": "Public domain (CC0)",
      "url": "https://berean.bible",
      "attribution": "Berean Standard Bible, public domain",
      "via": "https://github.com/scrollmapper/bible_databases (formats/json/BSB.json)",
      "retrievedAt": "2026-09-28"
    },
    {
      "id": "ai-claude",
      "kind": "ai",
      "name": "AI study notes",
      "status": "deferred",
      "generator": "claude",
      "model": "claude-opus-5",
      "promptVersions": {
        "verse-context": "v3",
        "edge-why": "v2"
      },
      "attribution": "Deferred: v1 ships no AI output. When enabled, notes are marked as an AI-generated study aid, not part of the Bible text or the OpenBible dataset",
      "license": "Generated content, owned by the publisher"
    }
  ],
  "shards": [
    {
      "path": "books.json",
      "kind": "books",
      "bytes": 17744,
      "gzipBytes": 4476,
      "sha256": "bf18586833bf92eb927f70abbd94a5b0b7eaf8fdc6c148db24a69554d825a1f9"
    },
    {
      "path": "graph/43-John.json",
      "kind": "graph",
      "book": 43,
      "bytes": 895570,
      "gzipBytes": 118038,
      "sha256": "bfd79391f677e6eda007ed5b8ae75a2757d0df1acb9e68c1361be35a94b0662a"
    },
    {
      "path": "incoming/43-John.json",
      "kind": "incoming",
      "book": 43,
      "bytes": 2818278,
      "gzipBytes": 188918,
      "sha256": "d32e5ea659efccb7a2aa50c6c28ab6e195ee52ae8b3c131d818a8de4a0bc9dd8"
    },
    {
      "path": "text/bsb/43-John.json",
      "kind": "text",
      "book": 43,
      "translation": "bsb",
      "bytes": 260443,
      "gzipBytes": 42971,
      "sha256": "22b96e2a8569466235faada0a2106d4983f492d1ab86b76b2b0a5112d6a1a653"
    }
  ],
  "onDevice": {
    "database": "asb.sqlite",
    "shippedInAppBundle": true,
    "estimatedBytes": 44700000,
    "tickerInline": 12
  },
  "_note": "Real manifest from data/samples/manifest.json with the shard list trimmed to 4 of 199 entries."
}
```

## 5. File layout and size estimates

Measured on the real data with compact JSON and gzip level 6; "keyed" estimates assume the readable camelCase keys above (roughly 2.5x raw, 1.3x gzipped).

```
data/full/                                distribution + OTA format, built by tools/build_dataset.py (rebuilt locally, not committed)
  manifest.json                            ~50 KB   versions, measured counts, ranking constants, sources, translations, 199 shards with sha256
  books.json                               ~18 KB   66 books with verseCounts
  attribution.md                           ~1 KB    BSB notice, OpenBible CC-BY credit with change note, AI notice (Settings > About)
  graph/{bookNo}-{osis}.json               66 files, sharded by SOURCE book, translation-free, 343,608 edges
      43-John.json                         896 KB raw / 118 KB gz                    measured
      all 66                               26.1 MB raw / 3.5 MB gz                   measured
  incoming/{bookNo}-{osis}.json            66 files, sharded by TARGET book, 596,218 rows
      43-John.json                         2818 KB raw / 189 KB gz                  measured
      all 66                               79.0 MB raw / 5.2 MB gz                   measured
  text/bsb/{bookNo}-{osis}.json            66 files, text + snippet + paragraphStart + omitted per verse
      43-John.json                         260 KB raw / 43 KB gz                    measured
      all 66                               9.8 MB raw / 1.7 MB gz                     measured
  text/niv/                                same layout, produced only under license, served OTA, never committed
  bundles/bsb/{bookNo}/{chapter}.json      optional (--bundles): all 1,189 chapter bundles, 145 MB raw (measured); the app builds these from SQLite instead
      43/003.json                          174 KB raw / 33 KB gz (John 3, 36 verses x 12 chips)   measured
      19/119.json                          795 KB raw (Psalm 119, the worst case)                measured
  ai/verse/, ai/edge/                      Phase 2: pre-generated notes for the top ~5,000 verses and their top 3 chips (not built yet)

data/samples/                              committed, founder-readable (1.6 MB): 6 chapter bundles, 5 ticker feeds, 5 connection lists,
                                           the trail and AI note from section 4, books.json, manifest.json
prototype/data/                            committed (29 MB): compact transport the HTML prototype expands into the documents above
                                           (books, manifest, all text in one file, 66 per-book ticker packs, sample AI notes)

App bundle (iOS):
  asb.sqlite                               prebuilt by tools/compile_sqlite.py, shipped read-only, copied to Application Support on first launch
                                           (cold start = a ~58 MB file copy, never a JSON parse). Tables: books(66), translations, verses(31,102 BSB rows:
                                           text + snippet + heading + paragraphStart; BSB only, NIV text is never stored),
                                           [edges(343,608) and incoming(596,218) in the tooling profile only],
                                           ticker(840,072 merged items; PK vid, rank; score and weight stored as integers x100 / x1000; reasonKind,
                                           reasonBasis, reasonConfidence100, reasonTextId), reason_text(63,217 distinct "because" sentences),
                                           ai_context(empty in v1), FTS5 on the BSB verses.text (search runs over BSB wording and opens the NIV).
                                           Measured (tools/compile_sqlite.py --profile ship): 50.5 MB without search, 57.7 MB with FTS5. John 3 opens in
                                           ~2.5 ms, Psalm 119 in ~7 ms (desktop CPython; expect several times that on an iPhone, still well under a frame).
                                           Raw edges/incoming stay out of the shipped file (profile full, for tooling only).
  Runtime: GRDB; chapter open = one indexed query over verses + ticker (36 x 12 rows for John 3), LRU of 5 ChapterBundles, prev/next chapter prefetched.

Downloaded on demand (CDN, verified by manifest sha256):
  text/niv/*.json.gz (~1.7 MB, license-gated), ai/ packs, manifest deltas. Download budget for full offline BSB reading: 0 (it ships in the binary).

On device only (SwiftData): Trail (active + last 20), bookmarks, highlights, reading position, fetched ai_context rows.
```

## 6. Decisions log

| # | Disagreement | Decision | Reasoning |
|---|---|---|---|
| 1 | Winner: founder judge chose Proposal 1 (screen-shaped documents), engineer judge chose Proposal 2 (normalized graph) | Proposal 1's document shapes on top of Proposal 2's graph semantics | The reader reads P1's documents; the pipeline that fills them must use P2's merge-by-start-vid, span discount and cap, or thousands of verses show duplicate chips. |
| 2 | Weight: per-verse normalized (judge 1, from P3) vs global log scale (P2, judge 2 flagged P3's two incompatible scales) | Per-verse `weight` computed on the merged `score`, global `tier` from the same score | Normalizing the single merged score gives every verse a graded strip (28,345 verses never reach score 10) while keeping in and out chips on one scale, which removes judge 2's objection. |
| 3 | Tier thresholds: 10 / 4 (judge 1) vs 20 / 5 (P2) | strong >= 10, solid >= 4, on score | Matches the top 1% / top 10% of the dataset that judge 1 asked for; measured share is 0.8% / 9.0%. |
| 4 | Provenance on every document (judge 2) vs manifest only with one attribution string (judge 1) | Short `attribution {text, crossReferences, ai}` on every UI document; full provenance once in the manifest | Satisfies CC-BY on screen without repeating a 300-byte block in 31,102 places. |
| 5 | Inline chip count: P1 12, P2 6, P3 12 out + 6 in | One constant `tickerInline = 12` merged, stored in the manifest | The inline count must equal the strip count so scrolling never does a lookup (judge 2), and one merged list avoids P3's out-then-in ordering that let a 33-vote incoming chip never outrank a 25-vote outgoing one. |
| 6 | Range field shape: `toEnd` (judge 1) vs `to {start, end}` (judge 2) | `to {start, end, ref, label}` object, `end == start` for singles, never null | One Codable shape (judge 2) built from whole words (judge 1), and the label rides along so the chip and the trail read without lookups. |
| 7 | Which numbers a chip carries: `votes` + `votesIn` (judge 1) vs `votesOut`, `votesInEff`, `score` (judge 2) | `votesOut`, `votesIn` (raw), `score`, `weight`, `tier`; `votesEff` derivable from `viaRange.span` | The peek sheet needs the two raw numbers a human understands ("cited 178 / cites back 33") plus the one number that ordered the strip. |
| 8 | Scroll as a trail hop (P3, judge 1's `kind: scroll`) vs not pushed (P2, judge 2) | Scroll is not a hop; it updates the current hop's `scroll.anchor` in place. Kinds: open, jump, search, bookmarkOpen | A trail full of scroll entries stops reading as a path; the anchor still restores exactly where the reader was. |
| 9 | Distribution shape: 1,189 chapter files per translation (P1) vs 66 book shards (P2/P3) | 66 book shards for graph, incoming and text; chapter bundles are derived documents built from SQLite (and emitted as files for the prototype) | Snippets per translation in 1,189 pre-joined files made an NIV pack ~55 MB instead of ~1.7 MB gz. |
| 10 | On-device import of JSON (P1, P2) vs prebuilt SQLite in the app bundle (P3, both judges) | Prebuilt read-only asb.sqlite shipped in the bundle | Avoids a 20-60 s first-launch import of ~1.8 M rows. |
| 11 | AI cache key contents: `vid:translation:promptVersion` (P2) vs adding textVersion (judge 2) | `ai:verse:{vid}:{translation}:{textVersion}:{promptVersion}` and the edge equivalent, plus `inputHash` | A licensor revision changes the words the model read without changing the translation id. |
| 12 | AI `why` in the sample: mostly null (P1) vs populated | `why` on the top 3 chips of John 3:16, `aiStatus: not_generated` elsewhere | The founder should see the AI in the first file he opens; a silent null hides the feature. |
| 13 | Headings in the sample bundle (P1 and P3 invented BSB headings) | `headings: []` for BSB, with `Translation.headings: true/false` | BSB.json has no headings; inventing them would misrepresent the source. |
| 14 | Span cap and discount exposed in UI docs (P2) vs build-time only (judge 1) | Build-time constants in the manifest; chips expose only `viaRange {start, end, label, span}` | The peek sheet can say "points at John 3:15–16" without the reader meeting a square root. |
| 15 | Dataset facts: judge 2 cited 645 cross-chapter ranges, 244 spans over 40, max span 88; judge 1 relayed P1's 70 + 34 incoming split | Measured: 650 cross-chapter, 295 over 40 verses, max span 182; John 3:16 incoming = 53 direct + 51 via range | Numbers in this spec were recomputed from the source files; the earlier figures counted within-chapter spans only or were not measured. |

| 16 | Why is a verse connected? (founder, 2026-09-28) | Every connection carries a reason: direct quote, same story or same topic, with a one-line "because" | The founder asked that each served verse say which of the three it is. Rules over the BSB keep it free, deterministic and compliant with the NIV and YouVersion terms. |
| 17 | Ticker motion (founder) | Hold by default; opt-in auto-scroll at 3.0 + 3.0 x weight seconds per chip | "Better if it didn't automatically scroll, or at least slower." |
| 18 | Launch translation (founder) | NIV through the YouVersion Platform (version 111), fetched at runtime; BSB bundled as offline fallback and analysis text | Free, non-commercial NIV access with a Swift SDK. NIV text is never bundled, stored or indexed, so chips show references and reasons and the peek sheet fetches the whole verse. |
| 19 | Price and AI (founder) | Free forever; AI notes deferred, slots kept | YouVersion requires no ads or paid tiers, and written approval before readers see AI output. |
| 20 | Confidence on screen (founder) | Every chip and peek sheet shows a match percentage: 100% for the same words or the same account, lower for looser topical or word matches | "Each match should include a confidence match. 100% if it is literally talking about the exact same thing, slightly less if it's a looser topical or word match." |

## 7. Open questions for the founder

Answered on 2026-09-28: the launch translation (NIV through YouVersion), the ticker motion (hold, slower opt-in scroll), the reasons for a connection, the price (free) and AI notes (deferred). Still open, in order of impact:

1. Questions for YouVersion Support before the ticker ships: how many NIV verses may be on screen at once (a forum report says 25), whether a preview may show part of a verse, whether storing only references is fine, and whether it keeps the SDK's installation id (it decides the privacy label).
2. The name: "AI-Assisted Study Bible" with no AI output in v1 may draw an App Review question on accurate metadata, and it sits close to "Light - AI Study Bible". See docs/IOS_BUILD_PLAN.md.
3. Incoming references: merged into one strip with a direction glyph (current), or a separate "Who quotes this?" lane.
4. Ranking constants to confirm after using the prototype: 12 chips, 0.5 incoming factor, 1/sqrt(span) discount, 40-verse cap, tiers at 10 / 4.
5. Trail persistence and sharing: on-device (last 20 trails) or iCloud sync with shareable replay links.
6. An editorial overlay: hand-picked links or corrected reasons (source "editor") that override the rules where they are wrong.
