import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { FACE_LANDMARK_COUNT, LM, landmarkIntegrityIssues } from "./geometry.js";
import type { Geom, Pt } from "./geometry.js";
import { measureCanthalTilts } from "./metrics.js";
import { EXPERIMENTAL_SIDE_METRIC_IDS, SIDE_METRICS, faceDirFromPoints, sidePointIntegrityIssues } from "./sideMetrics.js";
import type { SidePoints } from "./sideMetrics.js";

function rotate(p: Pt, deg: number): Pt {
  const t = (deg * Math.PI) / 180;
  return {
    x: p.x * Math.cos(t) - p.y * Math.sin(t),
    y: p.x * Math.sin(t) + p.y * Math.cos(t),
  };
}

test("face landmark guard rejects a missing or non-finite point", () => {
  const landmarks = Array.from({ length: FACE_LANDMARK_COUNT }, () => ({ x: 0.5, y: 0.5, z: 0 })) as NormalizedLandmark[];
  assert.deepEqual(landmarkIntegrityIssues(landmarks), []);
  landmarks[LM.EYE_R_INNER].x = Number.NaN;
  assert.match(landmarkIntegrityIssues(landmarks)[0], /Landmark 133/);
  assert.match(landmarkIntegrityIssues(landmarks.slice(0, 477))[0], /Expected 478/);
});

test("canthal tilt is invariant to image roll and preserves left-right asymmetry", () => {
  // Anatomical tilt is 6° on the subject-right eye and 4° on the left. Rotate
  // the whole photograph 14°; the reported values must remain 6° and 4°.
  const half = 0.5;
  const eye = (cx: number, tilt: number, right: boolean): [Pt, Pt] => {
    const rise = Math.tan((tilt * Math.PI) / 180) * half;
    const inner = right ? { x: cx + half, y: rise } : { x: cx - half, y: rise };
    const outer = right ? { x: cx - half, y: -rise } : { x: cx + half, y: -rise };
    return [inner, outer];
  };
  const [rInner, rOuter] = eye(-2, 6, true);
  const [lInner, lOuter] = eye(2, 4, false);
  const roll = 14;
  const points = new Map<number, Pt>([
    [LM.EYE_R_INNER, rotate(rInner, roll)],
    [LM.EYE_R_OUTER, rotate(rOuter, roll)],
    [LM.EYE_L_INNER, rotate(lInner, roll)],
    [LM.EYE_L_OUTER, rotate(lOuter, roll)],
  ]);
  const g = {
    imagePt: (i: number) => points.get(i)!,
    imageRollDeg: roll,
  } as Geom;
  const measured = measureCanthalTilts(g);
  assert.ok(Math.abs(measured.right - 6) < 0.05, String(measured.right));
  assert.ok(Math.abs(measured.left - 4) < 0.05, String(measured.left));
  assert.ok(Math.abs(measured.average - 5) < 0.05, String(measured.average));
  assert.ok(Math.abs(measured.asymmetry - 2) < 0.05, String(measured.asymmetry));
});

const validSide: SidePoints = {
  trichion: { x: 120, y: 50 },
  glabella: { x: 130, y: 90 },
  nasion: { x: 128, y: 110 },
  pronasale: { x: 180, y: 160 },
  subnasale: { x: 150, y: 190 },
  labialeSuperius: { x: 155, y: 215 },
  labialeInferius: { x: 153, y: 245 },
  pogonion: { x: 160, y: 290 },
  menton: { x: 145, y: 320 },
  gonion: { x: 70, y: 285 },
  condylion: { x: 72, y: 155 },
  cervicale: { x: 90, y: 330 },
  tragion: { x: 65, y: 170 },
};

test("side landmark guard accepts anatomy and blocks obvious missing-point errors", () => {
  assert.deepEqual(sidePointIntegrityIssues(validSide, 240, 360, 1), []);
  assert.match(
    sidePointIntegrityIssues({ ...validSide, tragion: { x: Number.NaN, y: 170 } }, 240, 360, 1)[0],
    /Ear notch is missing/,
  );
  assert.match(
    sidePointIntegrityIssues({ ...validSide, condylion: { x: 72, y: 310 } }, 240, 360, 1)[0],
    /Jaw top/,
  );
});

test("unvalidated profile constructions cannot enter a user score", () => {
  assert.equal(SIDE_METRICS.length, 10);
  for (const metric of SIDE_METRICS) {
    assert.equal(EXPERIMENTAL_SIDE_METRIC_IDS.has(metric.id), false, metric.id);
  }
});

test("the facing is read from the points, not asserted against them", () => {
  // A tester's profile was seeded with every point in the right place but the
  // facing detected backwards. That both blocked Confirm on a good photo and,
  // worse, would have fed an inverted faceDir into analyzeSide — where it
  // multiplies every projection and silently reports the profile the wrong way
  // round. The points are the witness: the nose tip is in front of the ear,
  // which is what "in front" means on a head.
  const facingRight = validSide;
  assert.equal(faceDirFromPoints(facingRight), 1);
  const mirrored = Object.fromEntries(
    Object.entries(facingRight).map(([k, v]) => [k, { x: 240 - v.x, y: v.y }]),
  ) as typeof validSide;
  assert.equal(faceDirFromPoints(mirrored), -1);
  // And both directions pass integrity, since neither is anatomically wrong.
  assert.deepEqual(sidePointIntegrityIssues(facingRight, 240, 360, faceDirFromPoints(facingRight)), []);
  assert.deepEqual(sidePointIntegrityIssues(mirrored, 240, 360, faceDirFromPoints(mirrored)), []);
});

test("a genuinely collapsed profile is still rejected", () => {
  // The replacement check has to keep catching the real failure: nose and ear
  // landing on top of each other, which cannot be measured whichever way the
  // head faces.
  const collapsed = { ...validSide, tragion: { ...validSide.pronasale, x: validSide.pronasale.x + 2 } };
  assert.match(
    sidePointIntegrityIssues(collapsed, 240, 360, faceDirFromPoints(collapsed))[0] ?? "",
    /too close together/,
  );
});
