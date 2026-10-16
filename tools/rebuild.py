"""Rebuild data/ from scratch: every lessons/*.json in lesson order, then manifest.json.

usage: python3 tools/rebuild.py [--force] [--no-tts]

Order: by date, then by the lesson's position in the current data/days.json (lessons not
there yet go last, by id). Builds into a temporary directory and replaces data/lessons,
vocab.json and days.json only if every lesson built without problems (or with --force).
data/audio/ and the previous manifest.json (for a stable generated_at) are kept.
Then tools/tts.py synthesizes missing audio (skipped with --no-tts, e.g. in CI on Linux),
audio_status is recomputed from data/audio/, and manifest.json is written.
"""
import json, pathlib, shutil, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import build, manifest, tts  # noqa: E402


def main(argv):
    force = "--force" in argv
    no_tts = "--no-tts" in argv
    data = ROOT / "data"
    days = json.loads((data / "days.json").read_text()) if (data / "days.json").exists() else {}
    srcs = []
    for p in sorted((ROOT / "lessons").glob("*.json")):
        src = json.loads(p.read_text())
        known = days.get(src["date"], {}).get("lessons", [])
        pos = known.index(src["id"]) if src["id"] in known else len(known)
        srcs.append(((src["date"], pos, src["id"]), p))
    srcs.sort()

    failed = []
    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)
        for _, p in srcs:
            try:
                problems = build.build(p, None, tmp, force=force, audio_dir=data / "audio")
            except FileNotFoundError as e:
                problems = [str(e)]
                print(f"{p.stem}: {e}")
            if problems:
                failed.append(p.stem)
                if not force:
                    print(f"\nrebuild остановлен на {p.name}; data/ не изменён")
                    return 1
        if (data / "lessons").exists():
            shutil.rmtree(data / "lessons")
        data.mkdir(exist_ok=True)
        shutil.copytree(tmp / "lessons", data / "lessons")
        for name in ("vocab.json", "days.json"):
            shutil.copyfile(tmp / name, data / name)
    (data / "audio").mkdir(exist_ok=True)
    (data / "audio" / ".gitkeep").touch()
    if not no_tts and tts.main([str(data)]) != 0:
        print("rebuild: tts не выполнен — audio_status по имеющимся файлам")
    build.refresh_audio_status(data)
    manifest.write(data)
    print(f"rebuild: {len(srcs)} lessons" + (f", with problems: {failed}" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
