"""Mini 'wordtrail build': merge words.json with agent content, validate, update data/.

usage: python3 tools/build.py lessons/<id>.json [content.json] [data_dir] [--force]

  content.json  default: agent/content/<id>.content.json
  data_dir      default: data/
  --force       write data even if problems were found (exit code is still 1)

Existing vocab.json / days.json in data_dir are read and updated, so a lemma met in an
earlier lesson gets the next level (repeat encounter). Re-running a lesson is idempotent:
its old encounters are replaced, not added. Lessons are ordered by (date, position in
days.json); only encounters from earlier lessons count for level/history.
Exit code: 0 = ok, 1 = problems found (nothing written unless --force), 2 = usage/input error.
"""
import hashlib, json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from schema_check import check  # noqa: E402

# Audio is synthesized by tools/tts.py (macOS `say` → AAC .m4a). The voice id is part of
# the file-name hash, so changing the voice yields new files instead of stale ones.
VOICE = "say:Samantha"
AUDIO_EXT = ".m4a"
PROMPT_VERSION = "level1-v1"
MODEL = "claude-opus-5-5"


def dump(obj):
    # vocab.json / days.json: 2-space indent, UTF-8, no trailing newline (small, diff-friendly).
    return json.dumps(obj, ensure_ascii=False, indent=2)


def dump_lesson(obj):
    # data/lessons/*.json: compact (no indentation) — the app downloads them; with sentence_pron
    # the indented form was ~5× larger. The readable source stays in agent/content/.
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def audio_key(text, rate):
    return hashlib.sha1(f"{text}|{VOICE}|{rate}".encode()).hexdigest()[:16] + AUDIO_EXT


def audio_jobs(lesson):
    """(file, text, rate) for every audio file a lesson references."""
    for x in lesson["items"]:
        a = x["audio"]
        yield a["word"], x["text"], 1.0
        yield a["sentence"], x["sentence"], 1.0
        yield a["sentence_slow"], x["sentence"], 0.75
        for f, ex in zip(a["examples"], x["content"]["examples"]):
            yield f, ex["en"], 1.0


def audio_status(lesson, audio_dir):
    """ready = every referenced file exists, partial = some, pending = none."""
    files = {f for f, _, _ in audio_jobs(lesson)}
    have = sum(1 for f in files if (pathlib.Path(audio_dir) / f).is_file())
    return "ready" if files and have == len(files) else "partial" if have else "pending"


def refresh_audio_status(data_dir=None, audio_dir=None):
    """Recompute build.audio_status of every lesson in data_dir from files on disk."""
    data_dir = pathlib.Path(data_dir) if data_dir else ROOT / "data"
    audio_dir = pathlib.Path(audio_dir) if audio_dir else data_dir / "audio"
    out = {}
    for p in sorted((data_dir / "lessons").glob("*.json")):
        L = json.loads(p.read_text())
        st = audio_status(L, audio_dir)
        if L["build"].get("audio_status") != st:
            L["build"]["audio_status"] = st
            p.write_text(dump_lesson(L))
        out[L["id"]] = st
    return out


def forms(word, lemma):
    base = {word.lower(), lemma.lower(), lemma.split()[0].lower()}
    out = set()
    for b in base:
        out |= {b, b + "s", b + "es", b + "ed", b + "d", b + "ing", (b[:-1] + "ing") if b.endswith("e") else b + "ing"}
    return out


def build(src_path, content_path=None, out_dir=None, force=False, quiet=False, audio_dir=None):
    """Build one lesson. Returns the list of problems (empty = ok)."""
    src_path = pathlib.Path(src_path)
    src = json.loads(src_path.read_text())
    content_path = pathlib.Path(content_path) if content_path else ROOT / "agent" / "content" / f"{src['id']}.content.json"
    out_dir = pathlib.Path(out_dir) if out_dir else ROOT / "data"
    if audio_dir is None:  # rebuild.py builds into a temp dir; audio always lives in data/audio
        audio_dir = out_dir / "audio" if (out_dir / "audio").is_dir() else ROOT / "data" / "audio"
    if not content_path.exists():
        raise FileNotFoundError(f"нет контента {content_path} — сначала его должен написать агент")
    content = json.loads(content_path.read_text())

    problems, warnings = [], []
    for name, obj, schema in (("words.json", src, "words.schema.json"), ("content.json", content, "content.schema.json")):
        for e in check(obj, json.loads((ROOT / "schemas" / schema).read_text())):
            problems.append(f"схема {name}: {e}")
    if src_path.stem != src["id"]:
        problems.append(f"имя файла {src_path.name} не совпадает с id {src['id']}")
    if problems:  # structure is broken, the merge below would crash
        return report(src, problems, warnings, None, quiet)
    sentences = content.get("sentences", {})

    def load(name, default):
        p = out_dir / name
        return json.loads(p.read_text()) if p.exists() else default

    vocab = load("vocab.json", {})
    days = load("days.json", {})
    # Re-running the same lesson must not count as a new encounter
    for e in vocab.values():
        e["encounters"] = [x for x in e["encounters"] if x["lesson"] != src["id"]]
    for lemma in [k for k, e in vocab.items() if not e["encounters"]]:
        del vocab[lemma]

    day = days.setdefault(src["date"], {"lessons": [], "words": 0})
    if src["id"] not in day["lessons"]:
        day["lessons"].append(src["id"])

    def order(lesson_id, date):
        lessons = days.get(date, {}).get("lessons", [])
        return (date, lessons.index(lesson_id) if lesson_id in lessons else len(lessons))

    me = order(src["id"], src["date"])

    for text in content["items"]:
        if text not in {it["text"] for it in src["items"]}:
            warnings.append(f"{text}: есть в content.json, но нет в words.json")

    items, later = [], set()
    for i, it in enumerate(src["items"]):
        c = content["items"].get(it["text"])
        if not c:
            problems.append(f"{it['text']}: нет контента"); continue
        c = dict(c)
        key = c.pop("s", None)
        if key is not None and key not in sentences:
            problems.append(f"{it['text']}: нет предложения {key} в sentences")
        s = sentences.get(key, {})
        text = c.pop("text_fixed", it["text"])
        sentence = s.get("display", it["sentence"])
        if s.get("ru"): c["sentence_ru"] = s["ru"]
        if text.lower() not in sentence.lower():
            problems.append(f"{text}: слова нет в предложении")
        fs = forms(text, c["lemma"])
        for ex in c["examples"]:
            low = ex["en"].lower()
            words = set(re.findall(r"[a-z]+(?:-[a-z]+)*", low)) | set(re.findall(r"[a-z]+", low))
            if not (words & fs) and not any(f in low for f in fs if " " in f):
                problems.append(f"{text}: пример без формы слова — {ex['en']}")
        for k in ("ru", "ru_short", "sentence_ru", "ipa"):
            if not c.get(k): problems.append(f"{text}: пустое поле {k}")
        lemma = c.pop("lemma")
        prev = vocab.get(lemma)
        earlier = [x for x in prev["encounters"] if order(x["lesson"], x["date"]) < me] if prev else []
        if prev and any(order(x["lesson"], x["date"]) > me for x in prev["encounters"]):
            later.add(lemma)
        level = len(earlier) + 1
        item = {
            "text": text, "kind": it["kind"], "sentence": sentence, "note": it.get("note", ""),
            "id": f"{src['id']}-{i+1:02d}", "lemma": lemma, "level": level, "encounter_no": level,
            "content": c,
            "audio": {
                "word": audio_key(text, 1.0),
                "sentence": audio_key(sentence, 1.0),
                "sentence_slow": audio_key(sentence, 0.75),
                "examples": [audio_key(e["en"], 1.0) for e in c["examples"]],
            },
        }
        if text != it["text"]: item["text_original"] = it["text"]
        if sentence != it["sentence"]: item["sentence_original"] = it["sentence"]
        if earlier: item["history"] = earlier
        items.append(item)
        e = vocab.setdefault(lemma, {"level": 0, "senses": [{"id": "s1", "ru": c["ru_short"]}], "encounters": []})
        if not any(x["lesson"] == src["id"] for x in e["encounters"]):  # same lemma twice in one lesson = one encounter
            if not earlier:  # this lesson is the first encounter: its translation names the sense
                e["senses"][0]["ru"] = c["ru_short"]
            e["encounters"].append({"lesson": src["id"], "date": src["date"], "sense": "s1", "sentence": sentence})
    if later:
        warnings.append(f"леммы встречаются в более поздних уроках, их уровни устарели — запустите tools/rebuild.py: {sorted(later)}")
    if problems and not force:
        return report(src, problems, warnings, None, quiet)

    # Canonical order: encounters and vocab entries follow lesson order, so incremental
    # builds and tools/rebuild.py produce identical bytes.
    for e in vocab.values():
        e["encounters"].sort(key=lambda x: order(x["lesson"], x["date"]))
        e["level"] = len(e["encounters"])
    vocab = dict(sorted(vocab.items(), key=lambda kv: order(kv[1]["encounters"][0]["lesson"], kv[1]["encounters"][0]["date"])))

    lesson = {**{k: src[k] for k in ("version", "id", "date")},
              "source": {**src["source"], "title_ru": content["source_title_ru"]},
              "day": {"index": day["lessons"].index(src["id"]) + 1, "total": len(day["lessons"])},
              "build": {"prompt_version": PROMPT_VERSION, "model": MODEL, "audio_status": "pending"},
              "items": items}
    lesson["build"]["audio_status"] = audio_status(lesson, audio_dir)

    lessons_dir = out_dir / "lessons"
    lessons_dir.mkdir(parents=True, exist_ok=True)
    (lessons_dir / f"{src['id']}.json").write_text(dump_lesson(lesson))
    # Keep day.index/total of the other lessons of this day in sync
    for idx, lid in enumerate(day["lessons"]):
        p = lessons_dir / f"{lid}.json"
        if lid != src["id"] and p.exists():
            other = json.loads(p.read_text())
            want = {"index": idx + 1, "total": len(day["lessons"])}
            if other.get("day") != want:
                other["day"] = want
                p.write_text(dump_lesson(other))
    day["words"] = sum(len(json.loads((lessons_dir / f"{l}.json").read_text())["items"]) for l in day["lessons"] if (lessons_dir / f"{l}.json").exists())
    (out_dir / "vocab.json").write_text(dump(vocab))
    (out_dir / "days.json").write_text(dump(days))
    return report(src, problems, warnings, (items, vocab, day), quiet)


def report(src, problems, warnings, result, quiet):
    if not quiet or problems:
        if result:
            items, vocab, day = result
            reps = [f"{x['text']}→{x['level']}" for x in items if x["level"] > 1]
            print(f"{src['id']}: items {len(items)}/{len(src['items'])}, repeats {len(reps)} {reps}, vocab {len(vocab)}, day {day}")
        else:
            print(f"{src['id']}: НЕ записано (есть проблемы; --force чтобы записать всё равно)")
        for w in warnings:
            print("warning:", w)
        print("problems:", "нет" if not problems else "")
        for p in problems:
            print("  -", p)
    return problems


def main(argv):
    force = "--force" in argv
    args = [a for a in argv if a != "--force"]
    if not 1 <= len(args) <= 3 or any(a.startswith("-") for a in args):
        print(__doc__, file=sys.stderr); return 2
    try:
        problems = build(*args, force=force)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print("error:", e, file=sys.stderr); return 2
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
