"""Fill `sentence_pron` (expected pronunciation + prosody of the item's sentence) into agent/content/*.content.json.

Contract: docs/stage3-contracts.md §1–3, §6 in the app repo; decisions: tools/pronunciation-model/G2P-EVAL.md.
Offline tool with its own venv (tools/sentence_pron/requirements.txt); not run in CI — CI only validates the result
(tools/sentence_pron_check.py via validate.py).

usage: tools/sentence_pron/.venv/bin/python tools/sentence_pron.py [content.json ...] [--check] [--flags]

  --check   write nothing; exit 1 if any item would change or has unreviewed flags
  --flags   list every flag, reviewed ones included

Per word token (tools/tokenizer.py):
  ph      first CMUdict variant (ZIPA expects dictionary forms); target words use the item's reviewed
          `phonemes` / tools/phonemes_manual.json; OOV → g2p_en; acronyms letter by letter; numbers spelled
          like the app (NumberFormatter .spellOut, en_US — "21" → twenty-one), except years (1100–2099), read
          naturally ("2025" → twenty twenty-five) with the spelled-out cardinal as an alt.
  alt     ≤ 3 objects {ph, p}: weak forms of function words (tools/weak_forms.json penalties), other CMUdict
          variants (p 0.5), MFA english_us_arpa variants with probability ≥ 0.1 (p 0.7), espeak-ng (p 0.7).
  fn/wt   function word by POS (DET ADP AUX CCONJ SCONJ PART PRON; not negation, not verb particles) → wt 0.3;
          target 1.5; others 1.0.
  hom     homographs (read, live, record, use, …): pronunciation chosen by POS; spaCy and NLTK disagree → "ambiguous".
Sentence: joins [] (G2P-EVAL), skip_cost 4.0, chunks (1–4, 4–12 words; for > 48 words up to ⌈n/4⌉), prosody
(type, tune, nucleus = last content word, breaks from punctuation, syllables).

Uncertain cases are printed as flags; the agent reviews them and records decisions in
tools/sentence_pron/overrides.json ({"<lesson id>/<item text>": {"set": {"words[3].ph": "…"}, "reviewed": [flag…]}}),
so reruns are reproducible.
"""
import json, math, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"
sys.path.insert(0, str(TOOLS))
import content_io  # noqa: E402
import sentence_pron_check as spc  # noqa: E402
import tokenizer  # noqa: E402

CACHE = TOOLS / "cache"
OVERRIDES = TOOLS / "sentence_pron" / "overrides.json"
_OV = __import__("json").loads(OVERRIDES.read_text()) if OVERRIDES.exists() else {}
# Reviewed pronunciations of words, applied wherever they occur: {"evals": {"ph": "…", "alt": [{"ph", "p"}]}}.
WORD_OVERRIDES = _OV.get("_words", {})
G2P = {"src": "cmu+mfa+espeak+weak", "ver": 1}
SKIP_COST = 4.0
P_CMU, P_MFA, P_ESPEAK, P_YEAR_CARDINAL = 0.5, 0.7, 0.7, 0.3
FN_POS = {"DET", "ADP", "AUX", "CCONJ", "SCONJ", "PART", "PRON"}
NEGATION = {"not", "n't", "no", "never", "none", "nothing", "nobody", "neither", "nor"}
WH = {"what", "why", "how", "when", "where", "who", "whom", "whose", "which"}
AUX_START = {"is", "are", "was", "were", "am", "do", "does", "did", "can", "could", "will", "would", "should", "shall",
             "may", "might", "must", "have", "has", "had", "isn't", "aren't", "wasn't", "weren't", "don't", "doesn't",
             "didn't", "can't", "couldn't", "won't", "wouldn't", "shouldn't", "haven't", "hasn't", "hadn't"}
LEADING = {"but", "and", "so", "or", "oh", "well", "now", "then"}
LETTERS = {
    "a": "EY1", "b": "B IY1", "c": "S IY1", "d": "D IY1", "e": "IY1", "f": "EH1 F", "g": "JH IY1", "h": "EY1 CH",
    "i": "AY1", "j": "JH EY1", "k": "K EY1", "l": "EH1 L", "m": "EH1 M", "n": "EH1 N", "o": "OW1", "p": "P IY1",
    "q": "K Y UW1", "r": "AA1 R", "s": "EH1 S", "t": "T IY1", "u": "Y UW1", "v": "V IY1",
    "w": "D AH1 B AH0 L Y UW0", "x": "EH1 K S", "y": "W AY1", "z": "Z IY1",
}
# Homographs: word → {coarse POS → ARPAbet}; "*" = fallback (then hom is "ambiguous" unless POS decided).
HOMOGRAPHS = {
    "read": {"past": "R EH1 D", "*": "R IY1 D"},
    "reads": {"*": "R IY1 D Z"},
    "live": {"ADJ": "L AY1 V", "ADV": "L AY1 V", "VERB": "L IH1 V"},
    "lives": {"NOUN": "L AY1 V Z", "VERB": "L IH1 V Z"},
    "lead": {"VERB": "L IY1 D", "*": "L IY1 D"},
    "use": {"NOUN": "Y UW1 S", "VERB": "Y UW1 Z"},
    "uses": {"NOUN": "Y UW1 S IH0 Z", "VERB": "Y UW1 Z IH0 Z"},
    "close": {"ADJ": "K L OW1 S", "ADV": "K L OW1 S", "VERB": "K L OW1 Z", "NOUN": "K L OW1 Z"},
    "wind": {"NOUN": "W IH1 N D", "VERB": "W AY1 N D"},
    "tear": {"VERB": "T EH1 R", "*": "T EH1 R"},
    "minute": {"NOUN": "M IH1 N AH0 T", "ADJ": "M AY0 N UW1 T"},
    "wound": {"NOUN": "W UW1 N D", "*": "W AW1 N D"},
    "separate": {"ADJ": "S EH1 P ER0 AH0 T", "VERB": "S EH1 P ER0 EY2 T"},
    "appropriate": {"ADJ": "AH0 P R OW1 P R IY0 AH0 T", "VERB": "AH0 P R OW1 P R IY0 EY2 T"},
    "estimate": {"NOUN": "EH1 S T AH0 M AH0 T", "VERB": "EH1 S T AH0 M EY2 T"},
    "moderate": {"ADJ": "M AA1 D ER0 AH0 T", "VERB": "M AA1 D ER0 EY2 T"},
    "duplicate": {"ADJ": "D UW1 P L AH0 K AH0 T", "NOUN": "D UW1 P L AH0 K AH0 T", "VERB": "D UW1 P L AH0 K EY2 T"},
}
# Noun/verb stress pairs: NOUN/ADJ → earliest primary stress among CMU variants, VERB → latest.
STRESS_PAIRS = {"record", "present", "object", "project", "content", "permit", "produce", "conduct", "desert",
                "contract", "increase", "decrease", "progress", "refuse", "subject", "suspect", "conflict", "contest",
                "convert", "export", "import", "insult", "protest", "rebel", "transfer", "upgrade", "update",
                "records", "projects", "increases", "updates", "upgrades", "imports", "exports", "conducts"}


# --- dictionaries -----------------------------------------------------------------------------------------
def _cmudict():
    d = {}
    for line in (CACHE / "cmudict.dict").read_text(encoding="utf-8").splitlines():
        parts = line.split("#")[0].split()
        if parts:
            d.setdefault(re.sub(r"\(\d+\)$", "", parts[0]), []).append(" ".join(parts[1:]))
    return d


def _mfa():
    d = {}
    path = CACHE / "english_us_arpa.dict"
    if not path.exists():
        print("note: tools/cache/english_us_arpa.dict is missing — MFA variants skipped (see README)")
        return d
    for line in path.read_text(encoding="utf-8").splitlines():
        p = line.split("\t")
        if len(p) >= 6:
            d.setdefault(p[0], []).append((float(p[1]), p[5]))
    for w in d:
        d[w].sort(key=lambda x: -x[0])
    return d


CMU = _cmudict()
MFA = _mfa()
MANUAL = {k: v for k, v in json.loads((TOOLS / "phonemes_manual.json").read_text()).items() if not k.startswith("_")}
WEAK = json.loads((TOOLS / "weak_forms.json").read_text())["words"]


def zkey(seq):
    """Key for de-duplication as ZIPA hears it: stress only matters for AH/ER/IH 0 (ə) vs stressed."""
    out = []
    for p in seq.replace("|", " ").split():
        base = p.rstrip("012")
        out.append(base + "0" if base in ("AH", "ER", "IH") and p.endswith("0") else base)
    return " ".join(out)


# --- numbers (same words as the app's NumberFormatter .spellOut, en_US) --------------------------------------
ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen " \
       "seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def spell_int(n):
    if n < 20:
        return ONES[n]
    if n < 100:
        return TENS[n // 10] + ("-" + ONES[n % 10] if n % 10 else "")
    for size, name in ((10**9, "billion"), (10**6, "million"), (1000, "thousand"), (100, "hundred")):
        if n >= size:
            head, rest = divmod(n, size)
            return f"{spell_int(head)} {name}" + (f" {spell_int(rest)}" if rest else "")
    raise ValueError(n)


def spell_year(n):
    if 2000 <= n <= 2009:
        return spell_int(n)
    hi, lo = divmod(n, 100)
    if lo == 0:
        return f"{spell_int(hi)} hundred"
    return f"{spell_int(hi)} {'oh-' + ONES[lo] if lo < 10 else spell_int(lo)}"


def number_words(tok):
    """(natural words, cardinal words or None, is_decimal) for a number token, or None."""
    t = tok.replace(",", "")
    if re.fullmatch(r"\d{1,9}", t) and (tok == t or re.fullmatch(r"\d{1,3}(,\d{3})+", tok)):
        n = int(t)
        if tok == t and len(t) == 4 and 1100 <= n <= 2099:
            return spell_year(n), spell_int(n), False
        return spell_int(n), None, False
    if re.fullmatch(r"\d+\.\d+", tok):
        a, b = tok.split(".")
        return f"{spell_int(int(a))} point " + " ".join(ONES[int(c)] for c in b), None, True
    return None


# --- word → ARPAbet ------------------------------------------------------------------------------------------
_g2p = None


def g2p_en(word):
    global _g2p
    if _g2p is None:
        from g2p_en import G2p
        _g2p = G2p()
    return " ".join(p for p in _g2p(word) if p.strip() and p[0].isalpha())


def spell_letters(chars):
    phones = []
    for i, ch in enumerate(chars):
        ph = CMU[ONES[int(ch)]][0] if ch.isdigit() else LETTERS[ch.lower()]
        phones.append(ph if i == len(chars) - 1 else ph.replace("1", "2"))
    return " ".join(phones)


def possessive(base):
    last = base.split()[-1]
    if last in ("S", "Z", "SH", "ZH", "CH", "JH"):
        return base + " IH0 Z"
    if last in ("P", "T", "K", "F", "TH"):
        return base + " S"
    return base + " Z"


def is_acronym(part):
    core = part[:-1] if part.endswith("s") and part[:-1].isupper() else part
    return 2 <= len(core) <= 6 and core.isupper() and core.isalnum() and any(c.isalpha() for c in core)


# Upper-case words read as words, not letters.
ACRONYM_WORDS = {"OK"}


def known(n):
    """Reviewed or dictionary pronunciation of a normalized word (manual first)."""
    return MANUAL.get(n) or (CMU[n][0] if n in CMU else None)


def compound(n):
    """OOV compound of two dictionary words (datastores, deepdive, coinbase) → ARPAbet, else None."""
    best = None
    for i in range(3, len(n) - 2):
        a, b = known(n[:i]), known(n[i:])
        if a and b and (best is None or min(i, len(n) - i) > best[0]):
            first = a
            second = b.replace("1", "2")  # compounds: primary stress on the first element
            best = (min(i, len(n) - i), f"{first} {second}")
    return best[1] if best else None


def word_ph(word, flags=None):
    """(ph, cmu_variants) for one hyphen-free word as written. Acronyms: ([] variants, spelled)."""
    n = tokenizer.normalize(word)
    if n in MANUAL:
        return MANUAL[n], [MANUAL[n]]
    if is_acronym(word) and word not in ACRONYM_WORDS:
        core, plural = (word[:-1], True) if word.endswith("s") and not word.isupper() else (word, False)
        if flags is not None:
            flags.append(f"ACR:{word}")
        ph = spell_letters(core)
        return (ph + (" Z" if plural else "")), []
    if n in CMU:
        return CMU[n][0], CMU[n]
    base, suffix = (n[:-2], "poss") if n.endswith("'s") else ((n[:-1], "pl") if n.endswith("s") else (n, None))
    if suffix and known(base):
        return possessive(known(base)), []
    for cand, suf in ((n, None), (base, suffix)):
        c = compound(cand) if len(cand) >= 7 else None
        if c:
            if flags is not None:
                flags.append(f"COMPOUND:{word}")
            return (possessive(c) if suf else c), []
    camel = re.findall(r"[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+", word)
    if len(camel) > 1 and all(c.lower() in CMU or c.isdigit() or is_acronym(c) for c in camel):
        if flags is not None:
            flags.append(f"CAMEL:{word}")
        return " | ".join(word_ph(c)[0] if not c.isdigit() else number_ph(c, flags)[0] for c in camel), []
    if flags is not None:
        flags.append(f"OOV:{word}")
    base = n[:-2] if n.endswith("'s") else n
    ph = g2p_en(base)
    return (possessive(ph) if n.endswith("'s") else ph), []


def words_ph(text, flags):
    return " | ".join(word_ph(w, flags)[0] for w in re.split(r"[\s\-]+", text) if w)


def number_ph(tok, flags):
    nw = number_words(tok)
    if not nw:
        return None, None
    natural, cardinal, decimal = nw
    flags.append(f"NUM:{tok}")
    return words_ph(natural, flags), (words_ph(cardinal, []) if cardinal else None)


def token_ph(tok, flags):
    """(ph, cmu_variants, extra_alts[(ph, p)], lexical) for a tokenizer token (may contain hyphens).
    lexical=False → spelled/number reading: dictionary/espeak variants don't apply."""
    w = tok["w"].replace("’", "'").replace("\u00ad", "")
    parts = [p for p in re.split(r"[-‐‑]", w) if p]
    n = tokenizer.normalize(w)
    if n in MANUAL:
        return MANUAL[n], [MANUAL[n]], [], True
    spelled = any(is_acronym(p) and p not in ACRONYM_WORDS or any(c.isdigit() for c in p) for p in parts)
    if len(parts) == 1 and n in CMU and not spelled:
        return CMU[n][0], CMU[n], [], True
    phs, extras = [], []
    variants = []
    for p in parts:
        if any(c.isdigit() for c in p) and number_words(p):
            ph, cardinal = number_ph(p, flags)
            phs.append(ph)
            if cardinal and cardinal != ph and len(parts) == 1:
                extras.append((cardinal, P_YEAR_CARDINAL))
            continue
        if any(c.isdigit() for c in p) and not is_acronym(p):
            flags.append(f"NUM:{p}")
            phs.append(spell_letters(p))
            continue
        ph, var = word_ph(p, flags)
        phs.append(ph)
        variants.append(var)
    ph = " | ".join(phs)
    cmu_vars = [ph]
    if len(parts) == 1 and variants and len(variants[0]) > 1:
        cmu_vars = variants[0]
    return ph, cmu_vars, extras, not spelled


# --- espeak-ng (IPA → ARPAbet) ----------------------------------------------------------------------------------
IPA2ARPA = [
    ("eɪ", "EY"), ("aɪ", "AY"), ("ɔɪ", "OY"), ("aʊ", "AW"), ("oʊ", "OW"), ("əʊ", "OW"), ("tʃ", "CH"), ("dʒ", "JH"),
    ("ɜː", "ER"), ("ɑː", "AA"), ("ɔː", "AO"), ("iː", "IY"), ("uː", "UW"),
    ("ɝ", "ER"), ("ɚ", "ER0"), ("ɑ", "AA"), ("ɒ", "AA"), ("ɔ", "AO"), ("æ", "AE"), ("ʌ", "AH"), ("ə", "AH0"),
    ("ɐ", "AH0"), ("ɛ", "EH"), ("e", "EH"), ("ɪ", "IH"), ("ᵻ", "IH0"), ("i", "IY"), ("ʊ", "UH"), ("u", "UW"),
    ("ʃ", "SH"), ("ʒ", "ZH"), ("θ", "TH"), ("ð", "DH"), ("ŋ", "NG"), ("ɹ", "R"), ("r", "R"), ("j", "Y"), ("ɾ", "T"),
    ("ʔ", "T"), ("ɡ", "G"), ("g", "G"), ("x", "K"), ("ɫ", "L"), ("l", "L"), ("n", "N"), ("m", "M"), ("p", "P"),
    ("b", "B"), ("t", "T"), ("d", "D"), ("k", "K"), ("f", "F"), ("v", "V"), ("s", "S"), ("z", "Z"), ("h", "HH"),
    ("w", "W"), ("ʍ", "W"),
]
_espeak_ready = False


def ipa_to_arpa(ipa):
    out, i, stress = [], 0, "0"
    while i < len(ipa):
        ch = ipa[i]
        if ch in "ˈˌ":
            stress = "1" if ch == "ˈ" else "2"
            i += 1
            continue
        if ch in "ː.‿-̯ ":
            i += 1
            continue
        if ch == "̩":  # syllabic consonant: n̩ → AH0 N
            out.insert(len(out) - 1, "AH0")
            i += 1
            continue
        for ipa_s, arpa in IPA2ARPA:
            if ipa.startswith(ipa_s, i):
                if arpa in spc.VOWELS:
                    arpa += stress
                    stress = "0"
                out.append(arpa)
                i += len(ipa_s)
                break
        else:
            return None
    return " ".join(out) if out else None


def espeak_words(text, tokens):
    global _espeak_ready
    try:
        from phonemizer import phonemize
        from phonemizer.backend.espeak.wrapper import EspeakWrapper
        from phonemizer.separator import Separator
    except ImportError:
        return [None] * len(tokens)
    if not _espeak_ready:
        import glob
        libs = glob.glob("/opt/homebrew/Cellar/espeak-ng/*/lib/libespeak-ng.dylib")
        if not libs:
            return [None] * len(tokens)
        EspeakWrapper.set_library(libs[0])
        _espeak_ready = True
    ws = [t["w"].replace("’", "'") for t in tokens]
    ph = phonemize([" ".join(ws)], language="en-us", backend="espeak", with_stress=True, strip=True,
                   separator=Separator(phone="", word=" ", syllable=""), preserve_punctuation=False)[0].split()
    if len(ph) != len(ws):
        return [None] * len(tokens)
    return [ipa_to_arpa(p) for p in ph]


# --- POS ---------------------------------------------------------------------------------------------------------
_nlp = None


def spacy_doc(text):
    global _nlp
    if _nlp is None:
        import spacy
        _nlp = spacy.load("en_core_web_sm")
    return _nlp(text)


def nltk_tags(tokens):
    import nltk
    return [t for _, t in nltk.pos_tag([t["w"].replace("’", "'") for t in tokens])]


def coarse(tag):
    if tag in ("VBD", "VBN"):
        return "past"
    for prefix, c in (("VB", "VERB"), ("NN", "NOUN"), ("JJ", "ADJ"), ("RB", "ADV")):
        if tag.startswith(prefix):
            return c
    return tag


def homograph(n, pos, tag, nltk_tag):
    """(ph, hom) or (None, None)."""
    a, b = coarse(tag), coarse(nltk_tag)
    if n in HOMOGRAPHS:
        table = HOMOGRAPHS[n]
        key = a if a in table else ("VERB" if a == "past" and "VERB" in table else ("ADJ" if pos == "ADJ" and "ADJ" in table else None))
        ph = table.get(key) or table.get("*") or next(iter(table.values()))
        agree = (a == b) or ({a, b} <= {"VERB", "past"} and "past" not in table)
        return ph, ("checked" if key and agree else "ambiguous")
    if n in STRESS_PAIRS and n in CMU and len(CMU[n]) > 1:
        def first_stress(v):
            return next(i for i, p in enumerate(v.split()) if p.endswith("1"))
        ordered = sorted(CMU[n], key=first_stress)
        verb = a in ("VERB", "past")
        ph = ordered[-1] if verb else ordered[0]
        return ph, ("checked" if (a in ("VERB", "past")) == (b in ("VERB", "past")) else "ambiguous")
    return None, None


# --- sentence -----------------------------------------------------------------------------------------------------
def gap_break(gap):
    if re.search(r"[.!?…]", gap):
        return "period"
    if ";" in gap:
        return "semicolon"
    if ":" in gap:
        return "colon"
    if re.search(r"[–—]|\s-\s", gap):
        return "dash"
    if "," in gap:
        return "comma"
    if re.search(r"[()\[\]]", gap):
        return "other"
    return None


def make_chunks(words, gaps, target, crossings):
    """Split into 1–4 chunks. Boundary cost: punctuation first, then syntax — the number of dependency arcs
    (spaCy) crossing the boundary, so phrases like "in terms of" or "on demand" stay together."""
    n = len(words)
    if n <= spc.CHUNK_MAX:
        return [{"from": 0, "to": n - 1}]
    lo_chunks, hi_len = spc.chunk_bounds(n)
    punct = {"period": 0.0, "semicolon": 0.0, "colon": 0.0, "comma": 0.5, "dash": 0.5, "other": 1.0}
    cost = []  # cost of a boundary after word i
    for i in range(n - 1):
        c = punct.get(gaps[i], 2.0) + 1.0 * crossings[i]
        if gaps[i] is None and (words[i + 1]["_pos"] in ("CCONJ", "SCONJ") or words[i + 1]["_n"] in WH | {"that"}):
            c -= 0.8
        if gaps[i] is None:
            if words[i]["fn"]:
                c += 2.5  # don't end a chunk on "the", "of", "to", "how"…
            if words[i]["_pos"] in ("DET", "ADJ", "NUM") or words[i + 1]["_n"] == "of":
                c += 2.0  # keep "its entire | annual budget", "a lot | of money", "on top | of" together
        if i in target and i + 1 in target:
            c = math.inf
        cost.append(c)
    best = {}

    def solve(start, left):
        """Min cost to split words[start:] into `left` chunks."""
        key = (start, left)
        if key in best:
            return best[key]
        rest = n - start
        if left == 1:
            res = (0.0 + 0.02 * (rest - 8) ** 2, [n - 1]) if spc.CHUNK_MIN <= rest <= hi_len else (math.inf, [])
            best[key] = res
            return res
        res = (math.inf, [])
        for size in range(spc.CHUNK_MIN, hi_len + 1):
            end = start + size - 1
            if end >= n - 1:
                break
            sub = solve(end + 1, left - 1)
            total = cost[end] + 0.02 * (size - 8) ** 2 + sub[0]
            if total < res[0]:
                res = (total, [end] + sub[1])
        best[key] = res
        return res

    options = []
    for k in range(lo_chunks, max(lo_chunks, spc.CHUNKS_MAX) + 1):
        c, ends = solve(0, k)
        if c < math.inf:
            options.append((c + 0.2 * k, ends))
    _, ends = min(options)
    out, start = [], 0
    for e in ends:
        out.append({"from": start, "to": e})
        start = e + 1
    return out


def prosody(text, words, gaps, doc, flags):
    tail = text.rstrip().rstrip("”\"’')]»").rstrip()
    end = tail[-1:] if tail else ""
    n = len(words)
    first = 0
    while first < n - 1 and words[first]["_n"] in LEADING:
        first += 1
    lead = words[first]["_n"]
    kind, tune, ambiguous = "statement", "fall", False
    if end == "?":
        if lead in WH:
            kind = "wh"
        elif re.search(r",\s*\w+(n['’]t)?\s+(it|he|she|they|you|we|i|there|that|this)\s*\?$", tail, re.I):
            kind, tune, ambiguous = "tag", "either", True
            flags.append("TUNE:tag")
        elif lead in AUX_START and re.search(r"\bor\b", tail):
            kind = "alternative"
        elif lead in AUX_START:
            kind, tune = "yesno", "rise"
        else:
            kind, tune, ambiguous = "yesno", "rise", True
            flags.append("Q:declarative")
    else:
        root_tok = next((t for t in doc if t.idx >= words[first]["ch"][0]), None)
        if root_tok is not None and root_tok.tag_ == "VB" and not any(t.dep_ in ("nsubj", "nsubjpass") and t.head == root_tok for t in doc):
            kind = "request"
        if end not in (".", "!"):
            ambiguous = True
            flags.append(f"TUNE:end'{end}'")
    content = [i for i, w in enumerate(words) if not w["fn"]]
    nucleus = content[-1] if content else n - 1
    breaks = [{"after": i, "kind": gaps[i]} for i in range(n - 1) if gaps[i]]
    return {"type": kind, "tune": tune, "tune_ambiguous": ambiguous, "nucleus": nucleus, "nucleus_alt": [],
            "breaks": breaks, "syllables": sum(spc.syllables(w["ph"]) for w in words)}


def target_span(sentence, text):
    m = re.search(re.escape(text), sentence, re.I)
    if not m:
        m = re.search(re.escape(text.replace("'", "’")), sentence, re.I) or re.search(re.escape(text.replace("’", "'")), sentence, re.I)
    return (m.start(), m.end()) if m else None


def build_sentence_pron(sentence, item_text, item_phonemes, flags):
    tokens = tokenizer.words(sentence)
    doc = spacy_doc(sentence)
    ntags = nltk_tags(tokens)
    espeak = espeak_words(sentence, tokens)
    span = target_span(sentence, item_text)
    if span is None:
        flags.append("TARGET:notfound")
    target = {i for i, t in enumerate(tokens) if span and t["ch"][0] < span[1] and t["ch"][1] > span[0]}
    gaps = [gap_break(sentence[tokens[i]["ch"][1]:tokens[i + 1]["ch"][0]]) for i in range(len(tokens) - 1)]
    words = []
    for i, t in enumerate(tokens):
        sp_toks = [x for x in doc if t["ch"][0] <= x.idx < t["ch"][1]]
        head = sp_toks[0] if sp_toks else None
        pos, tag, dep = (head.pos_, head.tag_, head.dep_) if head else ("X", "", "")
        n = t["n"]
        fn = (pos in FN_POS and n not in NEGATION and dep != "prt") and i not in target
        word_flags = []
        ph, cmu_vars, extras, lexical = token_ph(t, word_flags)
        hom = None
        hph, hom = homograph(n, pos, tag, ntags[i])
        if hph:
            ph = hph
            if hom == "ambiguous":
                word_flags.append(f"HOM:{t['w']}")
        if i in target and len(target) == 1 and item_phonemes and tokenizer.normalize(item_text) == n:
            ph = item_phonemes  # reviewed per-item phonemes (phonemes.py / phonemes_manual.json)
        fixed = WORD_OVERRIDES.get(n)
        if fixed:
            ph = fixed["ph"]
            word_flags[:] = [f for f in word_flags if not f.endswith(":" + t["w"])]
        alts = []

        def add(seq, p):
            if not seq or len(alts) >= 3:
                return
            try:
                spc.parse(seq)
            except ValueError:
                return
            if zkey(seq) == zkey(ph) or any(zkey(seq) == zkey(a["ph"]) for a in alts):
                return
            alts.append({"ph": seq, "p": round(p, 2)})

        if fixed:
            for a in fixed.get("alt", []):
                add(a["ph"], a["p"])
            lexical = False
        if fn and n in WEAK:
            for f in sorted(WEAK[n]["forms"], key=lambda f: f["penalty"]):
                if f["penalty"] < 3.0:
                    add(f["ph"], f["penalty"])
        for seq, p in extras:
            add(seq, p)
        if not hph and lexical and not fixed:
            for v in cmu_vars[1:]:
                add(v, P_CMU)
            for prob, v in MFA.get(n, []):
                if prob >= 0.1:
                    add(v, P_MFA)
            if espeak[i] and not any(c.isdigit() for c in t["w"]):
                add(espeak[i], P_ESPEAK)
        wt = 1.5 if i in target else (0.3 if fn else 1.0)
        words.append({"w": t["w"], "ch": t["ch"], "pos": pos, "fn": fn, "wt": wt, "ph": ph, "alt": alts,
                      "target": i in target, "stress": spc.primary_stress(ph), "hom": hom,
                      "_n": n, "_pos": pos})
        flags.extend(word_flags)
    # dependency arcs crossing each word boundary (by our word indices)
    tok2word = {}
    for i, t in enumerate(tokens):
        for x in doc:
            if t["ch"][0] <= x.idx < t["ch"][1]:
                tok2word[x.i] = i
    crossings = [0] * max(0, len(tokens) - 1)
    for x in doc:
        if x.is_punct or x.i not in tok2word or x.head.i not in tok2word:
            continue
        a, b = sorted((tok2word[x.i], tok2word[x.head.i]))
        for k in range(a, b):
            crossings[k] += 1
    chunks = make_chunks(words, gaps, target, crossings)
    if len(tokens) > spc.CHUNK_MAX * spc.CHUNKS_MAX:
        flags.append("CHUNK:long")
    pr = prosody(sentence, words, gaps, doc, flags)
    for w in words:
        del w["_n"], w["_pos"]
    return {"g2p": G2P, "text": sentence, "words": words, "joins": [], "chunks": chunks, "skip_cost": SKIP_COST,
            "prosody": pr}


# --- overrides ---------------------------------------------------------------------------------------------------
def apply_set(sp, path, value):
    keys = re.findall(r"[^.\[\]]+", path)
    obj = sp
    for k in keys[:-1]:
        obj = obj[int(k)] if isinstance(obj, list) else obj[k]
    last = keys[-1]
    if isinstance(obj, list):
        obj[int(last)] = value
    else:
        obj[last] = value


def main(argv):
    check, show_all = "--check" in argv, "--flags" in argv
    paths = [pathlib.Path(a) for a in argv if not a.startswith("--")] or sorted((ROOT / "agent" / "content").glob("*.content.json"))
    overrides = {k: v for k, v in _OV.items() if not k.startswith("_")}
    used, unreviewed, changed_total, errors = set(), [], 0, []
    stats = {"items": 0, "words": 0, "chunks": {}, "ambiguous": 0, "oov": 0, "acronyms": 0, "numbers": 0}
    for path in paths:
        obj, style, nl = content_io.load(path)
        lesson_id = path.name.replace(".content.json", "")
        src = json.loads((ROOT / "lessons" / f"{lesson_id}.json").read_text())
        src_items = {it["text"]: it for it in src["items"]}
        sentences = obj.get("sentences", {})
        changed = 0
        for key, c in obj["items"].items():
            it = src_items.get(key)
            if it is None:
                continue
            text = c.get("text_fixed", key)
            sentence = sentences.get(c.get("s"), {}).get("display", it["sentence"])
            flags = []
            sp = build_sentence_pron(sentence, text, c.get("phonemes"), flags)
            okey = f"{lesson_id}/{key}"
            ov = overrides.get(okey, {})
            if ov:
                used.add(okey)
            for p, v in ov.get("set", {}).items():
                apply_set(sp, p, v)
            for i, w in enumerate(sp["words"]):  # keep derived fields consistent after overrides
                w["stress"] = spc.primary_stress(w["ph"])
            if sp.get("prosody"):
                sp["prosody"]["syllables"] = sum(spc.syllables(w["ph"]) for w in sp["words"])
            reviewed = set(ov.get("reviewed", []))
            for f in flags:
                if show_all or f not in reviewed:
                    (unreviewed if f not in reviewed else []).append(f"{okey}: {f}")
                    if show_all:
                        print(f"flag {okey}: {f}{'' if f not in reviewed else '  (reviewed)'}")
            errs = spc.check(sp, sentence, tokenizer.words(sentence))
            errors += [f"{okey}: {e}" for e in errs]
            stats["items"] += 1
            stats["words"] += len(sp["words"])
            stats["chunks"][len(sp["chunks"])] = stats["chunks"].get(len(sp["chunks"]), 0) + 1
            stats["ambiguous"] += sum(1 for w in sp["words"] if w["hom"] == "ambiguous")
            stats["oov"] += sum(1 for f in flags if f.startswith("OOV:"))
            stats["acronyms"] += sum(1 for f in flags if f.startswith("ACR:"))
            stats["numbers"] += sum(1 for f in flags if f.startswith("NUM:"))
            if c.get("sentence_pron") != sp:
                obj["items"][key] = content_io.with_key_after(c, "phonemes", "sentence_pron", sp)
                changed += 1
        changed_total += changed
        if changed and not check:
            content_io.save(path, obj, style, nl)
        print(f"{path.name}: {'would change' if check else 'wrote'} {changed}")
    for k in sorted(set(overrides) - used):
        if not k.startswith("_"):
            print(f"warning: override for unknown item {k}")
    for u in unreviewed:
        print("unreviewed:", u)
    for e in errors:
        print("error:", e)
    print("stats:", json.dumps(stats, ensure_ascii=False))
    return 1 if errors or (check and (changed_total or unreviewed)) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
