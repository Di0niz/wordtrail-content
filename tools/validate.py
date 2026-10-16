"""Validate data/ against what the WordTrail app expects.

usage: python3 tools/validate.py [data_dir]

Checks manifest.json (format, order, sha of every file, counts), every lesson file
(required fields and types), vocab.json and days.json, and their mutual consistency.
Also reports lessons/*.json that are not built yet (warning only).
Exit code 0 = ok, 1 = errors.
"""
import hashlib, json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from schema_check import check  # noqa: E402
import build  # noqa: E402

DATE = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
STR = {"type": "string"}
NESTR = {"type": "string", "minLength": 1}
STR_LIST = {"type": "array", "items": NESTR}
SHA = {"type": "string", "pattern": "^[0-9a-f]{16}$"}
AUDIO = {"type": "string", "pattern": "^[0-9a-f]{16}\\" + build.AUDIO_EXT + "$"}
ENCOUNTER = {"type": "object", "required": ["lesson", "date", "sense", "sentence"],
             "properties": {"lesson": NESTR, "date": {"type": "string", "pattern": DATE}, "sense": NESTR, "sentence": NESTR}}

# The content keys come from schemas/content.schema.json (minus the keys build.py consumes).
_content_item = json.loads((ROOT / "schemas" / "content.schema.json").read_text())["$defs"]["item"]
_content_defs = json.loads((ROOT / "schemas" / "content.schema.json").read_text())["$defs"]
CONTENT = {
    "type": "object",
    "required": ["pos", "ipa", "cefr", "ru", "ru_short", "definition_en", "sentence_ru", "examples"],
    "additionalProperties": False,
    "properties": {k: v for k, v in _content_item["properties"].items() if k not in ("s", "lemma", "text_fixed")},
}

LESSON = {
    "type": "object",
    "required": ["version", "id", "date", "source", "day", "build", "items"],
    "properties": {
        "version": {"const": 1},
        "id": NESTR,
        "date": {"type": "string", "pattern": DATE},
        "source": {"type": "object", "required": ["title", "title_ru"],
                   "properties": {"title": NESTR, "title_ru": NESTR, "url": STR}},
        "day": {"type": "object", "required": ["index", "total"],
                "properties": {"index": {"type": "integer", "minimum": 1}, "total": {"type": "integer", "minimum": 1}}},
        "build": {"type": "object", "required": ["prompt_version", "model", "audio_status"],
                  "properties": {"prompt_version": NESTR, "model": NESTR, "audio_status": {"enum": ["pending", "partial", "ready"]}}},
        "items": {"type": "array", "minItems": 1, "items": {
            "type": "object",
            "required": ["text", "kind", "sentence", "note", "id", "lemma", "level", "encounter_no", "content", "audio"],
            "properties": {
                "text": NESTR, "kind": {"enum": ["word", "phrase"]}, "sentence": NESTR, "note": STR,
                "id": NESTR, "lemma": NESTR,
                "level": {"type": "integer", "minimum": 1}, "encounter_no": {"type": "integer", "minimum": 1},
                "content": {"$ref": "#/$defs/content"},
                "audio": {"type": "object", "required": ["word", "sentence", "sentence_slow", "examples"],
                          "properties": {"word": AUDIO, "sentence": AUDIO, "sentence_slow": AUDIO,
                                         "examples": {"type": "array", "items": AUDIO}}},
                "text_original": NESTR, "sentence_original": NESTR,
                "history": {"type": "array", "minItems": 1, "items": ENCOUNTER},
            },
        }},
    },
    "$defs": {**_content_defs, "content": CONTENT},
}

MANIFEST = {
    "type": "object",
    "required": ["version", "generated_at", "lessons", "vocab", "audio_base"],
    "additionalProperties": False,
    "properties": {
        "version": {"const": 1},
        "generated_at": {"type": "string", "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"},
        "lessons": {"type": "array", "items": {
            "type": "object",
            "required": ["id", "date", "title", "title_ru", "day_index", "words", "new", "repeats", "path", "sha", "audio_status"],
            "additionalProperties": False,
            "properties": {
                "id": NESTR, "date": {"type": "string", "pattern": DATE}, "title": NESTR, "title_ru": NESTR,
                "day_index": {"type": "integer", "minimum": 1}, "words": {"type": "integer", "minimum": 1},
                "new": {"type": "integer", "minimum": 0}, "repeats": {"type": "integer", "minimum": 0},
                "path": {"type": "string", "pattern": "^lessons/[^/]+\\.json$"}, "sha": SHA,
                "audio_status": {"enum": ["pending", "partial", "ready"]},
            }}},
        "vocab": {"type": "object", "required": ["path", "sha"], "additionalProperties": False,
                  "properties": {"path": {"const": "vocab.json"}, "sha": SHA}},
        "audio_base": {"const": "audio/"},
    },
}

VOCAB = {"type": "object", "additionalProperties": {
    "type": "object", "required": ["level", "senses", "encounters"],
    "properties": {
        "level": {"type": "integer", "minimum": 1},
        "senses": {"type": "array", "minItems": 1, "items": {"type": "object", "required": ["id", "ru"],
                                                             "properties": {"id": NESTR, "ru": NESTR}}},
        "encounters": {"type": "array", "minItems": 1, "items": ENCOUNTER},
    }}}

DAYS = {"type": "object", "additionalProperties": {
    "type": "object", "required": ["lessons", "words"],
    "properties": {"lessons": {"type": "array", "minItems": 1, "items": NESTR}, "words": {"type": "integer", "minimum": 0}}}}


def sha16(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def validate(data):
    errors, warnings = [], []
    err = errors.append

    def load(p, schema, name):
        if not p.exists():
            err(f"{name}: нет файла"); return None
        try:
            obj = json.loads(p.read_text())
        except json.JSONDecodeError as e:
            err(f"{name}: невалидный JSON: {e}"); return None
        errors.extend(f"{name}: {e}" for e in check(obj, schema))
        return obj

    man = load(data / "manifest.json", MANIFEST, "manifest.json")
    vocab = load(data / "vocab.json", VOCAB, "vocab.json") or {}
    days = load(data / "days.json", DAYS, "days.json") or {}

    lessons = {}
    for p in sorted((data / "lessons").glob("*.json")):
        L = load(p, LESSON, f"lessons/{p.name}")
        if L is None:
            continue
        lessons[p.stem] = L
        if L.get("id") != p.stem:
            err(f"lessons/{p.name}: id {L.get('id')} не совпадает с именем файла")
        items = L.get("items", [])
        ids = [x.get("id") for x in items]
        if len(set(ids)) != len(ids):
            err(f"lessons/{p.name}: повторяющиеся items[].id")
        for x in items:
            where = f"lessons/{p.name} {x.get('id')}"
            if x.get("level") != x.get("encounter_no"):
                err(f"{where}: level != encounter_no")
            if x.get("level", 1) > 1 and len(x.get("history", [])) != x["level"] - 1:
                err(f"{where}: level {x['level']}, а history {len(x.get('history', []))}")
            c, a = x.get("content", {}), x.get("audio", {})
            if isinstance(c.get("examples"), list) and isinstance(a.get("examples"), list) and len(c["examples"]) != len(a["examples"]):
                err(f"{where}: audio.examples не совпадает с content.examples по числу")
            if str(x.get("text", "")).lower() not in str(x.get("sentence", "")).lower():
                err(f"{where}: текста '{x.get('text')}' нет в предложении")
            e = vocab.get(x.get("lemma"))
            if not e:
                err(f"{where}: лемма '{x.get('lemma')}' отсутствует в vocab.json")
            elif not any(en.get("lesson") == L.get("id") for en in e.get("encounters", [])):
                err(f"{where}: в vocab.json нет встречи '{x.get('lemma')}' в этом уроке")

    # vocab <-> lessons
    for lemma, e in vocab.items():
        enc = e.get("encounters", [])
        if e.get("level") != len(enc):
            err(f"vocab.json {lemma}: level {e.get('level')} != числу встреч {len(enc)}")
        for en in enc:
            L = lessons.get(en.get("lesson"))
            if L is None:
                err(f"vocab.json {lemma}: встреча в несуществующем уроке {en.get('lesson')}")
            elif not any(x.get("lemma") == lemma for x in L.get("items", [])):
                err(f"vocab.json {lemma}: урок {en.get('lesson')} не содержит эту лемму")

    # days <-> lessons
    in_days = set()
    for date, d in days.items():
        for i, lid in enumerate(d.get("lessons", [])):
            in_days.add(lid)
            L = lessons.get(lid)
            if L is None:
                err(f"days.json {date}: нет урока {lid}"); continue
            if L.get("date") != date:
                err(f"days.json {date}: у урока {lid} дата {L.get('date')}")
            if L.get("day") != {"index": i + 1, "total": len(d["lessons"])}:
                err(f"lessons/{lid}.json: day {L.get('day')} не совпадает с days.json (index {i + 1}, total {len(d['lessons'])})")
        words = sum(len(lessons[l].get("items", [])) for l in d.get("lessons", []) if l in lessons)
        if d.get("words") != words:
            err(f"days.json {date}: words {d.get('words')} != {words}")
    for lid in lessons:
        if lid not in in_days:
            err(f"lessons/{lid}.json: нет в days.json")

    # manifest <-> files
    if man:
        listed = {}
        for m in man.get("lessons", []):
            lid = m.get("id")
            listed[lid] = m
            p = data / m.get("path", "")
            if not p.is_file():
                err(f"manifest: {lid}: нет файла {m.get('path')}"); continue
            if m.get("sha") != sha16(p):
                err(f"manifest: {lid}: sha {m.get('sha')} != {sha16(p)} — запустите tools/manifest.py")
            L = lessons.get(p.stem)
            if not L:
                continue
            items = L.get("items", [])
            expect = {"id": L.get("id"), "date": L.get("date"), "title": L.get("source", {}).get("title"),
                      "title_ru": L.get("source", {}).get("title_ru"), "day_index": L.get("day", {}).get("index"),
                      "words": len(items), "new": sum(1 for x in items if x.get("level") == 1),
                      "repeats": sum(1 for x in items if x.get("level", 1) > 1),
                      "audio_status": L.get("build", {}).get("audio_status")}
            for k, v in expect.items():
                if m.get(k) != v:
                    err(f"manifest: {lid}: {k} = {m.get(k)!r}, в уроке {v!r}")
            if m.get("words") != m.get("new", 0) + m.get("repeats", 0):
                err(f"manifest: {lid}: words != new + repeats")
        for lid in lessons:
            if lid not in listed:
                err(f"manifest: нет урока {lid}")
        keys = [(m.get("date", ""), m.get("day_index", 0)) for m in man.get("lessons", [])]
        if keys != sorted(keys, key=lambda k: (-int(k[0].replace("-", "") or 0), k[1])):
            err("manifest: уроки не отсортированы (date desc, day_index asc)")
        if (data / "vocab.json").exists() and man.get("vocab", {}).get("sha") != sha16(data / "vocab.json"):
            err("manifest: sha vocab.json не совпадает — запустите tools/manifest.py")
    if not (data / "audio").is_dir():
        err("нет папки data/audio/")
    else:
        referenced = set()
        for lid, L in lessons.items():
            try:
                jobs = list(build.audio_jobs(L))
            except (KeyError, TypeError):
                continue  # structure errors are reported above
            for f, text, rate in jobs:
                referenced.add(f)
                if build.audio_key(text, rate) != f:
                    err(f"lessons/{lid}.json: аудио {f} не соответствует тексту/голосу {build.VOICE} — запустите tools/rebuild.py")
            status = L.get("build", {}).get("audio_status")
            actual = build.audio_status(L, data / "audio")
            if status != actual:
                err(f"lessons/{lid}.json: audio_status {status!r}, по файлам {actual!r} — запустите tools/tts.py")
            missing = [f for f, _, _ in jobs if not (data / "audio" / f).is_file()]
            if status == "ready" and missing:
                err(f"lessons/{lid}.json: audio_status ready, но нет файлов: {missing[:3]}…")
            elif missing:
                warnings.append(f"lessons/{lid}.json: нет {len(missing)} аудиофайлов — запустите tools/tts.py")
        orphans = [f.name for f in (data / "audio").iterdir() if f.name != ".gitkeep" and f.name not in referenced]
        if orphans:
            warnings.append(f"data/audio: {len(orphans)} файлов без ссылок (tools/tts.py удалит их)")

    # inputs not built yet
    if data.resolve() == (ROOT / "data").resolve():
        for p in sorted((ROOT / "lessons").glob("*.json")):
            if p.stem not in lessons:
                warnings.append(f"lessons/{p.name} ещё не собран (нет data/lessons/{p.name})")
    return errors, warnings, lessons, vocab


def main(argv):
    data = pathlib.Path(argv[0]) if argv else ROOT / "data"
    errors, warnings, lessons, vocab = validate(data)
    for w in warnings:
        print("warning:", w)
    for e in errors:
        print("error:", e)
    items = sum(len(L.get("items", [])) for L in lessons.values())
    print(f"validate: {len(lessons)} lessons, {items} items, vocab {len(vocab)} — " + ("OK" if not errors else f"{len(errors)} errors"))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
