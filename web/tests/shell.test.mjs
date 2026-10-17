import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT, loadLessons } from "./helpers.mjs";
import { TrainingSession, kindFor, clozeParts, seeded } from "../js/domain/session.js";
import { buildDictionary } from "../js/domain/review.js";

const WEB = join(ROOT, "web");
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

test("service worker precaches every shell file (bump VERSION when they change)", () => {
  const sw = readFileSync(join(WEB, "sw.js"), "utf8");
  const listed = new Set([...sw.matchAll(/"\.\/([^"]*)"/g)].map((m) => m[1]));
  const files = walk(WEB).map((f) => relative(WEB, f)).filter((f) => !f.startsWith("tests/") && f !== "sw.js" && !f.endsWith(".DS_Store"));
  for (const f of files) assert.ok(listed.has(f), `sw.js SHELL is missing ./${f}`);
  for (const f of listed) if (f && f !== "") assert.ok(files.includes(f), `sw.js lists ./${f} which does not exist`);
});

test("every real lesson works with the web views' assumptions", () => {
  const lessons = loadLessons();
  assert.ok(lessons.length >= 2);
  for (const l of lessons) {
    assert.ok(l.source?.title && l.date && l.items.length, l.id);
    for (const it of l.items) {
      for (const k of ["id", "text", "sentence", "lemma"]) assert.equal(typeof it[k], "string", `${l.id} ${it.text} ${k}`);
      for (const k of ["ru", "ru_short", "ipa"]) assert.ok(it.content[k], `${it.id} content.${k}`);
      for (let box = 0; box <= 5; box++) {
        const kind = kindFor(it, box, 0);
        if (kind === "cloze") assert.ok(clozeParts(it), `${it.id} cloze without the word in its sentence`);
      }
    }
  }
  const all = lessons.flatMap((l) => l.items);
  const s = new TrainingSession(all, { rng: seeded(11) });
  assert.equal(s.total, 20);
  assert.ok(buildDictionary(lessons).length > 0);
});

test("lesson audio refs point to files when audio is ready", () => {
  for (const l of loadLessons()) {
    if (l.build?.audio_status !== "ready") continue;
    for (const it of l.items) for (const f of [it.audio?.word, it.audio?.sentence, it.audio?.sentence_slow, ...(it.audio?.examples ?? [])].filter(Boolean))
      assert.ok(statSync(join(ROOT, "data", "audio", f)).size > 0, `${it.id}: data/audio/${f}`);
  }
});
