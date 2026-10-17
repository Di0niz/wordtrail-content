// Shared word tokenizer — JS twin of content/tools/tokenizer.py and SharedKernel/TextTokenizer.swift.
// All three must pass schemas/tokenizer-golden.json. Offsets are Unicode code points, [start, end).

const APOSTROPHES = new Set(["'", "’", "‘", "`", "ʼ"]);
const HYPHENS = new Set(["-", "‐", "‑"]);
const DIGIT_JOINERS = new Set([".", ","]);
const SOFT_HYPHEN = "\u00ad";

const isBase = (c) => /^[\p{L}\p{N}]$/u.test(c);
const isMark = (c) => /^\p{M}$/u.test(c);
const isDigit = (c) => /^\p{Nd}$/u.test(c);

export function normalize(word) {
  let out = "";
  for (const c of word) {
    if (c === SOFT_HYPHEN) continue;
    out += APOSTROPHES.has(c) ? "'" : HYPHENS.has(c) ? "-" : c;
  }
  return out.toLowerCase();
}

/** [{text, normalized, start, end}] in order. */
export function words(text) {
  const s = [...text];
  const n = s.length;
  const out = [];
  let i = 0;
  while (i < n) {
    if (!isBase(s[i])) { i++; continue; }
    const start = i;
    let j = i + 1;
    while (j < n) {
      const c = s[j];
      if (isBase(c) || isMark(c)) j++;
      else if (j + 1 < n && (APOSTROPHES.has(c) || HYPHENS.has(c) || c === SOFT_HYPHEN) && isBase(s[j + 1])) j += 2;
      else if (j + 1 < n && DIGIT_JOINERS.has(c) && isDigit(s[j - 1]) && isDigit(s[j + 1])) j += 2;
      else break;
    }
    const w = s.slice(start, j).join("");
    out.push({ text: w, normalized: normalize(w), start, end: j });
    i = j;
  }
  return out;
}
