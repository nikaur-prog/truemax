import test from "node:test";
import assert from "node:assert/strict";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import {
  brollFor,
  cropAt,
  stageChanged,
  stageFor,
  stagePool,
  drawProgress,
  fitFont,
  overlayAlpha,
  overlayVisible,
  toneColour,
  regionCrop,
  rollProgress,
  rollingDigits,
} from "./rundownFrame.js";
import { anglePhases, angleLabelAt, arcRadius, interiorSweep } from "./measureOverlay.js";
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

test("the camera never walks UP the face", () => {
  // The claim the whole format rests on, and the one that was silently false
  // before the ordering fix. Assert the geometry rather than the table.
  //
  // Weakened from strictly-descending to never-ascending, deliberately: the
  // crop now refuses to cut the head (HEAD_FIT = 1), so on a photograph
  // without spare margin two lower bands can clamp to the same frame. Equal
  // is honest — the camera holding still is not a fault. Ascending is: a
  // walk-down that jumps back up reads as a re-cut, and that is the
  // regression this test exists to catch.
  const eyes = centreY(regionCrop(PHOTO, FACE, "eyes", ASPECT));
  const nose = centreY(regionCrop(PHOTO, FACE, "nose", ASPECT));
  const lips = centreY(regionCrop(PHOTO, FACE, "lips", ASPECT));
  const chin = centreY(regionCrop(PHOTO, FACE, "chin", ASPECT));
  assert.ok(eyes <= nose, `eyes ${eyes} below nose ${nose}`);
  assert.ok(nose <= lips, `nose ${nose} below lips ${lips}`);
  assert.ok(lips <= chin, `lips ${lips} below chin ${chin}`);
  // And it still actually descends over the whole walk, or the format is a
  // slideshow again: the top of the face must sit above the bottom.
  assert.ok(eyes < chin, `eyes ${eyes} not above chin ${chin}`);
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

// ---------------------------------------------------------------------------
// Nothing important lands where the app draws its own furniture.
//
// Measured from the published TikTok/Reels safe-zone template on its 1080x1920
// canvas: 270px of chrome at the top, 335 at the bottom, 60 left, 120 right —
// which on this 720x1280 frame is 180 / 223 / 40 / 80. The constants in the
// renderer sit at or outside those, and this pins the two that are easy to
// regress by nudging a layout number.
// ---------------------------------------------------------------------------
test("the safe area is at least what the platforms actually cover", () => {
  // Derived from the template rather than chosen, so a future edit that makes
  // the frame "look better" by reclaiming space fails here rather than in a
  // post nobody can read.
  const H = 1280;
  const W = 720;
  const MEASURED = { top: 180, bottom: 223, left: 40, right: 80 };

  // The caption's lowest possible baseline, and the bottom bar's sub-label,
  // are the two things closest to the bottom edge.
  const captionBaseline = H - 300 - 124;
  const barSub = H - 300 - 40 + 36;
  assert.ok(captionBaseline < H - MEASURED.bottom, "caption sits under the caption block");
  assert.ok(barSub < H - MEASURED.bottom, `bottom bar sub-label at ${barSub} is inside the chrome`);

  // And the right-hand column of the bottom bar clears the action rail.
  assert.ok(W - 132 < W - MEASURED.right, "value column runs into the action rail");
});

// ---------------------------------------------------------------------------
// The verdict has to fit inside the frame it is the conclusion of.
// ---------------------------------------------------------------------------

// A stand-in for a canvas context, wide enough to be honest: a glyph is a fixed
// fraction of the font size, so width is proportional to size AND to length,
// which is the only property fitFont depends on.
const fakeCtx = () => {
  const ctx = {
    font: "",
    measureText(text: string) {
      const px = Number(/(\d+)px/.exec(ctx.font)?.[1] ?? 16);
      return { width: text.length * px * 0.56 } as TextMetrics;
    },
  };
  return ctx as unknown as CanvasRenderingContext2D;
};

test("the verdict is shrunk until it fits the frame", () => {
  // "Looksmaxxing final boss" at a flat 76px ran off both edges of a 720-wide
  // frame and shipped as "ooksmaxxing final bos". Every rung on the ladder goes
  // through here, so the assertion is over all of them rather than the one that
  // was seen to break.
  const ctx = fakeCtx();
  const font = (px: number) => `300 ${px}px Fraunces, Georgia, serif`;
  const maxWidth = 720 - 48 * 2;

  const words = [
    "Mid",
    "Chopped",
    "Mogger",
    "She-mogger",
    "Good looking",
    "Background character",
    "Looksmaxxing final boss",
    "Certified baddie",
    "True Adam",
  ];
  for (const word of words) {
    ctx.font = fitFont(ctx, word, maxWidth, 76, 44, font);
    assert.ok(
      ctx.measureText(word).width <= maxWidth,
      `"${word}" is ${ctx.measureText(word).width.toFixed(0)}px wide in ${ctx.font}`,
    );
  }
});

test("a short verdict is not shrunk at all", () => {
  // Shrink-to-fit that also shrinks what already fits would quietly restyle the
  // whole ladder to the length of its longest rung.
  const ctx = fakeCtx();
  const font = (px: number) => `300 ${px}px Fraunces, Georgia, serif`;
  assert.equal(fitFont(ctx, "Mid", 720 - 96, 76, 44, font), font(76));
});

// ---------------------------------------------------------------------------
// The measurement arrives and is taken away, along the same paths.
// ---------------------------------------------------------------------------

test("the figure retracts rather than fading out", () => {
  // The exit used to be a fade of the whole overlay: every line dimmed in place
  // and was gone. It reads as an overlay being switched off, because that is
  // what it was. Un-drawing it is the same gesture that put it there, played
  // backwards.
  const timeline = buildTimeline([
    { kind: "metric", line: "a canthal tilt of 6.4 degrees, so the eye sits well above the inner", metricId: "canthalTilt" },
    { kind: "cta", line: "Go and get yours." },
  ]);
  const b = timeline.beats[0];

  // Complete on the click, which is the point of the run-up.
  assert.ok(drawProgress(b, b.drawAt!) > 0.999, "not finished when the click lands");
  // Still complete through the middle of the beat.
  assert.ok(drawProgress(b, b.start + b.duration * 0.5) > 0.999, "retracted too early");
  // And gone by the cut.
  assert.equal(drawProgress(b, b.start + b.duration), 0, "still on screen at the boundary");
});

test("the retraction is monotonic and finishes before the cut", () => {
  // A figure that flickers back up mid-retraction reads as a dropped frame, and
  // one still moving when the beat ends puts an animation across a cut — which
  // is the single most obvious way for an edit to look unfinished.
  const timeline = buildTimeline([
    { kind: "metric", line: "a canthal tilt of 6.4 degrees and the eye sits high on the outer corner", metricId: "canthalTilt" },
    { kind: "cta", line: "Go and get yours." },
  ]);
  const b = timeline.beats[0];
  const end = b.start + b.duration;

  let previous = 1;
  for (let t = b.start + b.duration * 0.5; t <= end; t += 0.01) {
    const p = drawProgress(b, t);
    assert.ok(p <= previous + 1e-9, `progress rose during the retraction at ${t.toFixed(2)}`);
    previous = p;
  }
  // Clean frame before the boundary, not mid-animation.
  assert.equal(drawProgress(b, end - 0.05), 0, "still retracting at the cut");
});

test("a measurement is never drawn at a size nobody can see", () => {
  // The alpha's remaining job. The retraction ends at zero length, and a line
  // of two pixels at full opacity popping off is the glitch the fade exists to
  // absorb.
  const timeline = buildTimeline([
    { kind: "metric", line: "a canthal tilt of 6.4 degrees with the outer corner sitting well above", metricId: "canthalTilt" },
    { kind: "cta", line: "Go and get yours." },
  ]);
  const b = timeline.beats[0];
  for (let t = b.start; t < b.start + b.duration; t += 0.01) {
    const p = drawProgress(b, t);
    const a = overlayAlpha(b, t);
    if (p > 0 && p < 0.05) {
      assert.ok(a < 0.75, `a ${(p * 100).toFixed(0)}% line was ${(a * 100).toFixed(0)}% opaque`);
    }
  }
  // And solid whenever there is a real figure to see.
  assert.ok(overlayAlpha(b, b.drawAt!) > 0.99, "not solid once drawn");
});

test("the figure is gone before a cutaway takes the frame", () => {
  // Found by rendering, after the retraction tests above passed.
  //
  // A metric beat hands its last third to a cutaway, and the overlay cannot be
  // drawn over one — the lines live in the measured face's landmark space. The
  // retraction was scheduled against the END of the beat, which put the whole
  // animation inside the cutaway window where nothing is drawn: the lines
  // vanished on the cut and the retraction was invisible on exactly the beats
  // that have one.
  const timeline = buildTimeline([
    { kind: "metric", line: "a canthal tilt of 6.4 degrees, so the outer corner sits above the inner", metricId: "canthalTilt" },
    { kind: "cta", line: "Go and get yours." },
  ]);
  const b = timeline.beats[0];

  // brollFor hands the frame over here. Asserted against the same fraction the
  // renderer uses, so the two cannot drift apart silently.
  const CUTAWAY_TAIL = 0.34;
  const handover = b.start + b.duration * (1 - CUTAWAY_TAIL);
  assert.equal(drawProgress(b, handover), 0, "still drawing when the cutaway arrives");

  // And it was still fully up a moment before it started withdrawing, so the
  // fix did not simply move the whole animation earlier.
  assert.ok(drawProgress(b, handover - 0.6) > 0.999, "retracted far too early");
});

// ---------------------------------------------------------------------------
// The colour grammar.
// ---------------------------------------------------------------------------

// Only the two fields toneColour reads. Building a whole ScoredMetric here
// would assert nothing extra and would break every time the type grows.
const toned = (conformance: number, zEff = 0) =>
  ({ conformance, zEff }) as unknown as Parameters<typeof toneColour>[0];

test("a measurement inside its band is painted as ideal, whatever its rank", () => {
  // The whole point of moving off zEff. A metric can sit dead-centre ideal and
  // still out-rank only half the population, because being near ideal is
  // common — the old rule painted that neutral white.
  assert.equal(toneColour(toned(1, -0.4)), "#8ff3e0");
  assert.equal(toneColour(toned(1, 2.0)), "#8ff3e0");
});

test("nothing renders in the neutral middle any more", () => {
  // 49.3% of the corpus's 627 metrics used to land in a white that carried no
  // verdict, so half of any rundown was visual filler. Every value on either
  // side of the band now says something.
  const ideal = toneColour(toned(1));
  for (const c of [0.999, 0.9, 0.6, 0.3, 0]) {
    assert.notEqual(toneColour(toned(c)), ideal, `conformance ${c} read as ideal`);
    assert.notEqual(toneColour(toned(c)), "#f7f7f2", `conformance ${c} read as neutral`);
  }
});

test("out of band ramps with distance rather than shouting equally", () => {
  // 22.5% of corpus metrics sit just outside their band and 15.6% sit far
  // outside. One flat warning colour for both would misreport which to work on.
  const red = (c: string) => Number(c.match(/\d+/g)![0]);
  const green = (c: string) => Number(c.match(/\d+/g)![1]);
  const near = toneColour(toned(0.95));
  const far = toneColour(toned(0.05));
  assert.ok(green(far) < green(near), "far outside should be the hotter colour");
  assert.ok(red(far) >= red(near) - 1, "the ramp should not cool off with distance");
});

// ---------------------------------------------------------------------------
// The number roll.
// ---------------------------------------------------------------------------

test("a rolled value settles on the truth", () => {
  assert.equal(rollingDigits("134.4°", 1), "134.4°");
  assert.equal(rollingDigits("134.4°", 1.5), "134.4°");
});

test("only the digits move", () => {
  // Punctuation that dances reads as a glitch, not as a readout.
  for (const p of [0, 0.2, 0.5, 0.8, 0.99]) {
    const out = rollingDigits("-12.5%", p);
    assert.equal(out.length, 6);
    assert.equal(out[0], "-");
    assert.equal(out[3], ".");
    assert.equal(out[5], "%");
  }
});

test("leading digits lock before trailing ones", () => {
  // Magnitude readable before precision, the way an odometer settles.
  const final = "134.4°";
  // Four digits, so the first locks a quarter of the way through.
  const late = rollingDigits(final, 0.8);
  assert.equal(late.slice(0, 3), "134", "leading digits should be settled by 0.8");
  const early = rollingDigits(final, 0.05);
  assert.notEqual(early, final, "nothing should be settled this early");
});

test("the roll is deterministic — the same frame renders the same twice", () => {
  // Frames are rendered for export. A Math.random in here would make two runs
  // of the same beat produce different video.
  for (const p of [0.1, 0.33, 0.47, 0.62, 0.9]) {
    assert.equal(rollingDigits("87.6%", p), rollingDigits("87.6%", p));
  }
});

test("the roll steps rather than blurring", () => {
  // At 60fps an unquantised roll is a grey smear that reads as a fault. Across
  // a 0.45s roll there should be a small number of distinct states, not one per
  // frame.
  const seen = new Set<string>();
  for (let f = 0; f <= 27; f++) seen.add(rollingDigits("134.4°", f / 27));
  assert.ok(seen.size > 3, `too static: only ${seen.size} states`);
  assert.ok(seen.size <= 14, `not quantised: ${seen.size} states across the roll`);
});

test("the value never resolves before its own measurement has finished drawing", () => {
  // A number settling while the line that justifies it is still being
  // constructed is this gesture played backwards.
  const timeline = buildTimeline([
    { kind: "metric", line: "a canthal tilt of 6.4 degrees, so the outer corner sits above the inner", metricId: "canthalTilt" },
    { kind: "cta", line: "Go and get yours." },
  ]);
  const b = timeline.beats[0];
  assert.ok(b.drawAt !== undefined);
  assert.equal(rollProgress(b, b.drawAt! - 0.01), 0, "rolling before the line landed");
  assert.equal(rollProgress(b, b.drawAt!), 0);
  assert.ok(rollProgress(b, b.drawAt! + 0.5) >= 1, "still rolling long after the line landed");
});

// ---------------------------------------------------------------------------
// Sequential construction of an angle figure.
// ---------------------------------------------------------------------------

test("an angle draws one leg, then the other, then the arc", () => {
  // Both legs used to share the overall progress and grow together, which draws
  // a finished V rather than an angle being constructed. The second leg
  // arriving against a stationary first is what makes the arc between them read
  // as a measurement being taken.
  const early = anglePhases(0.15);
  assert.ok(early.legA > 0, "first leg should be under way");
  assert.equal(early.legB, 0, "second leg started with the first");
  assert.equal(early.arc, 0, "arc swept before its legs existed");

  const mid = anglePhases(0.6);
  assert.ok(mid.legB > 0, "second leg never started");
  assert.ok(mid.legA > mid.legB, "the legs are drawing in lockstep");
  assert.equal(mid.arc, 0, "arc swept before both legs had landed");

  const late = anglePhases(0.85);
  assert.ok(late.arc > 0, "arc never swept");
});

test("an angle is complete, and only complete, at full progress", () => {
  // The retraction runs drawProgress back down and relies on every partial
  // state being a strict subset of the true figure.
  const done = anglePhases(1);
  assert.equal(done.legA, 1);
  assert.equal(done.legB, 1);
  assert.equal(done.arc, 1);
  const nearly = anglePhases(0.99);
  assert.ok(nearly.arc < 1, "the arc finished before the beat did");
  for (const u of [0, 0.25, 0.5, 0.75, 1]) {
    const p = anglePhases(u);
    for (const v of [p.legA, p.legB, p.arc]) {
      assert.ok(v >= 0 && v <= 1, `phase out of range at u=${u}`);
    }
  }
});

// ---------------------------------------------------------------------------
// The angle's arc and its label.
// ---------------------------------------------------------------------------

test("an angle marks the interior angle, never the reflex one", () => {
  // The old version sorted the two bearings and swept low to high, which is
  // only the interior angle while the pair does not straddle atan2's ±π
  // discontinuity. A gonial angle on one side of the face does straddle it, and
  // there the arc looped around the vertex and out through its own leg.
  const straddles: Array<[number, number]> = [
    [3.0, -3.0],
    [-3.05, 3.05],
    [Math.PI - 0.1, -Math.PI + 0.1],
  ];
  for (const [a1, a2] of straddles) {
    const d = interiorSweep(a1, a2);
    assert.ok(Math.abs(d) <= Math.PI + 1e-9, `reflex sweep for ${a1},${a2}`);
    assert.ok(Math.abs(d) < 0.3, `swept the long way round for ${a1},${a2}`);
  }
  // And it still lands exactly on the second leg in the ordinary case.
  assert.ok(Math.abs(interiorSweep(0, 1.2) - 1.2) < 1e-9);
  assert.ok(Math.abs(interiorSweep(1.2, 0) + 1.2) < 1e-9);
});

test("the arc is scaled to the figure, and bounded at both ends", () => {
  // A flat radius made the arc a hook you had to go looking for on a big
  // figure, and an unbounded one would swallow the face on a bigger one.
  const v = { x: 150, y: 260 };
  const near = arcRadius(v, { x: 130, y: 245 }, { x: 170, y: 245 }, 300);
  const far = arcRadius(v, { x: 40, y: 60 }, { x: 260, y: 60 }, 300);
  assert.ok(far > near, "the arc should grow with the figure");
  assert.ok(near >= 300 * 0.05, "arc collapsed on a small figure");
  assert.ok(far <= 300 * 0.14, "arc swallowed the frame on a large one");
});

test("the value chip sits clear of the arc, outside the figure", () => {
  // It used to be drawn ON the vertex — which is where the arc is — so the one
  // element identifying the figure as an angle was covered by its own number.
  const v = { x: 150, y: 258 };
  const a = { x: 54, y: 102 };
  const b = { x: 246, y: 102 };
  const at = angleLabelAt(v, a, b, 300, 5);
  const r = arcRadius(v, a, b, 300);
  assert.ok(Math.hypot(at.x - v.x, at.y - v.y) > r, "chip lands inside the arc");
  // Legs run upward from the chin, so the chip belongs below it — away from the
  // face, not between the legs where the face is.
  assert.ok(at.y > v.y, "chip placed into the figure rather than away from it");
});

test("a straight line does not produce a NaN label position", () => {
  const at = angleLabelAt({ x: 100, y: 100 }, { x: 0, y: 100 }, { x: 200, y: 100 }, 300, 5);
  assert.ok(Number.isFinite(at.x) && Number.isFinite(at.y));
});

// ---------------------------------------------------------------------------
// The stage system: photo-first pacing.
//
// When attached photographs carry their own landmarks, they stop being
// decoration and become stages: measurement beats are dealt out in pairs
// across the primary and every landmarked cutaway in turn, and the whole
// analysis — crop, line, retraction — plays on whichever photograph holds
// the stage. These tests pin the dealing order, its determinism, and the
// rule that the old tail-flash cutaway stands down when stages are active.
// ---------------------------------------------------------------------------
const STAGE_BEATS: Beat[] = [
  { kind: "hook", line: "How attractive is Test?" },
  { kind: "metric", line: "One.", metricId: "m1", region: "eyes", positive: true },
  { kind: "metric", line: "Two.", metricId: "m2", region: "eyes", positive: true },
  { kind: "metric", line: "Three.", metricId: "m3", region: "jaw", positive: true },
  { kind: "metric", line: "Four.", metricId: "m4", region: "jaw", positive: false },
  { kind: "metric", line: "Five.", metricId: "m5", region: "lips", positive: true },
  { kind: "metric", line: "Six.", metricId: "m6", region: "lips", positive: false },
  { kind: "cta", line: "Who next?" },
] as Beat[];

test("stages deal measurement beats out in pairs across every landmarked photo", () => {
  const timeline = buildTimeline(STAGE_BEATS);
  const staged = { image: {} as CanvasImageSource, landmarks: FACE };
  const bare = { image: {} as CanvasImageSource };
  const input = { timeline, metrics: new Map(), name: "Test", broll: [staged, bare] };

  assert.equal(stagePool(input).length, 1, "only the landmarked photo can hold a stage");
  const stages = timeline.beats.map((b) => stageFor(input, b));
  // Hook plays on the primary; metric pairs alternate primary, cutaway,
  // primary… with one landmarked cutaway in the pool.
  assert.equal(stages[0], null);
  assert.equal(stages[1], null);
  assert.equal(stages[2], null);
  assert.equal(stages[3], staged);
  assert.equal(stages[4], staged);
  assert.equal(stages[5], null);
  assert.equal(stages[6], null);
  assert.equal(stages[7], null, "the sign-off always plays on the primary");
  // Deterministic: the same input deals the same stages every render.
  assert.deepEqual(timeline.beats.map((b) => stageFor(input, b)), stages);
});

test("stageChanged marks exactly the boundaries where the photograph changes", () => {
  const timeline = buildTimeline(STAGE_BEATS);
  const staged = { image: {} as CanvasImageSource, landmarks: FACE };
  const input = { timeline, metrics: new Map(), name: "Test", broll: [staged] };
  const changes = timeline.beats.map((b) => stageChanged(input, b));
  assert.deepEqual(changes, [false, false, false, true, false, true, false, false]);
});

test("the tail-flash cutaway stands down while stages are active", () => {
  const timeline = buildTimeline(STAGE_BEATS);
  const staged = { image: {} as CanvasImageSource, landmarks: FACE };
  const input = { timeline, metrics: new Map(), name: "Test", broll: [staged] };
  for (const b of timeline.beats) {
    if (b.beat.kind !== "metric") continue;
    // At every instant of a metric beat, including the old cutaway tail.
    for (const f of [0.05, 0.5, 0.9]) {
      assert.equal(brollFor(input, b, b.start + b.duration * f), null);
    }
  }
  // And with no landmarked photo in the pool, the old behaviour stands: the
  // tail of a metric beat still cuts away.
  const bare = { timeline, metrics: new Map(), name: "Test", broll: [{ image: {} as CanvasImageSource }] };
  const metric = timeline.beats.find((b) => b.beat.kind === "metric")!;
  assert.notEqual(brollFor(bare, metric, metric.start + metric.duration * 0.9), null);
});
