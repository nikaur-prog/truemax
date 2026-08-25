import test from "node:test";
import assert from "node:assert/strict";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { FACE_LANDMARK_COUNT, LM } from "./geometry.js";
import {
  FRONT_POINTS,
  frontPointShift,
  moveFrontPoint,
  movedFrontPoints,
} from "./frontPoints.js";

const W = 1000;
const H = 1250;

function cloud(): NormalizedLandmark[] {
  return Array.from({ length: FACE_LANDMARK_COUNT }, (_, i) => ({
    x: 0.5 + (i % 7) * 0.01,
    y: 0.5 + (i % 11) * 0.01,
    z: -0.02 - (i % 5) * 0.001,
    visibility: 1,
  }));
}

const spec = (id: string) => {
  const found = FRONT_POINTS.find((s) => s.id === id);
  assert.ok(found, `spec ${id} is missing`);
  return found;
};

test("every editable point names a landmark inside the mesh", () => {
  for (const s of FRONT_POINTS) {
    assert.ok(
      Number.isInteger(s.index) && s.index >= 0 && s.index < FACE_LANDMARK_COUNT,
      `${s.id} index ${s.index}`,
    );
    for (const i of s.moves ?? []) {
      assert.ok(Number.isInteger(i) && i >= 0 && i < FACE_LANDMARK_COUNT, `${s.id} moves ${i}`);
    }
  }
});

test("ids and drawn landmarks are unique, so two handles can never fight", () => {
  const ids = new Set(FRONT_POINTS.map((s) => s.id));
  assert.equal(ids.size, FRONT_POINTS.length);
  const drawn = new Set(FRONT_POINTS.map((s) => s.index));
  assert.equal(drawn.size, FRONT_POINTS.length);
});

test("a group's handle is one of the landmarks that group moves", () => {
  for (const s of FRONT_POINTS) {
    if (!s.moves) continue;
    assert.ok(s.moves.includes(s.index), `${s.id} draws a handle it does not move`);
  }
});

test("moving a point lands it exactly where it was dropped", () => {
  const before = cloud();
  const after = moveFrontPoint(before, spec("menton"), { x: 400, y: 900 }, W, H);
  assert.ok(Math.abs(after[LM.MENTON].x * W - 400) < 1e-6);
  assert.ok(Math.abs(after[LM.MENTON].y * H - 900) < 1e-6);
});

test("the original cloud is never mutated", () => {
  const before = cloud();
  const snapshot = JSON.stringify(before);
  moveFrontPoint(before, spec("menton"), { x: 10, y: 10 }, W, H);
  assert.equal(JSON.stringify(before), snapshot);
});

test("depth is carried through rather than invented from a 2D drag", () => {
  const before = cloud();
  const after = moveFrontPoint(before, spec("zygionR"), { x: 120, y: 300 }, W, H);
  assert.equal(after[LM.ZYGION_R].z, before[LM.ZYGION_R].z);
});

test("only the named point moves", () => {
  const before = cloud();
  const after = moveFrontPoint(before, spec("menton"), { x: 400, y: 900 }, W, H);
  for (let i = 0; i < FACE_LANDMARK_COUNT; i++) {
    if (i === LM.MENTON) continue;
    assert.equal(after[i].x, before[i].x, `landmark ${i} x moved`);
    assert.equal(after[i].y, before[i].y, `landmark ${i} y moved`);
  }
});

// Nose width is the widest extent across four candidates per side. Moving one
// of them alone would either do nothing — another candidate is still widest —
// or silently re-elect which landmark IS the measurement. The group travels
// rigidly so the drag moves the extent by exactly what was dragged.
test("a nostril drag translates its whole alar group, keeping the arrangement", () => {
  const before = cloud();
  const drawn = before[98];
  const after = moveFrontPoint(before, spec("alarR"), { x: 200, y: 600 }, W, H);
  const dx = 200 / W - drawn.x;
  const dy = 600 / H - drawn.y;
  for (const i of LM.ALAR_R) {
    assert.ok(Math.abs(after[i].x - (before[i].x + dx)) < 1e-9, `alar ${i} x`);
    assert.ok(Math.abs(after[i].y - (before[i].y + dy)) < 1e-9, `alar ${i} y`);
  }
  // And the other side is untouched.
  for (const i of LM.ALAR_L) assert.equal(after[i].x, before[i].x);
});

test("shift is reported in pixels, and a fresh cloud has moved nothing", () => {
  const before = cloud();
  assert.equal(movedFrontPoints(before, before, W, H).length, 0);
  const after = moveFrontPoint(before, spec("gonionR"), {
    x: before[LM.GONION_R].x * W + 30,
    y: before[LM.GONION_R].y * H + 40,
  }, W, H);
  assert.ok(Math.abs(frontPointShift(before, after, spec("gonionR"), W, H) - 50) < 1e-6);
  const moved = movedFrontPoints(before, after, W, H);
  assert.equal(moved.length, 1);
  assert.equal(moved[0].id, "gonionR");
});

// A fingertip resting on a handle is not an edit. Without this the Re-measure
// button would arm on a tap, and re-scoring a face because somebody touched it
// is a score change nobody asked for.
test("a sub-pixel nudge does not count as moving a point", () => {
  const before = cloud();
  const after = moveFrontPoint(before, spec("menton"), {
    x: before[LM.MENTON].x * W + 0.4,
    y: before[LM.MENTON].y * H,
  }, W, H);
  assert.equal(movedFrontPoints(before, after, W, H).length, 0);
});
