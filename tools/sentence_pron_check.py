"""Stdlib checks for `content.sentence_pron` (docs/stage3-contracts.md §2–3, §6 in the app repo).

Used by tools/validate.py (CI) and tools/sentence_pron.py. No third-party imports.

Extended ARPAbet grammar:
    seq   := part (' | ' part)*          ; parts of a hyphenated/compound word
    part  := slot (' ' slot)*
    slot  := phone | phone '?' | '(' phone ('|' phone)+ ')'
    phone := ARPAbet consonant | ARPAbet vowel + stress digit 0/1/2
DX and Q are not allowed in content (ZIPA has no ɾ/ʔ for English).
"""
import math, re

VOWELS = {"AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"}
CONSONANTS = {"B", "CH", "D", "DH", "F", "G", "HH", "JH", "K", "L", "M", "N", "NG", "P", "R", "S", "SH", "T", "TH",
              "V", "W", "Y", "Z", "ZH"}
TYPES = {"statement", "wh", "yesno", "tag", "alternative", "request"}
TUNES = {"fall", "rise", "fall-rise", "either"}
BREAKS = {"comma", "period", "dash", "colon", "semicolon", "other"}
CHUNK_MIN, CHUNK_MAX, CHUNKS_MAX = 4, 12, 4


def is_phone(p):
    if p in CONSONANTS:
        return True
    return len(p) >= 3 and p[:-1] in VOWELS and p[-1] in "012"


def parse(seq):
    """Returns a list of parts; each part is a list of slots; a slot is (alternatives, optional).
    Raises ValueError with a readable message."""
    if not isinstance(seq, str) or not seq.strip() or seq != seq.strip() or "  " in seq:
        raise ValueError(f"пустая строка или лишние пробелы: {seq!r}")
    parts = []
    for part in seq.split(" | "):
        slots = []
        for tok in part.split(" "):
            if tok == "|":
                raise ValueError(f"разделитель '|' должен быть окружён пробелами: {seq!r}")
            optional = tok.endswith("?")
            body = tok[:-1] if optional else tok
            if body.startswith("(") and body.endswith(")"):
                alts = body[1:-1].split("|")
                if optional:
                    raise ValueError(f"'?' после альтернативы не допускается: {tok}")
                if len(alts) < 2:
                    raise ValueError(f"в альтернативе меньше двух фонем: {tok}")
            else:
                alts = [body]
            for a in alts:
                if a in ("DX", "Q"):
                    raise ValueError(f"{a} не используется в контенте (у ZIPA нет ɾ/ʔ)")
                if not is_phone(a):
                    raise ValueError(f"не фонема ARPAbet: {a!r} в {seq!r}")
            slots.append((alts, optional))
        if not slots:
            raise ValueError(f"пустая часть: {seq!r}")
        parts.append(slots)
    return parts


def slots(seq):
    """Flat list of slots across parts (the ' | ' separators are not slots)."""
    return [s for part in parse(seq) for s in part]


def primary_stress(seq):
    """Slot indices (separators excluded) whose first alternative carries primary stress."""
    return [i for i, (alts, _) in enumerate(slots(seq)) if alts[0].endswith("1")]


def syllables(seq):
    return sum(1 for alts, opt in slots(seq) if not opt and alts[0][:-1] in VOWELS)


def chunk_bounds(n):
    """(min chunks, max words per chunk) for a sentence of n words."""
    if n <= CHUNK_MAX:
        return 1, CHUNK_MAX
    # > 48 words: chunks grow beyond 12 (up to ⌈n/4⌉+3, room for natural phrase boundaries) instead of a 5th chunk
    hi = CHUNK_MAX if n <= CHUNK_MAX * CHUNKS_MAX else math.ceil(n / CHUNKS_MAX) + 3
    return math.ceil(n / hi), hi


def check(sp, sentence, tokens):
    """Errors (list of str) for one sentence_pron. `tokens` = tokenizer.words(sentence)."""
    errs = []
    if sp.get("text") != sentence:
        errs.append(f"text не совпадает с предложением элемента: {sp.get('text')!r}")
        return errs
    words = sp.get("words", [])
    if [(w["w"], w["ch"]) for w in words] != [(t["w"], t["ch"]) for t in tokens]:
        errs.append("words не совпадают с токенизатором (w/ch)")
        return errs
    n = len(words)
    for i, w in enumerate(words):
        try:
            parse(w["ph"])
        except ValueError as e:
            errs.append(f"words[{i}].ph: {e}")
        for j, a in enumerate(w.get("alt", [])):
            ph = a if isinstance(a, str) else a.get("ph")
            try:
                parse(ph)
            except ValueError as e:
                errs.append(f"words[{i}].alt[{j}]: {e}")
            if isinstance(a, dict) and not (isinstance(a.get("p"), (int, float)) and a["p"] >= 0):
                errs.append(f"words[{i}].alt[{j}].p: нужен штраф ≥ 0")
        if len(w.get("alt", [])) > 3:
            errs.append(f"words[{i}].alt: больше трёх вариантов")
        try:
            k = len(slots(w["ph"]))
            if any(not (0 <= s < k) for s in w.get("stress", [])):
                errs.append(f"words[{i}].stress: индекс вне слотов ph")
        except ValueError:
            pass
    if sp.get("joins"):
        errs.append("joins должен быть пустым (решение замера G2P, §6)")
    chunks = sp.get("chunks", [])
    lo, hi = chunk_bounds(n)
    covered = [c for ch in chunks for c in range(ch["from"], ch["to"] + 1)]
    if covered != list(range(n)):
        errs.append(f"chunks не покрывают слова 0..{n - 1} по порядку без пересечений")
    if not (lo <= len(chunks) <= max(lo, CHUNKS_MAX)):
        errs.append(f"chunks: {len(chunks)} шт., допустимо {lo}..{max(lo, CHUNKS_MAX)}")
    for ch in chunks:
        size = ch["to"] - ch["from"] + 1
        if len(chunks) > 1 and not (CHUNK_MIN <= size <= hi):
            errs.append(f"chunk {ch['from']}..{ch['to']}: {size} слов, допустимо {CHUNK_MIN}..{hi}")
    target = [i for i, w in enumerate(words) if w.get("target")]
    if target:
        owners = {next((k for k, ch in enumerate(chunks) if ch["from"] <= i <= ch["to"]), None) for i in target}
        if len(owners) != 1:
            errs.append("целевое слово разрезано между чанками")
    pr = sp.get("prosody")
    if pr:
        if pr.get("type") not in TYPES:
            errs.append(f"prosody.type: {pr.get('type')!r}")
        if pr.get("tune") not in TUNES:
            errs.append(f"prosody.tune: {pr.get('tune')!r}")
        for k in [pr.get("nucleus")] + list(pr.get("nucleus_alt", [])):
            if k is not None and not (0 <= k < n):
                errs.append(f"prosody: индекс ядра {k} вне 0..{n - 1}")
        for b in pr.get("breaks", []):
            if not (0 <= b["after"] < n - 1) or b.get("kind") not in BREAKS:
                errs.append(f"prosody.breaks: {b}")
    return errs
