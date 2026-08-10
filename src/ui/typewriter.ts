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

// ---------------------------------------------------------------------------
// Typing out a whole block, markup and all.
//
// `typewrite` above takes a plain string and owns the element it types into,
// which is fine for the region summary and useless for the overview: that
// block is a paragraph, a bolded callout, three score cards and a footnote,
// and blanking it to retype character by character would throw the markup
// away. This walks the text nodes that are already there instead, so <b>,
// the cards and every class survive untouched.
//
// Speed is the other difference. The region summary types at ~60 characters
// a second because there the typing IS the pacing. Here it is a reveal: the
// numbers are the point and nobody should be waiting on an animation to read
// their own score, so this runs at ~260 and caps out well under two seconds
// no matter how long the copy gets.
const BLOCK_CPS = 260;
const BLOCK_MIN_MS = 450;
const BLOCK_MAX_MS = 1500;

// Height is reserved before the first character appears. Without it the block
// grows a line at a time as words wrap and shoves the whole page down under
// the reader, which is the thing that makes typewriter effects feel cheap.
export function typewriteBlock(root: HTMLElement): void {
  const nodes: Array<{ node: Text; text: string }> = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const t = n as Text;
    if (t.data.trim()) nodes.push({ node: t, text: t.data });
  }
  const total = nodes.reduce((s, n) => s + n.text.length, 0);
  if (!total) return;

  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduced) return;

  root.style.minHeight = `${root.offsetHeight}px`;
  const finish = (): void => {
    for (const n of nodes) n.node.data = n.text;
    root.style.minHeight = "";
    root.onclick = null;
  };
  const paint = (shown: number): void => {
    let left = shown;
    for (const n of nodes) {
      const take = Math.max(0, Math.min(n.text.length, left));
      n.node.data = n.text.slice(0, take);
      left -= take;
    }
  };
  paint(0);

  const dur = Math.min(BLOCK_MAX_MS, Math.max(BLOCK_MIN_MS, (total / BLOCK_CPS) * 1000));
  const start = performance.now();
  let raf = 0;
  const step = (now: number): void => {
    const p = Math.min(1, (now - start) / dur);
    paint(Math.round(p * total));
    if (p < 1) raf = requestAnimationFrame(step);
    else finish();
  };
  raf = requestAnimationFrame(step);
  // Anyone who does not want to watch it can stop it, same as the other one.
  root.onclick = () => {
    cancelAnimationFrame(raf);
    finish();
  };
}
