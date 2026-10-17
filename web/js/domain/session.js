// One training run (port of LearningDomain/TrainingSession.swift): up to 20 items, due first;
// exercise type depends on the Leitner box; a wrong answer re-queues the item once, easier.

import { firstRange } from "./wordmatch.js";
import * as Dictation from "./dictation.js";

export const MAX_ITEMS = 20;
export const KINDS = { listen: "Послушать и понять", cloze: "Пропуск", recall: "Перевод назад", dictation: "Диктант" };

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Deterministic RNG for tests (mulberry32). */
export function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sentence split around the first whole-word occurrence of the item text, or null. */
export function clozeParts(item) {
  const r = firstRange(item.text, item.sentence);
  if (!r) return null;
  return { before: item.sentence.slice(0, r.start), word: item.sentence.slice(r.start, r.end), after: item.sentence.slice(r.end) };
}

export function kindFor(item, box, index) {
  let kind;
  if (box >= 3) kind = index % 2 === 0 && Dictation.isEligible(item) ? "dictation" : "recall";
  else kind = box === 2 ? "recall" : box === 1 ? "cloze" : ["listen", "cloze", "recall"][index % 3];
  if (kind === "cloze" && !clozeParts(item)) return "recall";
  return kind;
}

const PUNCT_EDGES = /^(?:(?!['-])\p{P})+|(?:(?!['-])\p{P})+$/gu;
export function normalize(s) {
  return s.toLowerCase().replace(/[’`]/g, "'").split(/\s+/u).filter(Boolean).join(" ").replace(PUNCT_EDGES, "");
}

export function accepted(q) {
  const it = q.item, c = it.content;
  switch (q.kind) {
    case "listen": return [c.ru_short];
    case "cloze": return [it.text];
    case "recall": return [it.text, it.lemma, c.suggest_phrase].filter(Boolean);
    case "dictation": return [it.sentence];
  }
  return [];
}

export class TrainingSession {
  /**
   * @param {object[]} items candidates
   * @param {{pool?: object[], progress?: Record<string,{box:number,due:Date}>, now?: Date, limit?: number, rng?: () => number}} opts
   */
  constructor(items, { pool, progress = {}, now = new Date(), limit = MAX_ITEMS, rng = Math.random } = {}) {
    this.pool = pool ?? items;
    this.rng = rng;
    this.position = 0;
    this.results = new Map();
    this.order = [];
    // due → never trained → not yet due; random inside each group
    const rank = (it) => { const p = progress[it.id]; return !p ? 1 : p.due <= now ? 0 : 2; };
    const picked = shuffle(items, rng).map((it, i) => [it, i])
      .sort((x, y) => rank(x[0]) - rank(y[0]) || x[1] - y[1])
      .slice(0, limit).map((x) => x[0]);
    this.queue = picked.map((it, idx) => this.#question(it, kindFor(it, progress[it.id]?.box ?? 0, idx), false));
  }

  #question(item, kind, isRetry) {
    let options = [];
    if (kind === "listen") {
      const right = item.content.ru_short;
      const others = [];
      for (const o of shuffle(this.pool, this.rng)) {
        if (o.id !== item.id && o.content.ru_short !== right && !others.includes(o.content.ru_short)) others.push(o.content.ru_short);
        if (others.length === 3) break;
      }
      options = shuffle([right, ...others], this.rng);
    }
    return { item, kind, isRetry, options, key: `${item.id}:${kind}:${isRetry ? 1 : 0}:${Math.floor(this.rng() * 1e9)}` };
  }

  get current() { return this.position < this.queue.length ? this.queue[this.position] : null; }
  get isFinished() { return this.position >= this.queue.length; }
  get total() { return this.queue.length; }

  check(answer) {
    const q = this.current;
    if (!q) return false;
    if (q.kind === "listen") return answer === q.item.content.ru_short;
    if (q.kind === "dictation") return Dictation.grade(answer, q.item.sentence, q.item.text).isCorrect;
    const v = normalize(answer);
    return v !== "" && accepted(q).some((a) => normalize(a) === v);
  }

  /** Records the answer for the current question. Does not advance. */
  record(correct) {
    const q = this.current;
    if (!q) return;
    const id = q.item.id;
    const r = this.results.get(id);
    if (r) r.finallyCorrect = correct; // the last answer wins: a fixed retry counts as finally correct
    else { this.results.set(id, { item: q.item, firstTry: correct, finallyCorrect: correct }); this.order.push(id); }
    if (!correct && !q.isRetry) {
      const easier = clozeParts(q.item) ? "cloze" : "recall";
      const kind = q.kind === "recall" || q.kind === "dictation" ? easier : q.kind;
      this.queue.push(this.#question(q.item, kind, true));
    }
  }

  advance() { this.position++; }
  /** Ends the session early: drop unanswered questions. */
  finish() { this.queue = this.queue.slice(0, this.position); }
  get orderedResults() { return this.order.map((id) => this.results.get(id)); }
}
