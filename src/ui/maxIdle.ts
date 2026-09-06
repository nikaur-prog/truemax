import { observeMaxMotion } from "./maxMotion.js";

// Quiet first, no repeated act, no props. Hidden and reduced-motion drawings
// have no scheduled idle timers. Returning to the screen starts a fresh rest.
const QUIET_MS = 10_000;
const GAP_MS = 5_000;
const ACT_MS = 5_000;
const WINDUP_MS = 340;
const SETTLE_MS = 550;
const ACTS = ["confused", "dance", "think", "stretch", "lookout"] as const;
type Act = (typeof ACTS)[number];

export interface IdleHandle {
  destroy(): void;
  /** Preview an act only when the drawing is visible and motion is allowed. */
  play(act: Act): void;
}
export const IDLE_ACTS: readonly Act[] = ACTS;
export interface MaxIdleRuntime {
  schedule(callback: () => void, delay: number): number;
  cancel(id: number): void;
  observe(svg: SVGSVGElement, changed: (active: boolean) => void): () => void;
}
const browserRuntime: MaxIdleRuntime = {
  schedule: (callback, delay) => window.setTimeout(callback, delay),
  cancel: (id) => window.clearTimeout(id),
  observe: observeMaxMotion,
};

export function mountMaxIdle(stage: HTMLElement | null, runtime: MaxIdleRuntime = browserRuntime): IdleHandle | null {
  const svg = stage?.querySelector<SVGSVGElement>(".mx-svg");
  if (!stage || !svg) return null;
  let timer: number | null = null;
  let clear: number | null = null;
  let last: Act | null = null;
  let active = false;
  let hovered = false;
  let dead = false;
  const awake = (): boolean => !dead && active && svg.isConnected;
  const stopAct = (): void => {
    if (clear !== null) runtime.cancel(clear);
    clear = null;
    svg.classList.remove("mx-windup", "mx-settle");
    for (const act of ACTS) svg.classList.remove(`mx-act-${act}`);
  };
  const stopTimer = (): void => {
    if (timer !== null) runtime.cancel(timer);
    timer = null;
  };
  const play = (act: Act): void => {
    if (!awake() || !ACTS.includes(act)) return;
    stopAct();
    last = act;
    svg.classList.add("mx-windup");
    clear = runtime.schedule(() => {
      clear = null;
      if (!awake()) { stopAct(); return; }
      svg.classList.remove("mx-windup");
      svg.classList.add(`mx-act-${act}`);
      clear = runtime.schedule(() => {
        clear = null;
        if (!awake()) { stopAct(); return; }
        svg.classList.remove(`mx-act-${act}`);
        svg.classList.add("mx-settle");
        clear = runtime.schedule(stopAct, SETTLE_MS);
      }, ACT_MS);
    }, WINDUP_MS);
  };
  const tick = (): void => {
    timer = null;
    if (!awake()) return;
    if (!hovered) {
      const pool = ACTS.filter((act) => act !== last);
      play(pool[Math.floor(Math.random() * pool.length)]!);
    }
    timer = runtime.schedule(tick, GAP_MS + ACT_MS + WINDUP_MS + SETTLE_MS);
  };
  const onEnter = (): void => {
    hovered = true;
  };
  const onLeave = (): void => { hovered = false; };
  stage.addEventListener("pointerenter", onEnter);
  stage.addEventListener("pointerleave", onLeave);
  const stopMotion = runtime.observe(svg, (visible) => {
    if (dead) return;
    active = visible;
    stopTimer();
    if (!awake()) stopAct();
    else timer = runtime.schedule(tick, QUIET_MS);
  });
  return {
    play,
    destroy(): void {
      if (dead) return;
      dead = true;
      stopAct();
      stopTimer();
      stopMotion();
      stage.removeEventListener("pointerenter", onEnter);
      stage.removeEventListener("pointerleave", onLeave);
    },
  };
}
