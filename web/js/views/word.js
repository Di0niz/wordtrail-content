// Word page: every encounter of a lemma across lessons + its Leitner state (iOS WordDetailView).
import { catalog, audioURL } from "../data.js";
import { store } from "../store.js";
import { esc, playBtn, highlight, boxDots, POS } from "../ui.js";
import * as RU from "../domain/ru.js";
import { buildDictionary } from "../domain/review.js";

export function mountWord(root, lemma) {
  const e = buildDictionary(catalog.lessons).find((x) => x.lemma.toLowerCase() === lemma.toLowerCase());
  if (!e) { root.innerHTML = `<div class="wrap"><div class="empty"><h2>Слово не найдено</h2><a class="link" href="#/dictionary">← Словарь</a></div></div>`; return () => {}; }
  const records = store.records();
  const it = e.encounters[0].item, c = it.content;
  const lesson0 = catalog.byId.get(e.encounters[0].lessonID);
  root.innerHTML = `<div class="wrap">
    <nav class="crumbs"><a href="#/dictionary">Словарь</a><span aria-hidden="true">/</span><span>${esc(e.lemma)}</span></nav>
    <article class="panel card">
      <div class="word-block">
        <div class="badges"><span class="badge">${esc(POS[c.pos] ?? c.pos)}</span>${c.cefr ? `<span class="badge">${esc(c.cefr)}</span>` : ""}<span class="badge">${RU.count(e.encounters.length, "встреча", "встречи", "встреч")}</span></div>
        <h2 class="word">${esc(e.lemma)}</h2>
        <div class="pron"><span class="ipa">${esc(c.ipa)}</span>${playBtn("Слово", it.text, audioURL(it.audio?.word, lesson0))}</div>
      </div>
      <div class="meaning"><p class="ru">${esc(c.ru)}</p>${c.definition_en ? `<p class="def">${esc(c.definition_en)}</p>` : ""}</div>
      <div class="sect"><div class="sect-h"><h3>Где встречалось</h3></div>
        <div class="history">${e.encounters.map((x) => {
          const l = catalog.byId.get(x.lessonID), r = records[x.item.id], i = l.items.indexOf(x.item);
          const state = r ? `${boxDots(r.box)} коробка ${r.box} · ${r.due <= new Date() ? "повторить сейчас" : `повтор ${RU.shortDate(r.due)}`} · попыток ${r.attempts}, ошибок ${r.mistakes}` : "ещё не тренировалось";
          return `<div class="h"><div class="hs">${highlight(x.item.sentence, x.item.text)}</div>
            <span>${playBtn("Предложение", x.item.sentence, audioURL(x.item.audio?.sentence, l), audioURL(x.item.audio?.sentence_slow, l))}</span>
            <span><a class="link" href="#/lesson/${encodeURIComponent(x.lessonID)}?mode=cards&i=${i}">${esc(x.lessonTitle)}</a> · ${RU.day(x.date)}</span>
            <span>${state}</span></div>`;
        }).join("")}</div></div>
    </article></div>`;
  return () => {};
}
