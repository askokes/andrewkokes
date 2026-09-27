# AI Study Bible

An iPhone-first study Bible where the verse you are reading drives a ticker of connected verses from across the whole Bible. Tap a chip to peek at the other verse. Tap Go to jump there. A trail remembers every hop, so you can spiderweb through Scripture and always find your way back. AI study notes explain why two verses connect.

This folder is the first draft: the JSON data model, a working prototype built on it, and the plan to ship the real app.

## Start here

1. **Try the prototype.** It opens on John 3:16 with the ticker running. Tap any chip, then Go, then Web to see your trail. The `{ }` button shows the exact JSON behind the screen.
   - Published: https://claude.ai/artifact/7Yj2v8vmhHSaH2m18U9uav (private to your account until you share it)
   - Local: `python3 -m http.server 8765 --directory prototype`, then open http://localhost:8765
2. **Read the JSON.** Open `data/samples/chapters/John-3.json`. Every verse carries its text and its top 12 connections, already ranked, with a preview snippet. That file is what one reader screen needs.
3. **Read the plan.** `docs/IOS_BUILD_PLAN.md` covers architecture, phases, effort, cost and the decisions you need to make. `docs/LICENSING.md` covers the NIV path.

## What one connection looks like

This is the first chip on John 3:16, straight from `data/samples/chapters/John-3.json`:

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
  "why": "Both verses ground God's love in an act, not a feeling: John says God gave His Son; Paul says Christ died for us while we were still sinners.",
  "aiStatus": "cached"
}
```

John 3:16 cites Romans 5:8 and Romans 5:8 cites it back, so the direction is `both`. The two vote counts come from OpenBible.info's crowd ranking. `weight` sets how bold the chip looks and how long it lingers in the ticker. John 3:16 has 110 connections in all; the ticker carries the top 12.

## What is in here

| Path | What it is |
|---|---|
| `docs/DATA_MODEL.md` | The data model spec: every entity, the ranking formula with a worked example, real JSON examples, and the decisions behind them |
| `docs/IOS_BUILD_PLAN.md` | How to build the real iPhone app: SwiftUI, on-device database, AI backend, phases, budget |
| `docs/LICENSING.md` | NIV, Berean Standard Bible, OpenBible.info and AI-content licensing, with a checklist |
| `data/samples/` | Founder-readable JSON for six chapters and five verses: chapter bundles, ticker feeds, full connection lists, a trail, an AI note, the books index and the manifest |
| `schema/` | JSON Schemas for every document type, plus `tools/validate.py` |
| `prototype/` | The iPhone prototype (`index.html`), its compact data for all 66 books, a Playwright smoke test and screenshots |
| `tools/build_dataset.py` | Builds everything in `data/` and `prototype/data/` from the two public sources |
| `tools/compile_sqlite.py` | Builds the on-device database the app will ship (44.7 MB with search) |
| `tests/` | Regression tests that pin the spec's worked examples |

## Rebuild from source

```bash
python3 tools/build_dataset.py            # downloads the sources on first run, then builds data/ and prototype/data/
python3 tools/compile_sqlite.py           # builds data/full/asb.sqlite and prints its size and query timings
python3 -m unittest discover -s tests     # checks the ranking still matches the spec
python3 tools/validate.py data/samples    # validates the sample JSON against the schemas
```

`data/full/` (the complete distribution format, about 110 MB) and `data/sources/` are rebuilt locally and are not committed.

## Key numbers

| Measure | Value |
|---|---|
| Verses | 31,102 (Berean Standard Bible) |
| Cross references | 343,608 from OpenBible.info |
| Ranked connections across all verses | 840,072 |
| Verses with no connections | 114 |
| On-device database | 44.7 MB with search, about 14 MB compressed |
| Chapter load from the database | about 2 ms for John 3 on a desktop |

## About the text and the AI notes

The prototype uses the Berean Standard Bible because it is public domain and reads close to the NIV. The NIV is owned by Biblica and needs a license. Biblica licenses finished apps, not prototypes, and allows streaming rather than offline storage. The data model is translation-agnostic, so the NIV drops in as a text layer without touching the cross-reference graph. See `docs/LICENSING.md`.

The AI notes in this draft are illustrative samples written during prototyping to show where AI context appears. They are not output of the production pipeline and have not been reviewed.

## Attribution

Scripture: The Holy Bible, Berean Standard Bible, BSB is produced in cooperation with Bible Hub, Discovery Bible, OpenBible.com, and the Berean Bible Translation Committee. This text of God's Word has been dedicated to the public domain.

Cross references from OpenBible.info (https://www.openbible.info/labs/cross-references/), used under a Creative Commons Attribution license. Dataset dated 2016-02-01. Vote counts reflect OpenBible.info user voting. Ranking and range handling are our own.
