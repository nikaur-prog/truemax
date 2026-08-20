import test from "node:test";
import assert from "node:assert/strict";
import { computeRawMetrics } from "./metrics.js";
import { LM, buildGeometry } from "./geometry.js";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

// ---------------------------------------------------------------------------
// The only measurement in this engine that can see facial fat.
//
// Everything else is a ratio between landmarks, and two faces with identical
// bone structure and very different amounts of tissue on it produce identical
// ratios. cheekFullness measures the CURVE of the visible outline between the
// widest point of the face and the jaw corner, which is the one thing in a
// frontal photograph that separates them.
//
// It is built from a signed perpendicular distance and a side-of-the-face sign
// flip, both of which are easy to get backwards in a way no test of the whole
// pipeline would localise — a wrong sign here reads as "the engine thinks fat
// is good", which is the exact failure that started this calibration.
// ---------------------------------------------------------------------------

const W = 1000;
const H = 1000;

/**
 * A face built to order, with the cheek outline placed where the test wants it.
 *
 * `bulge` is how far the mid-cheek point sits OUTSIDE the straight line from
 * the widest point of the face down to the jaw corner, in image pixels.
 * Negative is a hollow. Everything else is roughly human and held fixed, so the
 * only thing varying between two fixtures is the quantity under test.
 */
function face(bulge: number): NormalizedLandmark[] {
  const lm: NormalizedLandmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  const put = (i: number, x: number, y: number) => { lm[i] = { x: x / W, y: y / H, z: 0, visibility: 1 }; };

  // Eyes at y=400, 120px apart, centred on x=500.
  put(LM.EYE_R_OUTER, 380, 400); put(LM.EYE_R_INNER, 460, 400);
  put(LM.EYE_L_INNER, 540, 400); put(LM.EYE_L_OUTER, 620, 400);
  put(LM.EYE_R_TOP, 420, 385); put(LM.EYE_R_BOTTOM, 420, 415);
  put(LM.EYE_L_TOP, 580, 385); put(LM.EYE_L_BOTTOM, 580, 415);
  put(LM.GLABELLA, 500, 370); put(LM.FOREHEAD_TOP, 500, 250); put(LM.MENTON, 500, 780);
  put(LM.NASION, 500, 380); put(LM.SUBNASALE, 500, 560);

  // Structure: cheekbones at ±170, jaw corners at ±140 and lower.
  put(LM.ZYGION_R, 330, 450); put(LM.ZYGION_L, 670, 450);
  put(LM.GONION_R, 360, 640); put(LM.GONION_L, 640, 640);

  // The silhouette. Widest point level with the cheekbones, mid-cheek halfway
  // down to the jaw corner, displaced by `bulge` away from the face centre.
  put(LM.CHEEK_OUT_R, 320, 450); put(LM.CHEEK_OUT_L, 680, 450);
  const midY = 545;
  const chordX = 340; // halfway between 320 and 360
  put(LM.CHEEK_MID_R, chordX - bulge, midY);
  put(LM.CHEEK_MID_L, W - (chordX - bulge), midY);
  return lm;
}

// derive() is private to metrics.ts, so the computer is driven the way the
// engine drives it — through computeRawMetrics, which builds the same Derived.
const measure = (bulge: number) => computeRawMetrics(buildGeometry(face(bulge), W, H)).cheekFullness;

test("a hollow cheek reads negative and a full one reads positive", () => {
  assert.ok(measure(-25) < 0, `a cheek 25px inside the chord read ${measure(-25).toFixed(2)}`);
  assert.ok(measure(25) > 0, `a cheek 25px outside the chord read ${measure(25).toFixed(2)}`);
  // A silhouette sitting exactly on the chord is the boundary between the two
  // and must not land on either side of it by accident.
  assert.ok(Math.abs(measure(0)) < 0.05, `a flat cheek read ${measure(0).toFixed(3)}`);
});

test("more tissue reads as more fullness, monotonically", () => {
  let previous = -Infinity;
  for (const bulge of [-40, -20, -10, 0, 10, 20, 40]) {
    const v = measure(bulge);
    assert.ok(v > previous, `bulge ${bulge} read ${v.toFixed(2)}, not above ${previous.toFixed(2)}`);
    previous = v;
  }
});

test("both sides are read the same way round", () => {
  // The sign flip between the left and right cheek is the part most likely to
  // be wrong, and a symmetric face is where a flipped sign hides: the two
  // errors cancel in the mean and the metric looks fine until somebody turns
  // their head. Measured one side at a time, they must agree.
  const lm = face(30);
  const onlyRight = lm.map((p, i) => (i === LM.CHEEK_MID_L ? { x: (1000 - 340) / W, y: 545 / H, z: 0, visibility: 1 } : p));
  const onlyLeft = lm.map((p, i) => (i === LM.CHEEK_MID_R ? { x: 340 / W, y: 545 / H, z: 0, visibility: 1 } : p));
  const r = computeRawMetrics(buildGeometry(onlyRight, W, H)).cheekFullness;
  const l = computeRawMetrics(buildGeometry(onlyLeft, W, H)).cheekFullness;
  assert.ok(r > 0, `right cheek alone read ${r.toFixed(2)}`);
  assert.ok(l > 0, `left cheek alone read ${l.toFixed(2)}`);
  assert.ok(Math.abs(r - l) < 0.2, `the two sides disagree: ${r.toFixed(2)} vs ${l.toFixed(2)}`);
});

test("it is expressed as a share of face width, not in pixels", () => {
  // Two photographs of the same face at different distances must agree, or the
  // measurement is about the camera rather than the person.
  const small = computeRawMetrics(buildGeometry(face(30), W, H)).cheekFullness;
  const scaled = face(30).map((p) => ({ x: 0.5 + (p.x - 0.5) * 0.5, y: 0.5 + (p.y - 0.5) * 0.5, z: 0, visibility: 1 }));
  const large = computeRawMetrics(buildGeometry(scaled, W, H)).cheekFullness;
  assert.ok(Math.abs(small - large) < 0.1, `${small.toFixed(2)} at full size vs ${large.toFixed(2)} at half`);
});
