"""Does the lesson audio say what our phonemes say? ZIPA greedy decode vs expected phones.

usage (tools/tts venv): python tools/tts/check_pron.py --zipa <app>/tools/pronunciation-model [data_dir]
       [--role word|example|sentence] [--json out.json] [--limit N]

For every item: decode the word audio (m4a → 16 kHz via afconvert), map content.phonemes
(ARPAbet) to ZIPA tokens with tools/arpabet_zipa.json and compute PER with variant-aware
substitutions (any acceptable variant of a phone is not an error; droppable phones are free).
Prints items with PER > 20 % — fix them in tools/tts/lexicon.json.

--suggest: for bad words, synthesize a lexicon override (our ARPAbet → Misaki phonemes) and keep it
only if PER improves; also adds every word of any lesson text that Misaki doesn't know (names,
brands — Kokoro would guess them), with phonemes from sentence_pron. Writes tools/tts/lexicon.json.
"""
import argparse, json, pathlib, subprocess, sys, tempfile

import numpy as np
import soundfile as sf

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
MAP = json.loads((ROOT / "tools" / "arpabet_zipa.json").read_text())["map"]


def key(ph):
    base, stress = ph.rstrip("012"), (ph[-1] if ph[-1] in "012" else None)
    return base + "0" if base in ("AH", "ER", "IH") and stress == "0" else base


def slots(arpabet):
    """[(canonical_tokens, acceptable_single_tokens, droppable)] per ARPAbet phone."""
    out = []
    for tok in arpabet.replace("|", " ").replace("-", " ").split():
        variants = MAP.get(key(tok)) or MAP.get(tok.rstrip("012"))
        if not variants:
            continue
        canon = variants[0]
        singles = {v[0] for v in variants if len(v) == 1}
        out.append((canon, singles, any(len(v) == 0 for v in variants)))
    return out


def per(expected_slots, heard):
    """Edit distance over expected phones (each may expand to several tokens) vs decoded tokens."""
    exp = []  # flatten: (token, acceptable, droppable)
    for canon, singles, drop in expected_slots:
        if not canon:
            continue
        for i, t in enumerate(canon):
            exp.append((t, singles | {t} if len(canon) == 1 else {t}, drop))
    n, m = len(exp), len(heard)
    d = np.zeros((n + 1, m + 1))
    d[:, 0] = [sum(0 if e[2] else 1 for e in exp[:i]) for i in range(n + 1)]
    d[0, :] = np.arange(m + 1)
    for i in range(1, n + 1):
        t, ok, drop = exp[i - 1]
        for j in range(1, m + 1):
            sub = 0 if heard[j - 1] in ok else 1
            d[i, j] = min(d[i - 1, j - 1] + sub, d[i - 1, j] + (0 if drop else 1), d[i, j - 1] + 1)
    return d[n, m] / max(1, n), [e[0] for e in exp]


# ARPAbet → Misaki (US) phonemes used by Kokoro: A=eɪ I=aɪ O=oʊ W=aʊ Y=ɔɪ, ʧ ʤ, stress before the vowel.
_V = {"AA": "ɑ", "AE": "æ", "AO": "ɔ", "AW": "W", "AY": "I", "EH": "ɛ", "EY": "A", "IH": "ɪ", "IY": "i",
      "OW": "O", "OY": "Y", "UH": "ʊ", "UW": "u"}
_C = {"B": "b", "CH": "ʧ", "D": "d", "DH": "ð", "F": "f", "G": "ɡ", "HH": "h", "JH": "ʤ", "K": "k", "L": "l",
      "M": "m", "N": "n", "NG": "ŋ", "P": "p", "R": "ɹ", "S": "s", "SH": "ʃ", "T": "t", "TH": "θ", "V": "v",
      "W": "w", "Y": "j", "Z": "z", "ZH": "ʒ"}


def misaki(arpabet):
    out = []
    for tok in arpabet.replace("|", " ").replace("-", " ").split():
        tok = tok.rstrip("?").strip("()").split("|")[0]
        base, st = tok.rstrip("012"), (tok[-1] if tok[-1] in "012" else "")
        mark = {"1": "ˈ", "2": "ˌ"}.get(st, "")
        if base == "AH":
            out.append(mark + ("ʌ" if st in ("1", "2") else "ə"))
        elif base == "ER":
            out.append(mark + ("ɜɹ" if st in ("1", "2") else "əɹ"))
        elif base in _V:
            out.append(mark + _V[base])
        elif base in _C:
            out.append(_C[base])
    return "".join(out)


def decode16k(path):
    with tempfile.TemporaryDirectory() as tmp:
        wav = pathlib.Path(tmp) / "x.wav"
        subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", str(path), str(wav)], check=True)
        a, sr = sf.read(wav, dtype="float32")
    return a


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data", nargs="?", default=str(ROOT / "data"))
    ap.add_argument("--zipa", required=True, help="<app repo>/tools/pronunciation-model")
    ap.add_argument("--json")
    ap.add_argument("--threshold", type=float, default=0.2)
    ap.add_argument("--suggest", action="store_true")
    args = ap.parse_args()
    sys.path.insert(0, str(pathlib.Path(args.zipa) / "g2p_eval"))
    import zipa  # noqa: E402

    data = pathlib.Path(args.data)
    rows = []
    for p in sorted((data / "lessons").glob("*.json")):
        L = json.loads(p.read_text())
        for it in L["items"]:
            ph = it["content"].get("phonemes")
            f = data / "audio" / it["audio"]["word"]
            if not ph or not f.is_file():
                continue
            heard = zipa.greedy(zipa.log_posteriors(decode16k(f)))
            rate, exp = per(slots(ph), heard)
            rows.append({"id": it["id"], "text": it["text"], "phonemes": ph, "expected": " ".join(exp),
                         "heard": " ".join(heard), "per": round(rate, 3), "file": f.name})
    bad = [r for r in rows if r["per"] > args.threshold]
    pers = np.array([r["per"] for r in rows])
    print(f"words: {len(rows)}  mean PER {pers.mean():.3f}  median {np.median(pers):.3f}  "
          f"> {args.threshold:.0%}: {len(bad)}")
    for r in sorted(bad, key=lambda r: -r["per"]):
        print(f"  {r['per']:.2f}  {r['text']:<24} exp [{r['expected']}]  heard [{r['heard']}]")
    if args.json:
        pathlib.Path(args.json).write_text(json.dumps(rows, ensure_ascii=False, indent=1))
    if args.suggest:
        suggest(data, bad, zipa)


def suggest(data, bad, zipa):
    import warnings
    warnings.filterwarnings("ignore")
    sys.path.insert(0, str(ROOT / "tools"))
    sys.path.insert(0, str(pathlib.Path(__file__).parent))
    import tokenizer, kokoro_synth as ks  # noqa: E401
    from kokoro import KPipeline
    from misaki import en
    path = ROOT / "tools" / "tts" / "lexicon.json"
    lex = json.loads(path.read_text()) if path.exists() else {}
    pipe, g2p = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M"), en.G2P(trf=False, british=False)

    def heard(text):
        a = np.concatenate([x.numpy() for _, _, x in pipe(text, voice="af_heart", speed=1.0)]).astype(np.float32)
        with tempfile.TemporaryDirectory() as tmp:
            w24, w16 = pathlib.Path(tmp) / "a.wav", pathlib.Path(tmp) / "b.wav"
            sf.write(w24, ks.normalize(ks.trim(a)), ks.SR)
            subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", str(w24), str(w16)], check=True)
            return zipa.greedy(zipa.log_posteriors(sf.read(w16, dtype="float32")[0]))

    manual = set(lex.get("_manual", []))
    for r in bad:
        if r["text"] in manual:
            continue
        m = misaki(r["phonemes"])
        new = per(slots(r["phonemes"]), heard(f"[{r['text']}](/{m}/)"))[0]
        keep = new <= r["per"] - 0.05  # real improvement, not rounding
        print(f"  {r['text']:<24} {r['per']:.2f} → {new:.2f}  {m}  {'keep' if keep else 'skip'}")
        if keep:
            lex[r["text"]] = m
    # Words Misaki doesn't know (Kokoro would guess) — pin them to our sentence_pron phonemes.
    for p in sorted((data / "lessons").glob("*.json")):
        for it in json.loads(p.read_text())["items"]:
            sp = it["content"].get("sentence_pron") or {}
            for w in sp.get("words", []):
                word = w["w"].replace("’", "'")
                base = word[:-2] if word.lower().endswith("'s") else word
                if base in lex or base.lower() in {k.lower() for k in lex}:
                    continue
                if "❓" in g2p(base)[0] and not base.isupper() and not any(ch.isdigit() for ch in base):
                    ph = w["ph"].split(" | ")
                    if word != base:  # drop the possessive ending ('s = Z, S or IH0/AH0 Z) — Misaki adds it itself
                        toks = w["ph"].split()
                        if toks and toks[-1] in ("S", "Z"):
                            toks = toks[:-1]
                            if len(toks) > 1 and toks[-1] in ("IH0", "AH0") and toks[-2] in ("S", "Z", "SH", "ZH", "CH", "JH"):
                                toks = toks[:-1]
                        ph = [" ".join(toks)]
                    lex[base] = misaki(" ".join(ph))
                    print(f"  oov {base:<20} {lex[base]}")
    meta = {k: lex.pop(k) for k in [k for k in lex if k.startswith("_")]}
    lex = meta | dict(sorted(lex.items()))
    path.write_text(json.dumps(lex, ensure_ascii=False, indent=1) + "\n")
    print(f"lexicon: {len(lex) - 1} entries → {path}")


if __name__ == "__main__":
    main()
