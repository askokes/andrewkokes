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
        cls.b = Builder(cls.ds, {})

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
                      "viaRange", "snippet", "dwellSeconds"):
                self.assertEqual(want[k], got[k], f"rank {want['rank']} field {k}")


if __name__ == "__main__":
    unittest.main()
