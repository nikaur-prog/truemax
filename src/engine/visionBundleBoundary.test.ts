import test from "node:test";
import assert from "node:assert/strict";
import { assertDeferredVisionRuntime } from "../../scripts/vision-bundle-boundary.js";

const chunk = (fileName: string, imports: string[], isEntry = false, modules: Record<string, unknown> = {}) => ({ type: "chunk" as const, fileName, isEntry, imports, modules });
const vision = { "/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs": {} };

test("vision can be emitted as an on-intent dynamic chunk without entering startup imports", () => {
  assert.doesNotThrow(() => assertDeferredVisionRuntime({
    "main.js": { ...chunk("main.js", ["contours.js"], true), dynamicImports: ["vision.js"] } as ReturnType<typeof chunk>,
    "contours.js": chunk("contours.js", []),
    "vision.js": chunk("vision.js", [], false, vision),
    "page.html": { type: "asset" },
  }));
});

test("eager vision in an entry or a shared transitive chunk fails the build boundary", () => {
  assert.throws(() => assertDeferredVisionRuntime({ "main.js": chunk("main.js", [], true, vision) }), /eagerly loaded by main.js/);
  assert.throws(() => assertDeferredVisionRuntime({
    "main.js": chunk("main.js", ["shared.js"], true),
    "shared.js": chunk("shared.js", ["vision.js", "main.js"]),
    "vision.js": chunk("vision.js", [], false, vision),
  }), /through vision.js/);
});

test("every HTML entry is checked, and shared cycles terminate", () => {
  const bundle = {
    "main.js": chunk("main.js", ["a.js"], true),
    "a.js": chunk("a.js", ["main.js"]),
    "quick.js": chunk("quick.js", ["vision.js"], true),
    "vision.js": chunk("vision.js", [], false, vision),
  };
  assert.throws(() => assertDeferredVisionRuntime(bundle), /eagerly loaded by quick.js/);
  bundle["quick.js"].imports = [];
  assert.doesNotThrow(() => assertDeferredVisionRuntime(bundle));
});
