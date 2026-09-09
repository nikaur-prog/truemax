import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { closeScanConfirm, confirmScanAction, scanConfirmPreviewSize } from "./scanConfirm.js";

/** Minimal DOM boundary for exercising the real dialog's event lifecycle. */
function mountDialogDocument() {
  const savedDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const savedElement = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");
  const handlers = new Set<(event: KeyboardEvent) => void>();
  class Element {
    className = "";
    textContent = "";
    id = "";
    src = "";
    alt = "";
    hidden = false;
    children: Element[] = [];
    parent: Element | null = null;
    onclick: (() => void) | null = null;
    onerror: (() => void) | null = null;
    attrs = new Map<string, string>();
    classes = new Set<string>();
    classList = { add: (value: string) => this.classes.add(value), remove: (value: string) => this.classes.delete(value) };
    constructor(readonly tag: string) {}
    append(...children: Element[]) { for (const child of children) this.appendChild(child); }
    appendChild(child: Element) { child.parent = this; this.children.push(child); return child; }
    setAttribute(name: string, value: string) { this.attrs.set(name, value); }
    focus() { doc.activeElement = this; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((item) => item !== this); }
    all(): Element[] { return [this, ...this.children.flatMap((child) => child.all())]; }
  }
  const doc = {
    body: new Element("body"),
    activeElement: null as Element | null,
    createElement: (tag: string) => new Element(tag),
    addEventListener: (_name: string, handler: (event: KeyboardEvent) => void) => handlers.add(handler),
    removeEventListener: (_name: string, handler: (event: KeyboardEvent) => void) => handlers.delete(handler),
  };
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: Element });
  return {
    doc,
    key(key: string, shiftKey = false) {
      const event = { key, shiftKey, preventDefault() {} } as KeyboardEvent;
      for (const handler of [...handlers]) handler(event);
    },
    restore() {
      closeScanConfirm();
      if (savedDocument) Object.defineProperty(globalThis, "document", savedDocument);
      else Reflect.deleteProperty(globalThis, "document");
      if (savedElement) Object.defineProperty(globalThis, "HTMLElement", savedElement);
      else Reflect.deleteProperty(globalThis, "HTMLElement");
    },
  };
}

test("side invitation displays its labelled example and keeps both choices usable if it fails", async () => {
  const dom = mountDialogDocument();
  try {
    const answer = confirmScanAction({
      title: "Add a side photo?", copy: "A full side view, head level.",
      confirmLabel: "Add side photo", cancelLabel: "Use front only",
      example: { src: "/tutorial/side-do.jpg", alt: "A full side view", caption: "Example only" },
    });
    const elements = dom.doc.body.all();
    const image = elements.find((element) => element.tag === "img")!;
    assert.equal(image.src, "/tutorial/side-do.jpg");
    assert.equal(image.alt, "A full side view");
    assert.equal(elements.find((element) => element.tag === "figcaption")?.textContent, "Example only");
    image.onerror?.();
    assert.equal(image.hidden, true);
    const buttons = elements.filter((element) => element.tag === "button");
    assert.deepEqual(buttons.map((button) => button.textContent), ["Use front only", "Add side photo"]);
    assert.equal(dom.doc.activeElement, buttons[1]);
    dom.key("Tab");
    assert.equal(dom.doc.activeElement, buttons[0]);
    dom.key("Tab", true);
    assert.equal(dom.doc.activeElement, buttons[1]);
    buttons[0].onclick?.();
    assert.equal(await answer, false);
    assert.equal(dom.doc.body.children.length, 0);
    assert.equal(dom.doc.body.classes.has("scan-confirm-open"), false);
  } finally { dom.restore(); }
});

test("tearing down a side invitation cancels it once and cannot accept it later", async () => {
  const dom = mountDialogDocument();
  try {
    const answer = confirmScanAction({ title: "Add a side photo?", copy: "Optional", confirmLabel: "Add", cancelLabel: "Skip" });
    const accept = dom.doc.body.all().find((element) => element.textContent === "Add")!;
    closeScanConfirm();
    accept.onclick?.();
    dom.key("Escape");
    assert.equal(await answer, false);
    assert.equal(dom.doc.body.children.length, 0);
  } finally { dom.restore(); }
});

test("the front review copy is bounded instead of duplicating a full phone canvas", () => {
  assert.deepEqual(scanConfirmPreviewSize(2160, 2880), { width: 780, height: 1040 });
  assert.deepEqual(scanConfirmPreviewSize(720, 960), { width: 720, height: 960 });
  assert.deepEqual(scanConfirmPreviewSize(0, 0), { width: 0, height: 0 });
});

test("a captured front is accepted before the optional side decision", () => {
  const src = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  const captured = src.indexOf('title: "Happy with this front photo?"');
  const armed = src.lastIndexOf('armLeaveGuard("scan")', captured);
  const accepted = src.indexOf("if (!accepted)", captured);
  const optional = src.indexOf('title: "Add a side photo?"', accepted);
  const side = src.indexOf("if (takeSide) {", optional);
  const frontOnly = src.indexOf("await gateAnalysis(null, token)", side);
  assert.ok(armed > 0 && captured > armed && accepted > captured && optional > accepted);
  assert.ok(side > optional && frontOnly > side);
  assert.match(src.slice(captured, optional), /preview: frontShot/);
});

test("backing out of the profile step never strands a completed front scan", () => {
  const src = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  const review = src.indexOf("function showFrontReview()");
  const skip = src.indexOf('id="front-skip-side"', review);
  const skipHandler = src.indexOf('getElementById("front-skip-side")', skip);
  const frontOnly = src.indexOf("void gateAnalysis(null, token)", skipHandler);
  const permission = src.indexOf("await prepareSidePlacementChoice()", frontOnly);
  const cancelledConsentFallback = src.indexOf("await gateAnalysis(null, token)", permission);

  assert.ok(review > 0 && skip > review && skipHandler > skip && frontOnly > skipHandler);
  assert.ok(permission > frontOnly && cancelledConsentFallback > permission);
});

test("mobile scan exits use app UI, while refresh keeps the browser guard", () => {
  const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  const results = readFileSync(new URL("./results.ts", import.meta.url), "utf8");
  assert.doesNotMatch(main, /window\.confirm\("Leave this report/);
  assert.doesNotMatch(results, /window\.confirm\("Start over with a new photo/);
  assert.match(main, /window\.addEventListener\("beforeunload"/);
  assert.match(main, /closeScanConfirm\(\);\s*disarmLeaveGuard\(\);/);
});

test("side review offers retake and skip at the preview and correction steps", () => {
  const src = readFileSync(new URL("./sideFlow.ts", import.meta.url), "utf8");
  assert.match(src, /retakeButton\.textContent = "Retake side photo"/);
  assert.match(src, /skipButton\.textContent = "Use front only"/);
  assert.match(src, /if \(ctx\.onSkip\)/);
  assert.match(src, /if \(exitCtx\) appendSideExitActions\(backdrop\.querySelector\("section"\)!, exitCtx\)/);
  assert.match(src, /if \(opts\.exitCtx\) appendSideExitActions/);
  const guided = src.slice(src.indexOf("const showGuidedActions"), src.indexOf("const showReviewActions"));
  assert.match(guided, /appendSideExitActions\(e.actions, ctx\)/);
  const review = src.slice(src.indexOf("const showReviewActions"), src.indexOf("const confirmPlacement"));
  assert.match(review, /appendSideExitActions\(e.actions, ctx\)/);
});

test("skipping the side routes the owned front to analysis without a side result", () => {
  const src = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  const flow = src.slice(src.indexOf("function startSide()"));
  const skip = flow.slice(flow.indexOf("onSkip:"), flow.indexOf("onDone:"));
  assert.match(skip, /scanSession.isCurrent\(token\)/);
  assert.match(skip, /lastSide = null/);
  assert.match(skip, /gateAnalysis\(null, token\)/);
  assert.doesNotMatch(skip, /resetToUpload|onDone\(/);
});

test("side readers use an owned snapshot with cancellation and no artificial delay", () => {
  const src = readFileSync(new URL("./sideFlow.ts", import.meta.url), "utf8");
  assert.match(src, /seedSidePointsSmart\(\s*snapshot,/);
  assert.match(src, /cloudPlacementFor\(snapshot, localResult, signal, ctx\.reviewMode\)/);
  assert.match(src, /if \(!sideAttempt.current\(signal\)\) return/);
  assert.doesNotMatch(src, /READ_BEAT_MS/);
});

test("retake removes the old preview's invisible action state", () => {
  const src = readFileSync(new URL("./sideFlow.ts", import.meta.url), "utf8");
  const capture = src.slice(src.indexOf("export function openSideCapture"), src.indexOf("function skipSide"));
  assert.match(capture, /e\.actions\.classList\.remove\("mode-pending", "guided-row"\)/);
});

test("optional feedback never blocks report paint and uses scan cancellation", () => {
  const src = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /await feedbackInFlight/);
  assert.match(src, /signal: scanWorkAbort.signal/);
  assert.match(src, /durationPolicy: "interactive"/);
  const pass = src.slice(src.indexOf("async function playMeasurePass"), src.indexOf("async function runFullAnalysis"));
  assert.match(pass, /paintFrontPane\(frontShot\);\s*markMeasuredOnScreen/);
});

test("draft targets require verified side baselines and reset on identity change", () => {
  const src = readFileSync(new URL("./results.ts", import.meta.url), "utf8");
  assert.match(src, /fresh.targets = fresh.targets.filter\(\(target\) => target.view !== "side" \|\| ctx!.sideVerified === true\)/);
  assert.match(src, /clearResultsIdentityState\(\): void \{\s*resultOwner = null;\s*goalDraft = null;/);
  assert.match(src, /if \(keepTargets && !gated && adultUser\)/);
});

test("direct goal panel redraw disposes a running preview before replacing its DOM", () => {
  const src = readFileSync(new URL("./results.ts", import.meta.url), "utf8");
  const panel = src.slice(src.indexOf("function showImprove(): void"));
  const dispose = panel.indexOf("detachMorphPreview?.();");
  const replace = panel.indexOf("body().innerHTML =");
  const mount = panel.indexOf("detachMorphPreview = wireMorphPreview");
  assert.ok(dispose > 0 && replace > dispose && mount > replace);
  assert.match(panel.slice(dispose, replace), /detachMorphPreview = null/);
});
