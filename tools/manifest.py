"""Write data/manifest.json — the entry point the iOS app downloads first.

usage: python3 tools/manifest.py [data_dir]

Lessons: every data/lessons/*.json, sorted by date desc, then day_index asc.
sha = first 16 hex chars of sha256 of the file bytes. generated_at is kept from the
existing manifest when nothing else changed, so re-runs are byte-stable.
"""
import datetime, hashlib, json, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
VERSION = 1


def sha16(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def make(data_dir):
    lessons = []
    for p in sorted((data_dir / "lessons").glob("*.json")):
        L = json.loads(p.read_text())
        items = L["items"]
        lessons.append({
            "id": L["id"],
            "date": L["date"],
            "title": L["source"]["title"],
            "title_ru": L["source"]["title_ru"],
            "day_index": L["day"]["index"],
            "words": len(items),
            "new": sum(1 for x in items if x["level"] == 1),
            "repeats": sum(1 for x in items if x["level"] > 1),
            "path": f"lessons/{p.name}",
            "sha": sha16(p),
            "audio_status": L["build"]["audio_status"],
        })
    lessons.sort(key=lambda x: (x["day_index"], x["id"]))
    lessons.sort(key=lambda x: x["date"], reverse=True)  # stable: date desc, day_index asc
    return {
        "version": VERSION,
        "generated_at": None,
        "lessons": lessons,
        "vocab": {"path": "vocab.json", "sha": sha16(data_dir / "vocab.json")},
        "audio_base": "audio/",
    }


def write(data_dir=None):
    data_dir = pathlib.Path(data_dir) if data_dir else ROOT / "data"
    m = make(data_dir)
    out = data_dir / "manifest.json"
    old = json.loads(out.read_text()) if out.exists() else None
    if old and {**old, "generated_at": None} == m:
        m["generated_at"] = old["generated_at"]
    else:
        m["generated_at"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    text = json.dumps(m, ensure_ascii=False, indent=2) + "\n"
    changed = not out.exists() or out.read_text() != text
    if changed:
        out.write_text(text)
    print(f"manifest: {len(m['lessons'])} lessons, vocab {m['vocab']['sha']}, {'updated' if changed else 'unchanged'} ({m['generated_at']})")
    return m


if __name__ == "__main__":
    write(*sys.argv[1:2])
