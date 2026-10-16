"""Minimal JSON Schema checker (stdlib only) for the subset used in schemas/*.json.

Supported keywords: type, enum, const, required, properties, additionalProperties,
items, minItems, minLength, minimum, pattern, anyOf, $ref (local "#/$defs/..." only).
Annotations (title, description, examples, $comment, $schema, $id) are ignored.

usage as a library:  errors = check(instance, schema)   -> list of "path: message"
usage as a script:   python3 tools/schema_check.py schemas/content.schema.json agent/content/x.content.json
"""
import json, pathlib, re, sys

TYPES = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "null": lambda v: v is None,
}


def check(inst, schema, root=None, path="$"):
    root = root if root is not None else schema
    errs = []
    if "$ref" in schema:
        ref = schema["$ref"]
        if not ref.startswith("#/"):
            raise ValueError(f"unsupported $ref {ref}")
        target = root
        for part in ref[2:].split("/"):
            target = target[part]
        errs += check(inst, target, root, path)
    if "type" in schema:
        types = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        if not any(TYPES[t](inst) for t in types):
            return errs + [f"{path}: expected {'/'.join(types)}, got {type(inst).__name__}"]
    if "enum" in schema and inst not in schema["enum"]:
        errs.append(f"{path}: {inst!r} not in {schema['enum']}")
    if "const" in schema and inst != schema["const"]:
        errs.append(f"{path}: expected {schema['const']!r}")
    if isinstance(inst, str):
        if len(inst) < schema.get("minLength", 0):
            errs.append(f"{path}: shorter than {schema['minLength']}")
        if "pattern" in schema and not re.search(schema["pattern"], inst):
            errs.append(f"{path}: {inst!r} does not match {schema['pattern']}")
    if TYPES["number"](inst) and "minimum" in schema and inst < schema["minimum"]:
        errs.append(f"{path}: less than {schema['minimum']}")
    if isinstance(inst, list):
        if len(inst) < schema.get("minItems", 0):
            errs.append(f"{path}: fewer than {schema['minItems']} items")
        if "items" in schema:
            for i, v in enumerate(inst):
                errs += check(v, schema["items"], root, f"{path}[{i}]")
    if isinstance(inst, dict):
        for k in schema.get("required", []):
            if k not in inst:
                errs.append(f"{path}: missing required '{k}'")
        props = schema.get("properties", {})
        extra = schema.get("additionalProperties", True)
        for k, v in inst.items():
            if k in props:
                errs += check(v, props[k], root, f"{path}.{k}")
            elif extra is False:
                errs.append(f"{path}: unexpected key '{k}'")
            elif isinstance(extra, dict):
                errs += check(v, extra, root, f"{path}[{k!r}]")
    if "anyOf" in schema:
        if not any(not check(inst, s, root, path) for s in schema["anyOf"]):
            errs.append(f"{path}: matches none of anyOf ({'; '.join(s.get('description', '?') for s in schema['anyOf'])})")
    return errs


def check_file(schema_path, json_path):
    schema = json.loads(pathlib.Path(schema_path).read_text())
    return check(json.loads(pathlib.Path(json_path).read_text()), schema)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    bad = 0
    for p in sys.argv[2:]:
        errs = check_file(sys.argv[1], p)
        bad += bool(errs)
        print(f"{p}: {'ok' if not errs else ''}")
        for e in errs:
            print("  ", e)
    sys.exit(1 if bad else 0)
