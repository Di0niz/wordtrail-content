// Finished session → Leitner progress (port of LearningDomain/SessionOutcome.swift).
import * as Leitner from "./leitner.js";

/**
 * @param results [{item, firstTry}]
 * @param existing Record<itemId, ProgressRecord> (dates as Date)
 * @returns {{records: object[], rows: object[]}} rows — mistakes first
 */
export function apply(results, existing, lessonID, now = new Date()) {
  const records = [], rows = [];
  for (const r of results) {
    const old = existing[r.item.id];
    // Practising a word before it is due ("Ещё раз") must not climb boxes; a mistake still demotes it.
    const scheduled = old ? old.due <= now : true;
    const next = scheduled || !r.firstTry ? Leitner.next(old ? { box: old.box, due: old.due } : null, r.firstTry, now) : { box: old.box, due: old.due };
    const p = old ? { ...old } : { itemID: r.item.id, lessonID: lessonID(r.item), box: 0, due: now, last: now, attempts: 0, mistakes: 0 };
    p.box = next.box; p.due = next.due; p.last = now; p.attempts += 1;
    if (!r.firstTry) p.mistakes += 1;
    records.push(p);
    rows.push({ id: r.item.id, text: r.item.text, firstTry: r.firstTry, box: next.box, due: next.due });
  }
  rows.sort((a, b) => Number(a.firstTry) - Number(b.firstTry));
  return { records, rows };
}
