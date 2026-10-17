import { test } from "node:test";
import assert from "node:assert/strict";
import { encode, decode, merge, fileName, iso } from "../js/domain/transfer.js";

const t0 = new Date(1_800_000_000_000);
const rec = (id, box, off) => ({ itemID: id, lessonID: "L", box, due: t0, last: new Date(t0.getTime() + off * 1000), attempts: box, mistakes: 0 });

// Exactly what the iOS app writes (ProgressTransfer.encode: pretty-printed, sorted keys, ISO-8601 without ms).
const IOS_EXPORT = `{
  "exported_at" : "2026-10-17T10:00:00Z",
  "items" : [
    {
      "attempts" : 3,
      "box" : 2,
      "due" : "2026-10-20T10:00:00Z",
      "item_id" : "2026-10-16-building-resilient-ai-powered-software-01",
      "last" : "2026-10-17T09:59:00Z",
      "lesson_id" : "2026-10-16-building-resilient-ai-powered-software",
      "mistakes" : 1
    }
  ],
  "version" : 1
}`;

test("decodes a file exported by the iOS app", () => {
  const x = decode(IOS_EXPORT);
  assert.equal(x.items.length, 1);
  const r = x.items[0];
  assert.equal(r.itemID, "2026-10-16-building-resilient-ai-powered-software-01");
  assert.equal(r.box, 2); assert.equal(r.attempts, 3); assert.equal(r.mistakes, 1);
  assert.equal(iso(r.due), "2026-10-20T10:00:00Z");
});

test("round trip keeps the iOS shape: snake_case keys, no milliseconds, sorted items", () => {
  const records = [rec("b", 2, 1), rec("a", 1, 2.5)];
  const json = encode(records, t0);
  assert.match(json, /"item_id"/); assert.match(json, /"exported_at"/);
  assert.doesNotMatch(json, /\.\d{3}Z/, "Swift .iso8601 rejects fractional seconds");
  const keys = Object.keys(JSON.parse(json).items[0]);
  assert.deepEqual(keys, ["attempts", "box", "due", "item_id", "last", "lesson_id", "mistakes"]);
  const back = decode(json);
  assert.equal(back.version, 1);
  assert.deepEqual(back.items.map((r) => r.itemID), ["a", "b"]);
  assert.equal(back.items[1].box, 2);
  assert.equal(back.items[1].last.getTime(), Math.floor(records[0].last.getTime() / 1000) * 1000);
  assert.ok(fileName(t0).startsWith("wordtrail-progress-"));
});

test("rejects an unknown version; clamps and drops invalid records", () => {
  assert.throws(() => decode('{"version": 2, "exported_at": "2026-10-17T00:00:00Z", "items": []}'));
  const x = decode(`{"version": 1, "exported_at": "2026-10-17T10:00:00Z", "items": [
    {"item_id": "a", "lesson_id": "L", "box": -2, "due": "2026-10-17T10:00:00Z", "last": "2026-10-17T10:00:00Z", "attempts": -1, "mistakes": 5},
    {"item_id": "b", "lesson_id": "L", "box": 42, "due": "2026-10-17T10:00:00Z", "last": "2026-10-17T10:00:00Z", "attempts": 3, "mistakes": 1},
    {"item_id": "", "lesson_id": "L", "box": 1, "due": "2026-10-17T10:00:00Z", "last": "2026-10-17T10:00:00Z", "attempts": 1, "mistakes": 0}]}`);
  assert.deepEqual(x.items.map((r) => r.itemID), ["a", "b"]);
  assert.deepEqual([x.items[0].box, x.items[0].attempts, x.items[0].mistakes], [0, 0, 0]);
  assert.deepEqual([x.items[1].box, x.items[1].mistakes], [5, 1]);
});

test("merge keeps the later record; ties keep local", () => {
  const local = [rec("a", 1, 100), rec("b", 3, 100), rec("c", 2, 0)];
  const incoming = [rec("a", 2, 200), rec("b", 1, 50), rec("c", 4, 0), rec("d", 1, 10)];
  const m = merge(local, incoming);
  assert.deepEqual([m.added, m.updated, m.kept], [1, 1, 2]);
  assert.deepEqual(m.upserts.map((r) => r.itemID), ["a", "d"]);
  assert.equal(m.upserts[0].box, 2);
  const d = merge([], [rec("a", 1, 0), rec("a", 5, 10)]);
  assert.equal(d.added, 1); assert.equal(d.upserts[0].box, 5);
});
