// Small view helpers shared by the screens.
import { speaker } from "./audio.js";
import { firstRange } from "./domain/wordmatch.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const ICON = {
  play: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1.2v9.6L10.5 6z"/></svg>',
  theme: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.75a6.25 6.25 0 0 1 0 12.5z" fill="currentColor"/></svg>',
};

export const POS = {
  adjective: "прилагательное", adverb: "наречие", verb: "глагол", noun: "существительное", "phrasal verb": "фразовый глагол",
  "modal verb": "модальный глагол", preposition: "предлог", idiom: "идиома", pronoun: "местоимение", conjunction: "союз",
};

// Play buttons: the handler lives in a registry, the markup only carries an id.
const plays = new Map();
let nextId = 1;
function reg(text, url, slow) { const id = String(nextId++); plays.set(id, { text, url, slow }); return id; }
const playingAttr = (text) => (speaker.key === text ? ` on${speaker.slow ? " is-slow" : ""}` : "");

export function playBtn(label, text, url = null, slow = null) {
  return `<button type="button" class="play${playingAttr(text)}" data-pid="${reg(text, url, slow)}" data-say="${esc(text)}" title="Повторное нажатие — медленнее">${ICON.play}${esc(label)}</button>`;
}
export function miniPlay(text, url = null, slow = null, aria = "Прослушать") {
  return `<button type="button" class="mini-play${playingAttr(text)}" data-pid="${reg(text, url, slow)}" data-say="${esc(text)}" aria-label="${esc(aria)}">${ICON.play}</button>`;
}
export function bigPlay(label, text, url = null, slow = null) {
  return `<button type="button" class="big-play${playingAttr(text)}" data-pid="${reg(text, url, slow)}" data-say="${esc(text)}">${ICON.play}${esc(label)}</button>`;
}
export function playById(id) { const p = plays.get(id); if (p) speaker.play(p.text, p.url, p.slow); }
export const playPayload = (id) => plays.get(id);

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-pid]");
  if (b) { e.preventDefault(); playById(b.dataset.pid); }
});
document.addEventListener("wt:playing", (e) => {
  for (const b of $$("[data-say]")) {
    const on = e.detail.key !== null && b.dataset.say === e.detail.key;
    b.classList.toggle("on", on);
    b.classList.toggle("is-slow", on && e.detail.slow);
  }
});

/** Sentence with the item marked: whole-word match first, then substring (inflected forms). */
export function highlight(sentence, word, tag = "mark", cls = "") {
  const r = firstRange(word, sentence, true);
  if (!r) return esc(sentence);
  const c = cls ? ` class="${cls}"` : "";
  return esc(sentence.slice(0, r.start)) + `<${tag}${c}>` + esc(sentence.slice(r.start, r.end)) + `</${tag}>` + esc(sentence.slice(r.end));
}

/** Bolds the first word of an example starting with the lemma's stem (prototype's boldForms). */
export function boldForms(en, lemma) {
  let stem = (lemma.split(" ")[0] ?? "").toLowerCase();
  if (stem.endsWith("e") && stem.length > 2) stem = stem.slice(0, -1);
  if (!stem) return esc(en);
  const m = new RegExp(`\\b(${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[a-z\\-]*)`, "i").exec(en);
  if (!m) return esc(en);
  return esc(en.slice(0, m.index)) + "<b>" + esc(m[0]) + "</b>" + esc(en.slice(m.index + m[0].length));
}

export function boxDots(box) {
  if (box === null || box === undefined) return "";
  return `<span class="box-dots" aria-label="коробка ${box} из 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= box ? "on" : ""}"></i>`).join("")}</span>`;
}

let toastTimer = null;
export function toast(message, action = null) {
  let t = $("#toast");
  t.hidden = false;
  t.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ""}`;
  if (action) t.querySelector("button").onclick = () => { t.hidden = true; action.run(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), action ? 12000 : 3500);
}
document.addEventListener("wt:toast", (e) => toast(e.detail));

export const reduceMotion = () => document.documentElement.dataset.motion === "reduce" || matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Forget play handlers of the previous screen. */
export function clearPlays() { plays.clear(); }
