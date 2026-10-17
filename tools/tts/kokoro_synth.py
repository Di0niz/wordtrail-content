"""Kokoro-82M worker for tools/tts.py (runs in the tools/tts venv).

stdin: JSON lines {"out": "<wav path>", "text": "<spoken text>", "voice": "af_heart", "speed": 1.0}
For each job: synthesize (24 kHz), trim leading/trailing silence to MARGIN, normalize loudness
(RMS of the speech part to TARGET_RMS_DB, peak ≤ PEAK_DB) and write 16-bit mono WAV.
Prints one JSON line per finished job: {"out": ..., "seconds": ...}.

Kokoro-82M (hexgrad, Apache-2.0) with its Misaki G2P; `[word](/phonemes/)` in the text forces
a pronunciation (Misaki phoneme alphabet — see tools/tts/lexicon.json).
"""
import json, os, sys, warnings

warnings.filterwarnings("ignore")
os.environ.setdefault("HF_HOME", os.path.join(os.path.dirname(__file__), ".cache", "hf"))

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
from kokoro import KPipeline  # noqa: E402

SR = 24000
MARGIN = 0.08          # s of silence kept before/after speech
SILENCE_DB = -45.0     # frame RMS below peak-relative threshold = silence
TARGET_RMS_DB = -20.0  # speech RMS (dBFS)
PEAK_DB = -1.0


def db(x):
    return 20 * np.log10(max(float(x), 1e-9))


def trim(a):
    hop = int(0.01 * SR)
    frames = len(a) // hop
    if frames == 0:
        return a
    rms = np.sqrt(np.mean(a[: frames * hop].reshape(frames, hop) ** 2, axis=1))
    loud = np.where(20 * np.log10(np.maximum(rms, 1e-9)) > db(np.abs(a).max()) + SILENCE_DB)[0]
    if len(loud) == 0:
        return a
    start = max(0, loud[0] * hop - int(MARGIN * SR))
    end = min(len(a), (loud[-1] + 1) * hop + int(MARGIN * SR))
    return a[start:end]


def normalize(a):
    hop = int(0.01 * SR)
    frames = len(a) // hop
    rms = np.sqrt(np.mean(a[: frames * hop].reshape(frames, hop) ** 2, axis=1)) if frames else np.array([1e-9])
    speech = rms[rms > np.percentile(rms, 30)] if len(rms) > 3 else rms
    level = np.sqrt(np.mean(speech ** 2)) if len(speech) else 1e-9
    gain = 10 ** ((TARGET_RMS_DB - db(level)) / 20)
    peak = np.abs(a).max() * gain
    if peak > 10 ** (PEAK_DB / 20):
        gain *= 10 ** (PEAK_DB / 20) / peak
    return a * gain


def main():
    pipe = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")
    for line in sys.stdin:
        if not line.strip():
            continue
        job = json.loads(line)
        parts = [a.numpy() if hasattr(a, "numpy") else np.asarray(a)
                 for _, _, a in pipe(job["text"], voice=job["voice"], speed=float(job["speed"]))]
        audio = normalize(trim(np.concatenate(parts).astype(np.float32)))
        sf.write(job["out"], audio, SR, subtype="PCM_16")
        print(json.dumps({"out": job["out"], "seconds": round(len(audio) / SR, 3)}), flush=True)


if __name__ == "__main__":
    main()
