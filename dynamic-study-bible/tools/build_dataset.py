#!/usr/bin/env python3
"""Build the Dynamic Study Bible dataset from public sources.

Inputs (downloaded on first run into data/sources/, gitignored):
  * Berean Standard Bible text (public domain, CC0), scrollmapper/bible_databases BSB.json
  * OpenBible.info cross references (CC-BY, 2016-02-01), scrollmapper/bible_databases cross_references.txt

Outputs:
  data/full/        the complete distribution format from docs/DATA_MODEL.md (gitignored, ~150 MB):
                    books.json, manifest.json, graph/*.json, incoming/*.json, text/bsb/*.json,
                    and with --bundles, bundles/bsb/{book}/{chapter}.json for all 1,189 chapters
  data/samples/     spec-shaped documents for a handful of chapters and verses (committed, founder-readable)
  prototype/data/   compact transport files the HTML prototype loads (committed)

Ranking is asb.rank.v2 exactly as specified in docs/DATA_MODEL.md section 3.

Usage:
  python3 tools/build_dataset.py            # full + samples + prototype data
  python3 tools/build_dataset.py --bundles  # also write every chapter bundle to data/full/bundles
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import gzip
import hashlib
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from sources import ensure_sources  # noqa: E402
from reasons import ReasonModel  # noqa: E402

# ------------------------------------------------------------------ constants (all mirrored into manifest.ranking)
DATASET_VERSION = "2026.09.1"
RANKING_VERSION = "asb.rank.v2"
INCOMING_FACTOR = 0.5
SPAN_CAP = 40
TIER_STRONG = 10
TIER_SOLID = 4
TICKER_INLINE = 12
PROTO_CHIPS = 40             # the prototype carries the top 40 per verse so the Match slider has room to filter,
PROTO_TAIL_MIN = 0.6         # plus every lower-ranked connection matching at 60% or better, so high settings are exact
MATCH_BUCKETS = 20           # counts.byMatch: connections per 5-point band of match percentage
SNIPPET_MAX = 110
MOTION_DEFAULT = "hold"      # the strip holds on the focus verse; auto-scroll is opt-in
DWELL_BASE = 3.0             # seconds per chip when auto-scroll is on: 3.0 + 3.0 * weight (3 to 6 s)
DWELL_PER_WEIGHT = 3.0
REASONS_VERSION = "asb.reasons.v1"
REASON_KINDS = ["quote", "story", "topic"]
REASON_BASES = ["sharedWording", "quotation", "parallelAccount", "retelling", "samePassage", "sharedNames", "theme"]
AI_PROMPT_VERSIONS = {"verse-context": "v3", "edge-why": "v2"}

TRANSLATION = {
    "id": "bsb",
    "name": "Berean Standard Bible",
    "abbr": "BSB",
    "textVersion": "bsb-2023",
    "license": "Public domain (CC0), BSB Publishing 2023",
    "copyrightNotice": (
        "The Holy Bible, Berean Standard Bible, BSB is produced in cooperation with Bible Hub, Discovery Bible, "
        "OpenBible.com, and the Berean Bible Translation Committee. This text of God's Word has been dedicated "
        "to the public domain."
    ),
}
ATTRIBUTION = {
    "text": "Berean Standard Bible, public domain",
    "crossReferences": "Cross references from OpenBible.info, CC-BY (2016-02-01)",
    "ai": "No AI-generated content in this version. Connection reasons are computed by rules from the public-domain text.",
}
OPENBIBLE_ABOUT = (
    "Cross references from OpenBible.info (https://www.openbible.info/labs/cross-references/), used under a "
    "Creative Commons Attribution license. Dataset dated 2016-02-01. Vote counts reflect OpenBible.info user "
    "voting. Ranking, range handling and connection reasons are our own."
)
ATTRIBUTION_LINE = "Cross references from OpenBible.info, CC-BY (2016-02-01). Text: Berean Standard Bible, public domain."

ANNOTATION_KINDS = ["highlight", "bookmark", "note", "tag"]
ANNOTATION_PALETTE = [
    {"id": "yellow", "label": "Yellow", "hex": "#ffe27a"},
    {"id": "green", "label": "Green", "hex": "#b8e6a0"},
    {"id": "blue", "label": "Blue", "hex": "#a9d3f5"},
    {"id": "pink", "label": "Pink", "hex": "#f6b8d1"},
    {"id": "orange", "label": "Orange", "hex": "#ffc98a"},
]
ANNOTATION_RULES = {
    "anchor": "Verse ids plus optional word positions. word counts whitespace-separated words of the anchor's "
              "translation from 0, inclusive at both ends; null means the whole verse. of is the verse's word "
              "count when saved: if the text now has a different count, the mark covers the whole verse.",
    "otherTranslation": "A partial mark shown in another translation widens to whole verses.",
    "bookmark": "Whole verses only.",
    "neverStores": "NIV words. Marks hold verse ids and word positions; a note holds only what the reader types, "
                   "and the app never pastes verse text into it.",
    "youversionSync": "Optional, after Sign in with YouVersion with the highlights permission. Only whole-verse NIV "
                      "highlights sync, one passage per verse, colour as hex. Everything else stays on device and in "
                      "the reader's iCloud.",
    "persist": "SwiftData on device, synced through the reader's private iCloud database. No server of ours.",
}

DIRECTIONS = ["out", "in", "both"]
TIERS = ["strong", "solid", "light"]

# ------------------------------------------------------------------ canon

CANON = json.loads((HERE / "canon.json").read_text(encoding="utf-8"))
BOOK_NO = {b["id"]: b["order"] for b in CANON}
BOOK = {b["order"]: b for b in CANON}


def vid_of(book_no: int, ch: int, v: int) -> int:
    return book_no * 1_000_000 + ch * 1_000 + v


def split_vid(vid: int) -> tuple[int, int, int]:
    return vid // 1_000_000, (vid // 1_000) % 1_000, vid % 1_000


def ref_of(start: int, end: int | None = None) -> str:
    def one(x: int) -> str:
        b, c, v = split_vid(x)
        return f"{BOOK[b]['id']}.{c}.{v}"
    if end is None or end == start:
        return one(start)
    return f"{one(start)}-{one(end)}"


def label_of(start: int, end: int | None = None) -> str:
    """'Romans 5:8', '1 John 4:9–10', 'Isaiah 52:13–53:12', '2 John 1:1–3 John 1:14' (en dash)."""
    b, c, v = split_vid(start)
    name = BOOK[b]["displayName"]
    if end is None or end == start:
        return f"{name} {c}:{v}"
    b2, c2, v2 = split_vid(end)
    if b2 != b:
        return f"{name} {c}:{v}–{BOOK[b2]['displayName']} {c2}:{v2}"
    if c2 != c:
        return f"{name} {c}:{v}–{c2}:{v2}"
    return f"{name} {c}:{v}–{v2}"


# ------------------------------------------------------------------ load

class Dataset:
    def __init__(self, bsb_path: Path, xref_path: Path):
        self.text: dict[int, str] = {}
        self.ordlist: list[int] = []
        self.ordinal: dict[int, int] = {}
        self._load_text(bsb_path)
        self.stats: dict = {}
        self.out: dict[int, list[tuple[int, int, int]]] = collections.defaultdict(list)
        self.inc: dict[int, list[tuple[int, int, int, int, int, float]]] = collections.defaultdict(list)
        self.edges: list[tuple[int, int, int, int]] = []
        self._load_edges(xref_path)

    def _load_text(self, path: Path) -> None:
        data = json.loads(path.read_text(encoding="utf-8"))
        by_bsb = {b["bsbName"]: b for b in CANON}
        for book in data["books"]:
            bn = by_bsb[book["name"]]["order"]
            for ch in book["chapters"]:
                for v in ch["verses"]:
                    vid = vid_of(bn, ch["chapter"], v["verse"])
                    self.text[vid] = v["text"].strip()
                    self.ordinal[vid] = len(self.ordlist)
                    self.ordlist.append(vid)
        assert len(self.ordlist) == 31102, len(self.ordlist)

    def _parse(self, s: str) -> int | None:
        parts = s.split(".")
        if len(parts) != 3 or parts[0] not in BOOK_NO:
            return None
        return vid_of(BOOK_NO[parts[0]], int(parts[1]), int(parts[2]))

    def _fix(self, vid: int | None) -> int | None:
        """Verses outside BSB versification clamp to the last verse of their chapter (3 John 1:15 -> 1:14)."""
        if vid is None or vid in self.ordinal:
            return vid
        b, c, _ = split_vid(vid)
        if b not in BOOK or c < 1 or c > BOOK[b]["chapters"]:
            return None
        return vid_of(b, c, BOOK[b]["verseCounts"][c - 1])

    def _load_edges(self, path: Path) -> None:
        dropped = clamped = 0
        with open(path, encoding="utf-8") as f:
            next(f)
            for line in f:
                parts = line.rstrip("\n").split("\t")
                if len(parts) < 3:
                    continue
                src, tgt, votes = parts[0], parts[1], max(1, int(parts[2]))
                a, b = tgt.split("-", 1) if "-" in tgt else (tgt, tgt)
                f0, ts0, te0 = self._parse(src), self._parse(a), self._parse(b)
                f1, ts1, te1 = self._fix(f0), self._fix(ts0), self._fix(te0)
                if None in (f1, ts1, te1) or f1 != f0 or self.ordinal[te1] < self.ordinal[ts1]:
                    dropped += 1
                    continue
                if (ts1, te1) != (ts0, te0):
                    clamped += 1
                self.edges.append((f1, ts1, te1, votes))
                self.out[f1].append((ts1, te1, votes))
        skipped_long = 0
        for f1, ts, te, votes in self.edges:
            n = self.span(ts, te)
            if n > SPAN_CAP:
                skipped_long += 1
                continue
            eff = votes / math.sqrt(n)
            for o in range(self.ordinal[ts], self.ordinal[te] + 1):
                self.inc[self.ordlist[o]].append((f1, ts, te, n, votes, eff))
        ranges = [(ts, te) for _, ts, te, _ in self.edges if ts != te]
        spans = [self.span(ts, te) for ts, te in ranges]
        votes = sorted(e[3] for e in self.edges)
        self.stats = {
            "edges": len(self.edges),
            "edgesDroppedForMissingVerse": dropped,
            "edgesClampedToBsbVersification": clamped,
            "rangeTargets": len(ranges),
            "crossChapterRanges": sum(1 for ts, te in ranges if ts // 1000 != te // 1000),
            "crossBookRanges": sum(1 for ts, te in ranges if ts // 1_000_000 != te // 1_000_000),
            "rangesOver40Verses": skipped_long,
            "maxSpan": max(spans),
            "incomingRows": sum(len(x) for x in self.inc.values()),
            "votes": {"min": votes[0], "median": votes[len(votes) // 2], "p90": votes[int(len(votes) * 0.9)],
                      "p99": votes[int(len(votes) * 0.99)], "max": votes[-1]},
        }

    def span(self, ts: int, te: int) -> int:
        return self.ordinal[te] - self.ordinal[ts] + 1

    # -------------------------------------------------------------- text helpers

    def snippet(self, start: int, end: int | None = None) -> str:
        end = end or start
        t = self.text.get(start, "")
        if not t and end != start:
            for o in range(self.ordinal[start] + 1, self.ordinal[end] + 1):
                t = self.text[self.ordlist[o]]
                if t:
                    break
        if len(t) <= SNIPPET_MAX:
            return t
        cut = t[:SNIPPET_MAX].rsplit(" ", 1)[0]
        return cut.rstrip(",;:") + "…"

    # -------------------------------------------------------------- ranking (asb.rank.v2)

    def merged(self, vid: int) -> list[dict]:
        items: dict[int, dict] = {}
        also: dict[int, list] = collections.defaultdict(list)
        for ts, te, v in sorted(self.out.get(vid, []), key=lambda e: -e[2]):
            if ts in items:
                also[ts].append({"ref": ref_of(ts, te), "label": label_of(ts, te), "votes": v})
                continue
            items[ts] = {"start": ts, "end": te, "votesOut": v, "votesIn": 0, "eff": 0.0, "via": None}
        for f, ts, te, n, v, eff in self.inc.get(vid, []):
            it = items.setdefault(f, {"start": f, "end": f, "votesOut": 0, "votesIn": 0, "eff": 0.0, "via": None})
            it["votesIn"] += v
            it["eff"] += eff
            if n > 1 and it["via"] is None:
                it["via"] = {"start": ts, "end": te, "label": label_of(ts, te), "span": n}
        lst = []
        for k, it in items.items():
            it["score"] = round(it["votesOut"] + INCOMING_FACTOR * it["eff"], 2)
            it["direction"] = "both" if it["votesOut"] and it["votesIn"] else ("out" if it["votesOut"] else "in")
            it["alsoCites"] = also.get(k, [])
            lst.append(it)
        lst.sort(key=lambda it: (-it["score"], 0 if it["direction"] != "in" else 1, it["start"]))
        mx = lst[0]["score"] if lst else 0
        for i, it in enumerate(lst):
            it["rank"] = i + 1
            it["weight"] = round(math.log(1 + it["score"]) / math.log(1 + mx), 3) if mx > 0 else 0.0
            s = it["score"]
            it["tier"] = "strong" if s >= TIER_STRONG else ("solid" if s >= TIER_SOLID else "light")
            it["sameBook"] = it["start"] // 1_000_000 == vid // 1_000_000
        return lst

    def counts(self, vid: int, merged: list[dict]) -> dict:
        inc = self.inc.get(vid, [])
        shown = min(TICKER_INLINE, len(merged))
        return {"out": len(self.out.get(vid, [])), "in": len(inc), "inDirect": sum(1 for x in inc if x[3] == 1),
                "inViaRange": sum(1 for x in inc if x[3] > 1), "unique": len(merged), "shown": shown,
                "more": len(merged) - shown}


# ------------------------------------------------------------------ document builders

def match_histogram(confidences) -> list[int]:
    """Connections per 5-point band of match percentage: bucket i holds [5i%, 5i+5%), 100% goes in the last."""
    h = [0] * MATCH_BUCKETS
    for c in confidences:
        h[min(MATCH_BUCKETS - 1, int(round(c * 100)) // 5)] += 1
    return h


def ai_key(frm: int, start: int, end: int) -> str:
    return f"{frm}>{start}" if start == end else f"{frm}>{start}-{end}"


class Builder:
    def __init__(self, ds: Dataset, ai: dict, reasons: ReasonModel):
        self.ds = ds
        self.reasons = reasons
        self.ai_edges: dict[str, str] = ai.get("edges", {})
        self.ai_verses: dict[str, dict] = ai.get("verses", {})
        self._merged_cache: dict[int, list[dict]] = {}

    def merged(self, vid: int) -> list[dict]:
        if vid not in self._merged_cache:
            self._merged_cache[vid] = self.ds.merged(vid)
        return self._merged_cache[vid]

    def reason(self, vid: int, it: dict) -> dict:
        if "reason" not in it:
            it["reason"] = self.reasons.classify(vid, it["start"], it["end"], it["score"])
        return it["reason"]

    def ticker_item(self, vid: int, it: dict, kind: str = "bundle") -> dict:
        d = {
            "rank": it["rank"],
            "to": {"start": it["start"], "end": it["end"], "ref": ref_of(it["start"], it["end"]),
                   "label": label_of(it["start"], it["end"])},
            "direction": it["direction"],
            "votesOut": it["votesOut"],
            "votesIn": it["votesIn"],
            "score": it["score"],
            "weight": it["weight"],
            "tier": it["tier"],
            "sameBook": it["sameBook"],
            "viaRange": it["via"],
            "snippet": self.ds.snippet(it["start"], it["end"]),
            "reason": self.reason(vid, it),
        }
        if kind in ("bundle", "feed"):
            why = self.ai_edges.get(ai_key(vid, it["start"], it["end"]))
            d["why"] = why
            d["aiStatus"] = "cached" if why else "not_generated"
        if kind == "feed":
            d["dwellSeconds"] = round(DWELL_BASE + DWELL_PER_WEIGHT * it["weight"], 2)
        if kind == "connections":
            d["alsoCites"] = it["alsoCites"]
        return d

    def verse_doc(self, vid: int) -> dict:
        b, c, v = split_vid(vid)
        merged = self.merged(vid)
        text = self.ds.text[vid]
        return {
            "vid": vid, "verse": v, "ref": ref_of(vid), "label": label_of(vid), "text": text,
            "omitted": text == "", "paragraphStart": v == 1,
            "counts": {**self.ds.counts(vid, merged),
                       "byMatch": match_histogram(self.reason(vid, it)["confidence"] for it in merged)},
            "ticker": [self.ticker_item(vid, it) for it in merged[:TICKER_INLINE]],
            "connections": f"connections/{vid}.json",
            "ai": {"verse": f"ai:verse:{vid}:bsb:bsb-2023:{AI_PROMPT_VERSIONS['verse-context']}",
                   "status": "cached" if str(vid) in self.ai_verses else "not_generated"},
        }

    def chapter_bundle(self, book_no: int, ch: int) -> dict:
        bk = BOOK[book_no]
        n = bk["verseCounts"][ch - 1]
        cid = vid_of(book_no, ch, 0)
        prev_c = vid_of(book_no, ch - 1, 0) if ch > 1 else (vid_of(book_no - 1, BOOK[book_no - 1]["chapters"], 0) if book_no > 1 else None)
        next_c = vid_of(book_no, ch + 1, 0) if ch < bk["chapters"] else (vid_of(book_no + 1, 1, 0) if book_no < 66 else None)
        return {
            "schema": "asb.chapter/2", "datasetVersion": DATASET_VERSION, "rankingVersion": RANKING_VERSION,
            "translation": TRANSLATION,
            "book": {"bookNo": book_no, "osis": bk["id"], "name": bk["displayName"], "short": bk["short"]},
            "chapter": ch, "chapterId": cid, "verseCount": n, "prevChapter": prev_c, "nextChapter": next_c,
            "headings": [], "tickerInline": TICKER_INLINE,
            "verses": [self.verse_doc(vid_of(book_no, ch, v)) for v in range(1, n + 1)],
            "attribution": ATTRIBUTION,
        }

    def ticker_feed(self, vid: int) -> dict:
        merged = self.merged(vid)
        c = self.ds.counts(vid, merged)
        return {
            "schema": "asb.ticker/2", "rankingVersion": RANKING_VERSION, "translation": "bsb",
            "focus": {"vid": vid, "ref": ref_of(vid), "label": label_of(vid)},
            "counts": {k: c[k] for k in ("out", "in", "unique", "shown", "more")},
            "order": "score desc; out/both before in-only; then canonical order (start vid asc)",
            "motion": {"mode": MOTION_DEFAULT, "loop": True, "baseSeconds": DWELL_BASE,
                       "perWeightSeconds": DWELL_PER_WEIGHT,
                       "dwellFormula": f"dwellSeconds = {DWELL_BASE} + {DWELL_PER_WEIGHT} * weight",
                       "advanceOnFocusChange": True},
            "items": [self.ticker_item(vid, it, "feed") for it in merged[:TICKER_INLINE]],
            "attribution": ATTRIBUTION_LINE,
        }

    def connections(self, vid: int) -> dict:
        merged = self.merged(vid)
        c = self.ds.counts(vid, merged)
        return {
            "schema": "asb.connections/2", "datasetVersion": DATASET_VERSION, "rankingVersion": RANKING_VERSION,
            "translation": "bsb", "vid": vid, "ref": ref_of(vid), "label": label_of(vid),
            "counts": {k: c[k] for k in ("out", "in", "inDirect", "inViaRange", "unique")},
            "items": [self.ticker_item(vid, it, "connections") for it in merged],
        }

    # -------------------------------------------------------------- trail sample (real edges)

    def trail_sample(self) -> dict:
        def chip(frm: int, target_start: int) -> dict:
            for it in self.merged(frm):
                if it["start"] == target_start:
                    return it
            raise KeyError((frm, target_start))

        def target(it: dict) -> dict:
            return {"start": it["start"], "end": it["end"], "ref": ref_of(it["start"], it["end"]),
                    "label": label_of(it["start"], it["end"])}

        def hop(i: int, kind: str, vid: int, via: dict | None, at: str) -> dict:
            b, _, _ = split_vid(vid)
            return {"index": i, "kind": kind, "vid": vid, "ref": ref_of(vid), "label": label_of(vid),
                    "book": BOOK[b]["displayName"], "via": via,
                    "scroll": {"chapter": vid // 1000 * 1000, "anchor": vid, "highlight": None}, "at": at}

        def via(frm: int, it: dict) -> dict:
            return {"from": {"vid": frm, "ref": ref_of(frm), "label": label_of(frm)}, "to": target(it),
                    "direction": it["direction"], "votesOut": it["votesOut"], "votesIn": it["votesIn"],
                    "score": it["score"], "rank": it["rank"]}

        j316, r58, j1316, r56 = 43003016, 45005008, 62003016, 45005006
        a, b = chip(j316, r58), chip(r58, j1316)
        p1, p2 = chip(r58, r56), chip(j1316, j316)
        return {
            "schema": "asb.trail/2", "id": "trail_2026-09-27T14:02:11Z_a8f3", "translation": "bsb", "cursor": 2,
            "hops": [hop(0, "open", j316, None, "2026-09-27T14:02:11Z"),
                     hop(1, "jump", r58, via(j316, a), "2026-09-27T14:03:40Z"),
                     hop(2, "jump", j1316, via(r58, b), "2026-09-27T14:05:02Z")],
            "forward": [],
            "peeks": [{"fromHop": 1, "to": target(p1), "votesOut": p1["votesOut"], "at": "2026-09-27T14:04:10Z", "jumped": False},
                      {"fromHop": 2, "to": target(p2), "votesOut": p2["votesOut"], "at": "2026-09-27T14:05:40Z", "jumped": False}],
            "peek": {"open": True, "fromHop": 2, "to": target(p2), "direction": p2["direction"],
                     "votesOut": p2["votesOut"], "snippet": self.ds.text[j316],
                     "note": "a peek does not push a hop until the reader taps Go"},
            "web": {"nodes": [j316, r58, j1316],
                    "edges": [[j316, r58, a["votesOut"]], [r58, j1316, b["votesOut"]], [j1316, j316, p2["votesOut"]]],
                    "peekOnlyEdges": [[j1316, j316]], "booksTouched": ["John", "Romans", "1 John"], "loopClosed": True},
            "rules": {"pushOn": ["open", "jump", "search", "bookmarkOpen"],
                      "notPushed": ["scroll", "peek", "back", "forward"], "scrollUpdatesCurrentHop": True,
                      "maxHops": 200, "persist": "SwiftData; active trail restored on relaunch; last 20 trails kept"},
        }


    # -------------------------------------------------------------- annotations sample (the reader's own marks)

    def annotations_sample(self) -> dict:
        def point(vid: int, word: int | None, translation: str) -> dict:
            words = len(self.ds.text[vid].split()) if word is not None and translation == "bsb" else None
            return {"vid": vid, "word": word, "of": words}

        def anchor(start: int, end: int | None = None, words: tuple[int, int] | None = None,
                   translation: str = "niv") -> dict:
            end = end or start
            w0, w1 = words if words else (None, None)
            return {"translation": translation, "start": point(start, w0, translation),
                    "end": point(end, w1, translation), "ref": ref_of(start, end), "label": label_of(start, end),
                    "partial": words is not None}

        def ann(i: int, kind: str, a: dict, at: str, color=None, body=None, tags=(), yv="notEligible") -> dict:
            return {"id": f"ann_{i:02d}", "kind": kind, "anchor": a, "color": color, "body": body,
                    "tags": list(tags), "createdAt": at, "updatedAt": at, "sync": {"icloud": True, "youversion": yv}}

        j316, j317, r58, j1316, ps231 = 43003016, 43003017, 45005008, 62003016, 19023001
        return {
            "schema": "asb.annotations/1",
            "palette": ANNOTATION_PALETTE,
            "tags": [{"id": "love", "name": "love", "createdAt": "2026-09-27T14:06:30Z"},
                     {"id": "grace", "name": "grace", "createdAt": "2026-09-27T14:07:12Z"}],
            "items": [
                ann(1, "highlight", anchor(j316), "2026-09-27T14:02:30Z", color="yellow", yv="synced"),
                ann(2, "highlight", anchor(r58, words=(0, 8), translation="bsb"), "2026-09-27T14:03:55Z", color="blue"),
                ann(3, "bookmark", anchor(j316, j317), "2026-09-27T14:04:20Z"),
                ann(4, "note", anchor(r58), "2026-09-27T14:07:12Z",
                    body="He did not wait for us to get it together first. Compare 1 John 3:16.",
                    tags=("grace", "love")),
                ann(5, "tag", anchor(j1316), "2026-09-27T14:06:30Z", tags=("love",)),
                ann(6, "tag", anchor(j316), "2026-09-27T14:06:45Z", tags=("love",)),
                ann(7, "highlight", anchor(ps231, words=(4, 8), translation="bsb"), "2026-09-28T07:15:00Z",
                    color="green"),
            ],
            "rules": ANNOTATION_RULES,
            "_note": "Sample of one reader's marks. Every id, word position and word count is real BSB data; the "
                     "note body is sample text a reader might type. NIV anchors store positions only, never words.",
        }


# ------------------------------------------------------------------ writers

def dump(path: Path, doc, pretty: bool) -> bytes:
    path.parent.mkdir(parents=True, exist_ok=True)
    if pretty:
        s = json.dumps(doc, ensure_ascii=False, indent=2) + "\n"
    else:
        s = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    data = s.encode("utf-8")
    path.write_bytes(data)
    return data


def shard_entry(root: Path, path: Path, data: bytes, **extra) -> dict:
    e = {"path": str(path.relative_to(root)), **extra, "bytes": len(data),
         "gzipBytes": len(gzip.compress(data, compresslevel=6, mtime=0)),
         "sha256": hashlib.sha256(data).hexdigest()}
    return e


def books_doc() -> dict:
    books, first_ord = [], 0
    for b in CANON:
        books.append({
            "bookNo": b["order"], "osis": b["id"], "usfm": b["usfm"], "name": b["displayName"], "short": b["short"],
            "sourceName": b["bsbName"], "aliases": b["aliases"], "testament": b["testament"],
            "chapters": b["chapters"], "verses": b["verses"], "firstVid": vid_of(b["order"], 1, 1),
            "firstOrdinal": first_ord, "verseCounts": b["verseCounts"],
        })
        first_ord += b["verses"]
    return {"schema": "asb.books/2", "canon": "protestant-66",
            "versification": "BSB (31,102 verses); OpenBible refs outside it are clamped to the chapter's last verse (3 John 1:15 -> 1:14)",
            "books": books}


def manifest_doc(ds: Dataset, merged_total: int, inline_total: int, tiers: collections.Counter,
                 no_conn: int, shards: list[dict], built_at: str, reason_counts: collections.Counter) -> dict:
    reasons_block = {
        "version": REASONS_VERSION, "rules": "tools/reasons.py", "analysisText": "bsb-2023",
        "labels": {"quote": "Direct quote", "story": "Same story", "topic": "Same topic"},
        "bases": REASON_BASES,
        "share": {k: round(reason_counts[k] / merged_total, 4) for k in REASON_KINDS},
        "counts": {k: reason_counts[k] for k in REASON_KINDS},
        "confidence": "match strength 0..1, shown as a percentage: 1.0 = the same words or the same account; "
                      "topics are capped at 0.8 (tools/reasons.py, docs/DATA_MODEL.md 2.6.1)",
        "tested": "tests/gold_reasons.json (60 hand-labelled connections, all correct)",
        "note": "Deterministic rules over the public-domain BSB text, so no licensed text is processed. "
                "An AI pass may later replace a reason (source 'ai'), only with YouVersion's written approval.",
    }
    return {
        "schema": "asb.manifest/2", "datasetVersion": DATASET_VERSION, "builtAt": built_at,
        "pipeline": "tools/build_dataset.py",
        "canon": {"books": 66, "chapters": sum(b["chapters"] for b in CANON), "verses": len(ds.ordlist),
                  "versification": "BSB"},
        "graph": {**ds.stats, "mergedTickerItems": merged_total, "inlineTickerItems": inline_total,
                  "versesWithNoConnections": no_conn},
        "ranking": {
            "version": RANKING_VERSION, "incomingFactor": INCOMING_FACTOR, "rangeDiscount": "votes / sqrt(span)",
            "spanCap": SPAN_CAP, "score": "votesOut + incomingFactor * sum(votesIn / sqrt(span))",
            "weight": "ln(1 + score) / ln(1 + maxScoreOfThisVerse), 3 decimals, per verse",
            "tiers": {"strong": f">= {TIER_STRONG}", "solid": f">= {TIER_SOLID}", "light": f"< {TIER_SOLID}"},
            "tierShare": {t: round(tiers[t] / merged_total, 4) for t in TIERS},
            "order": "score desc; out/both before in-only; start vid asc",
            "collision": "same start, different end: keep higher votes, list others in alsoCites",
            "tickerInline": TICKER_INLINE, "snippetMaxChars": SNIPPET_MAX,
            "matchSlider": {"min": 0, "max": 100, "step": 5, "default": 0, "buckets": MATCH_BUCKETS,
                            "rule": "show the first tickerInline connections by rank whose match >= the slider value"},
            "dwellSeconds": f"{DWELL_BASE} + {DWELL_PER_WEIGHT} * weight",
            "motion": {"defaultMode": MOTION_DEFAULT, "baseSeconds": DWELL_BASE, "perWeightSeconds": DWELL_PER_WEIGHT},
        },
        "reasons": reasons_block,
        "translations": [
            {**TRANSLATION, "attribution": "Berean Standard Bible, BSB Publishing 2023, public domain",
             "role": "offline fallback and the analysis text for connection reasons", "bundled": True,
             "delivery": "bundled", "packUrl": None, "sha256": None, "headings": False},
            {"id": "niv", "name": "New International Version", "abbr": "NIV", "textVersion": None,
             "license": "Copyright Biblica, Inc. Delivered by the YouVersion Platform under its non-commercial license",
             "attribution": None,
             "copyrightNotice": "<the copyright string returned by the YouVersion API, shown wherever NIV text appears>",
             "role": "launch translation, fetched at runtime; never bundled, stored or indexed",
             "bundled": False, "delivery": "youversionPlatform", "youversionVersionId": 111,
             "packUrl": None, "sha256": None, "headings": True},
        ],
        "sources": [
            {"id": "openbible-xref-2016-02-01", "kind": "crossReferences", "name": "OpenBible.info Cross References",
             "version": "2016-02-01", "license": "CC-BY", "url": "https://www.openbible.info/labs/cross-references/",
             "attribution": OPENBIBLE_ABOUT,
             "via": "https://github.com/scrollmapper/bible_databases (2024 branch, cross_references.txt)",
             "retrievedAt": built_at[:10]},
            {"id": "bsb-2023", "kind": "text", "name": "Berean Standard Bible", "version": "2023",
             "license": "Public domain (CC0)", "url": "https://berean.bible",
             "attribution": "Berean Standard Bible, public domain",
             "via": "https://github.com/scrollmapper/bible_databases (formats/json/BSB.json)",
             "retrievedAt": built_at[:10]},
            {"id": "ai-claude", "kind": "ai", "name": "AI study notes", "status": "deferred", "generator": "claude",
             "model": "claude-opus-5",
             "promptVersions": AI_PROMPT_VERSIONS,
             "attribution": "Deferred: v1 ships no AI output. When enabled, notes are marked as an AI-generated study aid, "
                            "not part of the Bible text or the OpenBible dataset",
             "license": "Generated content, owned by the publisher"},
        ],
        "shards": shards,
        "onDevice": {"database": "asb.sqlite", "shippedInAppBundle": True, "estimatedBytes": 44700000,
                     "tickerInline": TICKER_INLINE},
    }


# ------------------------------------------------------------------ main

SAMPLE_CHAPTERS = [(43, 3), (45, 5), (62, 4), (1, 1), (19, 22), (23, 53)]
SAMPLE_VERSES = [43003016, 45005008, 1001001, 19022001, 23053005]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sources", default=str(ROOT / "data" / "sources"))
    ap.add_argument("--out", default=str(ROOT / "data" / "full"))
    ap.add_argument("--samples", default=str(ROOT / "data" / "samples"))
    ap.add_argument("--proto", default=str(ROOT / "prototype" / "data"))
    ap.add_argument("--ai", default="", help="optional AI notes file (deferred: v1 ships no AI output)")
    ap.add_argument("--bundles", action="store_true", help="write all 1,189 chapter bundles to --out/bundles")
    ap.add_argument("--built-at", default=dt.date.today().isoformat() + "T00:00:00Z")
    args = ap.parse_args()

    bsb_path, xref_path = ensure_sources(Path(args.sources))
    ds = Dataset(bsb_path, xref_path)
    ai = json.loads(Path(args.ai).read_text(encoding="utf-8")) if args.ai and Path(args.ai).exists() else {}
    rm = ReasonModel(ds.text, ds.ordlist, ds.ordinal, {b["order"]: b["displayName"] for b in CANON})
    bld = Builder(ds, ai, rm)
    out, samples, proto = Path(args.out), Path(args.samples), Path(args.proto)
    print(f"verses={len(ds.ordlist)} edges={ds.stats['edges']} incomingRows={ds.stats['incomingRows']}", file=sys.stderr)

    # ---- per-verse merge (once), global stats, compact prototype xref packs
    merged_total = inline_total = no_conn = 0
    tiers: collections.Counter = collections.Counter()
    reason_counts: collections.Counter = collections.Counter()
    for b in CANON:
        bn = b["order"]
        chapters = []
        because_ids: dict[str, int] = {}
        for ch in range(1, b["chapters"] + 1):
            verses = []
            for v in range(1, b["verseCounts"][ch - 1] + 1):
                vid = vid_of(bn, ch, v)
                m = bld.merged(vid)
                merged_total += len(m)
                inline_total += min(TICKER_INLINE, len(m))
                no_conn += 0 if m else 1
                for it in m:
                    tiers[it["tier"]] += 1
                    reason_counts[bld.reason(vid, it)["kind"]] += 1
                c = ds.counts(vid, m)
                chips = [[it["start"], it["end"], DIRECTIONS.index(it["direction"]), it["votesOut"], it["votesIn"],
                          it["score"], it["weight"], TIERS.index(it["tier"]),
                          [it["via"]["start"], it["via"]["end"], it["via"]["span"]] if it["via"] else 0,
                          [REASON_KINDS.index(it["reason"]["kind"]), REASON_BASES.index(it["reason"]["basis"]),
                           it["reason"]["confidence"],
                           because_ids.setdefault(it["reason"]["because"], len(because_ids))], it["rank"]]
                         for i, it in enumerate(m) if i < PROTO_CHIPS or it["reason"]["confidence"] >= PROTO_TAIL_MIN]
                verses.append([[c["out"], c["in"], c["inDirect"], c["inViaRange"], c["unique"]], chips,
                               match_histogram(it["reason"]["confidence"] for it in m)])
            chapters.append(verses)
        dump(proto / "xref" / f"{bn:02d}-{b['id']}.json", {
            "schema": "asb.protoXref/2", "datasetVersion": DATASET_VERSION, "rankingVersion": RANKING_VERSION,
            "book": bn, "osis": b["id"],
            "legend": {"verse": ["counts", "ticker", "byMatch"], "counts": ["out", "in", "inDirect", "inViaRange", "unique"],
                       "ticker": f"the top {PROTO_CHIPS} chips in rank order, then every lower-ranked chip matching at "
                                 f"{int(PROTO_TAIL_MIN * 100)}% or better; each chip's rank is its position in the verse's full "
                                 f"list; the strip shows the first {TICKER_INLINE} that pass the Match slider and reason filter",
                       "byMatch": f"{MATCH_BUCKETS} counts over all connections of the verse: bucket i holds match "
                                  "percentages in [5i, 5i+5), 100% in the last bucket",
                       "chip": ["start", "end", "direction", "votesOut", "votesIn", "score", "weight", "tier", "viaRange",
                                "reason", "rank"],
                       "direction": DIRECTIONS, "tier": TIERS, "viaRange": "0 or [start,end,span]",
                       "reason": "[kind, basis, confidence, becauseIndex]; kind and basis index reasonKinds and "
                                 "reasonBases, becauseIndex indexes the top-level because list",
                       "reasonKinds": REASON_KINDS, "reasonBases": REASON_BASES},
            "because": list(because_ids),
            "chapters": chapters}, pretty=False)
        bld._merged_cache.clear()  # keep memory flat; samples recompute what they need
    print(f"merged={merged_total} inline={inline_total} noConnections={no_conn} tiers={dict(tiers)} "
          f"reasons={dict(reason_counts)}", file=sys.stderr)

    # ---- full distribution format
    shards: list[dict] = []
    books = books_doc()
    shards.append(shard_entry(out, out / "books.json", dump(out / "books.json", books, pretty=False), kind="books"))
    by_src: dict[int, list] = collections.defaultdict(list)
    for f, ts, te, v in ds.edges:
        by_src[f // 1_000_000].append((f, ts, te, v))
    for b in CANON:
        bn = b["order"]
        rows = []
        for f in sorted({e[0] for e in by_src[bn]}):
            outs = sorted(ds.out[f], key=lambda e: (-e[2], 0 if e[0] == e[1] else 1, e[0], e[1]))
            rows += [{"from": f, "to": {"start": ts, "end": te}, "votes": v, "rank": i + 1}
                     for i, (ts, te, v) in enumerate(outs)]
        p = out / "graph" / f"{bn:02d}-{b['id']}.json"
        shards.append(shard_entry(out, p, dump(p, {
            "schema": "asb.graph/2", "datasetVersion": DATASET_VERSION, "book": bn, "osis": b["id"],
            "sourceId": "openbible-xref-2016-02-01", "edges": rows}, pretty=False), kind="graph", book=bn))
        inc_rows = []
        for vid in [x for x in ds.ordlist if x // 1_000_000 == bn]:
            rs = sorted(ds.inc.get(vid, []), key=lambda r: (-r[5], r[3], r[0]))
            inc_rows += [{"vid": vid, "from": f, "to": {"start": ts, "end": te}, "span": n, "viaRange": n > 1,
                          "votes": v, "votesEff": round(eff, 3), "rank": i + 1}
                         for i, (f, ts, te, n, v, eff) in enumerate(rs)]
        p = out / "incoming" / f"{bn:02d}-{b['id']}.json"
        shards.append(shard_entry(out, p, dump(p, {
            "schema": "asb.incoming/2", "datasetVersion": DATASET_VERSION, "book": bn, "osis": b["id"],
            "rows": inc_rows}, pretty=False), kind="incoming", book=bn))
        tv = []
        for vid in [x for x in ds.ordlist if x // 1_000_000 == bn]:
            t = ds.text[vid]
            tv.append({"vid": vid, "text": t, "snippet": ds.snippet(vid), "heading": None,
                       "paragraphStart": vid % 1000 == 1, "omitted": t == ""})
        p = out / "text" / "bsb" / f"{bn:02d}-{b['id']}.json"
        shards.append(shard_entry(out, p, dump(p, {
            "schema": "asb.text/2", "translation": "bsb", "textVersion": "bsb-2023", "book": bn, "osis": b["id"],
            "verses": tv}, pretty=False), kind="text", book=bn, translation="bsb"))
        if args.bundles:
            for ch in range(1, b["chapters"] + 1):
                dump(out / "bundles" / "bsb" / f"{bn:02d}" / f"{ch:03d}.json", bld.chapter_bundle(bn, ch), pretty=False)
            bld._merged_cache.clear()
    text_bytes = sum(s["bytes"] for s in shards if s["kind"] == "text")
    manifest = manifest_doc(ds, merged_total, inline_total, tiers, no_conn, shards, args.built_at, reason_counts)
    manifest["translations"][0]["sha256"] = hashlib.sha256(
        "".join(s["sha256"] for s in shards if s["kind"] == "text").encode()).hexdigest()
    dump(out / "manifest.json", manifest, pretty=True)
    (out / "attribution.md").write_text(
        "# Attribution\n\n" + TRANSLATION["copyrightNotice"] + "\n\n" + OPENBIBLE_ABOUT + "\n\n" +
        ATTRIBUTION["ai"] + "\n", encoding="utf-8")
    print(f"full: {len(shards)} shards, text {text_bytes/1e6:.1f} MB -> {out}", file=sys.stderr)

    # ---- founder-readable samples (spec shape, pretty)
    dump(samples / "books.json", books, pretty=True)
    dump(samples / "manifest.json", manifest, pretty=True)
    for bn, ch in SAMPLE_CHAPTERS:
        dump(samples / "chapters" / f"{BOOK[bn]['id']}-{ch}.json", bld.chapter_bundle(bn, ch), pretty=True)
    for vid in SAMPLE_VERSES:
        tag = ref_of(vid).replace(".", "-")
        dump(samples / "ticker" / f"{tag}.json", bld.ticker_feed(vid), pretty=True)
        dump(samples / "connections" / f"{tag}.json", bld.connections(vid), pretty=True)
    dump(samples / "trail.json", bld.trail_sample(), pretty=True)
    annotations = bld.annotations_sample()
    dump(samples / "annotations.json", annotations, pretty=True)
    stale_ai = samples / "ai-context-John-3-16.json"
    if ai.get("aiContextSample"):
        dump(stale_ai, ai["aiContextSample"], pretty=True)
    elif stale_ai.exists():
        stale_ai.unlink()  # AI notes are deferred; the shape stays documented in docs/DATA_MODEL.md 4.4

    # ---- prototype transport files
    dump(proto / "books.json", books, pretty=False)
    dump(proto / "manifest.json", {**manifest, "shards": manifest["shards"][:4],
                                   "_note": "Prototype copy: shard list trimmed to 4 of "
                                            f"{len(shards)}; full list in data/samples/manifest.json."}, pretty=False)
    dump(proto / "text" / "bsb.json", {
        "schema": "asb.protoText/2", "translation": TRANSLATION, "snippetMaxChars": SNIPPET_MAX,
        "books": [[[ds.text[vid_of(b["order"], ch, v)] for v in range(1, b["verseCounts"][ch - 1] + 1)]
                   for ch in range(1, b["chapters"] + 1)] for b in CANON]}, pretty=False)
    dump(proto / "annotations.json", annotations, pretty=False)
    dump(proto / "ai" / "notes.json", {
        "schema": "asb.protoAi/2",
        "_note": ai.get("_note", "AI notes are deferred. v1 ships no AI output; this file stays empty."),
        "edges": bld.ai_edges,
        "verses": bld.ai_verses}, pretty=False)
    print(f"samples -> {samples}\nprototype -> {proto}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
