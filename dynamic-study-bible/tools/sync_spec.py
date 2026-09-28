#!/usr/bin/env python3
"""Refresh the example JSON blocks in docs/DATA_MODEL.md section 4 from data/samples/.

The spec's examples are real build output, not hand-written JSON. Run this after
python3 tools/build_dataset.py whenever a document shape or the data changes:

    python3 tools/sync_spec.py            # rewrite the blocks in place
    python3 tools/sync_spec.py --check    # exit 1 if the spec is out of date (used by the tests)

Blocks refreshed: 4.1 chapter bundle (John 3, verses 15 to 17), 4.2 ticker feed (John 3:16),
4.3 trail, 4.5 books (John and Psalm), 4.6 manifest (shard list trimmed). 4.4, the AI context
example, is a hand-written shape reference while AI notes are deferred, so it is left alone.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / "docs" / "DATA_MODEL.md"
SAMPLES = ROOT / "data" / "samples"
HEADING = re.compile(r"^### (4\.\d)", re.M)


def dumps(doc) -> str:
    text = json.dumps(doc, ensure_ascii=False, indent=2)
    # keep long integer arrays (verse counts) on one line
    return re.sub(r"\[\n\s+(\d+(?:,\n\s+\d+)*)\n\s+\]",
                  lambda m: "[" + ", ".join(x.strip() for x in m.group(1).split(",")) + "]", text)


def load(name: str):
    return json.loads((SAMPLES / name).read_text(encoding="utf-8"))


def blocks() -> dict[str, dict]:
    chapter = load("chapters/John-3.json")
    chapter["verses"] = [v for v in chapter["verses"] if 15 <= v["verse"] <= 17]
    chapter["_note"] = ("Sample trimmed to verses 15-17 of 36 (from data/samples/chapters/John-3.json); the real "
                        "file carries every verse with the same shape. headings is empty because the BSB source "
                        "has none. why and aiStatus stay empty while AI notes are deferred.")
    books = load("books.json")
    books["books"] = [b for b in books["books"] if b["osis"] in ("John", "Ps")][::-1]
    books["_note"] = ("Two of 66 entries shown (from data/samples/books.json). name is the singular display form "
                      "used in labels ('Psalm 2:7'); sourceName is the BSB.json book name; osis is the OpenBible key.")
    manifest = load("manifest.json")
    total = len(manifest["shards"])
    manifest["shards"] = [s for s in manifest["shards"] if s["path"] in
                          ("books.json", "graph/43-John.json", "incoming/43-John.json", "text/bsb/43-John.json")]
    manifest["_note"] = f"Real manifest from data/samples/manifest.json with the shard list trimmed to 4 of {total} entries."
    return {"4.1": chapter, "4.2": load("ticker/John-3-16.json"), "4.3": load("trail.json"), "4.5": books,
            "4.6": manifest}


def main() -> int:
    spec = SPEC.read_text(encoding="utf-8")
    fresh = blocks()
    seen = set()

    updated, pos = [], 0
    for h in HEADING.finditer(spec):
        key = h.group(1)
        if key not in fresh:
            continue
        start = spec.find("```json\n", h.end())
        nxt = HEADING.search(spec, h.end())
        if start < 0 or (nxt and start > nxt.start()):
            continue
        body_start = start + len("```json\n")
        body_end = spec.find("\n```", body_start)
        updated.append(spec[pos:body_start] + dumps(fresh[key]))
        pos = body_end
        seen.add(key)
    updated = "".join(updated) + spec[pos:]
    missing = set(fresh) - seen
    if missing:
        print(f"spec has no JSON block under section(s) {sorted(missing)}", file=sys.stderr)
        return 2
    if "--check" in sys.argv:
        if updated != spec:
            print("docs/DATA_MODEL.md section 4 is out of date; run python3 tools/sync_spec.py", file=sys.stderr)
            return 1
        print("spec examples match data/samples")
        return 0
    SPEC.write_text(updated, encoding="utf-8")
    print(f"refreshed section 4 blocks: {', '.join(sorted(seen))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
