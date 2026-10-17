// Russian forms and dates (port of SharedKernel/RussianFormat.swift).
export function plural(n, one, few, many) {
  const m = Math.abs(n) % 10, h = Math.abs(n) % 100;
  if (m === 1 && h !== 11) return one;
  if (m >= 2 && m <= 4 && !(h >= 12 && h <= 14)) return few;
  return many;
}
export const count = (n, one, few, many) => `${n} ${plural(n, one, few, many)}`;
export const words = (n) => count(n, "слово", "слова", "слов");
export const lessons = (n) => count(n, "урок", "урока", "уроков");
export const repeats = (n) => count(n, "повтор", "повтора", "повторов");

const GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const WD = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const WD_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

/** "yyyy-mm-dd" → {y, m, d} or null (strict, Gregorian). */
function parts(s) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(s ?? "");
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = m[3] ? +m[3] : null;
  if (mo < 1 || mo > 12) return null;
  if (d !== null) { const dt = new Date(Date.UTC(y, mo - 1, d)); if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null; }
  return { y, m: mo, d };
}
/** Local midnight of "yyyy-mm-dd". */
export function date(s) { const p = parts(s); return p && p.d ? new Date(p.y, p.m - 1, p.d) : null; }
export function day(s) { const p = parts(s); return p && p.d ? `${p.d} ${GEN[p.m - 1]}` : s; }
export function weekday(s, short = false) { const d = date(s); return d ? (short ? WD_SHORT : WD)[d.getDay()] : ""; }
export function month(ym) { const p = parts(ym); return p ? `${MONTHS[p.m - 1]} ${p.y}` : ym; }
export function isoDay(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export const shortDate = (d) => `${d.getDate()} ${GEN[d.getMonth()]}`;
