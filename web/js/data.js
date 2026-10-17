// Content catalog from the content repo's data/ (GitHub Pages): manifest → lessons (by sha) → vocab.
// Lesson URLs carry ?v=<sha>, so a changed lesson is a new URL and unchanged ones come from cache.
import { isVerse, displayVerse } from "./domain/verse.js";

export const DATA = new URL("../../data/", import.meta.url); // web/js/data.js → /data/

export const catalog = {
  manifest: null,
  lessons: [], // manifest order: newest date first, then position in the day
  byId: new Map(),
  vocabSize: 0,
  loadedAt: null,
  error: null,
};

async function getJSON(url, init) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${url.pathname.split("/").pop()}: HTTP ${r.status}`);
  return r.json();
}

export async function loadCatalog() {
  try {
    const manifest = await getJSON(new URL("manifest.json", DATA), { cache: "no-cache" });
    const lessons = await Promise.all(manifest.lessons.map((e) => getJSON(new URL(`${e.path}?v=${e.sha}`, DATA))));
    let vocabSize = new Set(lessons.flatMap((l) => l.items.map((i) => i.lemma.toLowerCase()))).size;
    if (manifest.vocab) {
      try { vocabSize = Object.keys(await getJSON(new URL(`${manifest.vocab.path}?v=${manifest.vocab.sha}`, DATA))).length; } catch {}
    }
    const verseItems = new Set(lessons.filter((l) => isVerse(l.items.map((i) => i.sentence))).flatMap((l) => l.items.map((i) => i.id)));
    Object.assign(catalog, { manifest, lessons, byId: new Map(lessons.map((l) => [l.id, l])), vocabSize, verseItems, loadedAt: new Date(), error: null });
    pruneDataCache(manifest);
  } catch (e) {
    catalog.error = e.message || String(e);
    if (!catalog.manifest) throw e;
  }
  return catalog;
}

/** Drops cached lesson/vocab versions that the current manifest no longer references. */
async function pruneDataCache(manifest) {
  if (!("caches" in self)) return;
  const keep = new Set([...manifest.lessons.map((e) => `${e.path}?v=${e.sha}`), manifest.vocab && `${manifest.vocab.path}?v=${manifest.vocab.sha}`].filter(Boolean));
  try {
    const cache = await caches.open("wt-data");
    for (const req of await cache.keys()) {
      const u = new URL(req.url);
      const rel = u.pathname.slice(DATA.pathname.length) + u.search;
      if (u.search.startsWith("?v=") && !keep.has(rel)) cache.delete(req);
    }
  } catch {}
}

/** The item's sentence as shown: a poem's lines on separate lines (same length as `sentence`). */
export const shownSentence = (it) => (catalog.verseItems?.has(it.id) ? displayVerse(it.sentence) : it.sentence);
export const allItems = () => catalog.lessons.flatMap((l) => l.items);
export const lessonOf = (itemId) => catalog.lessons.find((l) => l.items.some((i) => i.id === itemId));
export const hasRecordedAudio = (lesson) => lesson?.build?.audio_status === "ready";
export function audioURL(file, lesson) {
  if (!file || !hasRecordedAudio(lesson)) return null;
  return new URL(`${catalog.manifest?.audio_base ?? "audio/"}${file}`, DATA).href;
}

/** date → lessons of that day (day order), newest date first. */
export function days() {
  const map = new Map();
  for (const l of catalog.lessons) { if (!map.has(l.date)) map.set(l.date, []); map.get(l.date).push(l); }
  for (const ls of map.values()) ls.sort((a, b) => (a.day?.index ?? 0) - (b.day?.index ?? 0));
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([date, lessons]) => ({ date, lessons }));
}
