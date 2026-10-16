"""Fill `phonemes` (ARPAbet, CMUdict style) into agent/content/*.content.json.

usage: python3 tools/phonemes.py [content.json ...] [--force] [--check]

For every item: phonemes of the text as shown (after text_fixed), words split on spaces
and hyphens and joined with ' | '. Sources, in order: tools/phonemes_manual.json (written
by the agent: OOV words and entries aligned with the lesson IPA), then CMUdict (first
pronunciation). Existing values are kept unless --force. --check writes nothing and
exits 1 if any item lacks phonemes.

CMUdict (BSD-2-Clause, Carnegie Mellon University) is downloaded once into tools/cache/.
Exit code: 0 = all items have phonemes, 1 = some are missing (listed — write them into
phonemes_manual.json or directly into content.json).
"""
import json, pathlib, re, sys, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import content_io  # noqa: E402

CMUDICT_URL = "https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict"
CACHE = ROOT / "tools" / "cache" / "cmudict.dict"
MANUAL = ROOT / "tools" / "phonemes_manual.json"
VOWELS = "AA|AE|AH|AO|AW|AY|EH|ER|EY|IH|IY|OW|OY|UH|UW"
CONSONANTS = "B|CH|D|DH|F|G|HH|JH|K|L|M|N|NG|P|R|S|SH|T|TH|V|W|Y|Z|ZH"
PHONE = rf"(?:(?:{VOWELS})[012]|{CONSONANTS})"
PATTERN = re.compile(rf"^{PHONE}(?: {PHONE})*(?: \| {PHONE}(?: {PHONE})*)*$")


def cmudict():
    if not CACHE.exists():
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        print(f"downloading {CMUDICT_URL}")
        CACHE.write_bytes(urllib.request.urlopen(CMUDICT_URL, timeout=60).read())
    d = {}
    for line in CACHE.read_text(encoding="utf-8").splitlines():
        parts = line.split("#")[0].split()
        if parts and "(" not in parts[0]:
            d.setdefault(parts[0], " ".join(parts[1:]))
    return d


def words(text):
    return [w for w in re.split(r"[\s\-]+", text.lower().replace("’", "'")) if w]


def lookup(text, cmu, manual):
    key = text.lower()
    if key in manual:
        return manual[key], []
    out, missing = [], []
    for w in words(text):
        w = w.strip(".,;:!?\"()")
        p = manual.get(w) or cmu.get(w)
        if not p:
            missing.append(w)
        out.append(p or "")
    return (" | ".join(out) if not missing else None), missing


def main(argv):
    force, check = "--force" in argv, "--check" in argv
    paths = [pathlib.Path(a) for a in argv if not a.startswith("--")] or sorted((ROOT / "agent" / "content").glob("*.content.json"))
    cmu = cmudict()
    manual = {k: v for k, v in json.loads(MANUAL.read_text()).items() if not k.startswith("_")}
    for k, v in manual.items():
        if not PATTERN.match(v):
            print(f"error: phonemes_manual.json {k}: неверный формат '{v}'"); return 2
    missing_all, unfilled = [], 0
    for path in paths:
        obj, style, nl = content_io.load(path)
        changed = 0
        for key, c in obj["items"].items():
            text = c.get("text_fixed", key)
            if c.get("phonemes") and not force:
                if not PATTERN.match(c["phonemes"]):
                    missing_all.append(f"{path.name}: {text}: неверный формат '{c['phonemes']}'")
                continue
            ph, missing = lookup(text, cmu, manual)
            if not ph:
                missing_all.append(f"{path.name}: {text}: нет в CMUdict — {missing}")
                continue
            if c.get("phonemes") != ph:
                obj["items"][key] = content_io.with_key_after(c, "ipa", "phonemes", ph)
                changed += 1
        unfilled += changed if check else 0
        if changed and not check:
            content_io.save(path, obj, style, nl)
        print(f"{path.name}: {'would fill' if check else 'filled'} {changed}")
    for m in missing_all:
        print("missing:", m)
    return 1 if missing_all or unfilled else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
