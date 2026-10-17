import { test } from "node:test";
import assert from "node:assert/strict";
import { words } from "../js/domain/tokenizer.js";
import { firstRange } from "../js/domain/wordmatch.js";
import { readJSON } from "./helpers.mjs";

test("tokenizer matches the shared golden file (Python and Swift twins)", () => {
  const { cases } = readJSON("schemas/tokenizer-golden.json");
  assert.ok(cases.length >= 60);
  for (const c of cases) {
    const got = words(c.text).map((t) => ({ w: t.text, n: t.normalized, ch: [t.start, t.end] }));
    const want = c.tokens.map((t) => ({ w: t.w, n: t.n ?? t.w, ch: t.ch }));
    assert.deepEqual(got, want, c.text);
  }
});

test("WordMatch finds whole words only, with optional substring fallback", () => {
  const s = "We barely rely on it.";
  assert.deepEqual(firstRange("rely", s), { start: 10, end: 14 });
  assert.equal(firstRange("run", "We are running late."), null);
  assert.deepEqual(firstRange("run", "We are running late.", true), { start: 7, end: 10 });
  assert.deepEqual(firstRange("ART", "Start the art class"), { start: 10, end: 13 });
});
