"""Regression tests for the dataset pipeline. Run: python3 -m unittest discover -s tests -v

They pin the worked examples in docs/DATA_MODEL.md so a change to ranking, labels or snippets
shows up as a failing test instead of a silent shift in what the ticker shows.
"""
import json
import math
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from build_dataset import Builder, Dataset, label_of, ref_of  # noqa: E402
from sources import ensure_sources  # noqa: E402


class PipelineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ds = Dataset(*ensure_sources(ROOT / "data" / "sources"))
        from build_dataset import BOOK
        from reasons import ReasonModel
        rm = ReasonModel(cls.ds.text, cls.ds.ordlist, cls.ds.ordinal, {b: BOOK[b]["displayName"] for b in BOOK})
        cls.b = Builder(cls.ds, {}, rm)

    def test_dataset_totals(self):
        s = self.ds.stats
        self.assertEqual(len(self.ds.ordlist), 31102)
        self.assertEqual(s["edges"], 343608)
        self.assertEqual(s["edgesDroppedForMissingVerse"], 1)
        self.assertEqual(s["edgesClampedToBsbVersification"], 4)
        self.assertEqual(s["incomingRows"], 596218)
        self.assertEqual(s["rangesOver40Verses"], 295)

    def test_john_3_16_worked_example(self):
        m = self.ds.merged(43003016)
        self.assertEqual(len(m), 110)
        top = m[0]
        self.assertEqual((top["start"], top["votesOut"], top["votesIn"], top["score"], top["weight"]),
                         (45005008, 178, 33, 194.5, 1.0))
        self.assertEqual(top["direction"], "both")
        self.assertEqual(top["tier"], "strong")
        second = m[1]
        self.assertEqual((second["start"], second["end"], second["score"], second["weight"]),
                         (62004009, 62004010, 128.5, 0.922))
        c = self.ds.counts(43003016, m)
        self.assertEqual((c["out"], c["in"], c["inDirect"], c["inViaRange"], c["more"]), (23, 104, 53, 51, 98))

    def test_range_discount_and_via_range(self):
        m = {it["start"]: it for it in self.ds.merged(43003015)}
        it = m[43003036]  # John 3:36 cites John 3:15-16 with 10 votes and is cited by 3:15 with 7
        self.assertAlmostEqual(it["score"], round(7 + 0.5 * 10 / math.sqrt(2), 2))
        self.assertEqual(it["via"]["label"], "John 3:15–16")

    def test_ranking_is_sorted_and_weights_bounded(self):
        for vid in (1001001, 19119105, 44024025, 66022021):
            m = self.ds.merged(vid)
            scores = [it["score"] for it in m]
            self.assertEqual(scores, sorted(scores, reverse=True))
            self.assertTrue(all(0 <= it["weight"] <= 1 for it in m))
            if m:
                self.assertEqual(m[0]["weight"], 1.0)

    def test_labels(self):
        self.assertEqual(label_of(19002007), "Psalm 2:7")
        self.assertEqual(label_of(62004009, 62004010), "1 John 4:9–10")
        self.assertEqual(label_of(23052013, 23053012), "Isaiah 52:13–53:12")
        self.assertEqual(label_of(63001001, 64001014), "2 John 1:1–3 John 1:14")
        self.assertEqual(ref_of(62004009, 62004010), "1John.4.9-1John.4.10")

    def test_snippets(self):
        s = self.ds.snippet(43003016)
        self.assertTrue(s.endswith("…"))
        self.assertLessEqual(len(s), 111)
        self.assertEqual(self.ds.snippet(62004019), "We love because He first loved us.")
        self.assertEqual(self.ds.text[40017021], "")  # omitted verse in BSB

    def test_samples_match_spec_examples(self):
        spec = (ROOT / "docs" / "DATA_MODEL.md").read_text(encoding="utf-8")
        i = spec.find("### 4.2")
        a = spec.find("```json", i) + 7
        feed = json.loads(spec[a:spec.find("```", a)])
        gen = self.b.ticker_feed(43003016)
        for want, got in zip(feed["items"], gen["items"]):
            for k in ("rank", "to", "direction", "votesOut", "votesIn", "score", "weight", "tier", "sameBook",
                      "viaRange", "snippet", "dwellSeconds", "reason"):
                self.assertEqual(want[k], got[k], f"rank {want['rank']} field {k}")



class SchemaTest(unittest.TestCase):
    """Every committed JSON document validates against schema/ (skipped when jsonschema is not installed)."""

    def test_committed_documents_validate(self):
        try:
            import validate  # tools/validate.py
        except ImportError as e:  # pragma: no cover
            self.skipTest(f"jsonschema not installed: {e}")
        validators = validate.load_validators()
        paths = list(validate.iter_files([str(ROOT / "data" / "samples"), str(ROOT / "prototype" / "data")]))
        self.assertGreater(len(paths), 80)
        for p in paths:
            doc = json.loads(p.read_text(encoding="utf-8"))
            errors = list(validators[doc["schema"]].iter_errors(doc))
            self.assertEqual(errors, [], f"{p}: {errors[:1]}")



class ReasonTest(unittest.TestCase):
    """Connection reasons (tools/reasons.py) against the hand-labelled pairs in tests/gold_reasons.json."""

    @classmethod
    def setUpClass(cls):
        from build_dataset import BOOK, BOOK_NO
        from reasons import ReasonModel
        cls.ds = Dataset(*ensure_sources(ROOT / "data" / "sources"))
        cls.rm = ReasonModel(cls.ds.text, cls.ds.ordlist, cls.ds.ordinal, {b: BOOK[b]["displayName"] for b in BOOK})
        cls.book_no = BOOK_NO

    def vid(self, ref):
        b, c, v = ref.split(".")
        return self.book_no[b] * 1_000_000 + int(c) * 1000 + int(v)

    def test_gold_pairs(self):
        gold = json.loads((ROOT / "tests" / "gold_reasons.json").read_text(encoding="utf-8"))["pairs"]
        wrong = []
        for focus, target, kinds in gold:
            fv, tv = self.vid(focus), self.vid(target)
            item = next((it for it in self.ds.merged(fv) if it["start"] <= tv <= it["end"]), None)
            self.assertIsNotNone(item, f"{focus} -> {target} is not a connection in the dataset")
            r = self.rm.classify(fv, item["start"], item["end"])
            if r["kind"] not in kinds:
                wrong.append(f"{focus} -> {target}: {r['kind']} ({r['because']}), expected {kinds}")
        self.assertEqual(wrong, [])

    def test_reason_shape_and_wording(self):
        r = self.rm.classify(19022001, 40027046, 40027046)
        self.assertEqual((r["kind"], r["label"], r["because"]), ("quote", "Direct quote", "Matthew 27:46 quotes Psalm 22:1"))
        r = self.rm.classify(43003016, 43003015, 43003015)
        self.assertEqual((r["kind"], r["basis"]), ("story", "samePassage"))
        r = self.rm.classify(43003016, 45005008, 45005008)
        self.assertEqual((r["kind"], r["because"]), ("topic", "Shared theme: loved"))
        self.assertEqual(r["source"], "rule")


class ConfidenceTest(unittest.TestCase):
    """The match percentage: 100% for the same words or the same account, lower for looser matches."""

    @classmethod
    def setUpClass(cls):
        from build_dataset import BOOK
        from reasons import ReasonModel
        cls.ds = Dataset(*ensure_sources(ROOT / "data" / "sources"))
        cls.rm = ReasonModel(cls.ds.text, cls.ds.ordlist, cls.ds.ordinal, {b: BOOK[b]["displayName"] for b in BOOK})

    def conf(self, focus, target):
        it = next(i for i in self.ds.merged(focus) if i["start"] <= target <= i["end"])
        return self.rm.classify(focus, it["start"], it["end"], it["score"])

    def test_exact_matches_are_100(self):
        self.assertEqual(self.conf(19022001, 40027046)["confidence"], 1.0)   # Psalm 22:1 in Matthew 27:46
        self.assertEqual(self.conf(40013005, 41004005)["confidence"], 1.0)   # Matthew 13:5 = Mark 4:5
        self.assertEqual(self.conf(45001017, 35002004)["confidence"], 1.0)   # Romans 1:17 quotes Habakkuk 2:4

    def test_looser_matches_score_lower(self):
        topic = self.conf(43003016, 45005008)                                  # John 3:16 and Romans 5:8
        self.assertEqual(topic["kind"], "topic")
        self.assertTrue(0.5 <= topic["confidence"] <= 0.8, topic)
        passage = self.conf(43003016, 43003015)
        self.assertTrue(0.8 <= passage["confidence"] < 1.0, passage)
        for vid in (1001001, 19023001, 58011001):
            for it in self.ds.merged(vid)[:12]:
                r = self.rm.classify(vid, it["start"], it["end"], it["score"])
                self.assertTrue(0.05 <= r["confidence"] <= 1.0)
                if r["kind"] == "topic":
                    self.assertLessEqual(r["confidence"], 0.8)


class SpecSyncTest(unittest.TestCase):
    def test_spec_examples_match_samples(self):
        import subprocess
        result = subprocess.run([sys.executable, str(ROOT / "tools" / "sync_spec.py"), "--check"],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)



if __name__ == "__main__":
    unittest.main()
