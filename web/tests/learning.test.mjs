import { test } from "node:test";
import assert from "node:assert/strict";
import * as Leitner from "../js/domain/leitner.js";
import { TrainingSession, kindFor, clozeParts, seeded, MAX_ITEMS } from "../js/domain/session.js";
import * as Dictation from "../js/domain/dictation.js";
import { apply } from "../js/domain/outcome.js";
import { pick, streak, buildDictionary, matchesStatus, matchesQuery, sortEntries, maxBox } from "../js/domain/review.js";
import * as RU from "../js/domain/ru.js";
import { loadLessons, item } from "./helpers.mjs";

const now = new Date(1_800_000_000_000);
const day = 86_400_000;

test("Leitner: correct answers climb, a mistake resets, out-of-range boxes are clamped", () => {
  let s = null; const boxes = [];
  for (let i = 0; i < 7; i++) { s = Leitner.next(s, true, now); boxes.push(s.box); }
  assert.deepEqual(boxes, [1, 2, 3, 4, 5, 5, 5]);
  assert.equal(s.due.getTime(), Leitner.addDays(now, 30).getTime());
  const m = Leitner.next({ box: 4, due: now }, false, now);
  assert.equal(m.box, 0);
  assert.equal(m.due.getTime(), Leitner.addDays(now, 1).getTime());
  assert.equal(Leitner.next({ box: -2, due: now }, true, now).box, 1);
  assert.equal(Leitner.next({ box: 99, due: now }, true, now).box, Leitner.MAX_BOX);
});

const items = loadLessons().at(-1).items;

test("session: limit, due first, box ≥ 2 → recall", () => {
  const n = new Date();
  const progress = {};
  for (const it of items) progress[it.id] = { box: 1, due: new Date(n.getTime() + day) };
  const dueIDs = new Set(items.slice(0, 3).map((i) => i.id));
  for (const id of dueIDs) progress[id] = { box: 2, due: new Date(n.getTime() - 60_000) };
  const s = new TrainingSession(items, { progress, now: n, rng: seeded(1) });
  assert.equal(s.total, Math.min(items.length, MAX_ITEMS));
  assert.deepEqual(new Set(s.queue.slice(0, 3).map((q) => q.item.id)), dueIDs);
  assert.ok(s.queue.slice(0, 3).every((q) => q.kind === "recall"));
});

test("session: new items rotate kinds; listen has 4 distinct options incl. the answer", () => {
  const s = new TrainingSession(items, { rng: seeded(2) });
  assert.deepEqual(new Set(s.queue.map((q) => q.kind)), new Set(["listen", "cloze", "recall"]));
  for (const q of s.queue.filter((q) => q.kind === "listen")) {
    assert.equal(q.options.length, 4);
    assert.ok(q.options.includes(q.item.content.ru_short));
    assert.equal(new Set(q.options).size, 4);
  }
});

test("session: a wrong answer re-queues once; a fixed retry is finally correct", () => {
  const s = new TrainingSession(items.slice(0, 3), { rng: seeded(3) });
  const first = s.current;
  s.record(false); assert.equal(s.total, 4);
  s.advance(); s.record(true); s.advance(); s.record(true); s.advance();
  const retry = s.current;
  assert.equal(retry.item.id, first.item.id); assert.ok(retry.isRetry);
  s.record(false); assert.equal(s.total, 4, "a retry is not re-queued again");
  s.advance(); assert.ok(s.isFinished);
  assert.deepEqual([s.results.get(first.item.id).firstTry, s.results.get(first.item.id).finallyCorrect], [false, false]);
  assert.equal(s.orderedResults.length, 3);

  const t = new TrainingSession([item("rely", "We barely rely on it.")], { rng: seeded(7) });
  t.record(false); t.advance(); t.record(true); t.advance();
  const r = t.results.get("L-01");
  assert.ok(!r.firstTry && r.finallyCorrect);
});

test("session: typed answers are normalized", () => {
  const it = items.find((i) => i.text.includes("-") || i.text.includes(" ")) ?? items[0];
  const s = new TrainingSession([it], { progress: { [it.id]: { box: 2, due: new Date(0) } }, rng: seeded(4) });
  assert.equal(s.current.kind, "recall");
  assert.ok(s.check("  " + it.text.toUpperCase() + ". "));
  assert.ok(s.check(it.lemma));
  assert.ok(!s.check(""));
  assert.ok(!s.check("definitely wrong"));
});

test("cloze: whole words only, falls back to recall", () => {
  const p = clozeParts(item("rely", "We barely rely on it."));
  assert.equal(p.before, "We barely "); assert.equal(p.word, "rely");
  assert.equal(clozeParts(item("run", "We are running late.")), null);
  assert.equal(kindFor(item("run", "We are running late."), 1, 0), "recall");
  assert.equal(kindFor({ ...items[0], sentence: "Nothing to see here." }, 1, 0), "recall");
  assert.ok(clozeParts(items[0]));
});

test("dictation: grading parity with the Swift tests", () => {
  const sentence = "Building resilient AI-powered software, and planning for when things go wrong.";
  let g = Dictation.grade("building RESILIENT ai-powered software and planning for when things go wrong", sentence, "resilient");
  assert.equal(g.matched, g.total); assert.ok(g.isCorrect); assert.ok(g.tokens.every((t) => t.type === "match"));
  assert.ok(Dictation.grade("It's done", "It’s done.", "done").isCorrect);
  g = Dictation.grade("Building resilient AI-powered software and planing for when things go wrong", sentence, "resilient");
  assert.equal(g.total, 11); assert.equal(g.matched, 10); assert.ok(g.isCorrect);
  const i = g.tokens.findIndex((t) => t.type === "missing" && t.text === "planning");
  assert.ok(i >= 0); assert.deepEqual(g.tokens[i + 1], { type: "extra", text: "planing" });
  g = Dictation.grade("Building AI-powered software, and planning for when things go wrong", sentence, "resilient");
  assert.ok(g.ratio >= Dictation.PASS_RATIO); assert.ok(!g.containsTarget); assert.ok(!g.isCorrect);
  assert.ok(!Dictation.grade("building software", sentence, "software").isCorrect);
  assert.equal(Dictation.grade("", sentence, "resilient").matched, 0);
  assert.ok(Dictation.grade("we spin it up now", "We spin it up now.", "spin it up").containsTarget);
  assert.ok(!Dictation.grade("we spin up it now", "We spin it up now.", "spin it up").containsTarget);
});

test("dictation kind: high boxes alternate recall/dictation; needs whole-word target; wrong → cloze retry", () => {
  const short = item("rely", "We barely rely on it.");
  assert.equal(kindFor(short, 3, 0), "dictation");
  assert.equal(kindFor(short, 3, 1), "recall");
  assert.equal(kindFor(short, 2, 0), "recall");
  const long = item("word", Array(30).fill("word").join(" ") + ".");
  assert.equal(kindFor(long, 5, 0), "recall");
  assert.ok(!Dictation.isEligible(item("run", "We are running late.")));
  assert.equal(kindFor(item("run", "We are running late."), 3, 0), "recall");
  const s = new TrainingSession([short], { progress: { [short.id]: { box: 3, due: new Date(0) } }, rng: seeded(5) });
  assert.equal(s.current.kind, "dictation");
  assert.ok(!s.check("nonsense")); assert.ok(s.check(short.sentence));
  s.record(false); s.advance();
  assert.equal(s.current.kind, "cloze"); assert.ok(s.current.isRetry);
});

test("outcome: practice before due does not promote; mistakes demote; new words start at box 1", () => {
  const it = item("rely", "We barely rely on it.");
  const notDue = { itemID: it.id, lessonID: "L", box: 1, due: new Date(now.getTime() + day), last: now, attempts: 1, mistakes: 0 };
  const ok = { item: it, firstTry: true, finallyCorrect: true };
  const { records, rows } = apply([ok], { [it.id]: notDue }, () => "L", now);
  assert.equal(records[0].box, 1); assert.equal(records[0].due.getTime(), notDue.due.getTime());
  assert.equal(records[0].attempts, 2); assert.equal(rows[0].box, 1);
  assert.equal(apply([{ item: it, firstTry: false }], { [it.id]: notDue }, () => "L", now).records[0].box, 0);
  const due = { ...notDue, due: new Date(now.getTime() - 60_000) };
  assert.equal(apply([ok], { [it.id]: due }, () => "L", now).records[0].box, 2);
  assert.equal(apply([ok], {}, () => "L", now).records[0].box, 1);
});

test("review selection: fresh = untrained, oldest lesson first, first words first", () => {
  const lessons = loadLessons(); // manifest order: newest first
  const picked = pick("fresh", lessons, {}, now);
  const oldest = [...lessons].reverse().flatMap((l) => l.items);
  assert.equal(picked.length, MAX_ITEMS);
  assert.deepEqual(picked.map((i) => i.id), oldest.slice(0, MAX_ITEMS).map((i) => i.id));
  const p = { [oldest[0].id]: { box: 1, due: new Date(now.getTime() - 1) }, [oldest[1].id]: { box: 1, due: new Date(now.getTime() + day) } };
  assert.deepEqual(pick("due", lessons, p, now).map((i) => i.id), [oldest[0].id]);
});

test("streak counts consecutive days, today may be pending", () => {
  const d = (k) => RU.isoDay(Leitner.addDays(now, -k));
  assert.equal(streak(new Set(), now), 0);
  assert.equal(streak(new Set([d(0), d(1), d(2), d(4)]), now), 3);
  assert.equal(streak(new Set([d(1), d(2)]), now), 2);
  assert.equal(streak(new Set([d(2), d(3)]), now), 0);
});

test("dictionary groups by lemma, filters and sorts", () => {
  const lessons = loadLessons();
  const entries = buildDictionary(lessons);
  const lemmas = new Set(lessons.flatMap((l) => l.items.map((i) => i.lemma.toLowerCase())));
  assert.equal(entries.length, lemmas.size);
  const e = entries[0], id = e.encounters[0].item.id;
  const progress = { [id]: { box: 4, due: new Date(Date.now() + day) } };
  assert.ok(matchesStatus(e, "learned", progress)); assert.ok(!matchesStatus(e, "new", progress)); assert.ok(!matchesStatus(e, "due", progress));
  progress[id].due = new Date(Date.now() - 1);
  assert.ok(matchesStatus(e, "due", progress)); assert.equal(maxBox(e, progress), 4);
  assert.ok(matchesQuery(e, e.encounters[0].item.content.ru_short.toUpperCase())); assert.ok(!matchesQuery(e, "zzzz"));
  assert.equal(sortEntries(entries, "box", progress)[0].lemma, e.lemma);
  const alpha = sortEntries(entries, "alphabet", {}).map((x) => x.lemma.toLowerCase());
  assert.deepEqual(alpha, [...alpha].sort((a, b) => a.localeCompare(b, "en")));
});

test("russian plurals and dates", () => {
  assert.equal(RU.words(1), "1 слово"); assert.equal(RU.words(3), "3 слова"); assert.equal(RU.words(12), "12 слов"); assert.equal(RU.words(22), "22 слова");
  assert.equal(RU.day("2026-10-16"), "16 октября"); assert.equal(RU.weekday("2026-10-16"), "пятница");
  assert.equal(RU.day("2026-02-30"), "2026-02-30"); assert.equal(RU.month("2026-10"), "Октябрь 2026");
});
