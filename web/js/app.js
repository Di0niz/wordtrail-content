// WordTrail web — hash router, shell and service worker wiring.
import { catalog, loadCatalog } from "./data.js";
import { store, onProgress } from "./store.js";
import { speaker } from "./audio.js";
import { $, clearPlays, toast } from "./ui.js";
import { renderFeed } from "./views/feed.js";
import { mountLesson } from "./views/lesson.js";
import { mountReview } from "./views/review.js";
import { mountDictionary } from "./views/dictionary.js";
import { mountWord } from "./views/word.js";
import { mountSettings } from "./views/settings.js";

export const appVersion = "web-1.0.0";

export function applyTheme() {
  const t = store.pref("theme", "system");
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  $('meta[name="theme-color"]')?.setAttribute("content", dark ? "#17181A" : "#FAFAF7");
}

let unmount = () => {};
let lastPath = null;

function parse() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, qs] = raw.split("?");
  return { parts: path.split("/").filter(Boolean).map(decodeURIComponent), params: new URLSearchParams(qs ?? ""), path };
}

function route({ keepScroll = false } = {}) {
  const { parts, params, path } = parse();
  const root = $("#app");
  if (!catalog.manifest) return;
  unmount(); unmount = () => {};
  speaker.stop();
  clearPlays();
  const [head, arg] = parts;
  if (!head) root.innerHTML = renderFeed();
  else if (head === "lesson") unmount = mountLesson(root, arg, params);
  else if (head === "review") unmount = mountReview(root, "due");
  else if (head === "fresh") unmount = mountReview(root, "fresh");
  else if (head === "dictionary") unmount = mountDictionary(root, params);
  else if (head === "word") unmount = mountWord(root, arg ?? "");
  else if (head === "settings") unmount = mountSettings(root);
  else root.innerHTML = `<div class="wrap"><div class="empty"><h2>Страница не найдена</h2><a class="link" href="#/">← К ленте</a></div></div>`;
  for (const a of document.querySelectorAll(".nav a")) {
    const target = a.getAttribute("href").slice(1);
    a.toggleAttribute("aria-current", target === "/" ? !head : target.startsWith(`/${head}`));
    if (a.hasAttribute("aria-current")) a.setAttribute("aria-current", "page");
  }
  if (!keepScroll && path !== lastPath) scrollTo({ top: 0 });
  lastPath = path;
  root.classList.remove("view-enter"); void root.offsetWidth; root.classList.add("view-enter");
  document.title = titleFor(head, arg);
}

function titleFor(head, arg) {
  if (head === "lesson") return `${catalog.byId.get(arg)?.source.title ?? "Урок"} · WordTrail`;
  return { review: "Повторение", fresh: "Новые слова", dictionary: "Словарь", word: arg, settings: "Настройки" }[head]
    ? `${{ review: "Повторение", fresh: "Новые слова", dictionary: "Словарь", word: arg, settings: "Настройки" }[head]} · WordTrail` : "WordTrail";
}

// In-page anchors (week strip → day) must not change the route.
document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-scroll]");
  if (!a) return;
  e.preventDefault();
  document.getElementById(a.dataset.scroll)?.scrollIntoView({ behavior: "smooth", block: "start" });
});

addEventListener("hashchange", () => route());
// Feed numbers follow progress written in another tab.
onProgress(() => { if (!parse().parts.length) route({ keepScroll: true }); });

function syncStatus() {
  const s = $("#sync");
  if (!s) return;
  s.textContent = catalog.error ? "нет связи" : "";
  s.classList.toggle("bad", !!catalog.error);
  s.title = catalog.error ? `Не удалось обновить уроки: ${catalog.error}. Показаны сохранённые.` : "";
}

// MARK: service worker

let waiting = null;
export async function checkForUpdate() {
  const reg = await navigator.serviceWorker?.getRegistration();
  if (!reg) return false;
  await reg.update().catch(() => {});
  return !!(reg.waiting ?? waiting);
}
function offerUpdate(worker) {
  waiting = worker;
  toast("Доступна новая версия", { label: "Обновить", run: () => worker.postMessage("skipWaiting") });
}
async function registerSW() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  try {
    const reg = await navigator.serviceWorker.register("./sw.js");
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w?.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) offerUpdate(w); });
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloading) { reloading = true; location.reload(); } });
  } catch (e) { console.warn("service worker:", e); }
}

// MARK: boot

async function boot() {
  applyTheme();
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applyTheme);
  if (new URLSearchParams(location.search).get("reduceMotion") === "1") document.documentElement.dataset.motion = "reduce";
  $("#theme-btn").onclick = () => {
    const cur = store.pref("theme", "system");
    const dark = cur === "dark" || (cur === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    store.setPref("theme", dark ? "light" : "dark");
    applyTheme();
  };
  try {
    await loadCatalog();
  } catch (e) {
    $("#app").innerHTML = `<div class="wrap"><div class="empty"><h2>Не удалось загрузить уроки</h2>${e.message}<br><button class="btn" style="margin-top:12px" onclick="location.reload()">Повторить</button></div></div>`;
    syncStatus();
    registerSW();
    return;
  }
  syncStatus();
  route();
  registerSW();
  // Refresh lessons when the tab comes back (cheap: unchanged lessons are cached by sha).
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") return;
    const before = catalog.manifest?.generated_at;
    await loadCatalog().catch(() => {});
    syncStatus();
    if (catalog.manifest?.generated_at !== before && !parse().parts.length) route({ keepScroll: true });
  });
}

boot();
