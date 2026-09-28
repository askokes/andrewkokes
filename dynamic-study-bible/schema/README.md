# Schemas

JSON Schema (draft 2020-12) for every document in the Dynamic Study Bible data model. Each document names its own schema in a top-level `schema` field, and `tools/validate.py` picks the matching file.

| Document `schema` | File | What it describes |
|---|---|---|
| `asb.chapter/2` | `chapter-bundle.schema.json` | One chapter for the reader screen: text plus the top 12 ranked connections per verse |
| `asb.ticker/2` | `ticker-feed.schema.json` | The ticker strip for one focus verse, including the motion rules |
| `asb.connections/2` | `connections.schema.json` | The full "See all" list of connections for one verse |
| `asb.trail/2` | `trail.schema.json` | Spiderweb navigation: hops, back and forward, peeks, the visited web |
| `asb.ai/2` | `ai-context.schema.json` | An AI verse note and an AI connection note with provenance and cache rules |
| `asb.books/2` | `books.schema.json` | The 66-book index with verse counts |
| `asb.manifest/2` | `manifest.schema.json` | Versions, measured counts, ranking constants, sources, shard hashes |
| `asb.graph/2` | `graph-shard.schema.json` | Outgoing cross references for one source book |
| `asb.incoming/2` | `incoming-shard.schema.json` | Incoming citations for one target book |
| `asb.text/2` | `text-pack.schema.json` | One book of one translation |
| `asb.protoXref/2`, `asb.protoText/2`, `asb.protoAi/2` | `proto-*.schema.json` | The compact files the HTML prototype loads |

`common.schema.json` holds the shared types: verse ids, jump targets, the ticker item, counts, attribution.

Validate anything:

```bash
pip install jsonschema
python3 tools/validate.py data/samples prototype/data
python3 tools/validate.py data/full          # after python3 tools/build_dataset.py
```
