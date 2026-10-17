// Whole-word, case-insensitive search (port of SharedKernel/WordMatch.swift):
// a match must not touch letters, marks or numbers on either side ("rely" is not inside "barely").

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** {start, end} in UTF-16 indices of `text`, or null. */
export function firstRange(needle, text, substringFallback = false) {
  if (!needle) return null;
  const re = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escapeRe(needle)}(?![\\p{L}\\p{M}\\p{N}])`, "iu");
  const m = re.exec(text);
  if (m) return { start: m.index, end: m.index + m[0].length };
  if (!substringFallback) return null;
  const i = text.toLowerCase().indexOf(needle.toLowerCase());
  return i < 0 ? null : { start: i, end: i + needle.length };
}

export const contains = (needle, text) => firstRange(needle, text) !== null;
