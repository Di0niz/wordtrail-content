// Cross-lesson selection, streak and dictionary (ports of ReviewSelection, Streak, DictionaryEntry).
import { MAX_ITEMS } from "./session.js";
import { isoDay } from "./ru.js";
import { addDays } from "./leitner.js";

/** lessons newest first; progress: Record<id,{box,due}> */
export function pick(mode, lessons, progress, now = new Date()) {
  if (mode === "due") return lessons.flatMap((l) => l.items).filter((it) => progress[it.id] && progress[it.id].due <= now);
  // fresh: oldest lesson first, words inside a lesson in their original order
  return [...lessons].reverse().flatMap((l) => l.items).filter((it) => !progress[it.id]).slice(0, MAX_ITEMS);
}

/** Consecutive training days ending today (or yesterday, if today is not trained yet). */
export function streak(days, now = new Date()) {
  let d = now;
  if (!days.has(isoDay(d))) { const y = addDays(d, -1); if (!days.has(isoDay(y))) return 0; d = y; }
  let n = 0;
  while (days.has(isoDay(d))) { n++; d = addDays(d, -1); }
  return n;
}

export const LEARNED_BOX = 4;
export const STATUSES = { all: "все", new: "новые", learning: "учу", learned: "выучено", due: "к повторению" };
export const SORTS = { alphabet: "по алфавиту", date: "по дате", box: "по коробке" };

/** Groups lesson items by lemma (case-insensitive); lessons newest first → encounters newest first. */
export function buildDictionary(lessons) {
  const order = [], byKey = new Map();
  for (const lesson of lessons) for (const item of lesson.items) {
    const key = item.lemma.toLowerCase();
    const e = { item, lessonID: lesson.id, lessonTitle: lesson.source.title, date: lesson.date };
    if (!byKey.has(key)) { order.push(key); byKey.set(key, { lemma: item.lemma, encounters: [e] }); }
    else byKey.get(key).encounters.push(e);
  }
  return order.map((k) => byKey.get(k));
}

export const maxBox = (e, progress) => {
  const b = e.encounters.map((x) => progress[x.item.id]?.box).filter((x) => x !== undefined);
  return b.length ? Math.max(...b) : null;
};
export const entryIsDue = (e, progress, now = new Date()) => e.encounters.some((x) => progress[x.item.id] && progress[x.item.id].due <= now);
export const lastDate = (e) => e.encounters.map((x) => x.date).sort().at(-1) ?? "";

export function matchesStatus(e, status, progress, now = new Date()) {
  const box = maxBox(e, progress);
  switch (status) {
    case "new": return box === null;
    case "learning": return box !== null && box < LEARNED_BOX;
    case "learned": return box !== null && box >= LEARNED_BOX;
    case "due": return entryIsDue(e, progress, now);
    default: return true;
  }
}

export function matchesQuery(e, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return e.lemma.toLowerCase().includes(q) || e.encounters.some(({ item: it }) =>
    it.text.toLowerCase().includes(q) || it.content.ru_short.toLowerCase().includes(q) || it.content.ru.toLowerCase().includes(q));
}

const coll = new Intl.Collator("en", { sensitivity: "base" });
export function sortEntries(entries, sort, progress) {
  const a = [...entries];
  if (sort === "alphabet") return a.sort((x, y) => coll.compare(x.lemma, y.lemma));
  if (sort === "date") return a.sort((x, y) => lastDate(y).localeCompare(lastDate(x)) || coll.compare(x.lemma, y.lemma));
  return a.sort((x, y) => (maxBox(y, progress) ?? -1) - (maxBox(x, progress) ?? -1) || coll.compare(x.lemma, y.lemma));
}
