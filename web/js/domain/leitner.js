// Leitner boxes (port of LearningDomain/Leitner.swift): box 1…5 → review after 1, 3, 7, 14, 30 days;
// a mistake on the first attempt sends the word to box 0 (tomorrow).

export const INTERVALS = [0, 1, 3, 7, 14, 30];
export const MAX_BOX = INTERVALS.length - 1;

export function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days); // calendar days in the local time zone, like Calendar.date(byAdding:)
  return d;
}

/** @param {{box:number, due:Date}|null|undefined} state */
export function next(state, firstTry, now = new Date()) {
  const current = Math.max(0, Math.min(MAX_BOX, state?.box ?? 0)); // imported files may carry any integer
  const box = firstTry ? Math.min(MAX_BOX, current + 1) : 0;
  const days = box === 0 ? 1 : INTERVALS[box];
  return { box, due: addDays(now, days) };
}

export const isDue = (state, now = new Date()) => (state ? state.due <= now : false);
