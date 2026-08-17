import test from "node:test";
import assert from "node:assert/strict";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { brollFor, cropAt, drawProgress, overlayAlpha, overlayVisible, regionCrop } from "./rundownFrame.js";
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

// ---------------------------------------------------------------------------
// The frame has to hold the measurement it is framing.
//
// From a rundown of the cap photograph: the chin-width beat cropped to the chin
// band, the chin-width span runs the whole width of the jaw, and the line left
// the right edge of the frame with its label outside the picture entirely. A
// viewer sees a measurement running off screen, which reads as a broken
// instrument rather than as a badly chosen crop.
// ---------------------------------------------------------------------------
test("a crop is widened to contain the measurement drawn into it", () => {
  // A span as wide as the whole face, in a band whose close-up floor is
  // narrower than that — which is the exact case that shipped broken.
  const wide = { x0: 0.3, y0: 0.66, x1: 0.7, y1: 0.72 };
  const tight = regionCrop(PHOTO, FACE, "chin", ASPECT);
  const held = regionCrop(PHOTO, FACE, "chin", ASPECT, wide);

  assert.ok(held.w > tight.w, `crop not widened: ${tight.w} -> ${held.w}`);
  assert.ok(held.x <= wide.x0 * PHOTO.width, "measurement starts left of the frame");
  assert.ok(
    held.x + held.w >= wide.x1 * PHOTO.width,
    `measurement runs off the right: frame ends ${held.x + held.w}, span ends ${wide.x1 * PHOTO.width}`,
  );
  assert.ok(held.y <= wide.y0 * PHOTO.height && held.y + held.h >= wide.y1 * PHOTO.height);
  // And it must still be a photograph, not the void.
  assert.ok(held.x >= 0 && held.y >= 0);
  assert.ok(held.x + held.w <= PHOTO.width + 1e-6 && held.y + held.h <= PHOTO.height + 1e-6);
});

test("a measurement that already fits does not move the camera", () => {
  // The expansion is per-beat and must cost nothing on the beats that do not
  // need it — widening every crop is the fix that was tried and reverted,
  // because it collapses every band to the same clamped frame.
  const small = { x0: 0.45, y0: 0.7, x1: 0.55, y1: 0.74 };
  const tight = regionCrop(PHOTO, FACE, "chin", ASPECT);
  const held = regionCrop(PHOTO, FACE, "chin", ASPECT, small);
  assert.equal(held.w.toFixed(3), tight.w.toFixed(3));
});

// ---------------------------------------------------------------------------
// Cutaways may never cover a measurement.
//
// This is the entire safety argument for showing other photographs of the same
// person. Every overlay is drawn in the MEASURED photograph's normalized
// landmark space and composited through the same crop rectangle; put that line
// over a different photograph and it lands somewhere arbitrary on a different
// face — a jaw measurement drawn across somebody's forehead, with a number on
// it, in a published video.
//
// So the rule is: a beat that draws geometry shows the photograph the geometry
// came from. Nothing else about this feature matters if that slips.
// ---------------------------------------------------------------------------
test("a cutaway never covers a beat that draws a measurement", () => {
  const beats: Beat[] = [
    { kind: "hook", line: "How attractive is Test?" },
    { kind: "metric", line: "Eyes.", metricId: "canthalTilt", region: "eyes", positive: true },
    { kind: "metric", line: "Jaw.", metricId: "jawCheekRatio", region: "jaw", positive: false },
    { kind: "context", line: "This measures a face and nothing else." },
    { kind: "card", line: "The verdict.", card: { verdict: "V", overall: 7, potential: 8, percentile: 90, rows: [] } },
    { kind: "curve", line: "The curve.", percentile: 90 },
    { kind: "search", line: "truemax.app" },
    { kind: "cta", line: "Who next?" },
  ] as Beat[];
  const timeline = buildTimeline(beats);
  const pool = [{ image: {} as CanvasImageSource }, { image: {} as CanvasImageSource }];

  for (const timed of timeline.beats) {
    const covered = brollFor({ timeline, metrics: new Map(), name: "Test", broll: pool }, timed, timed.start);
    if (timed.beat.metricId) {
      assert.equal(covered, null, `cutaway over a measured beat: ${timed.beat.line}`);
    }
    // The full-frame compositions own their own background too — a photograph
    // behind the curve is the head-shaped smudge the search beat was fixed to
    // stop having.
    if (["card", "curve", "search"].includes(timed.beat.kind)) {
      assert.equal(covered, null, `cutaway behind a ${timed.beat.kind} beat`);
    }
  }
});

test("cutaways do appear, and always in the same places", () => {
  // The restriction is worthless if it silently excludes everything, and a
  // rundown that shuffled its own B-roll between two exports of one scan would
  // be a different video each time — which is the reason this module is pure.
  const beats: Beat[] = [
    { kind: "hook", line: "How attractive is Test?" },
    { kind: "metric", line: "Eyes.", metricId: "canthalTilt", region: "eyes", positive: true },
    { kind: "context", line: "Context." },
    { kind: "cta", line: "Who next?" },
  ] as Beat[];
  const timeline = buildTimeline(beats);
  const a = { image: {} as CanvasImageSource };
  const b = { image: {} as CanvasImageSource };
  const input = { timeline, metrics: new Map(), name: "Test", broll: [a, b] };

  const shown = timeline.beats.map((t) => brollFor(input, t, t.start));
  assert.ok(shown.filter(Boolean).length >= 2, "no cutaway was ever shown");
  // Same input, same output, every time.
  assert.deepEqual(timeline.beats.map((t) => brollFor(input, t, t.start)), shown);
});

test("no cutaways at all changes nothing", () => {
  const beats: Beat[] = [{ kind: "hook", line: "How attractive is Test?" }] as Beat[];
  const timeline = buildTimeline(beats);
  assert.equal(brollFor({ timeline, metrics: new Map(), name: "Test" }, timeline.beats[0], 0), null);
  assert.equal(
    brollFor({ timeline, metrics: new Map(), name: "Test", broll: [] }, timeline.beats[0], 0),
    null,
  );
});

test("a measurement beat cuts away only in its tail, never while the line is up", () => {
  // "No cutaways during the analysis" costs the format its only cuts through
  // the longest stretch of the video. So a measurement beat is split: the line
  // lands early and holds on the measured photograph through the middle of the
  // sentence, then the last third cuts away while the sentence finishes.
  //
  // The invariant is unchanged and is the whole point — at no instant is a
  // cutaway on screen while the overlay for that beat would be drawn.
  const beats: Beat[] = [
    { kind: "hook", line: "How attractive is Test?" },
    {
      kind: "metric",
      line: "A canthal tilt of 6.4 degrees, so the outer corner sits above the inner.",
      metricId: "canthalTilt",
      region: "eyes",
      positive: true,
    },
  ] as Beat[];
  const timeline = buildTimeline(beats);
  const input = { timeline, metrics: new Map(), name: "Test", broll: [{ image: {} as CanvasImageSource }] };
  const beat = timeline.beats[1];

  // The line is drawn at drawAt. At that moment and for a good while after,
  // the measured photograph must still be the thing on screen.
  assert.ok(beat.drawAt !== undefined);
  assert.equal(brollFor(input, beat, beat.drawAt!), null, "cut away while the line was landing");
  assert.equal(brollFor(input, beat, beat.start + beat.duration * 0.5), null, "cut away mid-sentence");

  // And it does eventually cut, or the split bought nothing.
  assert.ok(brollFor(input, beat, beat.start + beat.duration * 0.95), "never cut away at all");

  // The other half of the sweep test, which an always-false overlayVisible
  // would otherwise satisfy trivially: the measurement really is on screen.
  assert.equal(overlayVisible(input, beat, beat.drawAt!), true, "the line is never shown");
  assert.equal(overlayVisible(input, beat, beat.start + beat.duration * 0.5), true);
});

test("the overlay and a cutaway are never both live at one instant", () => {
  // Swept rather than sampled, because the failure this prevents is a single
  // frame of a jaw measurement drawn across a different person's forehead —
  // and one frame is enough to be the thing somebody screenshots.
  const beats: Beat[] = [
    { kind: "metric", line: "Eyes measured here.", metricId: "canthalTilt", region: "eyes", positive: true },
    { kind: "metric", line: "Jaw measured here.", metricId: "jawCheekRatio", region: "jaw", positive: false },
  ] as Beat[];
  const timeline = buildTimeline(beats);
  const input = { timeline, metrics: new Map(), name: "Test", broll: [{ image: {} as CanvasImageSource }] };

  for (const beat of timeline.beats) {
    for (let t = beat.start; t < beat.start + beat.duration; t += 0.02) {
      if (brollFor(input, beat, t) && overlayVisible(input, beat, t)) {
        assert.fail(`overlay and cutaway both live at t=${t.toFixed(2)} on "${beat.beat.line}"`);
      }
    }
  }
});

test("a crop never cuts through the face", () => {
  // The one framing fault a viewer reads as a broken renderer rather than as a
  // choice. A band plus a close-up floor is a guess at how much face there is,
  // and on a photograph where the head fills more of the picture than usual the
  // guess came out tighter than the head — chin off the bottom, crown off the
  // top, mid-sentence.
  //
  // A close-up may still lose the ears and the very top of the hair. It may not
  // lose a feature.
  const box = { x0: 0.3, y0: 0.2, x1: 0.7, y1: 0.8 };
  const faceW = (box.x1 - box.x0) * PHOTO.width;
  const faceH = (box.y1 - box.y0) * PHOTO.height;
  for (const region of ["eyes", "midface", "nose", "lips", "jaw", "chin", "proportions"] as const) {
    const c = regionCrop(PHOTO, FACE, region, ASPECT);
    assert.ok(
      c.w >= faceW * 0.85,
      `${region}: crop ${c.w.toFixed(0)}px against a ${faceW.toFixed(0)}px face`,
    );
    assert.ok(c.h >= faceH * 0.85, `${region}: crop is shorter than the face`);
  }
});

test("the overlay arrives and leaves rather than blinking", () => {
  // drawProgress is how much of the LINE is drawn; overlayAlpha is how opaque
  // it is. They were the same number, so the figure snapped to full the moment
  // it existed and vanished on the frame the beat ended. A measurement that
  // disappears between two frames reads as a glitch.
  const beats: Beat[] = [
    { kind: "metric", line: "Eyes measured here, at some length.", metricId: "canthalTilt", region: "eyes", positive: true },
  ] as Beat[];
  const timeline = buildTimeline(beats);
  const b = timeline.beats[0];

  assert.equal(overlayAlpha(b, b.start), 0, "visible before it is drawn");
  assert.ok(overlayAlpha(b, b.drawAt!) > 0.9, "not solid once drawn");
  // And it dissolves rather than cutting.
  const nearEnd = b.start + b.duration - 0.14;
  assert.ok(overlayAlpha(b, nearEnd) < 0.35, `still ${overlayAlpha(b, nearEnd).toFixed(2)} at the cut`);
  // Monotonic out: no flicker back up on the way down.
  let prev = 1;
  for (let t = b.start + b.duration - 0.6; t < b.start + b.duration; t += 0.02) {
    const a = overlayAlpha(b, t);
    assert.ok(a <= prev + 1e-6, `alpha rose during the fade out at ${t.toFixed(2)}`);
    prev = a;
  }
});
