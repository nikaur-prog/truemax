import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LM } from "./geometry.js";

// ---------------------------------------------------------------------------
// Width and height are different questions, and they were collapsed once.
//
// bizygomatic width was measured between landmarks 116/345 for as long as the
// engine has existed. Across 60 reference photographs those two span 89.2% of
// the face at their own height — a consistent 10.8% underestimate, not an
// approximation — and five metrics divide by it. The fix points width at the
// silhouette, 234/454.
//
// The trap on the way out was pointing EVERYTHING at 234/454. cheekboneHeight
// has no width in it at all; it is where the cheekbone sits vertically. Moving
// it to the silhouette pair shifted it 41% on men and 12% on women, which is
// not a correction, just a different measurement under the same name.
//
// These pin the split so it cannot quietly close again.
// ---------------------------------------------------------------------------

const metricsSrc = readFileSync(new URL("./metrics.ts", import.meta.url), "utf8");

test("width and height use different landmarks on purpose", () => {
  assert.notEqual(LM.ZYGION_R, LM.MALAR_R);
  assert.notEqual(LM.ZYGION_L, LM.MALAR_L);
});

test("bizygomatic width is taken at the face silhouette", () => {
  // Measured, not assumed: tools/bizygo-check.mjs put 116/345 at 89.2% of the
  // face's width at their own height. 234/454 are the oval pair at that same
  // height, which is what the published definition of bizygomatic width asks
  // for — the maximum distance between the left and right facial boundary.
  assert.equal(LM.ZYGION_R, 234);
  assert.equal(LM.ZYGION_L, 454);
  assert.match(metricsSrc, /bizygo: dist\(p\(LM\.ZYGION_R\), p\(LM\.ZYGION_L\)\)/);
});

test("cheekboneHeight measures from the malar prominence, not the silhouette", () => {
  // The one metric that must NOT follow the width change. If a later edit
  // points it at ZYGION for consistency, this fails and says why.
  assert.equal(LM.MALAR_R, 116);
  assert.equal(LM.MALAR_L, 345);
  const body = metricsSrc.slice(
    metricsSrc.indexOf("cheekboneHeight: (d) =>"),
    metricsSrc.indexOf("cheekFullness"),
  );
  assert.ok(body.length > 0, "could not find the cheekboneHeight construction");
  assert.ok(body.includes("LM.MALAR_R"), "cheekboneHeight must read the malar prominence");
  assert.ok(!body.includes("LM.ZYGION"), "cheekboneHeight is a height and must not read the silhouette pair");
});

test("every metric that divides by bizygo has no rated evidence yet", () => {
  // The corpus stores measurements and not photographs, so the nineteen faces
  // cannot be re-measured under the new definition — their stored values
  // describe a quantity the engine no longer computes. They were removed, and
  // this is what stops them being quietly re-added from an old backup: a name
  // here means "prior only", and it leaves the list by re-scanning faces.
  const testSrc = readFileSync(new URL("./calibration.test.ts", import.meta.url), "utf8");
  const listed = testSrc.slice(
    testSrc.indexOf("const MEASURED_AFTER_CORPUS"),
    testSrc.indexOf("test(", testSrc.indexOf("const MEASURED_AFTER_CORPUS")),
  );
  for (const id of ["eyeSeparationRatio", "fwhr", "jawCheekRatio", "fifthsEyeRatio", "facialIndex"]) {
    assert.ok(listed.includes(`"${id}"`), `${id} divides by bizygo and must be listed as prior-only`);
  }
});
