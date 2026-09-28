"""Source loaders for the Dynamic Study Bible dataset build.

Two upstream files, both fetched from public GitHub mirrors:

* Berean Standard Bible (BSB) text, public domain (CC0), via scrollmapper/bible_databases.
* OpenBible.info cross references (CC-BY, 2016-02-01), via the 2024 branch of the same repo.

This module only knows how to download and parse them. The data-model shaping lives in
build_dataset.py so the loaders can be reused if the text source changes (for example
NIV under license, or the CrossReferences.org phrase-anchored set).
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
CANON_PATH = HERE / "canon.json"

BSB_URL = "https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/BSB.json"
XREF_URL = "https://raw.githubusercontent.com/scrollmapper/bible_databases/2024/cross_references.txt"

# ---------------------------------------------------------------- canon

def load_canon() -> list[dict]:
    """66-book Protestant canon in order, with OSIS ids and per-chapter verse counts (from BSB)."""
    with open(CANON_PATH, encoding="utf-8") as f:
        return json.load(f)


CANON = load_canon()
BOOK_BY_ID = {b["id"]: b for b in CANON}          # "John" -> book dict
BOOK_BY_BSB_NAME = {b["bsbName"]: b for b in CANON}  # "Revelation of John" -> book dict
BOOK_ORDER = {b["id"]: b["order"] for b in CANON}


# ---------------------------------------------------------------- refs

_REF_RE = re.compile(r"^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)$")


@dataclass(frozen=True, order=True)
class Ref:
    """A single verse address. Sorts canonically (book order, chapter, verse)."""
    book_order: int
    chapter: int
    verse: int

    @property
    def book(self) -> str:
        return CANON[self.book_order - 1]["id"]

    @property
    def id(self) -> str:
        return f"{self.book}.{self.chapter}.{self.verse}"

    def display(self, style: str = "abbr") -> str:
        b = CANON[self.book_order - 1]
        name = b["abbr"] if style == "abbr" else b["name"]
        return f"{name} {self.chapter}:{self.verse}"


def parse_ref(s: str) -> Ref | None:
    """'John.3.16' -> Ref. Returns None for ids outside the canon (e.g. 3John.1.15 in BSB versification)."""
    m = _REF_RE.match(s)
    if not m:
        return None
    book, ch, vs = m.group(1), int(m.group(2)), int(m.group(3))
    b = BOOK_BY_ID.get(book)
    if b is None:
        return None
    if ch < 1 or ch > b["chapters"]:
        return None
    if vs < 1 or vs > b["verseCounts"][ch - 1]:
        return None
    return Ref(b["order"], ch, vs)


def parse_range(s: str) -> tuple[Ref, Ref] | None:
    """'1John.4.9-1John.4.10' -> (start, end). A single id yields (ref, ref)."""
    if "-" in s:
        a, b = s.split("-", 1)
        ra, rb = parse_ref(a), parse_ref(b)
        if ra is None or rb is None or rb < ra:
            return None
        return ra, rb
    r = parse_ref(s)
    return (r, r) if r else None


def expand_range(start: Ref, end: Ref) -> list[Ref]:
    """All verse refs from start to end inclusive, walking across chapter boundaries."""
    out: list[Ref] = []
    b = CANON[start.book_order - 1]
    ch, vs = start.chapter, start.verse
    while True:
        r = Ref(start.book_order, ch, vs)
        out.append(r)
        if r == end or len(out) > 500:
            break
        if vs < b["verseCounts"][ch - 1]:
            vs += 1
        else:
            ch += 1
            vs = 1
            if ch > b["chapters"]:
                break
    return out


def display_range(start: Ref, end: Ref, style: str = "abbr") -> str:
    """Human label: 'Rom 5:8', '1 John 4:9-10', 'Ps 22:1-23:2'."""
    if start == end:
        return start.display(style)
    if start.chapter == end.chapter:
        return f"{start.display(style)}-{end.verse}"
    return f"{start.display(style)}-{end.chapter}:{end.verse}"


# ---------------------------------------------------------------- downloads

def _fetch(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    print(f"downloading {url} -> {dest}", file=sys.stderr)
    with urllib.request.urlopen(url, timeout=120) as r, open(dest, "wb") as f:
        f.write(r.read())
    return dest


def ensure_sources(src_dir: Path) -> tuple[Path, Path]:
    """Return (bsb_json_path, xref_txt_path), downloading if missing."""
    return _fetch(BSB_URL, src_dir / "BSB.json"), _fetch(XREF_URL, src_dir / "cross_references.txt")


# ---------------------------------------------------------------- loaders

def load_bsb(path: Path) -> dict[str, str]:
    """{'John.3.16': 'For God so loved...'} for all 31,102 verses. Empty text = verse omitted in this text."""
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    text: dict[str, str] = {}
    for book in d["books"]:
        b = BOOK_BY_BSB_NAME[book["name"]]
        for ch in book["chapters"]:
            for v in ch["verses"]:
                text[f"{b['id']}.{ch['chapter']}.{v['verse']}"] = v["text"].strip()
    return text


@dataclass(frozen=True)
class Edge:
    src: Ref
    start: Ref
    end: Ref
    votes: int

    @property
    def target_id(self) -> str:
        return self.start.id if self.start == self.end else f"{self.start.id}-{self.end.id}"


def load_edges(path: Path) -> tuple[list[Edge], list[str]]:
    """Parse the OpenBible tab file. Returns (edges, skipped_lines)."""
    edges: list[Edge] = []
    skipped: list[str] = []
    with open(path, encoding="utf-8") as f:
        next(f)  # header
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3:
                continue
            src = parse_ref(parts[0])
            rng = parse_range(parts[1])
            if src is None or rng is None:
                skipped.append(line.strip())
                continue
            edges.append(Edge(src, rng[0], rng[1], int(parts[2])))
    return edges, skipped


if __name__ == "__main__":
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE.parent / "data" / "sources"
    bsb, xref = ensure_sources(src)
    text = load_bsb(bsb)
    edges, skipped = load_edges(xref)
    print(f"verses={len(text)} edges={len(edges)} skipped={len(skipped)} {skipped[:3]}")
    print(parse_ref("John.3.16").display("name"), "->", display_range(*parse_range("1John.4.9-1John.4.10")))
