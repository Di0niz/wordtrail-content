// One word card (iOS WordCardView / prototype card).
import { audioURL } from "../data.js";
import { store } from "../store.js";
import { esc, playBtn, miniPlay, highlight, boldForms, POS } from "../ui.js";
import * as RU from "../domain/ru.js";

export function cardHTML(it, lesson, index, total, progress) {
  const c = it.content;
  const a = it.audio ?? {};
  const flags = [];
  if (c.proper_noun) flags.push('<span class="badge flag">в тексте имя собственное</span>');
  if (c.suggest_phrase) flags.push(`<span class="badge flag">агент предлагает фразу: ${esc(c.suggest_phrase)}</span>`);
  if (c.short_context) flags.push('<span class="badge flag">короткий контекст: заголовок</span>');
  for (const f of c.flags ?? []) flags.push(`<span class="badge flag">${esc(f)}</span>`);
  const level = it.level ?? 1;
  const showRu = store.pref("showRu", false);
  const p = progress[it.id];
  const dueText = !p ? "ещё не тренировалось" : p.due <= new Date() ? "повторить сейчас" : `повтор ${RU.shortDate(p.due)}`;
  const sentenceURL = audioURL(a.sentence, lesson), slowURL = audioURL(a.sentence_slow, lesson);

  return `
    <div class="card-top">
      <div class="word-block">
        <div class="badges">${level > 1 ? `<span class="badge flag">повтор · ур. ${level}</span>` : '<span class="badge new">новое · ур. 1</span>'}<span class="badge">${esc(POS[c.pos] ?? c.pos)}</span>${c.cefr ? `<span class="badge">${esc(c.cefr)}</span>` : ""}${flags.join("")}</div>
        <h2 class="word">${esc(it.text)}</h2>
        <div class="pron"><span class="ipa">${esc(c.ipa)}</span>${playBtn("Слово", it.text, audioURL(a.word, lesson))}${it.lemma.toLowerCase() !== it.text.toLowerCase() ? `<span class="lemma">словарная форма: <b>${esc(it.lemma)}</b></span>` : ""}</div>
      </div>
      <div class="nav-btns"><button class="btn sm" type="button" data-act="prev" aria-label="Предыдущее слово">←</button><button class="btn sm" type="button" data-act="next" aria-label="Следующее слово">→</button></div>
    </div>
    <div class="meaning"><p class="ru">${esc(c.ru)}</p>${c.definition_en ? `<p class="def">${esc(c.definition_en)}</p>` : ""}</div>
    <div class="sect">
      <div class="sect-h"><h3>Ваш контекст</h3><span class="spacer"></span>${playBtn("Предложение", it.sentence, sentenceURL, slowURL)}</div>
      <p class="context">${highlight(it.sentence, it.text)}</p>
      ${c.sentence_ru ? (showRu ? `<p class="context-ru">${esc(c.sentence_ru)}</p><button class="reveal" type="button" data-act="ru">Скрыть перевод</button>` : '<button class="reveal" type="button" data-act="ru">Показать перевод предложения</button>') : ""}
    </div>
    ${c.note_ru ? `<p class="note">${esc(c.note_ru)}</p>` : ""}
    ${levelDetails(it, lesson)}
    ${c.examples?.length ? `<div class="sect"><div class="sect-h"><h3>Примеры</h3></div><ul class="examples">${c.examples.map((ex, i) => `<li>${miniPlay(ex.en, audioURL(a.examples?.[i], lesson), null, "Прослушать пример")}<span class="en">${boldForms(ex.en, it.lemma)}</span><span class="r">${esc(ex.ru)}</span></li>`).join("")}</ul></div>` : ""}
    ${it.history?.length ? `<div class="sect"><div class="sect-h"><h3>Встречалось раньше · ${RU.count(it.history.length, "раз", "раза", "раз")}</h3></div><div class="history">${it.history.map((h) => `<div class="h"><div class="hs">${highlight(h.sentence, it.lemma, "mark", "rep-m")}</div>${h.date ? `<span>${RU.day(h.date)}</span>` : ""}</div>`).join("")}</div></div>` : ""}
    <div class="card-foot"><span>${index + 1} из ${total}</span><span>·</span><span>${esc(dueText)}</span><a class="link" href="#/word/${encodeURIComponent(it.lemma)}">Все встречи слова →</a><span class="spacer"></span>
      ${index < total - 1 ? '<button class="btn" type="button" data-act="next">Дальше →</button>' : '<button class="btn primary" type="button" data-act="train">К тренировке</button>'}</div>`;
}

function levelDetails(it, lesson) {
  const c = it.content, out = [];
  const sect = (title, body) => `<div class="sect"><div class="sect-h"><h3>${title}</h3></div>${body}</div>`;
  if (c.collocations?.length) out.push(sect("Сочетания", `<div class="chips">${c.collocations.map((x) => `<span class="chip">${esc(x)}</span>`).join("")}</div>`));
  if (c.family?.length) out.push(sect("Семья слова", `<div class="chips">${c.family.map((x) => `<span class="chip">${esc(x)}</span>`).join("")}</div>`));
  if (c.compare_ru) out.push(sect("Сравнение контекстов", `<p class="muted" style="margin:0;line-height:1.55">${esc(c.compare_ru)}</p>`));
  if (c.synonyms?.length) out.push(sect("Синонимы", c.synonyms.map((s) => `<div class="syn"><b>${esc(s.word)}</b><span class="muted">${esc(s.note_ru)}</span></div>`).join("")));
  if (c.register_ru) out.push(sect("Регистр", `<p class="muted" style="margin:0">${esc(c.register_ru)}</p>`));
  if (c.mistakes_ru?.length) out.push(sect("Типичные ошибки", `<ul style="margin:0;padding-left:18px;line-height:1.55">${c.mistakes_ru.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>`));
  if (c.story) out.push(sect("Мини-история", `<div class="history"><div class="h"><div class="hs">${miniPlay(c.story.en)} ${esc(c.story.en)}</div><span>${esc(c.story.ru)}</span></div></div>`));
  return out.join("");
}
