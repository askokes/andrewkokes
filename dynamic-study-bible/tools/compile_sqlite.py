#!/usr/bin/env python3
"""Compile the read-only on-device database (asb.sqlite) that the iOS app ships in its bundle.

Tables match docs/DATA_MODEL.md section 5 (App bundle). The ticker table holds every merged,
ranked connection (840,072 rows), so a chapter opens with one indexed query and the strip
never computes anything while the reader scrolls.

Usage: python3 tools/compile_sqlite.py [--profile ship|full] [--out data/full/asb.sqlite] [--no-fts]
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from build_dataset import (CANON, DIRECTIONS, REASON_BASES, REASON_KINDS, TIERS, TRANSLATION,  # noqa: E402
                           Dataset, ROOT, ai_key, vid_of)
from reasons import ReasonModel  # noqa: E402
from sources import ensure_sources  # noqa: E402

DDL = """
PRAGMA page_size = 4096;
CREATE TABLE books (bookNo INTEGER PRIMARY KEY, osis TEXT NOT NULL UNIQUE, name TEXT NOT NULL, short TEXT NOT NULL,
  testament TEXT NOT NULL, chapters INTEGER NOT NULL, verses INTEGER NOT NULL, verseCounts TEXT NOT NULL);
CREATE TABLE translations (id TEXT PRIMARY KEY, name TEXT, abbr TEXT, textVersion TEXT, license TEXT,
  copyrightNotice TEXT, bundled INTEGER NOT NULL);
CREATE TABLE verses (translation TEXT NOT NULL, vid INTEGER NOT NULL, text TEXT NOT NULL, snippet TEXT NOT NULL,
  heading TEXT, paragraphStart INTEGER NOT NULL, omitted INTEGER NOT NULL, PRIMARY KEY (translation, vid)) WITHOUT ROWID;
CREATE TABLE edges (fromVid INTEGER NOT NULL, rank INTEGER NOT NULL, toStart INTEGER NOT NULL, toEnd INTEGER NOT NULL,
  votes INTEGER NOT NULL, PRIMARY KEY (fromVid, rank)) WITHOUT ROWID;
CREATE TABLE incoming (vid INTEGER NOT NULL, rank INTEGER NOT NULL, fromVid INTEGER NOT NULL, toStart INTEGER NOT NULL,
  toEnd INTEGER NOT NULL, span INTEGER NOT NULL, votes INTEGER NOT NULL, votesEff REAL NOT NULL,
  PRIMARY KEY (vid, rank)) WITHOUT ROWID;
CREATE TABLE ticker (vid INTEGER NOT NULL, rank INTEGER NOT NULL, toStart INTEGER NOT NULL, toEnd INTEGER,
  direction INTEGER NOT NULL, votesOut INTEGER NOT NULL, votesIn INTEGER NOT NULL, score100 INTEGER NOT NULL,
  weight1000 INTEGER NOT NULL, tier INTEGER NOT NULL, viaStart INTEGER, viaEnd INTEGER, viaSpan INTEGER,
  reasonKind INTEGER NOT NULL, reasonBasis INTEGER NOT NULL, reasonConfidence100 INTEGER NOT NULL,
  reasonTextId INTEGER NOT NULL, PRIMARY KEY (vid, rank)) WITHOUT ROWID;
CREATE TABLE reason_text (id INTEGER PRIMARY KEY, because TEXT NOT NULL UNIQUE);
CREATE TABLE ai_context (key TEXT PRIMARY KEY, kind TEXT NOT NULL, json TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
"""

CHAPTER_SQL = """
SELECT v.vid, v.text, t.rank, t.toStart, coalesce(t.toEnd, t.toStart), t.direction, t.votesOut, t.votesIn,
       t.score100 / 100.0, t.weight1000 / 1000.0, t.tier, t.reasonKind, rt.because,
       t.viaStart, t.viaEnd, t.viaSpan, s.snippet
FROM verses v
LEFT JOIN ticker t ON t.vid = v.vid AND t.rank <= :inline
LEFT JOIN verses s ON s.translation = v.translation AND s.vid = t.toStart
LEFT JOIN reason_text rt ON rt.id = t.reasonTextId
WHERE v.translation = :tr AND v.vid BETWEEN :lo AND :hi
ORDER BY v.vid, t.rank
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sources", default=str(ROOT / "data" / "sources"))
    ap.add_argument("--out", default=str(ROOT / "data" / "full" / "asb.sqlite"))
    ap.add_argument("--ai", default="", help="optional AI notes file (deferred: v1 ships no AI output)")
    ap.add_argument("--no-fts", action="store_true")
    ap.add_argument("--profile", choices=["ship", "full"], default="ship",
                    help="ship: what the app bundles (ticker, verses, ai); full: also raw edges and incoming rows for tooling")
    args = ap.parse_args()

    ds = Dataset(*ensure_sources(Path(args.sources)))
    out = Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()
    db = sqlite3.connect(out)
    db.executescript(DDL)
    db.executemany("INSERT INTO books VALUES (?,?,?,?,?,?,?,?)",
                   [(b["order"], b["id"], b["displayName"], b["short"], b["testament"], b["chapters"], b["verses"],
                     json.dumps(b["verseCounts"])) for b in CANON])
    db.execute("INSERT INTO translations VALUES (?,?,?,?,?,?,1)",
               (TRANSLATION["id"], TRANSLATION["name"], TRANSLATION["abbr"], TRANSLATION["textVersion"],
                TRANSLATION["license"], TRANSLATION["copyrightNotice"]))
    db.executemany("INSERT INTO verses VALUES ('bsb',?,?,?,NULL,?,?)",
                   [(vid, ds.text[vid], ds.snippet(vid), int(vid % 1000 == 1), int(ds.text[vid] == ""))
                    for vid in ds.ordlist])
    edge_rows, inc_rows, tick_rows = [], [], []
    for f, outs in ds.out.items():
        for i, (ts, te, v) in enumerate(sorted(outs, key=lambda e: (-e[2], 0 if e[0] == e[1] else 1, e[0], e[1]))):
            edge_rows.append((f, i + 1, ts, te, v))
    for vid, rows in ds.inc.items():
        for i, (f, ts, te, n, v, eff) in enumerate(sorted(rows, key=lambda r: (-r[5], r[3], r[0]))):
            inc_rows.append((vid, i + 1, f, ts, te, n, v, round(eff, 3)))
    rm = ReasonModel(ds.text, ds.ordlist, ds.ordinal, {b["order"]: b["displayName"] for b in CANON})
    text_ids: dict[str, int] = {}
    for vid in ds.ordlist:
        for it in ds.merged(vid):
            via = it["via"] or {}
            r = rm.classify(vid, it["start"], it["end"], it["score"])
            tid = text_ids.setdefault(r["because"], len(text_ids) + 1)
            tick_rows.append((vid, it["rank"], it["start"], it["end"] if it["end"] != it["start"] else None,
                              DIRECTIONS.index(it["direction"]), it["votesOut"], it["votesIn"],
                              round(it["score"] * 100), round(it["weight"] * 1000), TIERS.index(it["tier"]),
                              via.get("start"), via.get("end"), via.get("span"),
                              REASON_KINDS.index(r["kind"]), REASON_BASES.index(r["basis"]),
                              round(r["confidence"] * 100), tid))
    if args.profile == "full":
        db.executemany("INSERT INTO edges VALUES (?,?,?,?,?)", edge_rows)
        db.executemany("INSERT INTO incoming VALUES (?,?,?,?,?,?,?,?)", inc_rows)
    else:
        db.execute("DROP TABLE edges")
        db.execute("DROP TABLE incoming")
    db.executemany("INSERT INTO ticker VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", tick_rows)
    db.executemany("INSERT INTO reason_text VALUES (?,?)", [(i, t) for t, i in text_ids.items()])
    ai = json.loads(Path(args.ai).read_text(encoding="utf-8")) if args.ai and Path(args.ai).exists() else {}
    for k, why in ai.get("edges", {}).items():
        frm, tgt = k.split(">")
        a, _, b = tgt.partition("-")
        key = f"ai:edge:{ai_key(int(frm), int(a), int(b or a))}:bsb:bsb-2023:v2"
        db.execute("INSERT INTO ai_context VALUES (?,?,?)", (key, "edge", json.dumps({"why": why, "sample": True})))
    for vid, note in ai.get("verses", {}).items():
        db.execute("INSERT INTO ai_context VALUES (?,?,?)",
                   (f"ai:verse:{vid}:bsb:bsb-2023:v3", "verse", json.dumps({**note, "sample": True})))
    db.executemany("INSERT INTO meta VALUES (?,?)", [("schema", "asb.sqlite/2"), ("datasetVersion", "2026.09.1"),
                                                      ("rankingVersion", "asb.rank.v2"), ("tickerInline", "12")])
    size_no_fts = None
    db.commit()
    db.execute("VACUUM")
    size_no_fts = out.stat().st_size
    if not args.no_fts:
        db.execute("CREATE VIRTUAL TABLE verses_fts USING fts5(text, vid UNINDEXED, translation UNINDEXED, "
                   "tokenize='unicode61 remove_diacritics 2')")
        db.execute("INSERT INTO verses_fts (text, vid, translation) SELECT text, vid, translation FROM verses")
        db.commit()
        db.execute("VACUUM")
    db.close()

    ro = sqlite3.connect(f"file:{out}?mode=ro", uri=True)
    t0 = time.perf_counter()
    rows = ro.execute(CHAPTER_SQL, {"inline": 12, "tr": "bsb", "lo": 43003000, "hi": 43003999}).fetchall()
    ms_chapter = (time.perf_counter() - t0) * 1000
    t0 = time.perf_counter()
    for _ in range(100):
        ro.execute(CHAPTER_SQL, {"inline": 12, "tr": "bsb", "lo": 19119000, "hi": 19119999}).fetchall()
    ms_ps119 = (time.perf_counter() - t0) * 10
    t0 = time.perf_counter()
    slider = ro.execute("SELECT rank, toStart, reasonConfidence100 FROM ticker WHERE vid = ? "
                        "AND reasonConfidence100 >= ? ORDER BY rank LIMIT 12", (43003016, 80)).fetchall()
    passing = ro.execute("SELECT count(*) FROM ticker WHERE vid = ? AND reasonConfidence100 >= ?", (43003016, 80)).fetchone()[0]
    ms_slider = (time.perf_counter() - t0) * 1000
    top = ro.execute("SELECT toStart, votesOut, votesIn, score100 / 100.0, weight1000 / 1000.0 FROM ticker "
                     "WHERE vid=43003016 AND rank=1").fetchone()
    fts = None if args.no_fts else ro.execute(
        "SELECT count(*) FROM verses_fts WHERE verses_fts MATCH 'shepherd'").fetchone()[0]
    tables = [r[0] for r in ro.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '%fts%'")]
    counts = {t: ro.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in tables}
    ro.close()
    report = {
        "path": str(out.relative_to(ROOT)), "profile": args.profile, "bytes": out.stat().st_size,
        "distinctReasonSentences": len(text_ids), "bytesWithoutFts": size_no_fts,
        "rows": counts, "john3Rows": len(rows), "john3ColdQueryMs": round(ms_chapter, 2),
        "psalm119WarmQueryMs": round(ms_ps119, 2), "john316Rank1": top, "ftsHitsShepherd": fts,
        "matchSlider": {"verse": "John 3:16", "atLeastPercent": 80, "passing": passing,
                        "shown": [list(r) for r in slider], "queryMs": round(ms_slider, 2)},
    }
    print(json.dumps(report, indent=2))
    (out.parent / f"{out.stem}.report.json").write_text(json.dumps(report, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
