// Settings: theme, progress export/import (iOS format), reset, data and app info.
import { catalog, loadCatalog } from "../data.js";
import { store } from "../store.js";
import { esc, $, toast } from "../ui.js";
import { encode, decode, merge, fileName } from "../domain/transfer.js";
import * as RU from "../domain/ru.js";
import { applyTheme, appVersion, checkForUpdate } from "../app.js";

export function mountSettings(root) {
  const draw = () => {
    const theme = store.pref("theme", "system");
    const list = store.list();
    root.innerHTML = `<div class="wrap settings">
      <section class="head"><h1>Настройки</h1></section>
      <section class="panel"><h2>Вид</h2>
        <div class="row"><span class="grow">Тема</span><div class="seg" role="group" aria-label="Тема">${[["system", "Как в системе"], ["light", "Светлая"], ["dark", "Тёмная"]].map(([k, t]) => `<button type="button" data-theme="${k}" aria-pressed="${k === theme}">${t}</button>`).join("")}</div></div>
        <div class="row"><label class="grow" for="show-ru">Сразу показывать перевод предложения на карточке</label><input type="checkbox" id="show-ru"${store.pref("showRu", false) ? " checked" : ""}></div>
      </section>
      <section class="panel"><h2>Прогресс</h2>
        <p>Прогресс хранится в этом браузере (${RU.words(list.length)} в тренировке). Файл JSON в формате приложения WordTrail для iPhone: экспортируйте здесь и импортируйте в приложении — и наоборот. При импорте для каждого слова остаётся более свежая запись.</p>
        <div class="row"><button class="btn" type="button" data-act="export"${list.length ? "" : " disabled"}>Экспорт прогресса</button><label class="btn" for="imp">Импорт прогресса</label><input id="imp" type="file" accept="application/json,.json" hidden><span class="spacer" style="flex:1"></span><button class="btn danger" type="button" data-act="reset">Сбросить прогресс</button></div>
        ${store.available ? "" : '<p style="color:var(--bad)">Хранилище браузера недоступно (приватный режим?) — прогресс не сохранится после закрытия вкладки.</p>'}
      </section>
      <section class="panel"><h2>Контент</h2>
        <dl class="kv">
          <dt>Уроков</dt><dd>${catalog.lessons.length}</dd>
          <dt>Слов в словаре</dt><dd>${catalog.vocabSize}</dd>
          <dt>Сборка</dt><dd>${esc(catalog.manifest?.generated_at ?? "—")}</dd>
          <dt>Обновлено</dt><dd>${catalog.loadedAt ? catalog.loadedAt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "—"}${catalog.error ? ` · <span style="color:var(--bad)">${esc(catalog.error)}</span>` : ""}</dd>
        </dl>
        <div class="row"><button class="btn" type="button" data-act="sync">Обновить уроки</button><button class="btn" type="button" data-act="update">Проверить обновление приложения</button></div>
      </section>
      <section class="panel"><h2>О приложении</h2>
        <dl class="kv"><dt>Версия</dt><dd>${esc(appVersion)}</dd></dl>
        <p>Веб-версия WordTrail: карточки, тренировки и повторение по Лейтнеру (1/3/7/14/30 дней) — как в приложении для iPhone. Тренировка произношения есть только в приложении. Работает офлайн; на iPhone: «Поделиться» → «На экран „Домой“».</p>
        <p><a class="link" href="https://github.com/Di0niz/wordtrail-content">Репозиторий контента</a> · <a class="link" href="../editor/">Редактор уроков</a></p>
        <p>Словарь фонем — CMUdict (BSD). Озвучка — синтез речи, указан в сборке контента.</p>
      </section>
    </div>`;
  };
  draw();

  root.onclick = async (e) => {
    const t = e.target.closest("[data-theme],[data-act]");
    if (!t) return;
    if (t.dataset.theme) { store.setPref("theme", t.dataset.theme); applyTheme(); draw(); return; }
    switch (t.dataset.act) {
      case "export": {
        const blob = new Blob([encode(store.list())], { type: "application/json" });
        const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: fileName() });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        break;
      }
      case "reset":
        if (confirm("Сбросить прогресс всех слов в этом браузере?")) { store.reset(); draw(); toast("Прогресс сброшен"); }
        break;
      case "sync":
        t.disabled = true;
        try { await loadCatalog(); toast(catalog.error ? `Не удалось обновить: ${catalog.error}` : "Уроки обновлены"); } finally { draw(); }
        break;
      case "update":
        toast((await checkForUpdate()) ? "Есть новая версия — обновите по кнопке внизу" : "Установлена последняя версия");
        break;
    }
  };
  root.onchange = async (e) => {
    if (e.target.id === "show-ru") store.setPref("showRu", e.target.checked);
    if (e.target.id === "imp" && e.target.files[0]) {
      try {
        const file = decode(await e.target.files[0].text());
        const m = merge(store.list(), file.items);
        store.upsert(m.upserts);
        toast(`Импорт: новых ${m.added}, обновлено ${m.updated}, оставлено без изменений ${m.kept}`);
        draw();
      } catch (err) {
        toast(`Не удалось импортировать: ${err.message}`);
      }
      e.target.value = "";
    }
  };
  return () => { root.onclick = root.onchange = null; };
}
