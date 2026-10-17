"""Shared word tokenizer (Python side). The Swift twin is SharedKernel/TextTokenizer.swift;
both must pass schemas/tokenizer-golden.json (see docs/stage3-contracts.md §1 in the app repo).

A word is a run of letters/numbers (+ combining marks) with internal joiners:
- apostrophes ' ’ ‘ ` ʼ between two letters/numbers (don't, Uber’s, rock'n'roll);
- hyphens - ‐ ‑ between two letters/numbers (AI-powered, day-to-day, 10-3);
- . or , between two digits (3.5, 1,000);
- soft hyphen U+00AD between two letters/numbers (pasted web text), dropped from the normalized form.
Everything else separates words; en/em dashes, slashes, dots between letters (U.S. → U, S) included.
Offsets are code points, [start, end), in the original text.

usage: tokenizer.py "text"            print tokens
       tokenizer.py --check           run the golden file (exit 1 on mismatch)
"""
import json, pathlib, sys, unicodedata

GOLDEN = pathlib.Path(__file__).resolve().parent.parent / "schemas" / "tokenizer-golden.json"

APOSTROPHES = {"'", "’", "‘", "`", "ʼ"}
HYPHENS = {"-", "‐", "‑"}
DIGIT_JOINERS = {".", ","}
SOFT_HYPHEN = "\u00ad"


def _cat(c):
    return unicodedata.category(c)


def _is_base(c):  # letter or number
    return _cat(c)[0] in "LN"


def _is_mark(c):
    return _cat(c)[0] == "M"


def _is_digit(c):
    return _cat(c) == "Nd"


def normalize(word):
    out = []
    for c in word:
        if c == SOFT_HYPHEN:
            continue
        if c in APOSTROPHES:
            out.append("'")
        elif c in HYPHENS:
            out.append("-")
        else:
            out.append(c)
    return "".join(out).lower()


def words(text):
    """[{"w": text, "n": normalized, "ch": [start, end]}] in order."""
    out, i, n = [], 0, len(text)
    while i < n:
        if not _is_base(text[i]):
            i += 1
            continue
        start, j = i, i + 1
        while j < n:
            c = text[j]
            if _is_base(c) or _is_mark(c):
                j += 1
            elif j + 1 < n and (c in APOSTROPHES or c in HYPHENS or c == SOFT_HYPHEN) and _is_base(text[j + 1]):
                j += 2
            elif j + 1 < n and c in DIGIT_JOINERS and _is_digit(text[j - 1]) and _is_digit(text[j + 1]):
                j += 2
            else:
                break
        w = text[start:j]
        out.append({"w": w, "n": normalize(w), "ch": [start, j]})
        i = j
    return out


def golden_tokens(text):
    """Golden-file shape: n only when it differs from w."""
    return [{k: v for k, v in t.items() if k != "n" or v != t["w"]} for t in words(text)]


def check(path=GOLDEN):
    data = json.loads(path.read_text(encoding="utf-8"))
    bad = 0
    for case in data["cases"]:
        got = golden_tokens(case["text"])
        if got != case["tokens"]:
            bad += 1
            print(f"tokenizer mismatch: {case['text']!r}\n  want {case['tokens']}\n  got  {got}")
    print(f"tokenizer golden: {len(data['cases']) - bad}/{len(data['cases'])} ok")
    return bad == 0


if __name__ == "__main__":
    if sys.argv[1:] == ["--check"]:
        sys.exit(0 if check() else 1)
    for t in words(" ".join(sys.argv[1:])):
        print(t)
