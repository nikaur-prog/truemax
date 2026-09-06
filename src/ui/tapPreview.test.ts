import assert from "node:assert/strict";
import test from "node:test";
import { resetTapPreview, wireMetricButton, wireTapPreview } from "./tapPreview.js";

function rowFixture() {
  const attributes = new Map<string, string>();
  const classes = new Set<string>();
  const row = {
    tabIndex: -1,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) },
    closest: () => row,
  } as unknown as HTMLElement;
  return { row, attributes, classes };
}

function key(row: HTMLElement, value: string, up = false, target: EventTarget = row, repeat = false): boolean {
  let prevented = false;
  const event = { key: value, target, repeat, preventDefault: () => { prevented = true; } } as unknown as KeyboardEvent;
  if (up) row.onkeyup?.(event);
  else row.onkeydown?.(event);
  return prevented;
}

test("measurement rows are named, focusable dialog buttons with Enter and Space behavior", () => {
  const { row, attributes } = rowFixture();
  let opens = 0;
  let previews = 0;
  let leaves = 0;
  wireMetricButton(row, "Open Canthal tilt details", () => { opens++; }, () => { previews++; }, () => { leaves++; });
  assert.equal(row.tabIndex, 0);
  assert.equal(attributes.get("role"), "button");
  assert.equal(attributes.get("aria-haspopup"), "dialog");
  assert.equal(attributes.get("aria-label"), "Open Canthal tilt details");
  row.onfocus?.({} as FocusEvent);
  assert.equal(previews, 1);
  assert.equal(key(row, "Enter"), true);
  assert.equal(opens, 1);
  key(row, "Enter", false, row, true);
  assert.equal(opens, 1, "holding Enter does not repeatedly open the dialog");
  assert.equal(key(row, " "), true, "Space must not scroll the report");
  assert.equal(opens, 1);
  assert.equal(key(row, " ", true), true);
  assert.equal(opens, 2);
  key(row, " ");
  row.onblur?.({} as FocusEvent);
  key(row, " ", true);
  assert.equal(opens, 2, "Space released after leaving the row must not activate it");
  assert.equal(leaves, 1);
  assert.equal(key(row, "Tab"), false);
});

test("nested controls retain their keyboard actions", () => {
  const { row } = rowFixture();
  let opens = 0;
  wireMetricButton(row, "Open details", () => { opens++; });
  const link = { closest: () => link } as unknown as EventTarget;
  assert.equal(key(row, "Enter", false, link), false);
  assert.equal(key(row, " ", false, link), false);
  assert.equal(opens, 0);
});

test("touch keeps preview then open, while keyboard and VoiceOver activation open directly", () => {
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const { row, classes } = rowFixture();
  Object.defineProperty(globalThis, "document", { configurable: true, value: { querySelectorAll: () => [row] } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { matchMedia: () => ({ matches: false }) } });
  const opened: string[] = [];
  const previewed: string[] = [];
  const click = (pointerType: string, detail: number, target: EventTarget = row) => row.onclick?.({ pointerType, detail, target } as unknown as PointerEvent);
  try {
    resetTapPreview();
    wireTapPreview(row, "canthalTilt", { label: "Open Canthal tilt details", open: (id) => opened.push(id), preview: (id) => previewed.push(id) });
    click("touch", 1);
    assert.equal(previewed.length, 1);
    assert.equal(opened.length, 0);
    assert.equal(classes.has("armed"), true);
    click("touch", 1);
    assert.equal(opened.length, 1);
    assert.equal(classes.has("armed"), false);
    click("", 0);
    assert.equal(opened.length, 2, "a virtual click is not forced through the two-touch flow");
    key(row, "Enter");
    assert.equal(opened.length, 3);
    const link = { closest: () => link } as unknown as EventTarget;
    click("mouse", 1, link);
    assert.equal(opened.length, 3);
  } finally {
    resetTapPreview();
    if (priorDocument) Object.defineProperty(globalThis, "document", priorDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (priorWindow) Object.defineProperty(globalThis, "window", priorWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
