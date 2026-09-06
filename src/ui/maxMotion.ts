/** One visibility subscription per drawing, shared by CSS, gaze and idle work. */
export interface MaxMotionRuntime<T> {
  allowed(target: T): boolean;
  connected(target: T): boolean;
  observe(target: T, changed: (visible: boolean) => void): () => void;
  onChange(changed: () => void): () => void;
}

export function createMaxMotionController<T>(runtime: MaxMotionRuntime<T>) {
  const entries = new Map<T, { visible: boolean; active: boolean; callbacks: Set<(active: boolean) => void>; stop(): void }>();
  let stopChanges: (() => void) | undefined;
  const update = (target: T): void => {
    const entry = entries.get(target);
    if (!entry) return;
    const active = entry.visible && runtime.connected(target) && runtime.allowed(target);
    if (entry.active === active) return;
    entry.active = active;
    for (const changed of entry.callbacks) changed(active);
  };
  return {
    active: (target: T): boolean => entries.get(target)?.active === true && runtime.connected(target) && runtime.allowed(target),
    observe(target: T, changed: (active: boolean) => void): () => void {
      let entry = entries.get(target);
      if (!entry) {
        entry = { visible: false, active: false, callbacks: new Set(), stop: () => {} };
        entries.set(target, entry);
        if (!stopChanges) stopChanges = runtime.onChange(() => { for (const item of entries.keys()) update(item); });
        entry.stop = runtime.observe(target, (visible) => {
          const current = entries.get(target);
          if (!current) return;
          current.visible = visible;
          update(target);
        });
      }
      entry.callbacks.add(changed);
      changed(entry.active);
      let stopped = false;
      return () => {
        if (stopped) return;
        stopped = true;
        entry.callbacks.delete(changed);
        if (entry.callbacks.size) return;
        entry.stop();
        entries.delete(target);
        if (!entries.size) { stopChanges?.(); stopChanges = undefined; }
      };
    },
  };
}

type Connection = EventTarget & { saveData?: boolean };
let motion: ReturnType<typeof createMaxMotionController<SVGSVGElement>> | undefined;
function browserMotion() {
  if (motion) return motion;
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  const connection = (navigator as Navigator & { connection?: Connection }).connection;
  const visible = new Map<SVGSVGElement, (visible: boolean) => void>();
  const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
    for (const entry of entries) visible.get(entry.target as SVGSVGElement)?.(entry.isIntersecting && entry.intersectionRatio >= 0.2);
  }, { threshold: 0.2 });
  motion = createMaxMotionController<SVGSVGElement>({
    allowed: (target) => !document.hidden && !media.matches && !connection?.saveData && target.dataset.max3dActive !== "true",
    connected: (target) => target.isConnected,
    observe: (target, changed) => {
      let lastVisible = false;
      visible.set(target, (next) => { lastVisible = next; changed(next); });
      const onRendering = (): void => changed(lastVisible);
      target.addEventListener("maxrenderchange", onRendering);
      // Without visibility observation, stay static rather than animate unseen.
      observer?.observe(target);
      return () => { observer?.unobserve(target); visible.delete(target); target.removeEventListener("maxrenderchange", onRendering); };
    },
    onChange: (changed) => {
      document.addEventListener("visibilitychange", changed);
      media.addEventListener("change", changed);
      connection?.addEventListener("change", changed);
      return () => {
        document.removeEventListener("visibilitychange", changed);
        media.removeEventListener("change", changed);
        connection?.removeEventListener("change", changed);
      };
    },
  });
  return motion;
}

export const observeMaxMotion = (svg: SVGSVGElement, changed: (active: boolean) => void): (() => void) =>
  browserMotion().observe(svg, changed);
export const maxMotionActive = (svg: SVGSVGElement): boolean => browserMotion().active(svg);
/** A real 3D surface suspends, rather than invisibly duplicates, its SVG work. */
export function setMax3DActive(svg: SVGSVGElement, active: boolean): void {
  if ((svg.dataset.max3dActive === "true") === active) return;
  if (active) svg.dataset.max3dActive = "true";
  else delete svg.dataset.max3dActive;
  svg.dispatchEvent(new Event("maxrenderchange"));
}

interface GazeTarget {
  active(): boolean;
  read(): { left: number; top: number; width: number; height: number };
  write(x: string, y: string): void;
}
/** One frame for all visible drawings, reading geometry before any style writes. */
export function createMaxGazeScheduler(runtime: { requestFrame(callback: () => void): number; cancelFrame(id: number): void }) {
  const targets = new Set<GazeTarget>();
  let frame: number | null = null;
  let point = { x: 0, y: 0 };
  const refresh = (): void => {
    if (frame !== null && ![...targets].some((target) => target.active())) {
      runtime.cancelFrame(frame);
      frame = null;
    }
  };
  return {
    refresh,
    add(target: GazeTarget): () => void {
      targets.add(target);
      return () => { targets.delete(target); refresh(); };
    },
    move(x: number, y: number): void {
      point = { x, y };
      if (frame !== null || ![...targets].some((target) => target.active())) return;
      frame = runtime.requestFrame(() => {
        frame = null;
        const updates = [...targets].filter((target) => target.active()).map((target) => {
          const box = target.read();
          if (!box.width) return null;
          const dx = point.x - (box.left + box.width / 2);
          const dy = point.y - (box.top + box.height * 0.38);
          const reach = Math.hypot(dx, dy) || 1;
          const radius = Math.min(3, reach / 40);
          return { target, x: `${((dx / reach) * radius).toFixed(2)}px`, y: `${((dy / reach) * radius).toFixed(2)}px` };
        });
        for (const update of updates) if (update && update.target.active()) update.target.write(update.x, update.y);
      });
    },
  };
}

const gaze = createMaxGazeScheduler({ requestFrame: (callback) => requestAnimationFrame(callback), cancelFrame: (id) => cancelAnimationFrame(id) });
let gazeUsers = 0;
const onPointer = (event: PointerEvent): void => { if (event.pointerType !== "touch") gaze.move(event.clientX, event.clientY); };
export function observeMaxGaze(svg: SVGSVGElement): () => void {
  const pointer = window.matchMedia("(pointer: fine)");
  const removeTarget = gaze.add({
    active: () => pointer.matches && maxMotionActive(svg),
    read: () => svg.getBoundingClientRect(),
    write: (x, y) => { svg.style.setProperty("--mx-gaze-x", x); svg.style.setProperty("--mx-gaze-y", y); },
  });
  const stopMotion = observeMaxMotion(svg, () => gaze.refresh());
  pointer.addEventListener("change", gaze.refresh);
  if (++gazeUsers === 1) document.addEventListener("pointermove", onPointer, { passive: true });
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    removeTarget();
    stopMotion();
    pointer.removeEventListener("change", gaze.refresh);
    if (--gazeUsers === 0) document.removeEventListener("pointermove", onPointer);
    svg.style.removeProperty("--mx-gaze-x");
    svg.style.removeProperty("--mx-gaze-y");
  };
}
