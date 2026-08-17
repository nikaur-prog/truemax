import test from "node:test";
import assert from "node:assert/strict";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { cropAt, drawProgress, regionCrop } from "./rundownFrame.js";
import { buildTimeline } from "../engine/rundownTimeline.js";
import type { Beat } from "../engine/reelScript.js";

// A face occupying the middle half of a 1000x1000 photograph. Only the bounding
// box matters to the crop maths, so four corners are a sufficient face.
const FACE: NormalizedLandmark[] = [
  { x: 0.3, y: 0.2, z: 0 },
  { x: 0.7, y: 0.2, z: 0 },
  { x: 0.3, y: 0.8, z: 0 },
  { x: 0.7, y: 0.8, z: 0 },
] as NormalizedLandmark[];

const PHOTO = { width: 1000, height: 1000 };
const ASPECT = 720 / 1280;

const centreY = (c: { y: number; h: number }) => c.y + c.h / 2;

test("the camera walks DOWN the face", () => {
  // The claim the whole format rests on, and the one that was silently false
  // before the ordering fix. Assert the geometry rather than the table.
  const eyes = centreY(regionCrop(PHOTO, FACE, "eyes", ASPECT));
  const nose = centreY(regionCrop(PHOTO, FACE, "nose", ASPECT));
  const lips = centreY(regionCrop(PHOTO, FACE, "lips", ASPECT));
  const chin = centreY(regionCrop(PHOTO, FACE, "chin", ASPECT));
  assert.ok(eyes < nose, `eyes ${eyes} not above nose ${nose}`);
  assert.ok(nose < lips, `nose ${nose} not above lips ${lips}`);
  assert.ok(lips < chin, `lips ${lips} not above chin ${chin}`);
});

test("a crop never leaves the photograph", () => {
  // Cropping past the edge draws the transparent void, which on a dark frame
  // looks like a rendering bug and on a light one looks like a mistake.
  for (const region of ["eyes", "midface", "nose", "lips", "jaw", "chin", "proportions", "symmetry"] as const) {
    const c = regionCrop(PHOTO, FACE, region, ASPECT);
    assert.ok(c.x >= 0 && c.y >= 0, `${region} crop starts outside the photo`);
    assert.ok(c.x + c.w <= PHOTO.width + 1e-6, `${region} crop runs off the right`);
    assert.ok(c.y + c.h <= PHOTO.height + 1e-6, `${region} crop runs off the bottom`);
    assert.ok(c.w > 0 && c.h > 0, `${region} crop is empty`);
  }
});

test("every crop holds the output aspect", () => {
  // A crop of the wrong aspect stretches the face. On a product that measures
  // facial proportions, distorting them in the export is the worst possible bug.
  for (const region of ["eyes", "jaw", "proportions"] as const) {
    const c = regionCrop(PHOTO, FACE, region, ASPECT);
    assert.ok(Math.abs(c.w / c.h - ASPECT) < 1e-6, `${region} aspect is ${c.w / c.h}`);
  }
});

test("a whole-face measurement is not cropped in on", () => {
  // Zooming to a band and then drawing a line to a point outside it would be
  // worse than not cropping at all.
  const whole = regionCrop(PHOTO, FACE, "proportions", ASPECT);
  const tight = regionCrop(PHOTO, FACE, "eyes", ASPECT);
  assert.ok(whole.h > tight.h, "proportions should frame wider than eyes");
});

const BEATS: Beat[] = [
  { kind: "metric", line: "The eyes are good enough to talk about.", metricId: "a", region: "eyes" },
  { kind: "metric", line: "The chin is good enough to talk about.", metricId: "b", region: "chin" },
];

test("the crop moves during the gap rather than cutting", () => {
  // Fourteen hard cuts in a minute is a slideshow — the failure the running
  // order was fixed to avoid, reintroduced at the camera instead of the script.
  const timeline = buildTimeline(BEATS);
  const first = timeline.beats[0];
  const settled = cropAt(PHOTO, FACE, timeline, first.start + 0.05, ASPECT);
  const moving = cropAt(PHOTO, FACE, timeline, first.start + first.duration - 0.2, ASPECT);
  const arrived = cropAt(PHOTO, FACE, timeline, timeline.beats[1].start + 0.05, ASPECT);

  assert.ok(centreY(moving) > centreY(settled), "crop had not begun moving before the beat ended");
  assert.ok(centreY(moving) < centreY(arrived), "crop jumped straight to the destination");
});

test("the crop is settled when a beat starts speaking", () => {
  // Moving while the sentence is being said means the viewer is reading a
  // caption on a moving frame.
  const timeline = buildTimeline(BEATS);
  const second = timeline.beats[1];
  const atStart = centreY(cropAt(PHOTO, FACE, timeline, second.start + 0.01, ASPECT));
  const later = centreY(cropAt(PHOTO, FACE, timeline, second.start + 0.3, ASPECT));
  assert.ok(Math.abs(atStart - later) < 1e-6, "crop was still moving after the beat began");
});

test("the measurement finishes drawing exactly on the click", () => {
  // The click is the sound of the measurement landing, so a figure still
  // growing when it fires is a sound effect for nothing.
  const timeline = buildTimeline(BEATS);
  const beat = timeline.beats[0];
  assert.equal(drawProgress(beat, beat.drawAt!), 1);
  assert.ok(drawProgress(beat, beat.drawAt! - 0.25) < 1);
  assert.equal(drawProgress(beat, beat.start), 0);
});

test("beats that measure nothing draw nothing", () => {
  const timeline = buildTimeline([{ kind: "hook", line: "How attractive is LeBron James?" }]);
  assert.equal(drawProgress(timeline.beats[0], 0.5), 0);
});
