"""Why two verses are connected: a direct quote, the same story, or the same topic.

Deterministic rules over the public-domain Berean Standard Bible text. That text is the analysis
text for every translation, so the reasons never depend on a licensed translation such as the NIV.

Each connection gets:
    {"kind": "quote" | "story" | "topic", "label": "Direct quote" | "Same story" | "Same topic",
     "because": one plain sentence, "basis": which rule fired, "confidence": 0..1,
     "source": "rule", "evidence": {...}}

Rules, first match wins:

  story / parallelAccount  The same account told twice: shared distinctive wording between parallel
                           books (the Gospels; Samuel, Kings and Chronicles; Kings with Isaiah or
                           Jeremiah; Chronicles, Ezra and Nehemiah; Joshua and Judges; Genesis and
                           Chronicles), or inside one narrative book when the passages also share a name.
  story / samePassage      Another part of the same passage: same chapter, at most 20 verses apart
                           (not Proverbs, whose neighbouring sayings are independent).
  quote / sharedWording    Distinctive shared wording: at least two shared word trigrams that occur in
                           at most 30 verses each, forming a run of four or more words. Formulas such as
                           "declares the LORD" or a psalm refrain are too common to count. Old Testament
                           retellings that also share two names become story / retelling instead.
  quote / quotation        A New Testament quotation, inside quotation marks, that reuses most of the
                           Old Testament verse's words (catches quotes whose wording was translated
                           differently, such as Matthew 4:10 and Deuteronomy 6:13).
  story / sharedNames      Both refer to the same specific people: a person named in at most 150 verses
                           plus another shared word; two shared people; a person and a place; two rare
                           places (Sodom and Gomorrah); or a person and a distinctive shared word.
                           A single shared place is not enough, because places host many stories.
  topic / theme            Everything else. The cross-reference dataset links them by theme; the
                           evidence lists the most distinctive words they share, if any.

Confidence is the match strength shown to readers as a percentage. 100% means the passages are literally
the same thing: the same words or the same account. It scales with how much of the shorter passage the
shared wording covers (quotes, parallel accounts), how close the verses sit (same passage), how much
distinctive vocabulary they share, and, for topics only, how strongly OpenBible.info readers voted for the
link. Topics are capped at 80% because a looser topical or word match is never "the same thing".

A later AI pass can replace any reason with source "ai", and an editor with source "editor".
Tested by tests/gold_reasons.json (hand-labelled pairs) through tests/test_pipeline.py.
"""
from __future__ import annotations

import collections
import math
import re

TOKEN = re.compile(r"[A-Za-z]+(?:[’'][A-Za-z]+)?")
SENTENCE_START = re.compile(r"(^|[.!?:;]\s+|[“‘\"(]\s*)([A-Za-z]+)")
INNER_QUOTE = re.compile(r"‘([^‘]*?)’(?![A-Za-z])")
OUTER_QUOTE = re.compile(r"“([^“”]*)(?:”|$)")

LABELS = {"quote": "Direct quote", "story": "Same story", "topic": "Same topic"}

STOP = set("""a about above after again against all also am an and any are as at be because been before being
below between both but by can could did do does doing down during each even ever every few for from further
had has have having he her here hers herself him himself his how i if in into is it its itself just let
may me might more most much must my myself no nor not now o of off on once one only or other ought our
ours ourselves out over own said same say says shall she should so some such than that the their theirs
them themselves then there these they this those through thus to too under until up upon us very was
we were what when where which while who whom whose why will with would yet you your yours yourself
yourselves thee thou thy thine ye unto went come came go goes gone made make makes give gave given take
took taken see saw seen know knew known tell told put set yes indeed like among within without toward
towards therefore however whoever whatever whenever wherever become became becomes stood stand sat sit
turn turned bring brought keep kept call called hear heard speak spoke spoken send sent find found lead
led leave left fell fall rise rose return returned pass passed thing things way ways place great many
another first large small whole away back day days year years time times everyone anyone whoever someone
nothing everything choirmaster maskil miktam psalm song tune director stringed instruments accompanied""".split())

COMMON_CONTENT = {"lord", "god", "said", "says", "people", "man", "men", "things"}

# Capitalized words that are titles, pronouns, spiritual beings or topographic generics, not story names.
NOT_NAMES = set("""I O LORD Lord God GOD Jesus Christ Messiah Spirit Holy Most High Almighty Sovereign Father Son
Lamb Word Savior Redeemer Rock King Mighty One Name Shepherd Branch Counselor Prince Amen Hallelujah Selah
Scripture Scriptures Law Prophets Heaven Kingdom Day He Him His Himself You Your Yours Yourself Me My Mine
Myself We Us Our Hosts Meeting Testimony Psalm Chronicles Book Life Israel Israelites Israelite Judah
Jerusalem Zion Jews Jew Gentiles Gentile Sabbath Passover Sheol Hebrew Hebrews Beth Baptist Satan Devil
Valley River Sea Mount Mountain City Gate Temple Tent Brook Spring Wilderness Desert Plain Hill""".split())

PLACE_PREP = {"in", "to", "from", "at", "into", "toward", "near", "through", "of", "against", "across", "beyond"}
KIN = {"father", "mother", "son", "sons", "daughter", "daughters", "wife", "brother", "brothers", "house",
       "descendants", "family", "servant", "servants", "king", "people"}
PERSON_NEXT = {"son", "said", "replied", "answered", "king", "went", "took", "sent"}

PARALLEL_GROUPS = [
    ("the Gospels", {40, 41, 42, 43}),
    ("Samuel, Kings and Chronicles", {9, 10, 11, 12, 13, 14}),
    ("Kings and Isaiah", {12, 23}),
    ("Kings, Chronicles and Jeremiah", {12, 14, 24}),
    ("Chronicles, Ezra and Nehemiah", {14, 15, 16}),
    ("Joshua and Judges", {6, 7}),
    ("Genesis and Chronicles", {1, 13}),
]
NARRATIVE_BOOKS = {1, 2, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 27, 32, 40, 41, 42, 43, 44}
NO_SAME_PASSAGE = {20}

RARE_TRIGRAM_DF = 30
VERY_RARE_TRIGRAM_DF = 12
RARE_WORD_DF = 60
SPECIFIC_NAME_DF = 150
KNOWN_NAME_DF = 400
NAME_DF_CAP = 1000
SAME_PASSAGE_SPAN = 20
MAX_RANGE_VERSES = 12


def _norm(w: str) -> str:
    return re.sub(r"[’']s$", "", w)


def quoted_spans(text: str) -> list[str]:
    """Text inside the innermost quotation marks of a verse; the BSB marks Old Testament quotations this way."""
    inner = INNER_QUOTE.findall(text)
    return inner if inner else [m for m in OUTER_QUOTE.findall(text) if m.strip()]


def stem(w: str) -> str:
    """Light suffix stripping so theme words match across forms (loved/love, believes/believe)."""
    for suf in ("ings", "ing", "edly", "ed", "eth", "est", "es", "s", "ly"):
        if w.endswith(suf) and len(w) - len(suf) >= 3:
            w = w[: -len(suf)]
            break
    return w[:-1] if w.endswith("e") and len(w) > 3 else w


def join_words(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1] if items else ""


class ReasonModel:
    def __init__(self, text: dict[int, str], ordlist: list[int], ordinal: dict[int, int], book_names: dict[int, str]):
        self.text, self.ordlist, self.ordinal, self.book_names = text, ordlist, ordinal, book_names
        self.words: dict[int, list[str]] = {}
        self.stems: dict[int, list[str]] = {}
        self.surface: dict[int, list[str]] = {}
        self.names: dict[int, set[str]] = {}
        cap, low, prep, cue = (collections.Counter() for _ in range(4))
        name_df, word_df, tri_df, stem_df = (collections.Counter() for _ in range(4))
        coordinated: list[tuple[str, str]] = []  # (name before "and", name after "and")
        for vid in ordlist:
            t = text[vid]
            starts = {m.start(2) for m in SENTENCE_START.finditer(t)}
            toks = [(_norm(m.group(0)), m.start()) for m in TOKEN.finditer(t)]
            caps = set()
            for i, (w, pos) in enumerate(toks):
                if w[0].isupper():
                    caps.add(w)
                if w[0].isupper() and pos not in starts:
                    cap[w] += 1
                    p1 = toks[i - 1][0].lower() if i >= 1 else ""
                    p2 = toks[i - 2][0].lower() if i >= 2 else ""
                    p3 = toks[i - 3][0].lower() if i >= 3 else ""
                    kin_of = p1 == "of" and (p2 in KIN or (p2 == "the" and p3 in KIN))
                    if kin_of or (i + 1 < len(toks) and toks[i + 1][0].lower() in PERSON_NEXT):
                        cue[w] += 1
                    elif p1 in PLACE_PREP or (p1 == "the" and p2 in PLACE_PREP):
                        prep[w] += 1
                    if p1 == "and" and i >= 2 and toks[i - 2][0][0].isupper():
                        coordinated.append((toks[i - 2][0], w))
                elif w[0].islower():
                    low[w] += 1
            surf = [w for w, _ in toks]
            words = [w.lower() for w in surf]
            self.surface[vid], self.words[vid], self.names[vid] = surf, words, caps
            self.stems[vid] = [stem(w) for w in words]
            word_df.update(set(words))
            stem_df.update(set(self.stems[vid]))
            tri_df.update(set(zip(words, words[1:], words[2:])))
            name_df.update(caps)
        self.word_df, self.tri_df, self.name_df, self.stem_df, self.n = word_df, tri_df, name_df, stem_df, len(ordlist)
        self.capitalized = {w.lower() for w, c in cap.items() if c > low.get(w.lower(), 0)}
        self.is_name = {w for w, c in cap.items()
                        if c >= 2 and w not in NOT_NAMES and low.get(w.lower(), 0) <= 3 * c and name_df[w] <= NAME_DF_CAP}
        place = {w for w in self.is_name if prep[w] >= 0.55 * cap[w] and cue[w] <= 0.10 * cap[w]}
        after_place = collections.Counter(b for a, b in coordinated if a in place)
        place |= {w for w in self.is_name if after_place[w] >= 0.5 * cap[w] and cue[w] <= 0.10 * cap[w]}
        # people groups (Levites, Philistines, Pharisees) host many stories, so they count like places
        place |= {w for w in self.is_name if w.endswith(("ites", "ians", "ees")) or w in {"Philistines", "Chaldeans"}}
        self.is_place = place
        for vid in ordlist:
            self.names[vid] = {w for w in self.names[vid] if w in self.is_name}

    # ------------------------------------------------------------ helpers

    def idf(self, w: str) -> float:
        return math.log(self.n / max(1, self.word_df.get(w, 1)))

    def _range(self, start: int, end: int) -> list[int]:
        a, b = self.ordinal[start], self.ordinal[end]
        return self.ordlist[a:min(b, a + MAX_RANGE_VERSES - 1) + 1]

    def _book(self, vid: int) -> str:
        return self.book_names[vid // 1_000_000]

    def label(self, start: int, end: int | None = None) -> str:
        end = end or start
        c, v = (start // 1000) % 1000, start % 1000
        if end == start:
            return f"{self._book(start)} {c}:{v}"
        c2, v2 = (end // 1000) % 1000, end % 1000
        if end // 1_000_000 != start // 1_000_000:
            return f"{self._book(start)} {c}:{v}–{self._book(end)} {c2}:{v2}"
        return f"{self._book(start)} {c}:{v}–{v2}" if c2 == c else f"{self._book(start)} {c}:{v}–{c2}:{v2}"

    def _shared_run(self, a: int, targets: list[int]) -> tuple[int, int, int, str, float]:
        """(rare shared trigrams, very rare ones, longest shared run in words, that run's text as it reads in verse a,
        the run's coverage of the shorter of verse a and the target verse it came from)."""
        wa = self.words[a]
        tri_b, tri_of = set(), {}
        for t in targets:
            wb = self.words[t]
            tris = set(zip(wb, wb[1:], wb[2:]))
            tri_b |= tris
            tri_of[t] = tris
        shared = [i for i, g in enumerate(zip(wa, wa[1:], wa[2:])) if g in tri_b]
        if not shared:
            return 0, 0, 0, "", 0.0
        dfs = [self.tri_df[(wa[i], wa[i + 1], wa[i + 2])] for i in shared]
        rare = sum(1 for d in dfs if d <= RARE_TRIGRAM_DF)
        very_rare = sum(1 for d in dfs if d <= VERY_RARE_TRIGRAM_DF)
        best_len = best_start = 0
        run_start = prev = shared[0]
        for i in shared[1:] + [None]:
            if i is not None and i == prev + 1:
                prev = i
                continue
            if prev - run_start + 3 > best_len:
                best_len, best_start = prev - run_start + 3, run_start
            if i is not None:
                run_start = prev = i
        first = (wa[best_start], wa[best_start + 1], wa[best_start + 2])
        t_len = min((len(self.words[t]) for t in targets if first in tri_of[t]), default=len(wa))
        coverage = min(1.0, best_len / max(1, min(len(wa), t_len)))
        return rare, very_rare, best_len, " ".join(self.surface[a][best_start:best_start + best_len]), coverage

    def _shared_words(self, a: int, targets: list[int], limit: int = 3) -> list[str]:
        """The most distinctive words verse a shares with the targets, matched on stems, in a's wording."""
        sb = set()
        for t in targets:
            sb.update(self.stems[t])
        seen, out = set(), []
        rows = sorted(zip(self.surface[a], self.words[a], self.stems[a]),
                      key=lambda x: math.log(self.n / max(1, self.stem_df[x[2]])), reverse=True)
        for surf, w, st in rows:
            if st in sb and w not in STOP and len(w) > 2 and st not in seen and self.stem_df[st] < 2000:
                seen.add(st)
                out.append(surf if (surf in self.is_name or w in self.capitalized) else w)
                if len(out) == limit:
                    break
        return out

    def _quotation_cover(self, verses: list[int], phrase: str) -> float:
        """How much of a marked quotation in these verses the shared phrase covers (1.0 = the whole quotation)."""
        run = [w.lower() for w in (_norm(x) for x in TOKEN.findall(phrase))]
        if not run:
            return 0.0
        needle = " " + " ".join(run) + " "
        best = 0.0
        for v in verses:
            for span in quoted_spans(self.text[v]):
                toks = [w.lower() for w in (_norm(x) for x in TOKEN.findall(span))]
                if toks and needle in " " + " ".join(toks) + " ":
                    best = max(best, min(1.0, len(run) / len(toks)))
        return best

    def _theme_coverage(self, a: int, targets: list[int]) -> float:
        """Share of verse a's distinctive vocabulary (idf-weighted content stems) that the targets also use."""
        sb = set()
        for t in targets:
            sb.update(self.stems[t])
        total = hit = 0.0
        for w, st in dict(zip(self.words[a], self.stems[a])).items():
            if w in STOP or len(w) <= 2:
                continue
            weight = math.log(self.n / max(1, self.stem_df[st]))
            total += weight
            if st in sb:
                hit += weight
        return hit / total if total else 0.0

    def _quoted_overlap(self, quoting: list[int], quoted: list[int]) -> str:
        """The quotation inside the New Testament verse(s) that reuses the Old Testament words, or ''."""
        target_words = set()
        for t in quoted:
            target_words.update(self.words[t])
        for v in quoting:
            for span in quoted_spans(self.text[v]):
                content = [w for w in dict.fromkeys(_norm(x).lower() for x in TOKEN.findall(span))
                           if w not in STOP and len(w) > 2]
                if len(content) < 2:
                    continue
                shared = [w for w in content if w in target_words]
                rare = [w for w in shared if w not in COMMON_CONTENT and self.word_df[w] <= 100]
                mid = [w for w in shared if w not in COMMON_CONTENT and self.word_df[w] <= 400]
                if len(shared) / len(content) >= 0.6 and ((len(shared) >= 2 and rare) or (len(shared) >= 3 and mid)):
                    self._last_span_cover = len(shared) / len(content)
                    return span.strip()
        return ""

    def _parallel_group(self, fb: int, tb: int, far_apart: bool) -> str | None:
        if fb == tb:
            return f"two places in {self.book_names[fb]}" if fb in NARRATIVE_BOOKS and far_apart else None
        for name, books in PARALLEL_GROUPS:
            if fb in books and tb in books:
                return name
        return None

    @staticmethod
    def _reason(kind: str, because: str, basis: str, confidence: float, evidence: dict) -> dict:
        return {"kind": kind, "label": LABELS[kind], "because": because, "basis": basis,
                "confidence": round(min(1.0, max(0.05, confidence)), 2), "source": "rule",
                "evidence": {k: v for k, v in evidence.items() if v not in (None, [], "")}}

    # ------------------------------------------------------------ classify

    def classify(self, focus: int, start: int, end: int, score: float = 0.0) -> dict:
        """Reason for the connection focus -> [start..end]. score is the merged ranking score (votes), used only
        for the confidence of topic matches."""
        targets = self._range(start, end)
        fb, tb = focus // 1_000_000, start // 1_000_000
        distance = abs(self.ordinal[start] - self.ordinal[focus])
        rare_tri, very_rare, run, phrase, run_cover = self._shared_run(focus, targets)
        cover = self._theme_coverage(focus, targets)
        votes = min(1.0, math.log(1 + max(0.0, score)) / math.log(61))
        ot_nt = (fb <= 39) != (tb <= 39)
        content = [w.lower() for w in TOKEN.findall(phrase) if w.lower() not in STOP and len(w) > 2]
        meaningful = ot_nt or (len(content) >= 2 and min(self.word_df[w] for w in content) <= 250)
        wording = rare_tri >= 2 and run >= 4 and meaningful
        rare_words = [w for w in self._shared_words(focus, targets, limit=6) if self.word_df[w.lower()] <= RARE_WORD_DF]
        names_b = set()
        for t in targets:
            names_b |= self.names[t]
        shared = sorted(self.names[focus] & names_b, key=lambda w: -self.name_df[w])
        people = [w for w in shared if w not in self.is_place]
        places = [w for w in shared if w in self.is_place]
        display_names = people + places
        a_label, b_label = self.label(focus), self.label(start, end)

        # 1. the same account told twice
        group = self._parallel_group(fb, tb, distance > SAME_PASSAGE_SPAN * 3)
        strong = run >= 4 and very_rare >= (2 if fb != tb else 3)
        if group and (fb != tb or shared) and (strong or (fb != tb and very_rare >= 1 and len(rare_words) >= 2)):
            where = f"{self._book(focus)} and {self._book(start)}" if fb != tb else group
            conf = 0.82 + 0.18 * run_cover if strong else 0.72 + 0.13 * cover
            return self._reason("story", f"The same account told in {where}", "parallelAccount",
                                conf, {"parallel": group, "phrase": phrase})

        # 2. another part of the same passage
        if fb == tb and fb not in NO_SAME_PASSAGE and focus // 1000 == start // 1000 and distance <= SAME_PASSAGE_SPAN:
            conf = 0.84 - 0.004 * distance + 0.12 * cover
            return self._reason("story", f"Another part of the same passage in {self._book(focus)} {(focus // 1000) % 1000}",
                                "samePassage", conf, {})

        # 3. direct quote
        span = ""
        if not wording and ot_nt:
            span = self._quoted_overlap([focus], targets) if fb > 39 else self._quoted_overlap(targets, [focus])
        if wording or span:
            if wording and not ot_nt and len(shared) >= 2 and (fb in NARRATIVE_BOOKS or tb in NARRATIVE_BOOKS):
                return self._reason("story", f"Both retell the account of {join_words(display_names[:2])}", "retelling",
                                    0.72 + 0.18 * max(cover, run_cover), {"names": display_names[:3], "phrase": phrase})
            if ot_nt:
                nt, ot = (a_label, b_label) if fb > 39 else (b_label, a_label)
                because = f"{nt} quotes {ot}"
            else:
                because = f"{a_label} and {b_label} share the same words"
            if wording and ot_nt:
                nt_side = [focus] if fb > 39 else targets
                run_cover = max(run_cover, self._quotation_cover(nt_side, phrase))
            conf = (0.80 + 0.20 * run_cover) if wording else (0.74 + 0.16 * getattr(self, "_last_span_cover", 0.6))
            return self._reason("quote", because, "sharedWording" if wording else "quotation",
                                conf, {"phrase": phrase if wording else span})

        # 4. the same specific people
        specific_people = [w for w in people if self.name_df[w] <= SPECIFIC_NAME_DF]
        rare_places = [w for w in places if self.name_df[w] <= SPECIFIC_NAME_DF]
        known_people = [w for w in people if self.name_df[w] <= KNOWN_NAME_DF]
        other = [w for w in self._shared_words(focus, targets, limit=6) if w not in shared and self.word_df[w.lower()] <= 1500]
        rare_other = [w for w in rare_words if w not in shared]
        very_rare_other = [w for w in rare_other if self.word_df[w.lower()] <= 30]
        if ((specific_people and other) or len(people) >= 2 or (people and rare_places) or len(rare_places) >= 2
                or (known_people and rare_other) or (people and very_rare_other)):
            names = [w for w in display_names if w in people or w in rare_places][:2]
            conf = min(0.85, 0.58 + 0.06 * min(3, len(shared)) + 0.15 * cover)
            return self._reason("story", f"Both tell of {join_words(names)}", "sharedNames",
                                conf, {"names": names, "words": rare_other[:2]})

        # 5. the same topic
        words = self._shared_words(focus, targets)
        because = f"Shared theme: {join_words(words)}" if words else "Linked by theme"
        conf = min(0.80, 0.30 + 0.30 * cover + 0.30 * votes)
        return self._reason("topic", because, "theme", conf, {"words": words})
