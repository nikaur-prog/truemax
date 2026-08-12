import assert from "node:assert/strict";
import test from "node:test";
import { classifyCoveringMask } from "./headCovering.ts";

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
