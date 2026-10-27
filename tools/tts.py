"""Synthesize lesson audio → AAC .m4a (mono, ~64 kbps). Engine: Kokoro-82M (default) or macOS `say`.

usage: python3 tools/tts.py [data_dir] [--keep] [--jobs N]
       WORDTRAIL_TTS_ENGINE=say python3 tools/tts.py   # fallback engine (also changes file names)

For every data/lessons/*.json: the word, the sentence at 1× and 0.75×, and each example.
File name = build.audio_key(text, rate, role) (hash of the spoken text, the role's voice and the
rate), so existing files are never synthesized again. Unreferenced files in data/audio/ are
deleted unless --keep. Afterwards build.audio_status of every lesson is recomputed from the
files on disk (run tools/manifest.py next).

Kokoro (build.VOICES["kokoro"]): word + sentence in af_heart (US female), examples in am_michael
(US male); the slow sentence is Kokoro speed 0.75 (a true 0.75×). Runs in the tools/tts venv:
    uv venv -p python3.11 tools/tts/.venv && uv pip install -p tools/tts/.venv -r tools/tts/requirements.txt
Words Kokoro mispronounces are pinned in tools/tts/lexicon.json (Misaki phonemes). The worker trims silence to 80 ms and normalizes loudness.

say (build.VOICES["say"]): compact Samantha; `say -r` is quantized — ≤ 70 wpm gives ~0.77×.
Requires macOS (`afconvert`; `say` for the fallback); in CI use tools/rebuild.py --no-tts.
"""
import concurrent.futures, json, os, pathlib, shutil, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import build  # noqa: E402

VENV_PY = ROOT / "tools" / "tts" / ".venv" / "bin" / "python"
WORKER = ROOT / "tools" / "tts" / "kokoro_synth.py"
SAY_WPM = {1.0: 175, 0.75: 70}  # measured, not linear (see docstring)


def to_m4a(src, out):
    tmp = out.with_name(out.name + ".part")
    subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-b", "64000", "-c", "1", str(src), str(tmp)], check=True)
    shutil.move(tmp, out)


def synth_say(text, rate, voice, out):
    with tempfile.TemporaryDirectory() as tmp:
        txt, aiff = pathlib.Path(tmp) / "in.txt", pathlib.Path(tmp) / "out.aiff"
        txt.write_text(text)
        subprocess.run(["say", "-v", voice.split(":", 1)[1], "-r", str(SAY_WPM[rate]), "-f", str(txt), "-o", str(aiff)], check=True)
        to_m4a(aiff, out)


def synth_kokoro(todo, audio, jobs_n):
    """todo: [(file, text, rate, role)] — one worker process (model loaded once), m4a encoding in threads."""
    if not VENV_PY.exists():
        print(f"tts: нет окружения Kokoro ({VENV_PY}). Создайте:\n"
              "  uv venv -p python3.11 tools/tts/.venv && uv pip install -p tools/tts/.venv -r tools/tts/requirements.txt",
              file=sys.stderr)
        return 2
    with tempfile.TemporaryDirectory() as tmp, concurrent.futures.ThreadPoolExecutor(jobs_n) as pool:
        wav_for, lines = {}, []
        for f, text, rate, role in todo:
            wav = pathlib.Path(tmp) / (f + ".wav")
            wav_for[str(wav)] = audio / f
            lines.append(json.dumps({"out": str(wav), "text": build.spoken(text),
                                     "voice": build.VOICE[role].split(":", 1)[1], "speed": rate}))
        proc = subprocess.Popen([str(VENV_PY), str(WORKER)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        proc.stdin.write("\n".join(lines) + "\n")
        proc.stdin.close()
        futures = []
        for line in proc.stdout:
            line = line.strip()
            if line.startswith("{"):
                done = json.loads(line)["out"]
                futures.append(pool.submit(to_m4a, pathlib.Path(done), wav_for[done]))
        if proc.wait() != 0:
            print("tts: kokoro worker failed", file=sys.stderr)
            return 1
        for fut in futures:
            fut.result()
    return 0


def main(argv):
    keep = "--keep" in argv
    jobs_n = os.cpu_count() or 4
    if "--jobs" in argv:
        jobs_n = int(argv[argv.index("--jobs") + 1])
    args = [a for i, a in enumerate(argv) if not a.startswith("--") and (i == 0 or argv[i - 1] != "--jobs")]
    data = pathlib.Path(args[0]) if args else ROOT / "data"
    audio = data / "audio"
    audio.mkdir(parents=True, exist_ok=True)
    engine = build.TTS_ENGINE
    if not shutil.which("afconvert") or (engine == "say" and not shutil.which("say")):
        print("tts: нужен macOS (afconvert, say) — пропускаю", file=sys.stderr)
        return 2

    wanted, problems = {}, []
    for p in sorted((data / "lessons").glob("*.json")):
        for f, text, rate, role in build.audio_jobs(json.loads(p.read_text())):
            if build.audio_key(text, rate, role) != f:
                problems.append(f"{p.name}: {f} не соответствует тексту/голосу {build.VOICE[role]} — запустите tools/rebuild.py")
            wanted[f] = (text, rate, role)
    if problems:
        for x in problems:
            print("error:", x)
        return 1

    todo = [(f, t, r, role) for f, (t, r, role) in sorted(wanted.items()) if not (audio / f).is_file()]
    if engine == "kokoro":
        rc = synth_kokoro(todo, audio, jobs_n) if todo else 0
        if rc:
            return rc
    else:
        with concurrent.futures.ThreadPoolExecutor(jobs_n) as pool:
            for fut in concurrent.futures.as_completed(
                    [pool.submit(synth_say, t, r, build.VOICE[role], audio / f) for f, t, r, role in todo]):
                fut.result()
    pruned = 0
    if not keep:
        for f in audio.iterdir():
            if f.name != ".gitkeep" and f.name not in wanted:
                f.unlink()
                pruned += 1
    statuses = build.refresh_audio_status(data, audio)
    size = sum(f.stat().st_size for f in audio.iterdir() if f.name in wanted)
    print(f"tts[{engine}]: {len(wanted)} files ({size / 1e6:.1f} MB), synthesized {len(todo)}, pruned {pruned}; status {statuses}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
