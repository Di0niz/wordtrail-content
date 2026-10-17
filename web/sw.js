// WordTrail web service worker: offline shell, lesson data by sha, audio on demand.
// Bump VERSION whenever a shell file changes — the page then offers «Обновить».
const VERSION = "web-1.0.0";
const SHELL_CACHE = `wt-shell-${VERSION}`;
const DATA_CACHE = "wt-data";
const AUDIO_CACHE = "wt-audio";
const FONT_CACHE = "wt-fonts";

// Keep in sync with web/ (tests/sw.test.mjs checks every file is listed).
const SHELL = [
  "./", "./index.html", "./app.css", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png",
  "./js/app.js", "./js/audio.js", "./js/data.js", "./js/store.js", "./js/ui.js",
  "./js/domain/dictation.js", "./js/domain/leitner.js", "./js/domain/outcome.js", "./js/domain/review.js",
  "./js/domain/ru.js", "./js/domain/session.js", "./js/domain/tokenizer.js", "./js/domain/transfer.js", "./js/domain/wordmatch.js",
  "./js/views/card.js", "./js/views/dictionary.js", "./js/views/feed.js", "./js/views/lesson.js",
  "./js/views/review.js", "./js/views/settings.js", "./js/views/training.js", "./js/views/word.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("wt-shell-") && k !== SHELL_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("message", (e) => { if (e.data === "skipWaiting") self.skipWaiting(); });

const DATA_PATH = new URL("../data/", self.registration.scope).pathname;

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === location.origin && url.pathname.startsWith(DATA_PATH)) {
    const rel = url.pathname.slice(DATA_PATH.length);
    if (rel === "manifest.json") return e.respondWith(networkFirst(req, DATA_CACHE));
    if (rel.startsWith("audio/")) return e.respondWith(audio(req));
    if (url.searchParams.has("v")) return e.respondWith(cacheFirst(req, DATA_CACHE)); // immutable by sha
    return e.respondWith(networkFirst(req, DATA_CACHE));
  }
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") return e.respondWith(staleWhileRevalidate(req, FONT_CACHE));
  if (url.origin === location.origin && url.pathname.startsWith(new URL(self.registration.scope).pathname)) {
    // Navigations get the shell; everything else is cache-first from the versioned shell cache.
    if (req.mode === "navigate") return e.respondWith(caches.match("./index.html", { cacheName: SHELL_CACHE }).then((r) => r ?? fetch(req)));
    return e.respondWith(caches.match(req, { cacheName: SHELL_CACHE, ignoreSearch: true }).then((r) => r ?? fetch(req)));
  }
});

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req, name) {
  const cache = await caches.open(name);
  try {
    const res = await fetch(req, { cache: "no-cache" });
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  const fresh = fetch(req).then((res) => { if (res.ok || res.type === "opaque") cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit ?? fresh;
}

// Audio elements send Range requests; the cache stores whole files and slices them.
async function audio(req) {
  const cache = await caches.open(AUDIO_CACHE);
  const key = new Request(req.url);
  let full = await cache.match(key);
  if (!full) {
    try {
      const res = await fetch(key);
      if (!res.ok) return res;
      await cache.put(key, res.clone());
      full = res;
    } catch {
      return Response.error();
    }
  }
  const range = req.headers.get("range");
  if (!range) return full;
  const buf = await full.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  const size = buf.byteLength;
  let start = m && m[1] ? Number(m[1]) : 0;
  let end = m && m[2] ? Number(m[2]) : size - 1;
  if (m && !m[1] && m[2]) { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  end = Math.min(end, size - 1);
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: { "Content-Type": full.headers.get("Content-Type") || "audio/mp4", "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes" },
  });
}
