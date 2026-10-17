// Dictionary: every lemma with search, status filters and sorting (iOS DictionaryView).
import { catalog } from "../data.js";
import { store } from "../store.js";
import { esc, boxDots, $ } from "../ui.js";
import * as RU from "../domain/ru.js";
import { buildDictionary, matchesStatus, matchesQuery, sortEntries, maxBox, entryIsDue, STATUSES, SORTS } from "../domain/review.js";

let entries = null, builtFor = null;

export function mountDictionary(root, params) {
  if (builtFor !== catalog.loadedAt) { entries = buildDictionary(catalog.lessons); builtFor = catalog.loadedAt; }
  let status = params.get("status") in STATUSES ? params.get("status") : "all";
  let sort = params.get("sort") in SORTS ? params.get("sort") : store.pref("dictSort", "alphabet");
  let query = params.get("q") ?? "";

  root.innerHTML = `<div class="wrap">
    <section class="head"><h1>Словарь</h1></section>
    <input class="search" id="q" type="search" placeholder="Слово или перевод" aria-label="Поиск по словарю" value="${esc(query)}" autocomplete="off" autocapitalize="off" spellcheck="false">
    <div class="filters" id="filters"></div>
    <p class="muted" id="count" style="margin:0"></p>
    <div class="panel" style="overflow:hidden"><ul class="dict" id="list"></ul></div>
  </div>`;

  function draw() {
    const progress = store.states(), now = new Date();
    const counts = Object.fromEntries(Object.keys(STATUSES).map((s) => [s, 0]));
    for (const e of entries) for (const s of Object.keys(STATUSES)) if (matchesStatus(e, s, progress, now)) counts[s]++;
    $("#filters", root).innerHTML = Object.entries(STATUSES).map(([k, t]) => `<button type="button" data-status="${k}" aria-pressed="${k === status}">${t} ${counts[k]}</button>`).join("")
      + `<select id="sort" aria-label="Сортировка">${Object.entries(SORTS).map(([k, t]) => `<option value="${k}"${k === sort ? " selected" : ""}>${t}</option>`).join("")}</select>`;
    const shown = sortEntries(entries.filter((e) => matchesStatus(e, status, progress, now) && matchesQuery(e, query)), sort, progress);
    $("#count", root).textContent = RU.words(shown.length);
    $("#list", root).innerHTML = shown.length ? shown.map((e) => {
      const it = e.encounters[0].item, box = maxBox(e, progress);
      return `<li><a href="#/word/${encodeURIComponent(e.lemma)}"><span class="lw">${esc(e.lemma)}</span>
        <span class="ls">${box === null ? "новое" : boxDots(box)}${entryIsDue(e, progress, now) ? '<span style="color:var(--repeat)">к повторению</span>' : ""}${e.encounters.length > 1 ? `<span>встреч: ${e.encounters.length}</span>` : ""}</span>
        <span class="lr">${esc(it.content.ru_short)} <span class="li">${esc(it.content.ipa)}</span></span></a></li>`;
    }).join("") : `<li style="padding:24px;text-align:center" class="muted">Ничего не найдено${query ? ` по «${esc(query)}»` : ""}</li>`;
    history.replaceState(null, "", `#/dictionary?status=${status}&sort=${sort}${query ? `&q=${encodeURIComponent(query)}` : ""}`);
  }

  $("#q", root).oninput = (e) => { query = e.target.value; draw(); };
  root.onclick = (e) => { const b = e.target.closest("[data-status]"); if (b) { status = b.dataset.status; draw(); } };
  root.onchange = (e) => { if (e.target.id === "sort") { sort = e.target.value; store.setPref("dictSort", sort); draw(); } };
  draw();
  return () => { root.onclick = root.onchange = null; };
}
