// Home: totals, what to review today, the last 7 days and an archive by month (iOS FeedView + prototype feed).
import { catalog, days as allDays } from "../data.js";
import { store } from "../store.js";
import { esc } from "../ui.js";
import * as RU from "../domain/ru.js";
import { pick, streak } from "../domain/review.js";
import { addDays } from "../domain/leitner.js";

export function renderFeed() {
  const progress = store.states();
  const now = new Date();
  const today = RU.isoDay(now);
  const lessons = catalog.lessons;
  const items = lessons.flatMap((l) => l.items);
  const due = pick("due", lessons, progress, now).length;
  const fresh = items.filter((i) => !progress[i.id]).length;
  const st = streak(store.days(), now);
  const first = lessons.map((l) => l.date).sort()[0];
  const days = allDays();
  const weekStart = RU.isoDay(addDays(now, -6));
  const recent = days.filter((d) => d.date >= weekStart);
  const archive = days.filter((d) => d.date < weekStart);

  if (!lessons.length) {
    return `<div class="wrap"><div class="empty"><h2>Уроков пока нет</h2>Новые уроки появятся здесь, как только будут опубликованы.</div></div>`;
  }

  const banners = [];
  if (due > 0) banners.push(banner("#/review", "due", "↻", `На повторение сегодня: ${due}`, fresh ? `Ещё не тренировались: ${RU.words(fresh)}` : "Все слова уже в тренировке"));
  else banners.push(banner(fresh ? "#/fresh" : null, fresh ? "fresh" : "ok", fresh ? "✦" : "✓", fresh ? "Учить новые слова" : "Повторять сегодня нечего",
    fresh ? `Не тренировались: ${RU.words(fresh)} · до 20 за раз` : "Все слова уже в тренировке — загляните завтра"));
  if (due > 0 && fresh > 0) banners.push(banner("#/fresh", "fresh", "✦", "Учить новые слова", `до 20 из ${RU.words(fresh)}`));

  return `<div class="wrap">
    <section class="head">
      <h1>WordTrail</h1>
      <div class="totals">
        <a href="#/dictionary"><b>${catalog.vocabSize}</b> ${RU.plural(catalog.vocabSize, "слово", "слова", "слов")} в словаре</a>
        <span><b>${lessons.length}</b> ${RU.plural(lessons.length, "урок", "урока", "уроков")}</span>
        ${first ? `<span>с <b>${RU.day(first)}</b></span>` : ""}
        ${st ? `<span class="streak"><b>🔥 ${st}</b> ${RU.plural(st, "день", "дня", "дней")} подряд</span>` : ""}
      </div>
    </section>
    <div class="banners">${banners.join("")}</div>
    <section class="sec">
      <div class="sec-h"><h2>Последние 7 дней</h2><span class="meta">${weekMeta(recent)}</span></div>
      ${week(days, now, today)}
      <div class="days">${recent.length ? recent.map((d) => dayBlock(d, today, progress)).join("") : '<div class="gap-row">за неделю уроков не было</div>'}</div>
    </section>
    ${archive.length ? `<section class="sec"><div class="sec-h"><h2>Архив</h2></div><div class="months">${months(archive, progress)}</div></section>` : ""}
    <p class="foot-note">Прогресс хранится в этом браузере. Перенести его на iPhone и обратно — в настройках: экспорт и импорт JSON в формате приложения.</p>
  </div>`;
}

function banner(href, kind, icon, title, sub) {
  const tag = href ? "a" : "div";
  return `<${tag} class="panel banner"${href ? ` href="${href}"` : ""}><span class="ic ${kind}" aria-hidden="true">${icon}</span><span><b>${esc(title)}</b><span>${esc(sub)}</span></span>${href ? '<span class="chev" aria-hidden="true">›</span>' : ""}</${tag}>`;
}

const wordsOf = (ls) => ls.reduce((a, l) => a + l.items.length, 0);

function weekMeta(recent) {
  const lessons = recent.reduce((a, d) => a + d.lessons.length, 0);
  return `${recent.length} из 7 дней · ${RU.lessons(lessons)} · ${RU.words(recent.reduce((a, d) => a + wordsOf(d.lessons), 0))}`;
}

function week(days, now, today) {
  const by = new Map(days.map((d) => [d.date, wordsOf(d.lessons)]));
  const dates = Array.from({ length: 7 }, (_, i) => RU.isoDay(addDays(now, i - 6)));
  const max = Math.max(1, ...dates.map((d) => by.get(d) ?? 0));
  return `<div class="week">${dates.map((d, i) => {
    const w = by.get(d) ?? 0;
    const h = w ? Math.max(6, Math.round((w / max) * 64)) : 2;
    const inner = `<span class="dn">${RU.weekday(d, true)}<b>${Number(d.slice(8))}</b></span><span class="barbox"><i class="bar-v" style="height:${h}px;animation-delay:${i * 40}ms"></i></span><span class="cnt">${w ? `<b>${w}</b> сл.` : "—"}</span>`;
    const label = `${RU.day(d)}, ${RU.weekday(d)}: ${w ? RU.words(w) : "уроков нет"}`;
    return w ? `<a class="wd${d === today ? " today" : ""}" href="#d-${d}" data-scroll="d-${d}" aria-label="${label}">${inner}</a>` : `<span class="wd empty${d === today ? " today" : ""}" aria-label="${label}">${inner}</span>`;
  }).join("")}</div>`;
}

function lessonRow(l, progress) {
  const reps = l.items.filter((i) => (i.level ?? 1) > 1).length;
  const learned = l.items.filter((i) => (progress[i.id]?.box ?? 0) >= 1).length;
  return `<li><a class="lesson" href="#/lesson/${encodeURIComponent(l.id)}">
    <span class="t">${esc(l.source.title)}</span>
    <span class="nums"><b>${l.items.length}</b>${RU.plural(l.items.length, "слово", "слова", "слов")}${reps ? ` · <span class="rep">${RU.repeats(reps)}</span>` : ""}</span>
    ${l.source.title_ru ? `<span class="ru">${esc(l.source.title_ru)}</span>` : ""}
    ${learned ? `<span class="meter" title="пройдено ${learned} из ${l.items.length}"><i style="width:${(learned / l.items.length) * 100}%"></i></span>` : ""}
  </a></li>`;
}

function dayBlock(d, today, progress) {
  const w = wordsOf(d.lessons);
  const reps = d.lessons.flatMap((l) => l.items).filter((i) => (i.level ?? 1) > 1).length;
  return `<article class="panel day" id="d-${d.date}"><div class="day-h"><h3>${RU.day(d.date)}</h3><span class="muted">${RU.weekday(d.date)}</span>${d.date === today ? '<span class="tag">сегодня</span>' : ""}
    <span class="sum">${RU.lessons(d.lessons.length)} · ${RU.words(w)}${reps ? ` · ${RU.repeats(reps)}` : " · все новые"}</span></div>
    <ul class="lessons">${d.lessons.map((l) => lessonRow(l, progress)).join("")}</ul></article>`;
}

function months(archive, progress) {
  const by = new Map();
  for (const d of archive) { const m = d.date.slice(0, 7); if (!by.has(m)) by.set(m, []); by.get(m).push(d); }
  return [...by.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([m, ds], mi) => {
    const ls = ds.flatMap((d) => d.lessons);
    const [y, mo] = m.split("-").map(Number);
    const n = new Date(y, mo, 0).getDate();
    const pad = (new Date(y, mo - 1, 1).getDay() + 6) % 7;
    const words = new Map(ds.map((d) => [d.date, wordsOf(d.lessons)]));
    let cells = '<i class="pad"></i>'.repeat(pad);
    for (let k = 1; k <= n; k++) {
      const w = words.get(`${m}-${String(k).padStart(2, "0")}`) ?? 0;
      cells += `<i data-l="${!w ? 0 : w < 12 ? 1 : w < 24 ? 2 : w < 40 ? 3 : 4}"></i>`;
    }
    return `<details class="panel month"${mi === 0 ? " open" : ""}><summary><div class="m-title"><h3>${RU.month(m)}</h3>
      <span class="s">${RU.count(ds.length, "день", "дня", "дней")} · ${RU.lessons(ls.length)} · ${RU.words(wordsOf(ls))}</span></div>
      <div class="cal" aria-hidden="true">${cells}</div></summary>
      <div class="m-body"><ul class="lessons">${ds.flatMap((d) => d.lessons).map((l) => lessonRow(l, progress)).join("")}</ul></div></details>`;
  }).join("");
}
