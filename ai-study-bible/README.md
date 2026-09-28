# AI-Assisted Study Bible

A free iPhone study Bible. The verse you are reading drives a strip of connected verses from across the whole Bible, and every connection says why it is there: a direct quote, the same story, or the same topic. Tap a chip to read the other verse. Tap Go to jump there. A trail remembers every hop, so you can spiderweb through Scripture and always find your way back.

This folder holds the data model, a working prototype built on it, and the plan to build the real app yourself with Claude.

## Start here

1. **Try the prototype.** It opens on John 3:16. The strip holds still; swipe it, or turn on Motion for a slow scroll. Use the filter to see only quotes, stories or topics. Tap a chip, then Go, then Web to see your trail. The `{ }` button shows the exact JSON behind the screen.
   - Published: https://claude.ai/artifact/7Yj2v8vmhHSaH2m18U9uav (private to your account until you share it)
   - Local: `python3 -m http.server 8765 --directory prototype`, then open http://localhost:8765
2. **Read the plan.** `docs/IOS_BUILD_PLAN.md` walks you through building the app with Claude Code, milestone by milestone, with the prompt to use at each step. `docs/LICENSING.md` covers the NIV path.
3. **Read the JSON.** `data/samples/chapters/John-3.json` is exactly what one reader screen needs: every verse with its top 12 connections, ranked, each with its reason.
4. **Working with Claude Code?** `CLAUDE.md` is the guide every session reads first: the decisions, the commands and the rules that keep the NIV license safe.

## Decisions (2026-09-28)

- **NIV at launch.** The NIV comes from the YouVersion Platform (Bible version 111), free for non-commercial apps, fetched at runtime through YouVersion's Swift SDK. NIV text is never bundled, stored or indexed, so the app keeps only verse references and fetches the words when you read.
- **Free.** No ads, in-app purchases, tips or paid tiers. YouVersion requires this.
- **Reasons on every connection.** Direct quote, same story, or same topic, each with a one-line "because" and a match percentage (100% = the same words or the same account).
- **The strip holds still.** Motion is off by default. When on, each chip stays 3 to 6 seconds.
- **AI notes later.** v1 shows no AI-generated text. YouVersion requires written approval before an app shows AI output, so start that conversation early.
- **Built by you with Claude.** No backend is needed for v1.

## What one connection looks like

The first chip on John 3:16, from `data/samples/chapters/John-3.json`:

```json
{
  "rank": 1,
  "to": { "start": 45005008, "end": 45005008, "ref": "Rom.5.8", "label": "Romans 5:8" },
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
    "source": "rule"
  }
}
```

John 3:16 cites Romans 5:8 and Romans 5:8 cites it back, so the direction is `both`. The vote counts come from OpenBible.info's crowd ranking. The reason says the two verses are linked by a shared theme, love, at a 65% match. Other chips read "Matthew 27:46 quotes Psalm 22:1" or "Another part of the same passage in John 3". The snippet is Berean Standard Bible preview text; in the app, the NIV verse appears when you tap.

## How the reasons work

`tools/reasons.py` applies plain rules to the public-domain Berean text, so no licensed text is ever processed:

- **Direct quote.** The two passages share distinctive wording, or a New Testament quotation reuses the Old Testament verse's words.
- **Same story.** The same account told twice (the Gospels, or Kings and Chronicles), another part of the same passage, or both passages tell of the same people.
- **Same topic.** Everything else, with the most distinctive shared words when there are any.

Every connection also shows a match percentage. 100% means the passages are literally the same thing: Psalm 22:1 quoted word for word in Matthew 27:46, or Matthew 13:5 and Mark 4:5 telling the same moment in the same words. Other parts of the same passage land around 75 to 95%, shared people around 65 to 85%, and topics never above 80%, with most between 35 and 50%. For topics, the percentage blends shared vocabulary with how strongly OpenBible.info readers voted for the link.

All 60 hand-labelled test pairs in `tests/gold_reasons.json` come out right. Hand checks of random samples put each rule at roughly 80 to 100 percent. Treat the reasons as a strong first pass that an editor or, with YouVersion's approval, an AI can refine later.

## What is in here

| Path | What it is |
|---|---|
| `CLAUDE.md` | The guide Claude Code reads first in every session |
| `docs/IOS_BUILD_PLAN.md` | How to build the iPhone app yourself with Claude Code |
| `docs/LICENSING.md` | NIV through YouVersion, Berean Standard Bible, OpenBible.info, AI and naming |
| `docs/DATA_MODEL.md` | The data model spec: entities, ranking, reasons, real JSON examples, decisions |
| `data/samples/` | Readable JSON for six chapters and five verses: chapter bundles, ticker feeds, full connection lists, a trail, the books index and the manifest |
| `schema/` | JSON Schemas for every document, generated by `tools/gen_schemas.py` |
| `prototype/` | The iPhone prototype, its data for all 66 books, a Playwright smoke test and screenshots |
| `tools/build_dataset.py` | Builds everything in `data/` and `prototype/data/` from the two public sources |
| `tools/reasons.py` | The connection reason rules |
| `tools/compile_sqlite.py` | Builds the database the app will ship |
| `tools/sync_spec.py`, `tools/validate.py` | Keep the spec's examples current and check JSON against the schemas |
| `tests/` | Regression tests, including the hand-labelled reasons |

## Rebuild from source

```bash
python3 tools/build_dataset.py            # downloads the sources on first run, then builds data/ and prototype/data/
python3 tools/sync_spec.py                # refreshes the example JSON in docs/DATA_MODEL.md
python3 tools/compile_sqlite.py           # builds data/full/asb.sqlite and prints its size and query timings
python3 -m unittest discover -s tests     # ranking, reasons, schemas and spec sync
python3 tools/validate.py data/samples prototype/data
```

`data/full/` (the complete distribution format) and `data/sources/` are rebuilt locally and are not committed.

## Key numbers

| Measure | Value |
|---|---|
| Verses | 31,102 |
| Cross references | 343,608 from OpenBible.info |
| Ranked connections across all verses | 840,072 |
| Reasons on the chips the strip shows | 3.3% direct quote, 9.5% same story, 87.2% same topic |
| On-device database | 57.7 MB with search |
| Chapter load from the database | about 2.5 ms for John 3 on a desktop |

## Attribution

Preview text: The Holy Bible, Berean Standard Bible, BSB is produced in cooperation with Bible Hub, Discovery Bible, OpenBible.com, and the Berean Bible Translation Committee. This text of God's Word has been dedicated to the public domain.

Cross references from OpenBible.info (https://www.openbible.info/labs/cross-references/), used under a Creative Commons Attribution license. Dataset dated 2016-02-01. Vote counts reflect OpenBible.info user voting. Ranking, range handling and connection reasons are our own.
