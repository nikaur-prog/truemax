import assert from "node:assert/strict";
import test from "node:test";
import { classifyCoveringMask } from "./headCovering.js";

const W = 100;
const H = 100;
const mask = () => new Uint8Array(W * H);
const paint = (m: Uint8Array, value: number, x0: number, y0: number, x1: number, y1: number) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * W + x] = value;
};

test("bare hair around a face is not called a hat or hood", () => {
  const m = mask();
  paint(m, 3, 30, 30, 70, 80);
  paint(m, 1, 22, 12, 78, 32);
  const check = classifyCoveringMask(m, W, H);
  assert.equal(check.hatLikely, false);
  assert.equal(check.hoodLikely, false);
});

test("clothing immediately above face skin is a hat-like covering", () => {
  const m = mask();
  paint(m, 3, 30, 30, 70, 80);
  paint(m, 4, 22, 12, 78, 33);
  assert.equal(classifyCoveringMask(m, W, H).hatLikely, true);
});

test("clothing flanking the face is a hood-like covering", () => {
  const m = mask();
  paint(m, 3, 30, 25, 70, 80);
  paint(m, 4, 18, 27, 35, 72);
  paint(m, 4, 65, 27, 82, 72);
  assert.equal(classifyCoveringMask(m, W, H).hoodLikely, true);
});

test("voluminous hair beside the temples is never called a hood", () => {
  // The live false positive this pins: curly dark hair flanking both temples,
  // with the segmenter mislabelling its shadowed LEFT side as clothing. The
  // old check took max(left, right) of clothes alone, so one mislabelled side
  // rejected every capture the tester made. Hair visible in the band is the
  // proof the band is not covered.
  const m = mask();
  paint(m, 3, 30, 25, 70, 80);   // face
  paint(m, 1, 18, 20, 32, 72);   // left hair mass...
  paint(m, 4, 18, 27, 26, 50);   // ...partly mislabelled as clothes
  paint(m, 1, 68, 20, 82, 72);   // right hair, labelled correctly
  const check = classifyCoveringMask(m, W, H);
  assert.equal(check.hoodLikely, false);
});

test("a one-sided block of fabric is a shoulder, not a hood", () => {
  const m = mask();
  paint(m, 3, 30, 25, 70, 80);
  paint(m, 4, 14, 27, 34, 72);   // fabric on the left only
  assert.equal(classifyCoveringMask(m, W, H).hoodLikely, false);
});
