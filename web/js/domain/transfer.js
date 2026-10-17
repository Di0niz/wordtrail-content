// Progress export/import in the iOS app's format (LearningDomain/ProgressTransfer.swift):
// {"version": 1, "exported_at": ISO-8601, "items": [{item_id, lesson_id, box, due, last, attempts, mistakes}]}.
// Dates are ISO-8601 without fractional seconds — Swift's .iso8601 strategy rejects milliseconds.
import { MAX_BOX } from "./leitner.js";
import { isoDay } from "./ru.js";

export const iso = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, "Z");

function parseDate(s, field) {
  const d = new Date(s);
  if (typeof s !== "string" || Number.isNaN(d.getTime())) throw new Error(`Неверная дата в поле ${field}: ${s}`);
  return d;
}

/** Clamped to valid ranges; null without an item id. */
export function sanitize(r) {
  if (!r.itemID) return null;
  const box = Math.max(0, Math.min(MAX_BOX, r.box | 0));
  const attempts = Math.max(0, r.attempts | 0);
  const mistakes = Math.max(0, Math.min(attempts, r.mistakes | 0));
  return { ...r, box, attempts, mistakes };
}

export function encode(records, now = new Date()) {
  const items = [...records].sort((a, b) => (a.itemID < b.itemID ? -1 : a.itemID > b.itemID ? 1 : 0)).map((r) => ({
    attempts: r.attempts, box: r.box, due: iso(r.due), item_id: r.itemID, last: iso(r.last), lesson_id: r.lessonID, mistakes: r.mistakes,
  }));
  return JSON.stringify({ exported_at: iso(now), items, version: 1 }, null, 2);
}

export function decode(text) {
  const j = JSON.parse(text);
  if (j.version !== 1) throw new Error(`Неизвестная версия файла: ${j.version}`);
  if (!Array.isArray(j.items)) throw new Error("В файле нет списка items");
  parseDate(j.exported_at, "exported_at");
  const items = j.items.map((x) => sanitize({
    itemID: String(x.item_id ?? ""), lessonID: String(x.lesson_id ?? ""), box: x.box, due: parseDate(x.due, "due"),
    last: parseDate(x.last, "last"), attempts: x.attempts, mistakes: x.mistakes,
  })).filter(Boolean);
  return { version: 1, exportedAt: new Date(j.exported_at), items };
}

/** For every item keeps the record with the later `last`; on a tie the local one wins. */
export function merge(local, incoming) {
  const byID = new Map();
  for (const r of local) { const m = byID.get(r.itemID); if (!m || r.last > m.last) byID.set(r.itemID, r); }
  const newest = new Map();
  for (const r of incoming) { const m = newest.get(r.itemID); if (!m || r.last > m.last) newest.set(r.itemID, r); }
  const out = { upserts: [], added: 0, updated: 0, kept: 0 };
  for (const r of [...newest.values()].sort((a, b) => (a.itemID < b.itemID ? -1 : 1))) {
    const mine = byID.get(r.itemID);
    if (mine) { if (r.last > mine.last) { out.upserts.push(r); out.updated++; } else out.kept++; }
    else { out.upserts.push(r); out.added++; }
  }
  return out;
}

export const fileName = (date = new Date()) => `wordtrail-progress-${isoDay(date)}.json`;
