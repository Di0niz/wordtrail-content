"""Synthesize lesson audio offline with macOS `say` → AAC .m4a (mono, 22.05 kHz, ~64 kbps).

usage: python3 tools/tts.py [data_dir] [--keep] [--jobs N]

For every data/lessons/*.json: the word, the sentence at 1× and 0.75×, and each example.
File name = build.audio_key(text, rate) (hash of text, voice, rate), so existing files are
never synthesized again. Unreferenced files in data/audio/ are deleted unless --keep.
Afterwards build.audio_status of every lesson is recomputed from the files on disk
(run tools/manifest.py next).

Voice: build.VOICE ("say:<name>"). The compact Samantha voice quantizes `say -r` and
clamps it from below: 131 wpm is only ~10% slower than the default, and anything ≤ 70 wpm
gives the slowest it can do — ~1.3× the duration (≈0.77×), used for the 0.75× files.
Requires macOS (`say`, `afconvert`); in CI use tools/rebuild.py --no-tts.
"""
import concurrent.futures, json, os, pathlib, shutil, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import build  # noqa: E402

WPM = {1.0: 175, 0.75: 70}  # see docstring: measured, not linear
VOICE_NAME = build.VOICE.split(":", 1)[1]


def synth(text, rate, out):
    with tempfile.TemporaryDirectory() as tmp:
        txt, aiff, m4a = (pathlib.Path(tmp) / n for n in ("in.txt", "out.aiff", "out.m4a"))
        txt.write_text(text)
        subprocess.run(["say", "-v", VOICE_NAME, "-r", str(WPM[rate]), "-f", str(txt), "-o", str(aiff)], check=True)
        subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-b", "64000", "-c", "1", str(aiff), str(m4a)], check=True)
        shutil.move(m4a, out)


def main(argv):
    keep = "--keep" in argv
    jobs_n = os.cpu_count() or 4
    if "--jobs" in argv:
        jobs_n = int(argv[argv.index("--jobs") + 1])
    args = [a for i, a in enumerate(argv) if not a.startswith("--") and (i == 0 or argv[i - 1] != "--jobs")]
    data = pathlib.Path(args[0]) if args else ROOT / "data"
    audio = data / "audio"
    audio.mkdir(parents=True, exist_ok=True)
    if not shutil.which("say") or not shutil.which("afconvert"):
        print("tts: нужен macOS (say, afconvert) — пропускаю", file=sys.stderr)
        return 2

    wanted, problems = {}, []
    for p in sorted((data / "lessons").glob("*.json")):
        for f, text, rate in build.audio_jobs(json.loads(p.read_text())):
            if build.audio_key(text, rate) != f:
                problems.append(f"{p.name}: {f} не соответствует тексту/голосу {build.VOICE} — запустите tools/rebuild.py")
            wanted[f] = (text, rate)
    if problems:
        for x in problems:
            print("error:", x)
        return 1

    todo = [(f, t, r) for f, (t, r) in sorted(wanted.items()) if not (audio / f).is_file()]
    with concurrent.futures.ThreadPoolExecutor(jobs_n) as pool:
        for fut in concurrent.futures.as_completed([pool.submit(synth, t, r, audio / f) for f, t, r in todo]):
            fut.result()
    pruned = 0
    if not keep:
        for f in audio.iterdir():
            if f.name != ".gitkeep" and f.name not in wanted:
                f.unlink()
                pruned += 1
    statuses = build.refresh_audio_status(data, audio)
    size = sum(f.stat().st_size for f in audio.iterdir() if f.name in wanted)
    print(f"tts: {len(wanted)} files ({size / 1e6:.1f} MB), synthesized {len(todo)}, pruned {pruned}; status {statuses}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
