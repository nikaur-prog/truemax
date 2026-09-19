import test from "node:test";
import assert from "node:assert/strict";
import { close, openSexChooser } from "./sexChooser.js";
import { closeSubjectChooser, openSubjectChooser } from "./subjectChooser.js";

/** Small DOM boundary: actual chooser handlers, with image loading under test control. */
function mountChooserDocument() {
  const names = ["document", "requestAnimationFrame", "cancelAnimationFrame"] as const;
  const originals = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const handlers = new Set<(event: KeyboardEvent) => void>();
  const frames = new Map<number, () => void>();
  const created: string[] = [], revoked: string[] = [];
  let frameId = 0;
  class Element {
    className = "";
    dataset: Record<string, string> = {};
    attrs = new Map<string, string>();
    children: Element[] = [];
    parent: Element | null = null;
    events = new Map<string, Set<(event: KeyboardEvent) => void>>();
    disabled = false;
    hidden = false;
    value = "";
    src = "";
    alt = "";
    width = 0;
    height = 0;
    naturalWidth = 0;
    draws: unknown[][] = [];
    onclick: ((event: { target: Element }) => void) | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    classList = {
      contains: (value: string) => this.className.split(/\s+/).includes(value),
      add: (value: string) => { if (!this.classList.contains(value)) this.className += ` ${value}`; },
      toggle: (value: string, force?: boolean) => {
        const add = force ?? !this.classList.contains(value);
        this.className = this.className.split(/\s+/).filter((part) => part && part !== value).join(" ");
        if (add) this.classList.add(value);
        return add;
      },
    };
    constructor(readonly tag: string) {}
    set innerHTML(html: string) {
      this.children = [];
      // Only materialise tags needed by the dialog boundary, not browser layout.
      for (const match of html.matchAll(/<(div|button|input|select|figure|p|h2|section)\b([^>]*)>/g)) {
        const child = new Element(match[1]);
        for (const attr of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) child.setAttribute(attr[1], attr[2] ?? "");
        this.appendChild(child);
      }
    }
    get isConnected(): boolean { return this === doc.body || Boolean(this.parent?.isConnected); }
    setAttribute(name: string, value: string) {
      this.attrs.set(name, value);
      if (name === "class") this.className = value;
      if (name.startsWith("data-")) this.dataset[name.slice(5)] = value;
      if (name === "disabled") this.disabled = true;
      if (name === "hidden") this.hidden = true;
    }
    removeAttribute(name: string) { this.attrs.delete(name); if (name === "src") this.src = ""; }
    appendChild(child: Element) { child.parent = this; this.children.push(child); return child; }
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
      this.parent = null;
    }
    all(): Element[] { return this.children.flatMap((child) => [child, ...child.all()]); }
    matches(selector: string): boolean {
      if (selector === "button:not(:disabled)") return this.tag === "button" && !this.disabled;
      if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
      if (selector.startsWith("#")) return this.attrs.get("id") === selector.slice(1);
      if (selector.startsWith("[")) return this.attrs.has(selector.slice(1, -1));
      return this.tag === selector;
    }
    querySelectorAll(selector: string) { return this.all().filter((child) => child.matches(selector)); }
    querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
    focus() { doc.activeElement = this; }
    click() { if (!this.disabled) this.onclick?.({ target: this }); }
    addEventListener(name: string, handler: (event: KeyboardEvent) => void) {
      if (!this.events.has(name)) this.events.set(name, new Set());
      this.events.get(name)!.add(handler);
    }
    removeEventListener(name: string, handler: (event: KeyboardEvent) => void) { this.events.get(name)?.delete(handler); }
    getContext() { return { drawImage: (...args: unknown[]) => this.draws.push(args) }; }
  }
  const doc = {
    body: new Element("body"),
    activeElement: null as Element | null,
    createElement: (tag: string) => new Element(tag),
    addEventListener: (_name: string, handler: (event: KeyboardEvent) => void) => handlers.add(handler),
    removeEventListener: (_name: string, handler: (event: KeyboardEvent) => void) => handlers.delete(handler),
  };
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: (fn: () => void) => { frames.set(++frameId, fn); return frameId; } });
  Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: (id: number) => frames.delete(id) });
  URL.createObjectURL = () => { const url = `blob:chooser-${created.length + 1}`; created.push(url); return url; };
  URL.revokeObjectURL = (url) => { revoked.push(url); };
  const root = () => doc.body.children[doc.body.children.length - 1]!;
  return {
    doc, handlers, frames, created, revoked, root,
    button(sex: "male" | "female") { return root().querySelectorAll(".sexpick-side").find((choice) => choice.dataset.sex === sex)!; },
    ready() { const img = root().querySelector("img")!; img.naturalWidth = 320; img.onload?.(); return img; },
    key(key: string, shiftKey = false) {
      let prevented = false, stopped = false;
      const event = { key, shiftKey, preventDefault: () => { prevented = true; }, stopImmediatePropagation: () => { stopped = true; } } as KeyboardEvent;
      for (const handler of [...handlers]) { handler(event); if (stopped) break; }
      return { prevented, stopped };
    },
    restore() {
      close();
      closeSubjectChooser();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

const photo = () => new Blob(["synthetic test photo"], { type: "image/png" });

test("legacy reference chooser retains one-tap selection and cannot finish twice", () => {
  const dom = mountChooserDocument();
  try {
    const picked: string[] = [];
    openSexChooser((sex) => picked.push(sex), "male");
    assert.equal(dom.root().querySelector(".sexpick-continue"), null);
    const female = dom.button("female");
    female.click();
    female.onclick?.({ target: female });
    dom.key("Escape");
    assert.deepEqual(picked, ["female"]);
    assert.equal(dom.handlers.size, 0);
    assert.equal(dom.frames.size, 0);
  } finally { dom.restore(); }
});

test("photo choice requires a fresh selection and explicit Continue after preview loads", () => {
  const dom = mountChooserDocument();
  try {
    const picked: string[] = [];
    openSexChooser((sex) => picked.push(sex), undefined, undefined, "Alex", { photo: photo(), confirm: true });
    const root = dom.root(), next = root.querySelector(".sexpick-continue")!;
    assert.equal(root.attrs.get("role"), "dialog");
    assert.equal(root.attrs.get("aria-modal"), "true");
    assert.equal(next.disabled, true);
    assert.equal(dom.button("male").attrs.get("aria-pressed"), "false");
    assert.equal(dom.button("female").attrs.get("aria-pressed"), "false");
    dom.button("male").click();
    assert.equal(next.disabled, true, "selection alone cannot accept an unreadable preview");
    dom.ready();
    assert.equal(next.disabled, false);
    dom.button("female").click();
    assert.equal(dom.button("male").attrs.get("aria-pressed"), "false");
    assert.equal(dom.button("female").attrs.get("aria-pressed"), "true");
    assert.equal(picked.length, 0);
    next.click();
    next.onclick?.({ target: next });
    assert.deepEqual(picked, ["female"]);
    assert.deepEqual(dom.revoked, dom.created);
    assert.equal(dom.handlers.size, 0);
    assert.equal(root.events.get("keydown")?.size, 0);
  } finally { dom.restore(); }
});

test("Back and Escape cancel exactly once without committing a selected reference", () => {
  const dom = mountChooserDocument();
  try {
    let picked = 0, cancelled = 0;
    for (const exit of ["Back", "Escape"]) {
      openSexChooser(() => { picked++; }, undefined, () => { cancelled++; }, undefined, { photo: photo(), confirm: true });
      dom.ready();
      dom.button("male").click();
      const next = dom.root().querySelector(".sexpick-continue")!;
      if (exit === "Back") dom.root().querySelector(".sexpick-cancel")!.click();
      else assert.deepEqual(dom.key("Escape"), { prevented: true, stopped: true });
      next.onclick?.({ target: next });
      dom.key("Escape");
    }
    assert.equal(picked, 0);
    assert.equal(cancelled, 2);
    assert.deepEqual(dom.revoked, dom.created);
    assert.equal(dom.handlers.size, 0);
  } finally { dom.restore(); }
});

test("replacing or externally closing a chooser disposes its photo and stale callbacks", () => {
  const dom = mountChooserDocument();
  try {
    const picked: string[] = [];
    let cancelled = 0;
    openSexChooser((sex) => picked.push(`old:${sex}`), "male", () => { cancelled++; }, undefined, { photo: photo(), confirm: true });
    const oldImage = dom.ready(), oldLoad = oldImage.onload;
    const oldNext = dom.root().querySelector(".sexpick-continue")!;
    openSexChooser((sex) => picked.push(`new:${sex}`), undefined, () => { cancelled++; }, undefined, { photo: photo(), confirm: true });
    assert.deepEqual(dom.revoked, [dom.created[0]]);
    assert.equal(oldImage.onload, null);
    assert.equal(oldImage.onerror, null);
    oldLoad?.();
    oldNext.onclick?.({ target: oldNext });
    assert.equal(picked.length, 0);
    assert.equal(dom.root().querySelector(".sexpick-continue")!.disabled, true);
    assert.equal(dom.button("male").classList.contains("selected"), false);
    close(); close();
    assert.equal(cancelled, 0, "external close is not an explicit user cancellation");
    assert.deepEqual(dom.revoked, dom.created);
    assert.equal(dom.handlers.size, 0);
    assert.equal(dom.frames.size, 0);
  } finally { dom.restore(); }
});

test("an explicitly supplied reference can be confirmed but a failed preview cannot", () => {
  const dom = mountChooserDocument();
  try {
    const picked: string[] = [];
    openSexChooser((sex) => picked.push(sex), "female", undefined, undefined, { photo: photo(), confirm: true });
    const next = dom.root().querySelector(".sexpick-continue")!;
    assert.equal(dom.button("female").attrs.get("aria-pressed"), "true");
    assert.equal(next.disabled, true);
    dom.root().querySelector("img")!.onerror?.();
    assert.equal(dom.root().querySelector(".sexpick-preview-error")!.hidden, false);
    next.onclick?.({ target: next });
    assert.equal(picked.length, 0);
    close();
    openSexChooser((sex) => picked.push(sex), "female", undefined, undefined, { confirm: true });
    dom.root().querySelector(".sexpick-continue")!.click();
    assert.deepEqual(picked, ["female"]);
  } finally { dom.restore(); }
});

test("canvas previews are locally copied and bounded without changing the source", () => {
  const dom = mountChooserDocument();
  try {
    const source = dom.doc.createElement("canvas"); source.width = 1920; source.height = 2560;
    openSexChooser(() => {}, undefined, undefined, undefined, { photo: source as unknown as HTMLCanvasElement, confirm: true });
    const preview = dom.root().querySelector("canvas")!;
    assert.deepEqual([preview.width, preview.height], [480, 640]);
    assert.equal(preview.draws[0][0], source);
    assert.deepEqual(dom.created, []);
    dom.button("male").click();
    assert.equal(dom.root().querySelector(".sexpick-continue")!.disabled, false);
    close();
    assert.deepEqual([preview.width, preview.height], [1, 1]);
    assert.deepEqual([source.width, source.height], [1920, 2560]);
  } finally { dom.restore(); }
});

test("focus stays in the chooser and activation does not advance an underlying scanner", () => {
  const dom = mountChooserDocument();
  try {
    const origin = dom.doc.createElement("button"); dom.doc.body.appendChild(origin); origin.focus();
    openSexChooser(() => {}, undefined, undefined, undefined, { confirm: true });
    const root = dom.root(), back = root.querySelector(".sexpick-cancel")!;
    assert.equal(dom.doc.activeElement, back);
    assert.equal(dom.key("Tab", true).prevented, true);
    assert.equal(dom.doc.activeElement, dom.button("female"));
    dom.key("Tab");
    assert.equal(dom.doc.activeElement, back);
    dom.button("male").click();
    root.querySelector(".sexpick-continue")!.focus();
    dom.key("Tab");
    assert.equal(dom.doc.activeElement, back);
    for (const key of ["Enter", " "]) {
      let stopped = false, prevented = false;
      const event = { key, stopPropagation: () => { stopped = true; }, preventDefault: () => { prevented = true; } } as KeyboardEvent;
      for (const handler of root.events.get("keydown") ?? []) handler(event);
      assert.equal(stopped, true);
      assert.equal(prevented, false, "keep native button activation");
    }
    close();
    assert.equal(dom.doc.activeElement, origin);
  } finally { dom.restore(); }
});

test("external subject close removes Escape and prevents stale subject selection", () => {
  const dom = mountChooserDocument();
  try {
    let picked = 0, cancelled = 0;
    openSubjectChooser(() => { picked++; }, () => { cancelled++; });
    const oldSelf = dom.root().querySelectorAll("[data-who]").find((button) => button.dataset.who === "me")!;
    assert.equal(dom.handlers.size, 1);
    closeSubjectChooser();
    oldSelf.onclick?.({ target: oldSelf });
    dom.key("Escape");
    assert.equal(picked, 0);
    assert.equal(cancelled, 0);
    assert.equal(dom.handlers.size, 0);
    assert.equal(dom.frames.size, 0);
  } finally { dom.restore(); }
});

test("replacing a subject chooser cannot finish from the prior chooser", () => {
  const dom = mountChooserDocument();
  try {
    const picked: string[] = [];
    let cancelled = 0;
    openSubjectChooser(() => picked.push("old"), () => { cancelled++; });
    const oldSelf = dom.root().querySelectorAll("[data-who]")[0];
    openSubjectChooser(() => picked.push("new"), () => { cancelled++; });
    oldSelf.onclick?.({ target: oldSelf });
    assert.equal(picked.length, 0);
    assert.equal(dom.handlers.size, 1);
    dom.root().querySelectorAll("[data-who]")[0].click();
    assert.deepEqual(picked, ["new"]);
    assert.equal(cancelled, 0);
    assert.equal(dom.handlers.size, 0);
    openSubjectChooser(() => picked.push("unexpected"), () => { cancelled++; });
    dom.key("Escape"); dom.key("Escape");
    assert.equal(cancelled, 1);
  } finally { dom.restore(); }
});
