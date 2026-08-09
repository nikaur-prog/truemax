import { tick } from "./audio.ts";

// Fast typewriter (~30 chars/sec) with key ticks; tap to complete instantly.
let active: number | null = null;

export function typewrite(box: HTMLElement, text: string): void {
  stopTypewriter();
  box.innerHTML = `<span class="caret"></span>`;
  const caret = box.firstElementChild as HTMLElement;
  let i = 0;
  active = window.setInterval(() => {
    if (i < text.length) {
      caret.insertAdjacentText("beforebegin", text[i]);
      if (i % 2) tick();
      i++;
    } else {
      stopTypewriter();
      caret.remove();
    }
  }, 17);
  box.onclick = () => {
    stopTypewriter();
    box.textContent = text;
  };
}

export function stopTypewriter(): void {
  if (active !== null) {
    clearInterval(active);
    active = null;
  }
}
