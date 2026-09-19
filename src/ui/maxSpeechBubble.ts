import { isAppForeground, subscribeNativeActivity } from "../engine/nativeBridge.js";
import { maxSpeechWindow, maxTextMouthLevel } from "./maxSpeechText.js";
import "./maxSpeechBubble.css";

export interface MaxSpeechBubbleOptions {
  onSpeakingChange?: (speaking: boolean) => void;
  onSpeechLevel?: (level: number | null) => void;
  maxCharacters?: number;
  /** Chat already announces its full transcript; dashboard openers may opt in. */
  announce?: boolean;
}
export interface MaxSpeechBubbleHandle {
  /** Cumulative text. Set complete only when the actual reply has ended. */
  update(text: string, options?: { complete?: boolean; animate?: boolean }): void;
  setVisible(visible: boolean): void;
  clear(): void;
  destroy(): void;
}
const mounted = new WeakMap<HTMLElement, MaxSpeechBubbleHandle>();

/** One timer only while visible letters are being revealed. Never plays audio. */
export function mountMaxSpeechBubble(host: HTMLElement, options: MaxSpeechBubbleOptions = {}): MaxSpeechBubbleHandle {
  const existing = mounted.get(host);
  if (existing) return existing;
  const doc = host.ownerDocument;
  const win = doc.defaultView!;
  const motion = win.matchMedia("(prefers-reduced-motion: reduce)");
  const bubble = doc.createElement("div");
  bubble.className = "max-speech-bubble";
  bubble.hidden = true;
  const label = doc.createElement("span");
  label.className = "max-speech-label";
  label.textContent = "MAX";
  const words = doc.createElement("span");
  words.className = "max-speech-words";
  bubble.append(label, words);
  const announced = doc.createElement("span");
  announced.className = "max-speech-announcement";
  announced.setAttribute("aria-live", "polite");
  announced.setAttribute("aria-atomic", "true");
  // Visual typing is decorative; screen readers receive one finished line.
  bubble.setAttribute("aria-hidden", "true");
  host.append(bubble, announced);
  host.classList.add("max-speech-host");
  let dead = false;
  let requestedVisible = true;
  const initialBox = host.getBoundingClientRect();
  let intersecting = host.getClientRects().length > 0
    && initialBox.bottom > 0 && initialBox.right > 0 && initialBox.top < win.innerHeight && initialBox.left < win.innerWidth;
  let timer: number | undefined;
  let text = "";
  let revealed = 0;
  let complete = true;
  let speaking = false;
  let active = false;

  const setSpeaking = (value: boolean): void => {
    if (speaking === value) return;
    speaking = value;
    bubble.classList.toggle("is-speaking", value);
    options.onSpeakingChange?.(value);
  };
  const stop = (): void => {
    if (timer !== undefined) win.clearTimeout(timer);
    timer = undefined;
    setSpeaking(false);
    options.onSpeechLevel?.(0);
  };
  const render = (): void => {
    words.textContent = maxSpeechWindow(text.slice(0, revealed), options.maxCharacters);
    bubble.hidden = !active || !text;
    if (options.announce && complete && revealed >= text.length && active) {
      const value = maxSpeechWindow(text, options.maxCharacters);
      if (announced.textContent !== value) announced.textContent = value;
    }
  };
  const tick = (): void => {
    timer = undefined;
    if (!active || dead) { stop(); return; }
    const step = Math.max(1, Math.min(6, Math.ceil((text.length - revealed) / 90)));
    revealed = Math.min(text.length, revealed + step);
    render();
    options.onSpeechLevel?.(maxTextMouthLevel(text[revealed - 1] ?? ""));
    if (revealed < text.length) timer = win.setTimeout(tick, 24);
    else if (!complete) {
      // A short gap between stream chunks is not a new gesture each time.
      // Keep the mouth closed while waiting, then settle once if data pauses.
      options.onSpeechLevel?.(0);
      timer = win.setTimeout(() => {
        timer = undefined;
        if (active && revealed < text.length) tick();
        else stop();
      }, 160);
    } else stop();
  };
  const reveal = (animate: boolean): void => {
    if (!active || !animate || motion.matches) {
      revealed = text.length;
      stop();
      render();
      return;
    }
    if (revealed < text.length) {
      // Do not spend a minute replaying a long answer delivered in one chunk.
      revealed = Math.max(revealed, text.length - 180);
      setSpeaking(true);
      render();
      if (timer === undefined) timer = win.setTimeout(tick, 24);
    } else { stop(); render(); }
  };
  const sync = (): void => {
    if (dead) return;
    active = requestedVisible && intersecting && host.isConnected && !doc.hidden && isAppForeground();
    if (!active || motion.matches) {
      revealed = text.length;
      stop();
    }
    render();
  };
  const intersection = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
    intersecting = entries.some((entry) => entry.isIntersecting);
    sync();
  });
  intersection?.observe(host);
  const measure = (): void => {
    const box = host.getBoundingClientRect();
    intersecting = host.getClientRects().length > 0 && box.bottom > 0 && box.right > 0 && box.top < win.innerHeight && box.left < win.innerWidth;
    sync();
  };
  if (!intersection) {
    win.addEventListener("scroll", measure, { passive: true, capture: true });
    win.addEventListener("resize", measure);
  }
  const removal = new MutationObserver(() => { if (!host.isConnected) handle.destroy(); });
  removal.observe(doc.documentElement, { childList: true, subtree: true });
  doc.addEventListener("visibilitychange", sync);
  motion.addEventListener("change", sync);
  const stopNative = subscribeNativeActivity(sync);
  const handle: MaxSpeechBubbleHandle = {
    update(next, updateOptions = {}) {
      if (dead) return;
      const value = String(next ?? "");
      if (!value.startsWith(text)) { stop(); revealed = 0; announced.textContent = ""; }
      text = value;
      complete = updateOptions.complete !== false;
      reveal(updateOptions.animate !== false);
    },
    setVisible(value) { requestedVisible = value; sync(); },
    clear() {
      if (dead) return;
      text = ""; revealed = 0; complete = true;
      announced.textContent = "";
      stop(); render();
    },
    destroy() {
      if (dead) return;
      dead = true;
      stop();
      intersection?.disconnect(); removal.disconnect(); stopNative();
      if (!intersection) {
        win.removeEventListener("scroll", measure, true);
        win.removeEventListener("resize", measure);
      }
      doc.removeEventListener("visibilitychange", sync);
      motion.removeEventListener("change", sync);
      bubble.remove(); announced.remove();
      host.classList.remove("max-speech-host");
      mounted.delete(host);
    },
  };
  mounted.set(host, handle);
  sync();
  return handle;
}
