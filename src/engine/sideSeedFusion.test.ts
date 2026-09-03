import test from "node:test";
import assert from "node:assert/strict";
import { SIDE_POINTS } from "./sideMetrics.js";
import type { SidePointId, SidePoints } from "./sideMetrics.js";
import {
  BACK_SIDE_POINT_IDS,
  CONFIDENCE_BAND_LABEL,
  DEFAULT_SEED_FUSION_POLICY,
  FRONT_SIDE_POINT_IDS,
  fuseSideSeeds,
  headWidth,
} from "./sideSeedFusion.js";

// A right-facing profile in a 640 by 850 frame; head width about 210 px.
function device(): SidePoints {
  return {
    trichion: { x: 270, y: 150 },
    glabella: { x: 300, y: 255 },
    nasion: { x: 295, y: 290 },
    pronasale: { x: 350, y: 380 },
    subnasale: { x: 320, y: 415 },
    labialeSuperius: { x: 325, y: 450 },
    labialeInferius: { x: 320, y: 485 },
    pogonion: { x: 312, y: 535 },
    menton: { x: 288, y: 570 },
    cervicale: { x: 225, y: 595 },
    gonion: { x: 180, y: 530 },
    condylion: { x: 150, y: 375 },
    tragion: { x: 140, y: 375 },
  };
}
const shifted = (base: SidePoints, moves: Partial<Record<SidePointId, { dx: number; dy: number }>>): SidePoints => {
  const out = { ...base };
  for (const [id, m] of Object.entries(moves) as Array<[SidePointId, { dx: number; dy: number }]>) {
    out[id] = { x: base[id].x + m.dx, y: base[id].y + m.dy };
  }
  return out;
};

test("the split is the thirteen points, five behind the face", () => {
  assert.equal(BACK_SIDE_POINT_IDS.length, 5);
  assert.equal(FRONT_SIDE_POINT_IDS.length + BACK_SIDE_POINT_IDS.length, SIDE_POINTS.length);
  assert.ok(headWidth(device()) > 200);
});

test("without a cloud reading the device seed comes back untouched, front high, back mid", () => {
  const fused = fuseSideSeeds(device(), null);
  assert.deepEqual(fused.points, device());
  assert.equal(fused.secondOpinion, false);
  for (const id of FRONT_SIDE_POINT_IDS) assert.equal(fused.band[id], "high", id);
  for (const id of BACK_SIDE_POINT_IDS) assert.equal(fused.band[id], "mid", id);
  assert.equal(fused.overall, "mid");
  assert.equal(fused.agreement.gonion, null);
});

test("two readers on the same pixels: every point high, the ear pair averaged", () => {
  const d = device();
  const c = shifted(d, { tragion: { dx: 6, dy: -4 }, condylion: { dx: 4, dy: 4 }, gonion: { dx: 5, dy: 5 } });
  const fused = fuseSideSeeds(d, c);
  assert.equal(fused.secondOpinion, true);
  assert.equal(fused.overall, "high");
  assert.equal(fused.source.tragion, "blend");
  assert.equal(fused.points.tragion.x, d.tragion.x + 3);
  assert.equal(fused.points.tragion.y, d.tragion.y - 2);
  assert.equal(fused.source.gonion, "device");
  assert.deepEqual(fused.points.gonion, d.gonion);
  assert.ok((fused.agreement.tragion ?? 1) < 0.04);
});

test("a jaw corner a third of a head apart keeps the device point and reads low", () => {
  const d = device();
  const unit = headWidth(d);
  const c = shifted(d, { gonion: { dx: -0.2 * unit, dy: -0.28 * unit } });
  const fused = fuseSideSeeds(d, c);
  assert.deepEqual(fused.points.gonion, d.gonion);
  assert.equal(fused.source.gonion, "device");
  assert.equal(fused.band.gonion, "low");
  assert.equal(fused.overall, "low");
  // The other back points are untouched by that one disagreement.
  assert.equal(fused.band.tragion, "high");
});

test("an ear notch the readers disagree on is not averaged", () => {
  const d = device();
  const unit = headWidth(d);
  const c = shifted(d, { tragion: { dx: 0.25 * unit, dy: 0 } });
  const fused = fuseSideSeeds(d, c);
  assert.equal(fused.source.tragion, "device");
  assert.equal(fused.band.tragion, "low");
});

test("a moderate disagreement is mid, and the model's own doubt caps a blended point at mid", () => {
  const d = device();
  const unit = headWidth(d);
  const c = shifted(d, { menton: { dx: 0, dy: 0.1 * unit }, condylion: { dx: 0.02 * unit, dy: 0 } });
  const plain = fuseSideSeeds(d, c);
  assert.equal(plain.band.menton, "mid");
  assert.equal(plain.band.condylion, "high");
  const doubted = fuseSideSeeds(d, c, { condylion: 0.2 });
  assert.equal(doubted.band.condylion, "mid");
  // Doubt about a point the device supplied changes nothing: the model's
  // opinion of its own reading is irrelevant to a reading not being used.
  const doubtedDevice = fuseSideSeeds(d, c, { menton: 0.1 });
  assert.equal(doubtedDevice.band.menton, "mid");
});

test("a policy that prefers the cloud on a point takes the cloud point when they disagree", () => {
  const d = device();
  const unit = headWidth(d);
  const c = shifted(d, { tragion: { dx: 0.25 * unit, dy: 0 } });
  const policy = { ...DEFAULT_SEED_FUSION_POLICY, prefer: { ...DEFAULT_SEED_FUSION_POLICY.prefer, tragion: "cloud" as const } };
  const fused = fuseSideSeeds(d, c, undefined, policy);
  assert.deepEqual(fused.points.tragion, c.tragion);
  assert.equal(fused.source.tragion, "cloud");
});

test("a degenerate device seed falls back to the cloud's head width, and to no fusion when both are degenerate", () => {
  const d = device();
  d.tragion = { ...d.pronasale };
  const c = device();
  const fused = fuseSideSeeds(d, c);
  assert.equal(fused.secondOpinion, true);
  assert.ok(fused.unit > 200);
  const flat = fuseSideSeeds(d, { ...c, tragion: { ...c.pronasale } });
  assert.equal(flat.secondOpinion, false);
  assert.deepEqual(flat.points, d);
});

test("the labels are plain readings, no em dash, no compliment", () => {
  for (const label of Object.values(CONFIDENCE_BAND_LABEL)) {
    assert.doesNotMatch(label, /—/);
    assert.match(label, /confidence$/);
  }
});
