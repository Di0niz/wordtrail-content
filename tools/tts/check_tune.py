"""Sanity check of the reference intonation: does the TTS end statements with a fall and
yes/no questions with a rise? (tools/tts venv; numpy autocorrelation F0, not the app's pYIN.)

usage: python tools/tts/check_tune.py [data_dir] [--ids id1,id2,...] [--extra "Do you like coffee?" ...]

Δ = median F0 of the last 150 ms of voicing − median F0 of the preceding ~1 s of voicing, in
semitones (close to the app's «last 150 ms vs nucleus» rule without a word alignment);
fall ≤ −2 st, rise ≥ +2 st, else flat. Expected tune comes from sentence_pron.prosody.tune.
"""
import argparse, json, pathlib, subprocess, sys, tempfile

import numpy as np
import soundfile as sf

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
SR = 16000


def load16k(path):
    with tempfile.TemporaryDirectory() as tmp:
        wav = pathlib.Path(tmp) / "x.wav"
        subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", str(path), str(wav)], check=True)
        return sf.read(wav, dtype="float32")[0]


def f0_track(a, fmin=70, fmax=450, win=0.04, hop=0.01):
    n, h = int(win * SR), int(hop * SR)
    lo, hi = int(SR / fmax), int(SR / fmin)
    out = []
    peak = np.abs(a).max() + 1e-9
    for s in range(0, len(a) - n, h):
        x = a[s:s + n] - a[s:s + n].mean()
        if np.sqrt(np.mean(x ** 2)) < 0.03 * peak:
            out.append(np.nan)
            continue
        ac = np.correlate(x, x, "full")[n - 1:]
        ac /= ac[0] + 1e-9
        lag = lo + int(np.argmax(ac[lo:hi]))
        out.append(SR / lag if ac[lag] > 0.45 else np.nan)
    f = np.array(out)
    # median-smooth and drop octave jumps vs the running median
    med = np.nanmedian(f)
    f[(f > 1.8 * med) | (f < 0.55 * med)] = np.nan
    return f


def tune(path):
    f = f0_track(load16k(path))
    v = f[~np.isnan(f)]
    if len(v) < 10:
        return None, len(v)
    tail, before = v[-15:], v[-115:-15]
    delta = 12 * np.log2(np.median(tail) / np.median(before))
    return float(delta), len(v)


def verdict(d):
    return "?" if d is None else ("fall" if d <= -2 else "rise" if d >= 2 else "flat")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data", nargs="?", default=str(ROOT / "data"))
    ap.add_argument("--ids", default="")
    ap.add_argument("--extra", nargs="*", default=[], help="WAV/M4A paths with expected tune as path=rise|fall")
    args = ap.parse_args()
    data = pathlib.Path(args.data)
    ids = set(filter(None, args.ids.split(",")))
    ok = bad = 0
    for p in sorted((data / "lessons").glob("*.json")):
        for it in json.loads(p.read_text())["items"]:
            if ids and it["id"] not in ids:
                continue
            exp = ((it["content"].get("sentence_pron") or {}).get("prosody") or {}).get("tune", "?")
            d, nv = tune(data / "audio" / it["audio"]["sentence"])
            v = verdict(d)
            good = v == exp or exp == "either"
            ok, bad = ok + good, bad + (not good)
            print(f"{'ok ' if good else 'BAD'} {it['id'][-2:]} expected {exp:<5} got {v:<4} Δ {d if d is None else round(d, 1)} st  «{it['sentence'][:60]}…»")
    for spec in args.extra:
        path, exp = spec.rsplit("=", 1)
        d, _ = tune(path)
        v = verdict(d)
        good = v == exp
        ok, bad = ok + good, bad + (not good)
        print(f"{'ok ' if good else 'BAD'} extra expected {exp:<5} got {v:<4} Δ {d if d is None else round(d, 1)} st  {pathlib.Path(path).name}")
    print(f"tune check: {ok} ok, {bad} mismatches")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
