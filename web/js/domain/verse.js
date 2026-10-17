// Lines of verse inside a lesson sentence (same rules as the iOS app's VerseLines).
// A poem's sentence is stored on one line, so line starts show up as mid-sentence capitals («the night Of cloudless»).
// For display those spaces become "\n"; the length is unchanged, so ranges found in the sentence still apply.

const LINE_STARTERS = new Set(("a an and as at but by for from had has have he her his how if in is it its my nor of on or our " +
  "she so that the their then there these they this those thus thy to upon was we were what when where which while who whose " +
  "with yet you your").split(" "));
const MIN_HITS = 2;

function breaks(s) {
  const out = [];
  const chars = [...s];
  for (let i = 1; i < chars.length - 1; i++) {
    if (chars[i] !== " " || !/\p{Lu}/u.test(chars[i + 1])) continue;
    const prev = chars[i - 1];
    if (!/\p{L}/u.test(prev) && prev !== ",") continue;
    let j = i + 1;
    while (j < chars.length && /[\p{L}’']/u.test(chars[j])) j++;
    out.push({ space: i, word: chars.slice(i + 1, j).join("") });
  }
  return out;
}

export function isVerse(sentences) {
  let hits = 0;
  for (const s of sentences) for (const b of breaks(s)) if (LINE_STARTERS.has(b.word.toLowerCase()) && ++hits >= MIN_HITS) return true;
  return false;
}

export function displayVerse(sentence) {
  const chars = [...sentence];
  for (const b of breaks(sentence)) if (b.word !== "I" && !/^I[’']/.test(b.word)) chars[b.space] = "\n";
  return chars.join("");
}
