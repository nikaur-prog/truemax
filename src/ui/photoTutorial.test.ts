import test from "node:test";
import assert from "node:assert/strict";
import { tutorialSteps } from "./photoTutorial.js";
import type { TutorialView } from "./photoTutorial.js";

const VIEWS: TutorialView[] = ["front", "side"];

test("every view shows the mistakes first and the right way last", () => {
  // The order is the teaching. "Don't stand under a downlight" means nothing
  // until you have seen the half-shadowed face it produces, so a reordering
  // that floats the correct frame to the top quietly undoes the tutorial.
  for (const view of VIEWS) {
    const steps = tutorialSteps(view);
    assert.ok(steps.length >= 3, `${view} needs enough mistakes to be worth watching`);
    const dos = steps.filter((s) => s.kind === "do");
    assert.equal(dos.length, 1, `${view} must land on exactly one correct frame`);
    assert.equal(steps[steps.length - 1].kind, "do", `${view} must END on the correct frame`);
    for (const step of steps.slice(0, -1)) {
      assert.equal(step.kind, "dont", `${view} must not interleave a correct frame`);
    }
  }
});

test("every step names its own asset and carries its own words", () => {
  const seen = new Set<string>();
  for (const view of VIEWS) {
    for (const step of tutorialSteps(view)) {
      assert.match(step.src, /^\/tutorial\/[a-z-]+\.jpg$/, `${step.src} is not a tutorial asset`);
      assert.ok(!seen.has(step.src), `${step.src} is used twice`);
      seen.add(step.src);
      assert.ok(step.title.length > 0 && step.title.length < 40, `bad title: ${step.title}`);
      // The caption has to survive the picture being missing, so it must say
      // what to do rather than just point at the image.
      assert.ok(step.caption.length > 40, `caption too thin to stand alone: ${step.caption}`);
    }
  }
});

test("the front and side tutorials are different tutorials", () => {
  const front = tutorialSteps("front").map((s) => s.src);
  const side = tutorialSteps("side").map((s) => s.src);
  assert.ok(front.every((s) => s.includes("front")));
  assert.ok(side.every((s) => s.includes("side")));
});

test("a step with motion declares a coherent timeline", () => {
  // The cue and the shutter are driven off the clip's own currentTime, so
  // their numbers are claims about the footage. A cue that ends after the
  // clip, or a shutter that fires during the turn, animates against what the
  // person is actually watching.
  const CLIP_SECONDS = 5; // every tutorial clip is generated at five seconds
  for (const view of VIEWS) {
    for (const step of tutorialSteps(view)) {
      if (!step.video) {
        assert.equal(step.cue, undefined, "a cue without a clip has nothing to track");
        assert.equal(step.flash, undefined, "a shutter without a clip has nothing to fire on");
        continue;
      }
      assert.match(step.video, /^\/tutorial\/[a-z-]+\.mp4$/, `${step.video} is not a tutorial clip`);
      if (step.cue) {
        assert.ok(step.cue.start >= 0, "the cue cannot start before the clip");
        assert.ok(step.cue.end > step.cue.start, "the cue must move forwards");
        assert.ok(step.cue.end <= CLIP_SECONDS, "the cue cannot outlast the clip");
      }
      if (step.flash) {
        assert.ok(step.flash.at > 0 && step.flash.at <= CLIP_SECONDS, "the shutter must fire inside the clip");
        if (step.cue) {
          assert.ok(step.flash.at >= step.cue.end, "the shutter fires after the turn, not during it");
        }
        // The burst is centred on the handset, so an off-frame centre would
        // put the light source outside the picture it is supposed to come from.
        assert.ok(step.flash.x > 0 && step.flash.x < 1, `flash x ${step.flash.x} is outside the frame`);
        assert.ok(step.flash.y > 0 && step.flash.y < 1, `flash y ${step.flash.y} is outside the frame`);
      }
    }
  }
});

test("the clip lands on the step that teaches the turn", () => {
  // Motion belongs on the one step a still cannot teach, and nowhere else.
  const withVideo = VIEWS.flatMap((v) => tutorialSteps(v).filter((s) => s.video));
  assert.equal(withVideo.length, 1, "exactly one step should carry a clip");
  assert.equal(withVideo[0].kind, "do", "the clip shows the correct capture, not a mistake");
  const side = tutorialSteps("side");
  assert.equal(side[side.length - 1].video, withVideo[0].video, "and it is the side tutorial's last step");
});
