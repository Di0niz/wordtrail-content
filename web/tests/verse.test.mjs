import { test } from "node:test";
import assert from "node:assert/strict";
import { isVerse, displayVerse } from "../js/domain/verse.js";

const byron = [
  "She walks in beauty, like the night Of cloudless climes and starry skies.",
  "A mind at peace with all below, A heart whose love is innocent!",
];

test("detects verse, not prose", () => {
  assert.equal(isVerse(byron), true);
  assert.equal(isVerse(["Minion – built in 2025 – is powered by DevPods, which Uber created in 2017.", "I think Claude and I agree."]), false);
});

test("breaks lines keeping the length", () => {
  const d = displayVerse(byron[0]);
  assert.equal(d, "She walks in beauty, like the night\nOf cloudless climes and starry skies.");
  assert.equal(d.length, byron[0].length);
  assert.equal(displayVerse("And bright Meet. Then I said"), "And bright\nMeet. Then I said");
});
