// Training run (iOS TrainingView / prototype training): listen, cloze, recall, dictation;
// Leitner progress is written when the session ends — or when the user leaves mid-session.
import { audioURL, lessonOf } from "../data.js";
import { store } from "../store.js";
import { speaker } from "../audio.js";
import { esc, playBtn, bigPlay, highlight, $, $$, reduceMotion, toast } from "../ui.js";
import * as RU from "../domain/ru.js";
import { TrainingSession, KINDS, clozeParts } from "../domain/session.js";
import * as Dictation from "../domain/dictation.js";
import { apply } from "../domain/outcome.js";

export class Trainer {
  /**
   * @param root element to render into
   * @param items candidates
   * @param opts {lessons, onExit?, onSaved?, exitLabel?}
   */
  constructor(root, items, { lessons, onExit = null, onSaved = null, exitLabel = "К карточкам" } = {}) {
    Object.assign(this, { root, items, lessons, onExit, onSaved, exitLabel });
    this.pool = lessons.flatMap((l) => l.items);
    this.onKey = (e) => this.#key(e);
    document.addEventListener("keydown", this.onKey);
    root.onclick = (e) => this.#click(e);
    root.onsubmit = (e) => { e.preventDefault(); this.#submitTyped(); };
    this.start();
  }

  start() {
    this.session = new TrainingSession(this.items, { pool: this.pool, progress: store.states() });
    this.applied = false;
    this.answer = null;
    this.hint = false;
    this.render();
  }

  dispose() {
    document.removeEventListener("keydown", this.onKey);
    clearTimeout(this.autoplay);
    this.persist();
    speaker.stop();
  }

  lessonOf(item) { return this.lessons.find((l) => l.items.some((i) => i.id === item.id)) ?? lessonOf(item.id); }
  urls(item) {
    const l = this.lessonOf(item), a = item.audio ?? {};
    return { word: audioURL(a.word, l), sentence: audioURL(a.sentence, l), slow: audioURL(a.sentence_slow, l) };
  }

  /** Writes Leitner progress for the answered questions; idempotent. */
  persist() {
    if (this.applied || !this.session.order.length) return null;
    const records = store.records();
    const { records: up, rows } = apply(this.session.orderedResults, records, (it) => this.lessonOf(it)?.id ?? "", new Date());
    try {
      store.upsert(up);
      store.recordDay();
      this.applied = true;
      this.onSaved?.();
    } catch (e) {
      toast(e.message);
      return null;
    }
    return rows;
  }

  // MARK: rendering

  render() {
    const s = this.session;
    clearTimeout(this.autoplay);
    if (!this.items.length) {
      this.root.innerHTML = `<div class="empty"><h2>Нечего тренировать</h2>Все слова уже на месте.</div>`;
      return;
    }
    if (s.isFinished) return this.#result();
    const q = s.current;
    const it = q.item, c = it.content, u = this.urls(it);
    const head = `<div class="t-top"><span class="t-kind">${KINDS[q.kind]}</span>${q.isRetry ? "<span>· ещё раз</span>" : ""}<span class="spacer"></span><span>${Math.min(s.position + 1, s.total)} / ${s.total}</span><button class="btn ghost sm" type="button" data-act="quit">Завершить</button></div>
      <div class="progress" aria-hidden="true"><i style="width:${(s.position / s.total) * 100}%"></i></div>`;
    let body = "";
    if (q.kind === "listen") {
      body = `<div class="listen-row">${bigPlay("Прослушать предложение", it.sentence, u.sentence, u.slow)}<span class="muted" style="font-size:12.5px">ещё раз — медленнее</span></div>
        <p class="q">Что значит <mark>${esc(it.text)}</mark> в этом предложении?</p>
        <div class="options" role="group" aria-label="Варианты">${q.options.map((o, i) => `<button class="opt" type="button" data-opt="${esc(o)}"><kbd>${i + 1}</kbd><span>${esc(o)}</span><span class="mk" aria-hidden="true"></span></button>`).join("")}</div>
        <div id="fb"></div><div class="t-actions" id="t-act"><span class="hint keys">Клавиши <kbd class="k">1</kbd>–<kbd class="k">4</kbd></span></div>`;
    } else if (q.kind === "cloze") {
      const p = clozeParts(it);
      body = `<p class="q">${esc(p.before)}<span class="gap" id="gap" style="min-width:${Math.max(5, p.word.length)}ch"></span>${esc(p.after)}</p>
        ${c.sentence_ru ? `<p class="q-sub">${esc(c.sentence_ru)}</p>` : ""}
        ${this.#typed("Впишите слово")}
        <div id="fb"></div><div class="t-actions" id="t-act"><span class="hint">Подсказка: начинается на «${esc(it.text[0])}», ${RU.count([...it.text].length, "знак", "знака", "знаков")}</span></div>`;
    } else if (q.kind === "recall") {
      body = `<p class="q">${esc(c.ru)}</p>${c.definition_en ? `<p class="q-sub">${esc(c.definition_en)}</p>` : ""}
        ${this.#typed("Слово по-английски")}
        <div id="fb"></div><div class="t-actions" id="t-act">${this.hint ? `<span class="hint">Первые буквы: «${esc(it.text.slice(0, 2))}…», в тексте — ${RU.count([...it.text].length, "знак", "знака", "знаков")}</span>` : '<button class="btn ghost sm" type="button" data-act="hint">Подсказка</button>'}</div>`;
    } else {
      body = `<div class="listen-row">${bigPlay("Прослушать · 0.75×", it.sentence, u.slow ?? u.sentence, null)}<span class="muted" style="font-size:12.5px">наберите предложение целиком</span></div>
        ${c.sentence_ru ? `<p class="q-sub" style="margin:0">${esc(c.sentence_ru)}</p>` : ""}
        ${this.#typed("Что вы услышали", true)}
        <div id="fb"></div><div class="t-actions" id="t-act"><span class="hint">Регистр и знаки препинания не важны; засчитывается от ${Math.round(Dictation.PASS_RATIO * 100)} % слов</span></div>`;
    }
    this.root.innerHTML = `<div class="${reduceMotion() ? "" : "q-enter"}" style="display:grid;gap:20px">${head}${body}</div>`;
    const inp = $("#ans", this.root);
    if (inp) setTimeout(() => inp.focus({ preventScroll: true }), 30);
    if (q.kind === "listen" || q.kind === "dictation") {
      speaker.resetRepeat();
      this.autoplay = setTimeout(() => {
        if (this.session.current !== q) return;
        if (q.kind === "listen") speaker.play(it.sentence, u.sentence, u.slow);
        else speaker.play(it.sentence, u.slow ?? u.sentence, null); // dictation: the slow recording at 1×
      }, 250);
    }
  }

  #typed(placeholder, multiline = false) {
    const field = multiline
      ? `<textarea class="answer" id="ans" rows="3" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="${placeholder}"></textarea>`
      : `<input class="answer" id="ans" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="${placeholder}">`;
    return `<form class="answer-row" id="f-ans"><label class="sr" for="ans">${placeholder}</label>${field}<button class="btn primary" type="submit">Проверить</button><button class="btn ghost" type="button" data-act="giveup">Не помню</button></form>`;
  }

  // MARK: answers

  #submitTyped() {
    const inp = $("#ans", this.root);
    if (!inp) return;
    if (this.answer) return this.next();
    const v = inp.value;
    if (!v.trim()) { inp.focus(); return; }
    this.#finish(this.session.check(v), v);
  }

  #choose(btn) {
    if (this.answer) return;
    const right = this.session.current.item.content.ru_short;
    const ok = this.session.check(btn.dataset.opt);
    for (const b of $$(".opt", this.root)) {
      b.disabled = true;
      if (b.dataset.opt === right) { b.classList.add("right"); b.querySelector(".mk").textContent = "✓"; }
    }
    if (!ok) { btn.classList.add("wrong"); btn.querySelector(".mk").textContent = "✗"; }
    this.#finish(ok, btn.dataset.opt);
  }

  #finish(ok, given) {
    const s = this.session, q = s.current, it = q.item, c = it.content, u = this.urls(it);
    s.record(ok);
    this.answer = { ok, given };
    navigator.vibrate?.(ok ? 15 : [20, 40, 20]);
    const inp = $("#ans", this.root);
    if (inp) {
      inp.classList.add(ok ? "right" : "wrong"); inp.readOnly = true;
      if (!ok && !reduceMotion()) { inp.classList.remove("shake"); void inp.offsetWidth; inp.classList.add("shake"); }
    }
    const gap = $("#gap", this.root);
    if (gap) { gap.textContent = clozeParts(it).word; gap.classList.add(ok ? "filled" : "missed"); }
    let detail;
    if (q.kind === "listen") detail = c.sentence_ru ? `<span>${esc(c.sentence_ru)}</span>` : "";
    else if (q.kind === "dictation") {
      const g = Dictation.grade(given, it.sentence, it.text);
      detail = `<div class="diff">${g.tokens.map((t) => t.type === "match" ? `<span>${esc(t.text)}</span>` : t.type === "missing" ? `<span class="miss" title="пропущено или с ошибкой">${esc(t.text)}</span>` : `<span class="x" title="лишнее">${esc(t.text)}</span>`).join(" ")}</div>
        <span class="muted">Совпало ${g.matched} из ${g.total} слов${g.containsTarget ? "" : ` · нет слова «${esc(it.text)}»`}</span>`;
    } else detail = `<span>${highlight(it.sentence, it.text, "b")}</span>`;
    $("#fb", this.root).innerHTML = `<div class="feedback ${ok ? "ok" : "no"}" role="status"><strong>${ok ? "Верно." : given ? "Не совсем." : "Ответ:"}</strong>
      <span><span class="fw">${esc(it.text)}</span> — ${esc(c.ru_short)}</span>${detail}</div>`;
    $("#t-act", this.root).innerHTML = `<button class="btn primary" type="button" data-act="next" id="t-next">Дальше</button>${playBtn("Слово", it.text, u.word)}${playBtn("Фраза", it.sentence, u.sentence, u.slow)}<span class="hint keys"><kbd class="k">Enter</kbd> — дальше</span>`;
    if (q.kind === "listen" || !inp) $("#t-next", this.root)?.focus({ preventScroll: true });
    $("#fb", this.root).scrollIntoView({ block: "nearest", behavior: reduceMotion() ? "auto" : "smooth" });
  }

  next() {
    if (!this.answer) return;
    this.session.advance();
    this.answer = null; this.hint = false;
    speaker.stop();
    this.render();
  }

  quit() {
    if (this.answer) this.session.advance();
    this.session.finish();
    this.answer = null;
    this.render();
  }

  #result() {
    const rows = this.persist() ?? this.rows ?? [];
    this.rows = rows;
    const right = rows.filter((r) => r.firstTry).length;
    const untouched = Math.max(0, this.items.length - rows.length);
    const all = rows.length && right === rows.length;
    this.root.innerHTML = `<div class="result">
      <h2>${rows.length ? (all ? 'Всё с первого раза <span class="star" aria-hidden="true">★</span>' : `${right} из ${rows.length} с первого раза`) : "Тренировка завершена"}</h2>
      <div class="result-grid">
        <div class="metric"><b>${right}</b><span>верно сразу</span></div>
        <div class="metric"><b>${rows.length - right}</b><span>${RU.plural(rows.length - right, "слово вернётся", "слова вернутся", "слов вернутся")} завтра</span></div>
        <div class="metric"><b>${untouched}</b><span>ждут следующей сессии</span></div>
      </div>
      ${rows.length ? `<div class="tbl-wrap"><table class="res-table"><thead><tr><th>Слово</th><th>Результат</th><th>Коробка</th><th>Следующий повтор</th></tr></thead><tbody>${rows.map((r, i) => `<tr style="animation-delay:${Math.min(i, 8) * 40}ms"><td>${esc(r.text)}</td><td class="${r.firstTry ? "ok-t" : "no-t"}">${r.firstTry ? "с первого раза" : "с ошибкой"}</td><td>${r.box}</td><td>${RU.shortDate(r.due)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      <div class="t-actions"><button class="btn primary" type="button" data-act="again">Ещё раз</button>${this.onExit ? `<button class="btn" type="button" data-act="exit">${esc(this.exitLabel)}</button>` : ""}</div></div>`;
  }

  // MARK: input

  #click(e) {
    if (e.target.closest("[data-pid]")) return; // play buttons: handled at document level
    const opt = e.target.closest(".opt");
    if (opt) { e.stopPropagation(); return this.#choose(opt); }
    const a = e.target.closest("[data-act]")?.dataset.act;
    if (a) e.stopPropagation(); // handled here; the button may be gone after re-render
    if (a === "quit") this.quit();
    else if (a === "next") this.next();
    else if (a === "giveup") { if (!this.answer) this.#finish(false, ""); }
    else if (a === "hint") { this.hint = true; const act = $("#t-act", this.root); const it = this.session.current.item; act.innerHTML = `<span class="hint">Первые буквы: «${esc(it.text.slice(0, 2))}…», в тексте — ${RU.count([...it.text].length, "знак", "знака", "знаков")}</span>`; }
    else if (a === "again") { this.rows = null; this.start(); }
    else if (a === "exit") this.onExit?.();
  }

  #key(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || !this.root.isConnected) return;
    const s = this.session;
    if (!s || s.isFinished) return;
    const inField = e.target.closest?.("input,textarea");
    if (this.answer && e.key === "Enter" && (!inField || e.target.readOnly)) { e.preventDefault(); this.next(); return; }
    if (!this.answer && e.key === "Enter" && e.target.tagName === "TEXTAREA" && !e.shiftKey) { e.preventDefault(); this.#submitTyped(); return; }
    if (inField) return;
    if (!this.answer && /^[1-4]$/.test(e.key)) { const b = $$(".opt", this.root)[Number(e.key) - 1]; if (b) b.click(); }
    else if (e.key === " " && !e.target.closest?.("button")) { e.preventDefault(); $(".big-play", this.root)?.click(); }
  }
}
