#!/usr/bin/env python3
"""Validate AI Study Bible JSON documents against the schemas in schema/.

The schema is picked from each document's top-level "schema" string (asb.chapter/2 -> chapter-bundle.schema.json).
Usage: python3 tools/validate.py <file-or-dir> [more ...]     (directories are walked for *.json)
Needs the `jsonschema` package (pip install jsonschema).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

SCHEMA_DIR = Path(__file__).resolve().parent.parent / "schema"
BY_TYPE = {
    "asb.chapter/2": "chapter-bundle", "asb.ticker/2": "ticker-feed", "asb.connections/2": "connections",
    "asb.trail/2": "trail", "asb.ai/2": "ai-context", "asb.books/2": "books", "asb.manifest/2": "manifest",
    "asb.graph/2": "graph-shard", "asb.incoming/2": "incoming-shard", "asb.text/2": "text-pack",
    "asb.protoXref/2": "proto-xref", "asb.protoText/2": "proto-text", "asb.protoAi/2": "proto-ai",
}


def load_validators() -> dict[str, Draft202012Validator]:
    schemas = {p.name: json.loads(p.read_text(encoding="utf-8")) for p in SCHEMA_DIR.glob("*.schema.json")}
    registry = Registry().with_resources((s["$id"], Resource.from_contents(s)) for s in schemas.values())
    out = {}
    for doc_type, stem in BY_TYPE.items():
        schema = schemas[f"{stem}.schema.json"]
        Draft202012Validator.check_schema(schema)
        out[doc_type] = Draft202012Validator(schema, registry=registry)
    return out


def iter_files(args: list[str]):
    for a in args:
        p = Path(a)
        if p.is_dir():
            yield from sorted(x for x in p.rglob("*.json") if not x.name.endswith(".schema.json"))
        else:
            yield p


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    validators = load_validators()
    failed = checked = skipped = 0
    for path in iter_files(argv):
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            print(f"FAIL {path}: cannot read JSON ({e})")
            failed += 1
            continue
        doc_type = doc.get("schema") if isinstance(doc, dict) else None
        if doc_type not in validators:
            print(f"skip {path}: no schema for {doc_type!r}")
            skipped += 1
            continue
        checked += 1
        errors = sorted(validators[doc_type].iter_errors(doc), key=lambda e: list(e.absolute_path))
        if errors:
            failed += 1
            print(f"FAIL {path} ({doc_type}): {len(errors)} error(s)")
            for e in errors[:3]:
                where = "/".join(str(x) for x in e.absolute_path) or "(root)"
                print(f"     at {where}: {e.message[:200]}")
        else:
            print(f"ok   {path} ({doc_type})")
    print(f"\n{checked} checked, {failed} failed, {skipped} skipped")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
