import test from "node:test";
import assert from "node:assert/strict";

import { scrimStops } from "./rundownFrame.js";

// The dimming gradient, tested as a decision rather than eyeballed in a render.
//
// It exists to make ONE measurement stand out of a photograph. Every frame that
// draws no measurement was getting it anyway, and on the card that meant .72
// black over the crown of the face in the one frame the viewer is meant to read
// rather than watch.

const alphaAt = (stops: Array<[number, string]>, at: number): number => {
  const hit = stops.find(([position]) => position === at);
  assert.ok(hit, `expected a stop at ${at}`);
  const alpha = /rgba\([^)]*,\s*([\d.]+)\)/.exec(hit![1]);
  assert.ok(alpha, `expected an alpha in ${hit![1]}`);
  return Number(alpha![1]);
};

test("the card gets no scrim at all", () => {
  // The reported bug: the face in the card's top band came back dimmed for no
  // reason a viewer could see. The card draws no measurement, so there is
  // nothing for a scrim to separate it from.
  assert.deepEqual(scrimStops("card", false, false), []);
});

test("the card gets no scrim under any other flag either", () => {
  // Not conditional on how the beat was reached. A card is a card.
  for (const matted of [true, false]) {
    for (const cutaway of [true, false]) {
      assert.deepEqual(scrimStops("card", matted, cutaway), [], `matted=${matted} cutaway=${cutaway}`);
    }
  }
});

test("a faint scrim on the card would be the same bug quieter", () => {
  // Guards against the tempting half-fix: turning the gradient down instead of
  // off. Empty is the assertion, not "lighter than it was".
  assert.equal(scrimStops("card", false, false).length, 0);
});

test("a measured frame still gets its scrim", () => {
  // The fix must not have disarmed the thing everywhere. A plain metric beat is
  // exactly what the scrim was built for.
  const stops = scrimStops("metric", false, false);
  assert.ok(stops.length > 0);
  assert.ok(alphaAt(stops, 0) > 0.5, "the top band still holds the caption");
  assert.ok(alphaAt(stops, 1) > 0.5, "and the bottom still holds the bar");
});

test("a matted frame is dimmed least across the face", () => {
  // The ground is already dark, so the scrim's only remaining job is holding
  // the caption and the bar. Anything more is dimming a face twice.
  const matted = scrimStops("metric", true, false);
  const plain = scrimStops("metric", false, false);
  assert.ok(alphaAt(matted, 0.34) < alphaAt(plain, 0.34));
  assert.ok(alphaAt(matted, 0.68) < alphaAt(plain, 0.68));
});

test("a cutaway sits between the matted and the plain frame", () => {
  // It has no measurement to stand out of, so the full dim just produces a dull
  // frame at the moment the video is meant to feel like it has more than one
  // shot in it.
  const cutaway = scrimStops("metric", false, true);
  const plain = scrimStops("metric", false, false);
  assert.ok(alphaAt(cutaway, 0.34) < alphaAt(plain, 0.34));
  assert.ok(alphaAt(cutaway, 0.68) < alphaAt(plain, 0.68));
});

test("every scrim that exists runs the full height", () => {
  // A gradient that stops short of the frame leaves a visible seam.
  for (const [kind, matted, cutaway] of [
    ["metric", false, false],
    ["metric", true, false],
    ["metric", false, true],
    ["curve", false, false],
    ["search", false, false],
  ] as Array<[string, boolean, boolean]>) {
    const stops = scrimStops(kind, matted, cutaway);
    assert.equal(stops[0][0], 0, `${kind} must start at the top`);
    assert.equal(stops[stops.length - 1][0], 1, `${kind} must reach the bottom`);
  }
});
