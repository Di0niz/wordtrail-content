// Browser-side progress (localStorage). Records mirror the iOS app's WordProgress / ProgressRecord.
import { isoDay } from "./domain/ru.js";
import { iso } from "./domain/transfer.js";

const NS = "wt.web.v1.";
const get = (k, d) => { try { const v = localStorage.getItem(NS + k); return v ? JSON.parse(v) : d; } catch { return d; } };
const set = (k, v) => { try { localStorage.setItem(NS + k, JSON.stringify(v)); return true; } catch { return false; } };

const toRecord = (r) => ({ ...r, due: new Date(r.due), last: new Date(r.last) });
const fromRecord = (r) => ({ ...r, due: iso(r.due), last: iso(r.last) });

let cache = null;
const raw = () => (cache ??= get("progress", {}));

export const store = {
  available: (() => { try { localStorage.setItem(NS + "probe", "1"); localStorage.removeItem(NS + "probe"); return true; } catch { return false; } })(),

  /** Record<itemId, ProgressRecord> with Dates. */
  records() { const out = {}; for (const [k, v] of Object.entries(raw())) out[k] = toRecord(v); return out; },
  list() { return Object.values(this.records()); },
  /** Record<itemId, {box, due}> for the domain. */
  states() { const out = {}; for (const [k, v] of Object.entries(raw())) out[k] = { box: v.box, due: new Date(v.due) }; return out; },
  upsert(records) {
    const p = raw();
    for (const r of records) p[r.itemID] = fromRecord(r);
    if (!set("progress", p)) throw new Error("Не удалось сохранить прогресс: хранилище браузера недоступно или переполнено");
    emit();
  },
  reset() { cache = {}; set("progress", {}); set("days", []); emit(); },

  days() { return new Set(get("days", [])); },
  recordDay(date = new Date()) { const d = this.days(); d.add(isoDay(date)); set("days", [...d].sort()); },

  pref(key, fallback) { return get("pref." + key, fallback); },
  setPref(key, value) { set("pref." + key, value); },
};

const listeners = new Set();
export const onProgress = (fn) => (listeners.add(fn), () => listeners.delete(fn));
function emit() { for (const fn of listeners) fn(); }

// Another tab changed progress.
addEventListener("storage", (e) => { if (e.key === NS + "progress") { cache = null; emit(); } });
