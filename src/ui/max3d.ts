/** Small lazy entry point. No renderer or asset is imported on the scan path. */
import { MAX_3D_STATES, normalizeMaxSpeechLevel } from "./max3dSchedule.js";
import type { Max3DState } from "./max3dSchedule.js";
export { MAX_3D_STATES };
export type { Max3DState };
export const MAX_3D_VIEWS = ["front", "three-quarter", "side", "back"] as const;
export type Max3DView = typeof MAX_3D_VIEWS[number];
export interface Max3DHandle {
  setAnimation(state: Max3DState): void;
  setView(view: Max3DView): void;
  setPlayfulEnabled(enabled: boolean): void;
  setSpeechLevel(level: number | null): void;
  destroy(): void;
}
export interface Max3DOptions { playful?: boolean }
export interface Max3DRuntime {
  setState(state: Max3DState): void;
  setView(view: Max3DView): void;
  setPlayfulEnabled(enabled: boolean): void;
  setSpeechLevel(level: number | null): void;
  dispose(): void;
  pause(paused: boolean): void;
}
type RuntimeModule = Pick<typeof import("./max3dRuntime.js"), "createMax3D">;

/** Opt-in large Coach surface only. The calling surface must dispose on close. */
export function createMax3DMounter(load: () => Promise<RuntimeModule>) {
  let releaseCurrent: (() => void) | undefined;
  return function mount(stage: HTMLElement, initial: Max3DState = "idle", options: Max3DOptions = {}): Max3DHandle {
  releaseCurrent?.();
  const fallback = stage.querySelector<SVGSVGElement>(".mx-svg");
  let dead = false;
  let visible = false;
  let state = initial;
  let view: Max3DView = "three-quarter";
  let playful = options.playful !== false;
  let speechLevel: number | null = null;
  let loading = false;
  let failed = false;
  let renderer: Max3DRuntime | null = null;
  const abort = new AbortController();
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const connection = (navigator as Navigator & { connection?: EventTarget & { saveData?: boolean } }).connection;
  const allowed = (): boolean => !dead && stage.isConnected && visible && !document.hidden && !motion.matches && !connection?.saveData;
  const sync = (): void => {
    renderer?.pause(!allowed());
    if (!allowed() || loading || failed || renderer) return;
    const box = stage.getBoundingClientRect();
    if (box.width < 88 || box.height < 88) return;
    loading = true;
    void load().then(async ({ createMax3D }) => {
      if (!allowed()) { loading = false; return; }
      const mounted = await createMax3D(stage, fallback, state, abort.signal, () => {
        failed = true;
        renderer = null;
      }, allowed);
      loading = false;
      if (dead) { mounted.dispose(); return; }
      renderer = mounted;
      renderer.setPlayfulEnabled(playful);
      renderer.setSpeechLevel(speechLevel);
      renderer.setState(state);
      renderer.setView(view);
      renderer.pause(!allowed());
    }).catch((error: unknown) => {
      loading = false;
      failed = !(error instanceof DOMException && error.name === "AbortError");
    });
  };
  const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.2);
    sync();
  }, { threshold: 0.2 });
  observer?.observe(stage);
  // Older embedded browsers without IntersectionObserver still get a working
  // preview, while geometry checks keep offscreen surfaces asleep.
  const measureVisibility = (): void => {
    const box = stage.getBoundingClientRect();
    visible = box.bottom > 0 && box.right > 0 && box.top < window.innerHeight && box.left < window.innerWidth;
    sync();
  };
  if (!observer) {
    window.addEventListener("scroll", measureVisibility, { passive: true });
    window.addEventListener("resize", measureVisibility);
  }
  const size = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
  size?.observe(stage);
  document.addEventListener("visibilitychange", sync);
  motion.addEventListener("change", sync);
  connection?.addEventListener("change", sync);
  // A detached surface must not retain a context if a caller misses teardown.
  const removal = new MutationObserver(() => { if (!stage.isConnected) dispose(); });
  removal.observe(document.documentElement, { childList: true, subtree: true });
  function dispose(): void {
    if (dead) return;
    dead = true;
    abort.abort();
    observer?.disconnect(); size?.disconnect(); removal.disconnect();
    document.removeEventListener("visibilitychange", sync);
    motion.removeEventListener("change", sync);
    connection?.removeEventListener("change", sync);
    if (!observer) {
      window.removeEventListener("scroll", measureVisibility);
      window.removeEventListener("resize", measureVisibility);
    }
    renderer?.dispose(); renderer = null;
    if (releaseCurrent === dispose) releaseCurrent = undefined;
  }
  releaseCurrent = dispose;
  if (!observer) measureVisibility();
  return {
    setAnimation(next) { if (dead || !MAX_3D_STATES.includes(next)) return; state = next; renderer?.setState(next); },
    setView(next) { if (dead || !MAX_3D_VIEWS.includes(next)) return; view = next; renderer?.setView(next); },
    setPlayfulEnabled(enabled) { if (dead) return; playful = enabled; renderer?.setPlayfulEnabled(enabled); },
    setSpeechLevel(level) { if (dead) return; speechLevel = normalizeMaxSpeechLevel(level); renderer?.setSpeechLevel(speechLevel); },
    destroy: dispose,
  };
  };
}

export const mountMax3D = createMax3DMounter(() => import("./max3dRuntime.js"));
