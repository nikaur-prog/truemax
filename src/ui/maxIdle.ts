// ---------------------------------------------------------------------------
// What Max does when nobody is talking to him.
//
// He used to stand there, breathing. Breathing is enough to say "not a
// graphic" and nowhere near enough to say "someone worth talking to" — and he
// sits on a screen where the whole proposition is that there is a coach on the
// other side of it.
//
// So he has a repertoire. Every few seconds he picks something and does it for
// about five: thumbs at his phone, tinkers with a spanner, pulls out a hand
// mirror and kisses his own reflection, drops and knocks out a set of
// press-ups, rides a skateboard on the spot. Nothing here is functional and
// that is the point — the acts are deliberately beside the product, because a
// character who only ever mimes the task is a progress indicator with a face.
// They should read as upbeat and a bit ridiculous. He is pleased with himself.
//
// Four rules keep it from becoming wallpaper:
//
//   Silence first. Ten seconds of nothing after he appears. Somebody who has
//   just landed is reading the screen, and a robot breaking into a dance over
//   the top of that is an interruption rather than a personality.
//
//   Never twice running. Picking uniformly at random means the same act
//   repeats now and then, and a repeat reads as a stuck loop rather than as a
//   choice. Drawing from everything-but-the-last makes it impossible.
//
//   Only when he can be seen. Off screen, in a hidden tab, or under a pointer
//   he stops — animating a character nobody is looking at is pure battery, and
//   performing UNDER somebody's cursor fights the poke they came for.
//
//   Asleep when unseen, not merely idle. The acts were always gated on
//   visibility; the dozen resting animations underneath them — bob, blink,
//   glance, antenna, pulse, shadow — were not, and ticked forever on every
//   drawing of him on the page whether or not it was in the viewport. The
//   `mx-asleep` class pauses the lot. It is the single biggest thing this
//   module does for a phone, and it is why the observer now drives a class
//   rather than just a boolean.
// ---------------------------------------------------------------------------

/** How long he stays still after arriving. */
const QUIET_MS = 10_000;
/** The gap between acts. */
const GAP_MS = 5_000;
/** How long one act runs. Matches the CSS animation durations. */
const ACT_MS = 5_000;

// The repertoire.
//
// Eight rather than four, because at four the set itself becomes the loop: you
// see all of them inside a minute and after that he is a character with four
// moves. At eight the next one is genuinely a surprise for long enough that
// nobody counts.
//
// Chosen to be mostly silly and never about faces. `mirror` is the one that
// comes closest — he admires himself and plants a kiss on his own reflection —
// and it earns its place by being a joke at his expense rather than the
// reader's. Nothing in here mimes scanning, measuring or judging.
const ACTS = [
  "phone",
  "confused",
  "dance",
  "skate",
  "tinker",
  "mirror",
  "pushups",
  "think",
] as const;
type Act = (typeof ACTS)[number];

export interface IdleHandle {
  /** Stop performing and clean up every listener. */
  destroy(): void;
  /** Run one act now, whatever the schedule says. Used by tests. */
  play(act: Act): void;
}

/** The full repertoire, for tests and for anything that wants to preview one. */
export const IDLE_ACTS: readonly Act[] = ACTS;

/**
 * Give a mounted Max an idle life.
 *
 * Returns a handle whose destroy() removes everything; every surface that
 * mounts him is responsible for calling it, and the observers self-disconnect
 * if the element leaves the document anyway.
 */
export function mountMaxIdle(stage: HTMLElement | null): IdleHandle | null {
  if (!stage) return null;
  const svg = stage.querySelector<SVGSVGElement>(".mx-svg");
  if (!svg) return null;
  // Reduced motion means reduced motion. He keeps the breathing the stylesheet
  // already turns off; he does not gain a dance.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let clear: ReturnType<typeof setTimeout> | null = null;
  let last: Act | null = null;
  let visible = true;
  let hovered = false;
  let dead = false;

  // Paused whenever he cannot be seen, for either reason. Both conditions feed
  // one class so a tab switch while he is off screen cannot wake him by
  // resolving only half of it.
  const syncSleep = (): void => {
    svg.classList.toggle("mx-asleep", !visible || document.hidden);
  };

  const stopAct = (): void => {
    if (clear) clearTimeout(clear);
    clear = null;
    for (const a of ACTS) svg.classList.remove(`mx-act-${a}`);
  };

  const play = (act: Act): void => {
    stopAct();
    last = act;
    svg.classList.add(`mx-act-${act}`);
    clear = setTimeout(stopAct, ACT_MS);
  };

  const pick = (): Act => {
    // Draw from everything except what he just did, so a repeat is impossible
    // rather than merely unlikely. Math.random is fine here: this is a
    // character choosing a mannerism, not anything that has to be reproducible.
    const pool = ACTS.filter((a) => a !== last);
    return pool[Math.floor(Math.random() * pool.length)]!;
  };

  const tick = (): void => {
    timer = null;
    if (dead) return;
    if (!svg.isConnected) {
      destroy();
      return;
    }
    // Not while he is being pointed at, and not while he cannot be seen. The
    // clock keeps running either way, so he does not owe a backlog of dances
    // to somebody who scrolls back.
    if (visible && !hovered && !document.hidden) play(pick());
    timer = setTimeout(tick, GAP_MS + ACT_MS);
  };

  const io = typeof IntersectionObserver === "undefined"
    ? null
    : new IntersectionObserver(
        (entries) => {
          visible = entries.some((e) => e.isIntersecting);
          if (!visible) stopAct();
          syncSleep();
        },
        { threshold: 0.2 },
      );
  io?.observe(svg);

  const onEnter = (): void => {
    hovered = true;
    stopAct();
  };
  const onLeave = (): void => {
    hovered = false;
  };
  const onVisibility = (): void => {
    if (document.hidden) stopAct();
    syncSleep();
  };
  stage.addEventListener("pointerenter", onEnter);
  stage.addEventListener("pointerleave", onLeave);
  document.addEventListener("visibilitychange", onVisibility);

  function destroy(): void {
    dead = true;
    stopAct();
    // Woken on the way out. Leaving the class behind would freeze him mid-blink
    // for whatever mounts him next, since the markup is often reused.
    svg!.classList.remove("mx-asleep");
    if (timer) clearTimeout(timer);
    timer = null;
    io?.disconnect();
    stage!.removeEventListener("pointerenter", onEnter);
    stage!.removeEventListener("pointerleave", onLeave);
    document.removeEventListener("visibilitychange", onVisibility);
  }

  syncSleep();
  timer = setTimeout(tick, QUIET_MS);
  return { destroy, play };
}
