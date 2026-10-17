// Lesson page: «Карточки», «Тренировка», «Слова» (iOS LessonView / prototype lesson).
import { catalog, audioURL } from "../data.js";
import { store } from "../store.js";
import { speaker } from "../audio.js";
import { esc, miniPlay, $, reduceMotion } from "../ui.js";
import * as RU from "../domain/ru.js";
import { cardHTML } from "./card.js";
import { Trainer } from "./training.js";

const MODES = [["cards", "Карточки"], ["train", "Тренировка"], ["list", "Слова"]];

export function mountLesson(root, id, params) {
  const lesson = catalog.byId.get(id);
  if (!lesson) {
    root.innerHTML = `<div class="wrap"><div class="empty"><h2>Урок не найден</h2><a class="link" href="#/">← К ленте</a></div></div>`;
    return () => {};
  }
  const items = lesson.items;
  let mode = MODES.some(([m]) => m === params.get("mode")) ? params.get("mode") : "cards";
  let cur = Math.min(Number(params.get("i") ?? store.pref("card." + id, 0)) || 0, items.length - 1);
  let trainer = null;

  root.innerHTML = `<div class="wrap">
    <nav class="crumbs" aria-label="Путь"><a href="#/">Лента</a><span aria-hidden="true">/</span><span>${RU.day(lesson.date)}</span></nav>
    <section class="head" id="l-head"></section>
    <div class="modes" role="tablist" aria-label="Режим">${MODES.map(([m, t]) => `<button role="tab" type="button" data-mode="${m}" aria-selected="${m === mode}">${t}</button>`).join("")}</div>
    <section id="l-view" aria-live="polite"></section>
  </div>`;

  const head = () => {
    const p = store.states();
    const now = new Date();
    const learned = items.filter((i) => (p[i.id]?.box ?? 0) >= 1).length;
    const due = items.filter((i) => p[i.id] && p[i.id].due <= now).length;
    const reps = items.filter((i) => (i.level ?? 1) > 1).length;
    const day = lesson.day ?? { index: 1, total: 1 };
    $("#l-head", root).innerHTML = `<div class="eyebrow">${RU.day(lesson.date)} ${lesson.date.slice(0, 4)}${day.total > 1 ? ` · урок ${day.index} из ${day.total}` : ""}</div>
      <h1>${esc(lesson.source.title)}</h1>${lesson.source.title_ru ? `<p class="ru">${esc(lesson.source.title_ru)}</p>` : ""}
      <div class="stats"><span><b>${items.length}</b> ${RU.plural(items.length, "слово", "слова", "слов")}</span><span>новых <b>${items.length - reps}</b> · повторов <b>${reps}</b></span><span>пройдено <b>${learned}</b> из ${items.length}</span><span>к повторению <b>${due}</b></span></div>`;
  };

  const view = $("#l-view", root);
  function render(dir = "") {
    speaker.stop();
    for (const b of root.querySelectorAll("[data-mode]")) b.setAttribute("aria-selected", String(b.dataset.mode === mode));
    if (mode !== "train" && trainer) { trainer.dispose(); trainer = null; }
    if (mode === "cards") {
      view.innerHTML = `<article class="panel card${dir && !reduceMotion() ? ` enter-${dir}` : ""}" id="card">${cardHTML(items[cur], lesson, cur, items.length, store.states())}</article>`;
    } else if (mode === "list") {
      const p = store.states();
      view.innerHTML = `<div style="display:grid;gap:12px"><div class="panel wl"><table>
        <thead><tr><th class="n" scope="col">№</th><th scope="col">Слово</th><th class="ipa-h" scope="col">Транскрипция</th><th scope="col">Перевод в контексте</th></tr></thead>
        <tbody>${items.map((it, i) => `<tr data-i="${i}"><td class="n">${i + 1}</td>
          <td><div class="w">${miniPlay(it.text, audioURL(it.audio?.word, lesson), null, `Прослушать ${it.text}`)}<div><a href="#" data-open="${i}">${esc(it.text)}</a>${it.lemma.toLowerCase() !== it.text.toLowerCase() ? `<span class="lem">${esc(it.lemma)}</span>` : ""}<span class="ipa-m">${esc(it.content.ipa)}</span></div></div></td>
          <td class="ipa-c">${esc(it.content.ipa)}</td><td class="tr">${esc(it.content.ru_short)}${p[it.id] ? ` <span class="muted" style="font-size:12px">· коробка ${p[it.id].box}</span>` : ""}</td></tr>`).join("")}</tbody>
      </table></div><div class="row-actions"><span>Нажмите на строку, чтобы открыть карточку слова.</span><button class="btn" type="button" data-act="train">Тренировать эти слова</button></div></div>`;
    } else {
      view.innerHTML = `<div class="panel train" id="train"></div>`;
      trainer = new Trainer($("#train", view), items, { lessons: [lesson], onExit: () => setMode("cards"), onSaved: head });
    }
    head();
  }

  function setMode(m) {
    mode = m;
    history.replaceState(null, "", `#/lesson/${encodeURIComponent(id)}?mode=${m}`);
    render();
  }
  function go(i, dir) {
    cur = (i + items.length) % items.length;
    store.setPref("card." + id, cur);
    render(dir);
    if (dir) $("#card", root)?.scrollIntoView({ block: "nearest", behavior: reduceMotion() ? "auto" : "smooth" });
  }

  root.onclick = (e) => {
    // The trainer handles its own buttons («Дальше» there must not flip cards).
    // composedPath: the trainer may have already re-rendered and detached e.target.
    if (e.composedPath().some((el) => el.id === "train") || e.target.closest("[data-pid]")) return;
    const t = e.target.closest("[data-mode],[data-act],[data-open],tr[data-i]");
    if (!t) return;
    if (t.dataset.mode) setMode(t.dataset.mode);
    else if (t.dataset.act === "prev") go(cur - 1, "prev");
    else if (t.dataset.act === "next") go(cur + 1, "next");
    else if (t.dataset.act === "train") setMode("train");
    else if (t.dataset.act === "ru") { store.setPref("showRu", !store.pref("showRu", false)); render(); }
    else if (t.dataset.open !== undefined || t.dataset.i !== undefined) { e.preventDefault(); cur = Number(t.dataset.open ?? t.dataset.i); mode = "cards"; setMode("cards"); }
  };
  const onKey = (e) => {
    if (mode !== "cards" || e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.("input,textarea,select")) return;
    if (e.key === "ArrowRight") { e.preventDefault(); go(cur + 1, "next"); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); go(cur - 1, "prev"); }
    else if (e.key === " " && !e.target.closest?.("button")) { e.preventDefault(); $("#card .play", root)?.click(); }
  };
  document.addEventListener("keydown", onKey);
  render();
  return () => { document.removeEventListener("keydown", onKey); trainer?.dispose(); speaker.stop(); root.onclick = null; };
}
