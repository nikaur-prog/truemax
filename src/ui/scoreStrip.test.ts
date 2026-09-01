import assert from "node:assert/strict";
import test from "node:test";
import { clearScoreStrip, renderScoreStrip } from "./scoreStrip.js";
import type { Report } from "../engine/types.js";

function classes(initial: string[] = []) {
  const values = new Set(initial);
  return {
    values,
    contains: (name: string) => values.has(name),
    add: (...names: string[]) => names.forEach((name) => values.add(name)),
    remove: (...names: string[]) => names.forEach((name) => values.delete(name)),
    toggle: (name: string, force?: boolean) => {
      const next = force ?? !values.has(name);
      if (next) values.add(name);
      else values.delete(name);
      return next;
    },
  };
}

test("the report header stays compact until the actual report top", () => {
  const paneClasses = classes();
  const headerClasses = classes();
  const properties = new Map<string, string>();
  const main = {
    style: {
      setProperty: (name: string, value: string) => properties.set(name, value),
      removeProperty: (name: string) => properties.delete(name),
    },
  } as unknown as HTMLElement;
  const pane = {
    isConnected: true,
    classList: paneClasses,
    closest: () => main,
    parentElement: main,
  } as unknown as HTMLElement;
  const header = {
    isConnected: true,
    classList: headerClasses,
    getBoundingClientRect: () => ({ height: headerClasses.contains("report-compact") ? 35 : 52 }),
  } as unknown as HTMLElement;

  let y = 100;
  const listeners = new Map<string, () => void>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      get scrollY() { return y; },
      addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
      removeEventListener: (name: string) => listeners.delete(name),
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      querySelector: (selector: string) => {
        if (selector === ".pane-photo") return pane;
        if (selector === ".topbar") return header;
        if (selector === "#v-main") return main;
        return null;
      },
    },
  });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (fn: FrameRequestCallback) => { fn(0); return 1; },
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe() { this.callback([], this as unknown as ResizeObserver); }
      disconnect() {}
    },
  });

  try {
    renderScoreStrip({} as Report);
    assert.equal(paneClasses.contains("results-ready"), true);
    assert.equal(headerClasses.contains("report-compact"), false);
    assert.equal(properties.get("--report-header-h"), "52px");

    y = 120;
    listeners.get("scroll")?.();
    assert.equal(headerClasses.contains("report-compact"), true);
    assert.equal(properties.get("--report-header-h"), "35px");

    // Scrolling upward is not enough: the compact state holds until the same
    // top position at which the report mounted.
    y = 105;
    listeners.get("scroll")?.();
    assert.equal(headerClasses.contains("report-compact"), true);

    y = 100;
    listeners.get("scroll")?.();
    assert.equal(headerClasses.contains("report-compact"), false);

    clearScoreStrip();
    assert.equal(properties.has("--report-header-h"), false);
    assert.equal(listeners.has("scroll"), false);
  } finally {
    clearScoreStrip();
    Reflect.deleteProperty(globalThis, "ResizeObserver");
    Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
    Reflect.deleteProperty(globalThis, "requestAnimationFrame");
    Reflect.deleteProperty(globalThis, "document");
    Reflect.deleteProperty(globalThis, "window");
  }
});
