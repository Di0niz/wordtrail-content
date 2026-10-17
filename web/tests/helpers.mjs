import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const readJSON = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
export function loadLessons() {
  const m = readJSON("data/manifest.json");
  return m.lessons.map((e) => readJSON(join("data", e.path)));
}
export function item(text, sentence, id = "L-01") {
  return { id, text, kind: text.includes(" ") ? "phrase" : "word", sentence, note: "", lemma: text, level: 1,
    content: { pos: "verb", ipa: "/x/", ru: "x", ru_short: "x", examples: [] } };
}
