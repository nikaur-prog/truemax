import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { prefersReducedOverlayMotion, snapshotIfMatching, transitionMeasurement } from "./measureOverlay.js";

test("front and side hover snapshots reuse their buffer without resizing or leaving old pixels", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  let allocations = 0;
  let resizes = 0;
  let clears = 0;
  let draws = 0;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement() {
        allocations++;
        let width = 0;
        let height = 0;
        return {
          get width() { return width; },
          set width(value: number) { resizes++; width = value; },
          get height() { return height; },
          set height(value: number) { resizes++; height = value; },
          getContext: () => ({ clearRect() { clears++; }, drawImage() { draws++; } }),
        };
      },
    },
  });
  try {
    const canvas = { width: 1200, height: 1600 } as HTMLCanvasElement;
    const first = snapshotIfMatching(canvas, 1200, 1600);
    for (let row = 0; row < 20; row++) assert.equal(snapshotIfMatching(canvas, 1200, 1600), first);
    assert.equal(allocations, 1);
    assert.equal(resizes, 2);
    assert.equal(clears, 21);
    assert.equal(draws, 21);
    assert.equal(snapshotIfMatching(canvas, 1600, 1200), null, "never blend an overlay from a mismatched photo grid");
    canvas.width = 1600; canvas.height = 1200;
    assert.equal(snapshotIfMatching(canvas, 1600, 1200), first);
    assert.equal(allocations, 1);
    assert.equal(resizes, 4);
    const secondCanvas = { width: 1600, height: 1200 } as HTMLCanvasElement;
    assert.notEqual(snapshotIfMatching(secondCanvas, 1600, 1200), first, "separate visible overlays do not share pixels");
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("tab changes and report teardown cancel both views' drawings and pending hover reverts", () => {
  const source = readFileSync(new URL("./results.ts", import.meta.url), "utf8");
  assert.match(source, /function clearResultPhotoRecovery\(\): void \{\s+cancelReportDrawing\(\)/);
  assert.match(source, /cancelReportDrawing\(\);\s+stopTypewriter\(\);/);
  const cleanup = source.slice(source.indexOf("function cancelReportDrawing()"), source.indexOf("// Whether the screen"));
  for (const handle of ["transition", "fade", "sideFade", "pillarFade"]) {
    assert.ok(cleanup.includes(`${handle}?.cancel()`), `${handle} must not paint over the next tab`);
  }
  assert.match(cleanup, /clearTimeout\(revert\)/);
  assert.match(cleanup, /clearTimeout\(pillarRevert\)/);
});

test("reduced motion paints a transition immediately without a canvas buffer or frame loop", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { matchMedia: (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" }) } });
  try {
    assert.equal(prefersReducedOverlayMotion(), true);
    let painted = 0;
    const canvas = {} as HTMLCanvasElement;
    const animation = transitionMeasurement(canvas, (target) => { assert.equal(target, canvas); painted++; });
    animation.cancel();
    assert.equal(painted, 1);
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("both measurement draw-on paths honour reduced motion before allocating", () => {
  for (const [file, method, paint] of [
    ["./measureOverlay.ts", "animateMeasurement", "drawMeasurement"],
    ["./sideMeasureOverlay.ts", "animateSideMeasurement", "drawSideMeasurement"],
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    const animation = source.slice(source.indexOf(`export function ${method}(`));
    assert.match(animation, new RegExp(`if \\(prefersReducedOverlayMotion\\(\\)\\) \\{\\s+${paint}\\(`));
    assert.ok(animation.indexOf("prefersReducedOverlayMotion()") < animation.indexOf("snapshotIfMatching("));
  }
});

test("side measurement hint and detail opener stay inside their own region", () => {
  const source = readFileSync(new URL("./results.ts", import.meta.url), "utf8");
  assert.match(source, /data-side-region="\$\{r.region\}"/);
  assert.match(source, /metric.def.region === hint.dataset.sideRegion/);
  assert.match(source, /x.def.region === hint.dataset.sideRegion && wasMeasured\(x\)/);
  assert.doesNotMatch(source, /flattering comparison you did not earn/);
});
