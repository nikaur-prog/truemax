// Fast typewriter (~60 chars/sec); tap to complete instantly.
//
// It used to click on every other character through a WebAudio oscillator.
// Removed: the effect earns its place because it paces reading, and the sound
// was doing something different and worse — it made a measurement page feel
// like a toy, and it fired unprompted on a screen people open in public.
let active: number | null = null;

export function typewrite(box: HTMLElement, text: string): void {
  stopTypewriter();
  box.innerHTML = `<span class="caret"></span>`;
  const caret = box.firstElementChild as HTMLElement;
  let i = 0;
  active = window.setInterval(() => {
    if (i < text.length) {
      caret.insertAdjacentText("beforebegin", text[i]);
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
