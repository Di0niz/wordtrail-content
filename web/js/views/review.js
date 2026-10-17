// Cross-lesson sessions: due words («Повторение») and never-trained words («Новые слова»).
import { catalog } from "../data.js";
import { store } from "../store.js";
import { pick } from "../domain/review.js";
import { Trainer } from "./training.js";
import * as RU from "../domain/ru.js";

export function mountReview(root, mode) {
  // Freeze the set: finishing the session changes due dates, the result must stay on screen.
  const items = pick(mode, catalog.lessons, store.states(), new Date());
  const title = mode === "due" ? "Повторение" : "Новые слова";
  if (!items.length) {
    root.innerHTML = `<div class="wrap"><nav class="crumbs"><a href="#/">Лента</a></nav><div class="empty"><h2>${mode === "due" ? "Повторять нечего" : "Новых слов нет"}</h2>${mode === "due" ? "Слова вернутся сюда, когда подойдёт срок. Новые слова тренируются на странице урока." : "Все слова уроков уже в тренировке."}</div></div>`;
    return () => {};
  }
  root.innerHTML = `<div class="wrap"><nav class="crumbs"><a href="#/">Лента</a><span aria-hidden="true">/</span><span>${title}</span></nav>
    <section class="head"><h1>${title}</h1><div class="stats"><span>${RU.words(items.length)} из ${RU.lessons(new Set(items.map((i) => i.id.slice(0, i.id.lastIndexOf("-")))).size)}</span></div></section>
    <div class="panel train" id="train"></div></div>`;
  const t = new Trainer(root.querySelector("#train"), items, { lessons: catalog.lessons, onExit: () => (location.hash = "#/"), exitLabel: "К ленте" });
  return () => t.dispose();
}
