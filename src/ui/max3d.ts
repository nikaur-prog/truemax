/** Small lazy entry point. No renderer or asset is imported on the scan path. */
export const MAX_3D_STATES = ["idle", "listening", "thinking", "speaking", "celebrate", "quiet"] as const;
export type Max3DState = typeof MAX_3D_STATES[number];
export const MAX_3D_VIEWS = ["front", "three-quarter", "side", "back"] as const;
export type Max3DView = typeof MAX_3D_VIEWS[number];
export interface Max3DHandle {
  setAnimation(state: Max3DState): void;
  setView(view: Max3DView): void;
  destroy(): void;
}
let releaseCurrent: (() => void) | undefined;

/** Opt-in large Coach surface only. The calling surface must dispose on close. */
export function mountMax3D(stage: HTMLElement, initial: Max3DState = "idle"): Max3DHandle {
  releaseCurrent?.();
  const fallback = stage.querySelector<SVGSVGElement>(".mx-svg");
  let dead = false;
  let visible = false;
  let state = initial;
  let view: Max3DView = "three-quarter";
  let loading = false;
  let failed = false;
  let renderer: { setState(state: Max3DState): void; setView(view: Max3DView): void; dispose(): void; pause(paused: boolean): void } | null = null;
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
    void import("./max3dRuntime.js").then(async ({ createMax3D }) => {
      if (!allowed()) { loading = false; return; }
      const mounted = await createMax3D(stage, fallback, state, abort.signal, () => {
        failed = true;
        renderer = null;
      }, allowed);
      loading = false;
      if (dead) { mounted.dispose(); return; }
      renderer = mounted;
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
    renderer?.dispose(); renderer = null;
    if (releaseCurrent === dispose) releaseCurrent = undefined;
  }
  releaseCurrent = dispose;
  return {
    setAnimation(next) { if (dead || !MAX_3D_STATES.includes(next)) return; state = next; renderer?.setState(next); },
    setView(next) { if (dead || !MAX_3D_VIEWS.includes(next)) return; view = next; renderer?.setView(next); },
    destroy: dispose,
  };
}
