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
