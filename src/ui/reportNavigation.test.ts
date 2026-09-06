import assert from "node:assert/strict";
import test from "node:test";
import { mountReportRailState, mountTabScrollbar, scrollReportPanelToStart } from "./reportNavigation.js";

function events() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    listeners,
    addEventListener(name: string, listener: () => void) {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
    },
    removeEventListener(name: string, listener: () => void) { listeners.get(name)?.delete(listener); },
    fire(name: string) { for (const listener of listeners.get(name) ?? []) listener(); },
  };
}

function harness() {
  const original = new Map<string, PropertyDescriptor | undefined>();
  const install = (key: string, value: unknown) => {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  };
  const pending = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const win = { ...events(), scrollY: 900, innerWidth: 390, matchMedia: () => ({ matches: true }), scrollTo: (_options: ScrollToOptions) => {} };
  const resizes: Array<{ trigger: () => void; disconnected: boolean }> = [];
  const mutations: Array<{ trigger: () => void; disconnected: boolean }> = [];
  const intersections: Array<{ trigger: (top: number) => void; disconnected: boolean; options?: IntersectionObserverInit }> = [];
  let styleReads = 0;
  let stickyTop = "320px";
  install("window", win);
  install("document", { querySelector: () => null });
  install("getComputedStyle", () => { styleReads++; return { top: stickyTop }; });
  install("requestAnimationFrame", (callback: FrameRequestCallback) => { pending.set(++nextFrame, callback); return nextFrame; });
  install("cancelAnimationFrame", (id: number) => pending.delete(id));
  install("ResizeObserver", class {
    state;
    constructor(callback: () => void) { this.state = { trigger: callback, disconnected: false }; resizes.push(this.state); }
    observe() {}
    disconnect() { this.state.disconnected = true; }
  });
  install("MutationObserver", class {
    state;
    constructor(callback: () => void) { this.state = { trigger: callback, disconnected: false }; mutations.push(this.state); }
    observe() {}
    disconnect() { this.state.disconnected = true; }
  });
  install("IntersectionObserver", class {
    state;
    constructor(callback: (entries: Array<{ boundingClientRect: { top: number } }>) => void, options?: IntersectionObserverInit) {
      this.state = { trigger: (top: number) => callback([{ boundingClientRect: { top } }]), disconnected: false, options };
      intersections.push(this.state);
    }
    observe() {}
    disconnect() { this.state.disconnected = true; }
  });
  return {
    win, pending, resizes, mutations, intersections,
    get styleReads() { return styleReads; },
    set stickyTop(value: string) { stickyTop = value; },
    flush() { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach((callback) => callback(0)); },
    restore() { for (const [key, descriptor] of original) descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key); },
  };
}

test("tab swipes coalesce, clamp iOS bounce and release every observer on teardown", () => {
  const h = harness();
  const tabs = { ...events(), scrollWidth: 800, clientWidth: 400, scrollLeft: 0 };
  const properties = new Map<string, string>();
  let writes = 0;
  const track = { hidden: false, style: { setProperty(key: string, value: string) { writes++; properties.set(key, value); } } };
  try {
    const destroy = mountTabScrollbar(tabs as unknown as HTMLElement, track as unknown as HTMLElement);
    h.flush();
    assert.equal(properties.get("--thumb-w"), "50.00%");
    tabs.scrollLeft = 200;
    for (let i = 0; i < 12; i++) tabs.fire("scroll");
    assert.equal(h.pending.size, 1);
    h.flush();
    assert.equal(properties.get("--thumb-x"), "25.00%");
    const before = writes;
    tabs.fire("scroll"); h.flush();
    assert.equal(writes, before, "an unchanged thumb does not reapply styles");
    tabs.scrollLeft = -50; tabs.fire("scroll"); h.flush();
    assert.equal(properties.get("--thumb-x"), "0.00%");
    tabs.scrollLeft = 900; tabs.fire("scroll"); h.flush();
    assert.equal(properties.get("--thumb-x"), "50.00%");
    // Front and side can fit different sets of tabs in the same border box.
    tabs.scrollWidth = 400; h.mutations[0].trigger(); h.flush();
    assert.equal(track.hidden, true);
    tabs.fire("scroll");
    destroy();
    assert.equal(h.pending.size, 0);
    assert.equal(h.resizes[0].disconnected, true);
    assert.equal(h.mutations[0].disconnected, true);
    assert.equal(tabs.listeners.get("scroll")?.size, 0);
    assert.equal(h.win.listeners.get("resize")?.size, 0);
    h.mutations[0].trigger();
    assert.equal(h.pending.size, 0);
  } finally { h.restore(); }
});

test("sticky elevation observes its boundary without layout reads during scrolling", () => {
  const h = harness();
  const classes = new Set<string>();
  const rail = { classList: { toggle: (name: string, on: boolean) => on ? classes.add(name) : classes.delete(name), remove: (name: string) => classes.delete(name) } };
  const sentinel = { getBoundingClientRect() { throw new Error("scroll-time layout read"); } };
  try {
    const destroy = mountReportRailState(rail as unknown as HTMLElement, sentinel as unknown as HTMLElement);
    h.flush();
    assert.equal(h.intersections[0].options?.rootMargin, "-320px 0px 0px 0px");
    assert.equal(h.win.listeners.get("scroll")?.size ?? 0, 0);
    const reads = h.styleReads;
    h.intersections[0].trigger(250);
    assert.equal(classes.has("is-stuck"), true);
    h.intersections[0].trigger(420);
    assert.equal(classes.has("is-stuck"), false);
    assert.equal(h.styleReads, reads);
    h.stickyTop = "290px"; h.resizes[0].trigger(); h.flush();
    assert.equal(h.intersections[0].disconnected, true);
    assert.equal(h.intersections[1].options?.rootMargin, "-290px 0px 0px 0px");
    h.intersections[1].trigger(420);
    h.intersections[0].trigger(250);
    assert.equal(classes.has("is-stuck"), false, "a queued callback from an old resize boundary is ignored");
    destroy();
    assert.equal(h.intersections[1].disconnected, true);
    assert.equal(h.resizes[0].disconnected, true);
    assert.equal(h.win.listeners.get("resize")?.size, 0);
  } finally { h.restore(); }
});

test("older browsers retain a coalesced sticky-state fallback and desktop removes mobile elevation", () => {
  const h = harness();
  const classes = new Set<string>();
  const rail = { classList: { toggle: (name: string, on: boolean) => on ? classes.add(name) : classes.delete(name), remove: (name: string) => classes.delete(name) } };
  const sentinel = { getBoundingClientRect: () => ({ top: 200 }) };
  try {
    Reflect.deleteProperty(globalThis, "IntersectionObserver");
    const destroy = mountReportRailState(rail as unknown as HTMLElement, sentinel as unknown as HTMLElement);
    h.flush();
    assert.equal(classes.has("is-stuck"), true);
    for (let i = 0; i < 10; i++) h.win.fire("scroll");
    assert.equal(h.pending.size, 1);
    h.flush();
    h.win.matchMedia = () => ({ matches: false });
    h.win.fire("resize"); h.flush();
    assert.equal(classes.has("is-stuck"), false);
    destroy();
    assert.equal(h.win.listeners.get("scroll")?.size, 0);
  } finally { h.restore(); }
});

test("choosing a new report tab returns to the panel start, not the sticky rail's visible position", () => {
  const h = harness();
  const scrolls: ScrollToOptions[] = [];
  h.win.scrollTo = (options) => { scrolls.push(options); };
  let naturalTop = -80;
  const rail = { getBoundingClientRect: () => ({ top: 320 }) };
  const sentinel = { getBoundingClientRect: () => ({ top: naturalTop }) };
  try {
    scrollReportPanelToStart(rail as unknown as HTMLElement, sentinel as unknown as HTMLElement);
    assert.deepEqual(scrolls, [{ top: 500, behavior: "instant" }]);
    naturalTop = 450;
    scrollReportPanelToStart(rail as unknown as HTMLElement, sentinel as unknown as HTMLElement);
    assert.equal(scrolls.length, 1, "do not jump down while someone reads their photo or score summary");
    h.win.matchMedia = () => ({ matches: false });
    naturalTop = -80;
    scrollReportPanelToStart(rail as unknown as HTMLElement, sentinel as unknown as HTMLElement);
    assert.equal(scrolls[1].behavior, "smooth");
  } finally { h.restore(); }
});
