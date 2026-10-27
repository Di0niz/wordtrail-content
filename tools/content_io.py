"""Read/write agent/content/*.content.json without reformatting them.

Two styles exist: fully indented (json.dumps indent=2) and compact — one line per
sentence / item inside the indented top level. `save` writes the file back in the
style it was read in, so tools that edit content leave small diffs.
"""
import json, pathlib


def _compact(obj):
    lines = ["{"]
    keys = list(obj)
    for i, k in enumerate(keys):
        v = obj[k]
        tail = "," if i < len(keys) - 1 else ""
        if isinstance(v, dict) and v and all(isinstance(x, dict) for x in v.values()):
            lines.append(f"  {json.dumps(k, ensure_ascii=False)}: {{")
            sub = list(v)
            for j, sk in enumerate(sub):
                st = "," if j < len(sub) - 1 else ""
                lines.append(f"    {json.dumps(sk, ensure_ascii=False)}: {json.dumps(v[sk], ensure_ascii=False)}{st}")
            lines.append("  }" + tail)
        else:
            lines.append(f"  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)}{tail}")
    lines.append("}")
    return "\n".join(lines)


def _indented(obj):
    return json.dumps(obj, ensure_ascii=False, indent=2)


STYLES = {"compact": _compact, "indented": _indented}


def load(path):
    """Returns (obj, style, trailing_newline)."""
    text = pathlib.Path(path).read_text()
    obj = json.loads(text)
    body = text.rstrip("\n")
    style = next((name for name, f in STYLES.items() if f(obj) == body), "indented")
    return obj, style, text.endswith("\n")


def save(path, obj, style="indented", newline=True):
    pathlib.Path(path).write_text(STYLES[style](obj) + ("\n" if newline else ""))


def with_key_after(d, after, key, value):
    """Copy of dict d with key=value placed right after `after` (or replaced in place)."""
    if key in d:
        return {k: (value if k == key else v) for k, v in d.items()}
    out = {}
    for k, v in d.items():
        out[k] = v
        if k == after:
            out[key] = value
    if key not in out:
        out[key] = value
    return out
