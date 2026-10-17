// Plays words and sentences: the lesson's recorded m4a when available, else the browser voice.
// As in the app, pressing the same button again plays it slower: sentence_slow at 1× or the same file at 0.75×.

const audio = typeof Audio !== "undefined" ? new Audio() : null;
if (audio) audio.preload = "auto";
const synth = typeof speechSynthesis !== "undefined" ? speechSynthesis : null;

let voice = null;
function pickVoice() {
  if (!synth) return;
  const vs = synth.getVoices().filter((v) => /^en[-_]US/i.test(v.lang));
  const score = (v) => (/premium|enhanced|natural|neural/i.test(v.name) ? 3 : 0) + (/google|samantha|ava|zoe|aria|jenny/i.test(v.name) ? 1 : 0) + (v.localService ? 0 : 0.5);
  voice = vs.sort((a, b) => score(b) - score(a))[0] ?? synth.getVoices().find((v) => /^en/i.test(v.lang)) ?? null;
}
if (synth) { pickVoice(); synth.addEventListener?.("voiceschanged", pickVoice); }

class Speaker {
  key = null;
  slow = false;
  lastKey = null;
  presses = 0;
  failed = new Set(); // URLs that failed (offline, 404) → speech synthesis

  /** @param text what to say; url recorded audio; slowURL already-slowed recording */
  play(text, url = null, slowURL = null) {
    this.presses = text === this.lastKey ? this.presses + 1 : 1;
    this.lastKey = text;
    const slow = this.presses % 2 === 0;
    if (slow && slowURL && !this.failed.has(slowURL)) this.#speak(text, slowURL, 1, true);
    else this.#speak(text, url, slow ? 0.75 : 1, slow);
  }

  resetRepeat() { this.lastKey = null; }

  stop() {
    if (audio) { audio.onended = audio.onerror = null; audio.pause(); }
    synth?.cancel();
    this.#set(null, false);
  }

  #speak(text, url, rate, markSlow) {
    this.stop();
    this.#set(text, markSlow);
    if (url && audio && !this.failed.has(url)) {
      audio.src = url;
      audio.playbackRate = rate;
      audio.defaultPlaybackRate = rate;
      audio.preservesPitch = true;
      const done = () => { if (this.key === text) this.#set(null, false); };
      audio.onended = done;
      audio.onerror = () => { if (audio.src !== url) return; this.failed.add(url); if (this.key === text) this.#tts(text, rate); };
      audio.play().catch((e) => { if (e.name !== "AbortError") { this.failed.add(url); this.#tts(text, rate); } });
    } else this.#tts(text, rate);
  }

  #tts(text, rate) {
    if (!synth) { this.#set(null, false); toastNoVoice(); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US"; u.rate = rate < 1 ? 0.8 : 1;
    if (voice) u.voice = voice;
    u.onend = u.onerror = () => { if (this.key === text) this.#set(null, false); };
    synth.speak(u);
  }

  #set(key, slow) {
    this.key = key; this.slow = slow;
    document.dispatchEvent(new CustomEvent("wt:playing", { detail: { key, slow } }));
  }
}

export const speaker = new Speaker();

let warned = false;
function toastNoVoice() {
  if (warned) return; warned = true;
  document.dispatchEvent(new CustomEvent("wt:toast", { detail: "Озвучка недоступна в этом браузере" }));
}
