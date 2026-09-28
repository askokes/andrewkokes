"""Generate schema/*.schema.json. Edit this file, then run: python3 tools/gen_schemas.py"""
import json
from pathlib import Path
OUT = Path(__file__).resolve().parent.parent / 'schema'; OUT.mkdir(exist_ok=True)
BASE = "https://asb.dev/schema/"
C = "common.schema.json#/$defs/"
def ref(name): return {"$ref": C + name}
def obj(props, required=None, note=True, extra=False):
    p = dict(props)
    if note: p["_note"] = {"type": "string", "description": "Illustrative-content marker; consumers ignore it"}
    o = {"type": "object", "properties": p, "additionalProperties": extra}
    o["required"] = list(required if required is not None else [k for k in props])
    return o
def doc(name, title, desc, schema_const, props, required=None, defs=None):
    s = {"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": BASE + name, "title": title,
         "description": desc}
    s.update(obj({"schema": {"const": schema_const}, **props}, required=(["schema"] + list(required if required is not None else props))))
    if defs: s["$defs"] = defs
    (OUT / name).write_text(json.dumps(s, indent=2, ensure_ascii=False) + "\n")

INT0 = {"type": "integer", "minimum": 0}
STR = {"type": "string"}
NSTR = {"type": ["string", "null"]}
common = {
  "$schema": "https://json-schema.org/draft/2020-12/schema", "$id": BASE + "common.schema.json",
  "title": "Shared definitions", "description": "Types shared by every Dynamic Study Bible document (docs/DATA_MODEL.md section 2).",
  "$defs": {
    "vid": {"type": "integer", "minimum": 1001001, "maximum": 66150176,
            "description": "Verse id: bookNo*1,000,000 + chapter*1,000 + verse. John 3:16 = 43003016"},
    "chapterId": {"type": "integer", "minimum": 1001000, "maximum": 66150000, "multipleOf": 1000,
                  "description": "Zero-verse id of a chapter. John 3 = 43003000"},
    "bookNo": {"type": "integer", "minimum": 1, "maximum": 66},
    "osisRef": {"type": "string", "pattern": "^[1-3]?[A-Za-z]+\\.\\d+\\.\\d+(-[1-3]?[A-Za-z]+\\.\\d+\\.\\d+)?$"},
    "range": obj({"start": ref("vid"), "end": ref("vid")}, note=False),
    "verseRef": obj({"vid": ref("vid"), "ref": ref("osisRef"), "label": STR}, note=False),
    "verseTarget": {**obj({"start": ref("vid"), "end": ref("vid"), "ref": ref("osisRef"), "label": STR}, note=False),
                    "description": "Jump target; end == start for a single verse (never null)"},
    "viaRange": {"oneOf": [{"type": "null"},
                           obj({"start": ref("vid"), "end": ref("vid"), "label": STR,
                                "span": {"type": "integer", "minimum": 2, "maximum": 40}}, note=False)],
                 "description": "Present when the incoming citation pointed at a range covering this verse"},
    "direction": {"enum": ["out", "in", "both"]},
    "tier": {"enum": ["strong", "solid", "light"]},
    "aiStatus": {"enum": ["cached", "not_generated"]},
    "weight": {"type": "number", "minimum": 0, "maximum": 1},
    "reason": {**obj({
        "kind": {"enum": ["quote", "story", "topic"]},
        "label": {"enum": ["Direct quote", "Same story", "Same topic"]},
        "because": STR,
        "basis": {"enum": ["sharedWording", "quotation", "parallelAccount", "retelling", "samePassage", "sharedNames", "theme"]},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1,
                       "description": "Match strength shown as a percentage: 1.0 = the same words or the same account"},
        "source": {"enum": ["rule", "ai", "editor"]},
        "evidence": obj({"phrase": STR, "names": {"type": "array", "items": STR}, "words": {"type": "array", "items": STR},
                         "parallel": STR}, required=[], note=False)},
        required=["kind", "label", "because", "basis", "confidence", "source"], note=False),
        "description": "Why the verse is connected (docs/DATA_MODEL.md 2.6.1, tools/reasons.py)"},
    "tickerItem": obj({
        "rank": {"type": "integer", "minimum": 1}, "to": ref("verseTarget"), "direction": ref("direction"),
        "votesOut": INT0, "votesIn": INT0, "score": {"type": "number", "minimum": 0}, "weight": ref("weight"),
        "tier": ref("tier"), "sameBook": {"type": "boolean"}, "viaRange": ref("viaRange"), "snippet": STR,
        "reason": ref("reason"), "why": NSTR, "aiStatus": ref("aiStatus"), "dwellSeconds": {"type": "number", "minimum": 0},
        "alsoCites": {"type": "array", "items": obj({"ref": ref("osisRef"), "label": STR, "votes": INT0}, note=False)}},
        required=["rank", "to", "direction", "votesOut", "votesIn", "score", "weight", "tier", "sameBook",
                  "viaRange", "snippet", "reason"], note=False),
    "counts": obj({**{k: INT0 for k in ("out", "in", "inDirect", "inViaRange", "unique", "shown", "more")},
                   "byMatch": {"type": "array", "items": INT0, "minItems": 20, "maxItems": 20,
                               "description": "Connections per 5-point band of match percentage (bucket i = [5i, 5i+5), 100 in the last)"}},
                  required=["out", "in", "unique"], note=False),
    "translationHeader": obj({k: STR for k in ("id", "name", "abbr", "textVersion", "license", "copyrightNotice")}, note=False),
    "attribution": obj({"text": STR, "crossReferences": STR, "ai": STR}, note=False),
    "timestamp": {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$"},
    "sha256": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
  }}
(OUT / "common.schema.json").write_text(json.dumps(common, indent=2) + "\n")

def item(*req): return {"allOf": [ref("tickerItem"), {"required": list(req)}]}
def counts(*req): return {"allOf": [ref("counts"), {"required": list(req)}]}

# ---------------- chapter bundle
verse = obj({
    "vid": ref("vid"), "verse": {"type": "integer", "minimum": 1}, "ref": ref("osisRef"), "label": STR, "text": STR,
    "omitted": {"type": "boolean", "default": False}, "paragraphStart": {"type": "boolean"}, "heading": NSTR,
    "counts": counts("out", "in", "inDirect", "inViaRange", "unique", "shown", "more"),
    "ticker": {"type": "array", "maxItems": 12, "items": item("why", "aiStatus")},
    "connections": STR,
    "ai": obj({"verse": {"type": "string", "pattern": "^ai:verse:"}, "status": ref("aiStatus")}, note=False)},
    required=["vid", "verse", "ref", "label", "text", "paragraphStart", "counts", "ticker", "connections", "ai"], note=False)
doc("chapter-bundle.schema.json", "Chapter bundle", "The reader screen document: every verse of one chapter with its text and top ranked connections (spec 2.7, example 4.1).",
    "asb.chapter/2", {
      "datasetVersion": STR, "rankingVersion": STR, "translation": ref("translationHeader"),
      "book": obj({"bookNo": ref("bookNo"), "osis": STR, "name": STR, "short": STR}, note=False),
      "chapter": {"type": "integer", "minimum": 1}, "chapterId": ref("chapterId"), "verseCount": {"type": "integer", "minimum": 1},
      "prevChapter": {"oneOf": [ref("chapterId"), {"type": "null"}]}, "nextChapter": {"oneOf": [ref("chapterId"), {"type": "null"}]},
      "headings": {"type": "array", "items": obj({"beforeVerse": {"type": "integer", "minimum": 1}, "title": STR}, note=False)},
      "tickerInline": {"type": "integer", "minimum": 1}, "verses": {"type": "array", "minItems": 1, "items": verse},
      "attribution": ref("attribution")})

# ---------------- ticker feed
doc("ticker-feed.schema.json", "Ticker feed", "The strip for one focus verse, with the motion rules in the data (spec 2.9, example 4.2).",
    "asb.ticker/2", {
      "rankingVersion": STR, "translation": STR, "focus": ref("verseRef"),
      "counts": counts("out", "in", "unique", "shown", "more"), "order": STR,
      "motion": obj({"mode": {"enum": ["hold", "autoScroll"]}, "loop": {"type": "boolean"},
                     "baseSeconds": {"type": "number"}, "perWeightSeconds": {"type": "number"}, "dwellFormula": STR,
                     "advanceOnFocusChange": {"type": "boolean"}}, note=False),
      "items": {"type": "array", "maxItems": 12, "items": item("why", "aiStatus", "dwellSeconds")},
      "attribution": STR})

# ---------------- connections
doc("connections.schema.json", "Connections", "The uncapped 'See all' list for one verse (spec 2.8).", "asb.connections/2", {
      "datasetVersion": STR, "rankingVersion": STR, "translation": STR, "vid": ref("vid"), "ref": ref("osisRef"), "label": STR,
      "counts": counts("out", "in", "inDirect", "inViaRange", "unique"),
      "items": {"type": "array", "items": item("alsoCites")}})

# ---------------- trail
hop = obj({
    "index": INT0, "kind": {"enum": ["open", "jump", "search", "bookmarkOpen"]}, "vid": ref("vid"), "ref": ref("osisRef"),
    "label": STR, "book": STR,
    "via": {"oneOf": [{"type": "null"}, obj({"from": ref("verseRef"), "to": ref("verseTarget"), "direction": ref("direction"),
                                             "votesOut": INT0, "votesIn": INT0, "score": {"type": "number"},
                                             "rank": {"type": "integer", "minimum": 1}}, note=False)]},
    "scroll": obj({"chapter": ref("chapterId"), "anchor": ref("vid"), "highlight": {"oneOf": [{"type": "null"}, ref("range")]}}, note=False),
    "at": ref("timestamp")}, note=False)
doc("trail.schema.json", "Trail", "Spiderweb navigation state: hops, back/forward, peeks and the visited web (spec 2.10, example 4.3).",
    "asb.trail/2", {
      "id": STR, "translation": STR, "cursor": INT0, "hops": {"type": "array", "items": hop},
      "forward": {"type": "array", "items": hop},
      "peeks": {"type": "array", "items": obj({"fromHop": INT0, "to": ref("verseTarget"), "votesOut": INT0,
                                               "at": ref("timestamp"), "jumped": {"type": "boolean"}}, note=False)},
      "peek": {"oneOf": [{"type": "null"}, obj({"open": {"type": "boolean"}, "fromHop": INT0, "to": ref("verseTarget"),
                                                "direction": ref("direction"), "votesOut": INT0, "snippet": STR, "note": STR},
                                               required=["open", "fromHop", "to"], note=False)]},
      "web": obj({"nodes": {"type": "array", "items": ref("vid")},
                  "edges": {"type": "array", "items": {"type": "array", "prefixItems": [ref("vid"), ref("vid"), INT0], "items": False, "minItems": 3}},
                  "peekOnlyEdges": {"type": "array", "items": {"type": "array", "prefixItems": [ref("vid"), ref("vid")], "items": False, "minItems": 2}},
                  "booksTouched": {"type": "array", "items": STR}, "loopClosed": {"type": "boolean"}}, note=False),
      "rules": obj({"pushOn": {"type": "array", "items": STR}, "notPushed": {"type": "array", "items": STR},
                    "scrollUpdatesCurrentHop": {"type": "boolean"}, "maxHops": {"type": "integer", "minimum": 1},
                    "persist": STR}, note=False)})

# ---------------- AI context
prov = obj({"generator": STR, "model": STR, "promptId": STR, "promptVersion": STR, "schemaVersion": {"type": "integer"},
            "inputs": {"type": "object"}, "inputHash": {"type": "string", "pattern": "^sha256:[0-9a-f]{64}$"},
            "generatedAt": ref("timestamp"), "backendJob": NSTR, "tokens": obj({"input": INT0, "output": INT0}, note=False),
            "reviewed": {"type": "boolean"}, "disclaimer": STR}, note=False)
cache = obj({"source": {"enum": ["bundled", "fetched", "userRequested"]}, "fetchedAt": {"oneOf": [ref("timestamp"), {"type": "null"}]},
             "ttlDays": {"type": ["integer", "null"], "minimum": 1}, "invalidateOn": {"type": "array", "items": STR}}, note=False)
RELATIONS = ["quotation", "allusion", "fulfillment", "parallel", "contrast", "context", "thematic"]
ai_verse = obj({
    "key": {"type": "string", "pattern": "^ai:verse:\\d+:[a-z0-9]+:[a-z0-9-]+:v\\d+$"}, "kind": {"const": "verse"},
    "vid": ref("vid"), "ref": ref("osisRef"), "translation": STR, "textVersion": STR,
    "content": obj({"summary": STR, "context": STR, "speaker": STR, "genre": STR, "themes": {"type": "array", "items": STR},
                    "entities": {"type": "array", "items": obj({"name": STR, "type": {"enum": ["person", "group", "place", "thing", "event"]},
                                                                "alias": STR, "role": STR, "vid": ref("vid")},
                                                               required=["name", "type"], note=False)},
                    "questions": {"type": "array", "items": STR}, "readingTip": STR}, note=False),
    "provenance": prov, "cache": cache}, note=False)
ai_edge = obj({
    "key": {"type": "string", "pattern": "^ai:edge:\\d+>\\d+(-\\d+)?:[a-z0-9]+:[a-z0-9-]+:v\\d+$"}, "kind": {"const": "edge"},
    "from": ref("verseRef"), "to": ref("verseTarget"), "direction": ref("direction"), "votesOut": INT0, "votesIn": INT0,
    "translation": STR, "textVersion": STR,
    "content": obj({"why": STR, "relation": {"enum": RELATIONS}, "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "sharedThemes": {"type": "array", "items": STR},
                    "readNext": {"type": "array", "items": obj({"to": ref("verseTarget"), "why": STR}, note=False)}}, note=False),
    "relationVocabulary": {"type": "array", "items": {"enum": RELATIONS}},
    "provenance": prov, "cache": cache}, note=False)
doc("ai-context.schema.json", "AI context", "AI verse note and connection note with provenance and cache rules (spec 2.11, example 4.4).",
    "asb.ai/2", {"verse": {"$ref": "#/$defs/aiVerseContext"}, "connection": {"$ref": "#/$defs/aiConnection"},
                 "requestOnMiss": {"type": "object"}},
    required=["verse", "connection"], defs={"aiVerseContext": ai_verse, "aiConnection": ai_edge})

# ---------------- books
book = obj({"bookNo": ref("bookNo"), "osis": STR, "name": STR, "short": STR, "sourceName": STR,
            "aliases": {"type": "array", "items": STR}, "testament": {"enum": ["OT", "NT"]},
            "chapters": {"type": "integer", "minimum": 1}, "verses": {"type": "integer", "minimum": 1},
            "firstVid": ref("vid"), "firstOrdinal": INT0,
            "verseCounts": {"type": "array", "minItems": 1, "items": {"type": "integer", "minimum": 1}}},
           required=["bookNo", "osis", "name", "short", "sourceName", "testament", "chapters", "verses", "firstVid", "firstOrdinal", "verseCounts"], note=False)
doc("books.schema.json", "Books index", "The 66-book canon with verse counts per chapter (spec 2.1, example 4.5).", "asb.books/2",
    {"canon": STR, "versification": STR, "books": {"type": "array", "minItems": 1, "maxItems": 66, "items": book}})

# ---------------- manifest
translation = obj({"id": STR, "name": STR, "abbr": STR, "textVersion": NSTR, "license": STR, "attribution": NSTR,
                   "copyrightNotice": STR, "role": STR, "bundled": {"type": "boolean"},
                   "delivery": {"enum": ["bundled", "pack", "youversionPlatform"]},
                   "youversionVersionId": {"type": "integer"}, "packUrl": NSTR,
                   "sha256": {"oneOf": [ref("sha256"), {"type": "null"}]}, "headings": {"type": "boolean"}},
                  required=["id", "name", "abbr", "textVersion", "license", "copyrightNotice", "bundled", "headings"], note=False)
source = obj({"id": STR, "kind": {"enum": ["crossReferences", "text", "ai"]}, "name": STR, "status": {"enum": ["active", "deferred"]},
              "version": STR, "license": STR,
              "url": STR, "attribution": STR, "via": STR, "retrievedAt": STR, "generator": STR, "model": STR,
              "promptVersions": {"type": "object", "additionalProperties": STR}},
             required=["id", "kind", "name", "license", "attribution"], note=False)
shard = obj({"path": STR, "kind": {"enum": ["books", "graph", "incoming", "text"]}, "book": ref("bookNo"), "translation": STR,
             "bytes": INT0, "gzipBytes": INT0, "sha256": ref("sha256")}, required=["path", "kind", "bytes", "sha256"], note=False)
graph = obj({k: INT0 for k in ("edges", "edgesDroppedForMissingVerse", "edgesClampedToBsbVersification", "rangeTargets",
                               "crossChapterRanges", "crossBookRanges", "rangesOver40Verses", "maxSpan", "incomingRows",
                               "mergedTickerItems", "inlineTickerItems", "versesWithNoConnections")} |
            {"votes": obj({k: INT0 for k in ("min", "median", "p90", "p99", "max")}, note=False)},
            required=["edges", "incomingRows", "mergedTickerItems"], note=False)
ranking = obj({"version": STR, "incomingFactor": {"type": "number"}, "rangeDiscount": STR, "spanCap": {"type": "integer"},
               "score": STR, "weight": STR, "tiers": obj({"strong": STR, "solid": STR, "light": STR}, note=False),
               "tierShare": obj({"strong": {"type": "number"}, "solid": {"type": "number"}, "light": {"type": "number"}}, note=False),
               "order": STR, "collision": STR, "tickerInline": {"type": "integer", "minimum": 1},
               "snippetMaxChars": {"type": "integer", "minimum": 1}, "dwellSeconds": STR,
               "matchSlider": obj({"min": INT0, "max": INT0, "step": INT0, "default": INT0, "buckets": INT0, "rule": STR},
                                  note=False),
               "motion": obj({"defaultMode": {"enum": ["hold", "autoScroll"]}, "baseSeconds": {"type": "number"},
                              "perWeightSeconds": {"type": "number"}}, note=False)},
              required=["version", "incomingFactor", "spanCap", "tiers", "order", "tickerInline", "snippetMaxChars"], note=False)
doc("manifest.schema.json", "Dataset manifest", "Versions, measured counts, ranking constants, translations, sources and shard hashes (spec 2.12, example 4.6).",
    "asb.manifest/2", {
      "datasetVersion": STR, "builtAt": ref("timestamp"), "pipeline": STR,
      "canon": obj({"books": INT0, "chapters": INT0, "verses": INT0, "versification": STR}, note=False),
      "graph": graph, "ranking": ranking,
      "reasons": obj({"version": STR, "rules": STR, "analysisText": STR,
                      "labels": obj({"quote": STR, "story": STR, "topic": STR}, note=False),
                      "bases": {"type": "array", "items": STR},
                      "share": obj({"quote": {"type": "number"}, "story": {"type": "number"}, "topic": {"type": "number"}}, note=False),
                      "counts": obj({"quote": INT0, "story": INT0, "topic": INT0}, note=False),
                      "confidence": STR, "tested": STR, "note": STR},
                     required=["version", "rules", "analysisText", "labels", "share"], note=False),
      "translations": {"type": "array", "minItems": 1, "items": translation},
      "sources": {"type": "array", "items": source}, "shards": {"type": "array", "items": shard},
      "onDevice": obj({"database": STR, "shippedInAppBundle": {"type": "boolean"}, "estimatedBytes": INT0,
                       "tickerInline": {"type": "integer"}}, note=False)})

# ---------------- distribution shards
doc("graph-shard.schema.json", "Graph shard", "Outgoing OpenBible edges for one source book (spec 2.4).", "asb.graph/2", {
      "datasetVersion": STR, "book": ref("bookNo"), "osis": STR, "sourceId": STR,
      "edges": {"type": "array", "items": obj({"from": ref("vid"), "to": ref("range"), "votes": {"type": "integer", "minimum": 1},
                                               "rank": {"type": "integer", "minimum": 1}, "sourceId": STR},
                                              required=["from", "to", "votes", "rank"], note=False)}})
doc("incoming-shard.schema.json", "Incoming shard", "Incoming citations for one target book, one row per covered verse (spec 2.5).", "asb.incoming/2", {
      "datasetVersion": STR, "book": ref("bookNo"), "osis": STR,
      "rows": {"type": "array", "items": obj({"vid": ref("vid"), "from": ref("vid"), "to": ref("range"),
                                              "span": {"type": "integer", "minimum": 1, "maximum": 40}, "viaRange": {"type": "boolean"},
                                              "votes": {"type": "integer", "minimum": 1}, "votesEff": {"type": "number", "minimum": 0},
                                              "rank": {"type": "integer", "minimum": 1}}, note=False)}})
doc("text-pack.schema.json", "Text pack", "One book of one translation: text, snippet and paragraph data per verse (spec 2.3).", "asb.text/2", {
      "translation": STR, "textVersion": STR, "book": ref("bookNo"), "osis": STR,
      "verses": {"type": "array", "items": obj({"vid": ref("vid"), "text": STR, "snippet": STR, "heading": NSTR,
                                                "paragraphStart": {"type": "boolean"}, "omitted": {"type": "boolean"}}, note=False)}})

# ---------------- prototype transport formats
chip = {"type": "array", "minItems": 11, "items": False, "prefixItems": [
    ref("vid"), ref("vid"), {"enum": [0, 1, 2]}, INT0, INT0, {"type": "number", "minimum": 0}, ref("weight"), {"enum": [0, 1, 2]},
    {"oneOf": [{"const": 0}, {"type": "array", "prefixItems": [ref("vid"), ref("vid"), {"type": "integer", "minimum": 2}], "items": False, "minItems": 3}]},
    {"type": "array", "minItems": 4, "items": False, "prefixItems": [
        {"enum": [0, 1, 2]}, {"type": "integer", "minimum": 0, "maximum": 6}, {"type": "number", "minimum": 0, "maximum": 1},
        {"type": "integer", "minimum": 0}]},
    {"type": "integer", "minimum": 1}]}
pverse = {"type": "array", "minItems": 3, "items": False, "prefixItems": [
    {"type": "array", "items": INT0, "minItems": 5, "maxItems": 5}, {"type": "array", "items": chip},
    {"type": "array", "items": INT0, "minItems": 20, "maxItems": 20}]}
doc("proto-xref.schema.json", "Prototype ticker pack", "Compact per-book tickers the HTML prototype expands into spec TickerItems (prototype only).",
    "asb.protoXref/2", {"datasetVersion": STR, "rankingVersion": STR, "book": ref("bookNo"), "osis": STR,
                        "legend": {"type": "object"}, "because": {"type": "array", "items": STR},
                        "chapters": {"type": "array", "items": {"type": "array", "items": pverse}}})
doc("proto-text.schema.json", "Prototype text pack", "All verse text as books[bookNo-1][chapter-1][verse-1] (prototype only; empty string = omitted verse, null = not in this data set).",
    "asb.protoText/2", {"translation": ref("translationHeader"), "snippetMaxChars": {"type": "integer"},
                        "books": {"type": "array", "maxItems": 66, "items": {"type": ["array", "null"], "items": {"type": ["array", "null"], "items": {"type": ["string", "null"]}}}}})
doc("proto-ai.schema.json", "Prototype AI notes", "Sample AI notes keyed by connection and by verse (prototype only).", "asb.protoAi/2", {
      "edges": {"type": "object", "propertyNames": {"pattern": "^\\d+>\\d+(-\\d+)?$"}, "additionalProperties": STR},
      "verses": {"type": "object", "propertyNames": {"pattern": "^\\d+$"},
                 "additionalProperties": obj({"summary": STR, "context": STR, "speaker": STR, "themes": {"type": "array", "items": STR},
                                              "readingTip": STR, "questions": {"type": "array", "items": STR}},
                                             required=["summary"], note=False)}},
    required=["edges"])
print(sorted(p.name for p in OUT.glob("*.json")))
