// Dictation grading (port of LearningDomain/Dictation.swift): word-level LCS that ignores case,
// punctuation and apostrophe style; correct when ≥ 85 % of words match and the target is present.

export const PASS_RATIO = 0.85;
export const MAX_WORDS = 25;

const EDGE_NON_ALNUM = /^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu;
const EDGE_PUNCT_EXCEPT_JOINERS = /^(?:(?!['-])\p{P})+|(?:(?!['-])\p{P})+$/gu;

export function normalizeWord(w) {
  return w.toLowerCase().replace(/[’‘`]/g, "'").replace(EDGE_NON_ALNUM, "");
}

/** [{display, norm}]; pure-punctuation tokens dropped. */
export function words(s) {
  return s.split(/[\s—–]+/u)
    .filter(Boolean)
    .map((t) => ({ display: t.replace(EDGE_PUNCT_EXCEPT_JOINERS, ""), norm: normalizeWord(t) }))
    .filter((t) => t.norm !== "");
}

export function isEligibleSentence(sentence) {
  const n = words(sentence).length;
  return n > 0 && n <= MAX_WORDS;
}

/** Short enough to type and the item's text is in its sentence as whole words. */
export function isEligible(item) {
  return isEligibleSentence(item.sentence) && grade(item.sentence, item.sentence, item.text).containsTarget;
}

/** tokens: [{type: "match"|"missing"|"extra", text}] */
export function grade(answer, sentence, target) {
  const exp = words(sentence), got = words(answer);
  const a = exp.map((w) => w.norm), b = got.map((w) => w.norm);
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  let tokens = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { tokens.push({ type: "match", text: exp[i].display }); i++; j++; }
    else if (j < b.length && (i === a.length || dp[i][j + 1] >= dp[i + 1][j])) { tokens.push({ type: "extra", text: got[j].display }); j++; }
    else { tokens.push({ type: "missing", text: exp[i].display }); i++; }
  }
  tokens = reorderSubstitutions(tokens);

  const t = words(target).map((w) => w.norm);
  let containsTarget = false;
  if (t.length && b.length >= t.length)
    for (let k = 0; k <= b.length - t.length && !containsTarget; k++) containsTarget = t.every((x, n) => b[k + n] === x);

  const matched = dp[0]?.[0] ?? 0, total = a.length;
  const ratio = total === 0 ? 0 : matched / total;
  return { tokens, matched, total, containsTarget, ratio, isCorrect: containsTarget && ratio >= PASS_RATIO };
}

// "missing" before "extra" when they replace each other: reads as "should be X, you typed Y".
function reorderSubstitutions(tokens) {
  const out = [];
  let missing = [], extras = [];
  const flush = () => { out.push(...missing, ...extras); missing = []; extras = []; };
  for (const t of tokens) {
    if (t.type === "match") { flush(); out.push(t); }
    else if (t.type === "missing") missing.push(t);
    else extras.push(t);
  }
  flush();
  return out;
}
