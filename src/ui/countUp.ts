// Counting a number up to its value.
//
// This existed three times over — results.ts, scoreStrip.ts and
// onboardingFunnel.ts each had their own copy, with the same cubic ease-out
// and three different durations. The fourth copy was about to be written for
// the dashboard hero, so here it is once.
//
// Why the number counts at all: a figure that appears fully formed is a label,
// and a figure that arrives is a reading. The whole product rests on the second
// reading being the true one, and the animation is the only part of the
// interface that says so before the user has read a word.

/** The house curve. Every count-up in the app has used this one. */
export const easeOutCubic = (p: number): number => 1 - Math.pow(1 - p, 3);

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export interface CountUpOptions {
  /** Digits after the decimal point. Default 1, which is how scores are shown. */
  decimals?: number;
  /** Milliseconds of animation. Default 720. */
  duration?: number;
  /** Milliseconds to wait before starting, to sit inside an entry stagger. */
  delay?: number;
  /**
   * Where to write each frame. Defaults to replacing the element's text, which
   * is wrong for an element with child nodes worth keeping — the dashboard hero
   * carries a "/10" in a <small> that textContent would destroy.
   */
  write?: (text: string) => void;
}

/**
 * Count `el` up to `target`. Honours prefers-reduced-motion by jumping straight
 * to the value, and stops if the element leaves the document mid-count.
 */
export function countUp(el: HTMLElement, target: number, opts: CountUpOptions = {}): void {
  const decimals = opts.decimals ?? 1;
  const duration = opts.duration ?? 720;
  const write = opts.write ?? ((text: string) => (el.textContent = text));
  const finish = () => write(target.toFixed(decimals));

  if (prefersReducedMotion()) {
    finish();
    return;
  }

  const run = () => {
    const start = performance.now();
    const step = (now: number) => {
      if (!el.isConnected) return;
      const progress = Math.min(1, (now - start) / duration);
      write((target * easeOutCubic(progress)).toFixed(decimals));
      if (progress < 1) requestAnimationFrame(step);
      else finish();
    };
    requestAnimationFrame(step);
  };

  if (opts.delay) setTimeout(run, opts.delay);
  else run();
}
