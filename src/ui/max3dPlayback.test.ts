import test from "node:test";
import assert from "node:assert/strict";
import { AnimationClip, AnimationMixer, NumberKeyframeTrack, Object3D } from "three";
import { createMax3DPlayback } from "./max3dPlayback.js";
import { MAX_3D_STATES } from "./max3dSchedule.js";

function fixture() {
  const object = new Object3D();
  const mixer = new AnimationMixer(object);
  const actions = new Map(MAX_3D_STATES.map((name, index) => [name, mixer.clipAction(new AnimationClip(name, 1, [
    new NumberKeyframeTrack(".position[x]", [0, 0.5, 1], [0, index + 1, 0]),
  ]))]));
  const playback = createMax3DPlayback(actions);
  const step = (seconds: number): void => { mixer.update(seconds); playback.advance(seconds); };
  return { mixer, actions, playback, step };
}

test("rapid state transitions enable at most two actions and retire every completed fade", () => {
  const { mixer, actions, playback, step } = fixture();
  for (let cycle = 0; cycle < 5; cycle++) for (const state of MAX_3D_STATES) {
    playback.select(state);
    step(0.04);
    assert.ok(mixer.stats.actions.inUse <= 2, `${state}: no accumulated fades`);
    const weight = [...actions.values()].filter((action) => action.isScheduled()).reduce((sum, action) => sum + action.getEffectiveWeight(), 0);
    assert.ok(Math.abs(weight - 1) < 0.000001, `${state}: weights sum to ${weight}`);
  }
  step(0.3);
  assert.equal(mixer.stats.actions.inUse, 1);
  assert.equal(playback.transitioning(), false);
  playback.stop();
  assert.equal(mixer.stats.actions.inUse, 0);
});

test("clamped one-shots never trap later gestures and same-state requests can restart", () => {
  const { mixer, actions, playback, step } = fixture();
  playback.select("celebrate"); step(1);
  assert.equal(playback.finished(), "celebrate");
  assert.equal(actions.get("celebrate")!.paused, true);
  playback.select("listening"); step(0.3);
  assert.equal(playback.finished(), null);
  assert.equal(mixer.stats.actions.inUse, 1);
  playback.select("celebrate");
  assert.equal(actions.get("celebrate")!.paused, false);
  assert.equal(actions.get("celebrate")!.time, 0);
  step(0.5); playback.select("celebrate", true);
  assert.equal(actions.get("celebrate")!.time, 0);
  step(0.3);
  assert.equal(mixer.stats.actions.inUse, 1);
  playback.stop();
});

test("quiet settles after visible blend duration, with no wall-clock wait", () => {
  const { playback, step } = fixture();
  playback.select("speaking"); step(0.1);
  playback.select("quiet");
  assert.equal(playback.transitioning(), true);
  step(0.14); assert.equal(playback.transitioning(), true);
  step(0); assert.equal(playback.transitioning(), true, "pausing does not consume the blend");
  step(0.15); assert.equal(playback.transitioning(), false);
  assert.equal(playback.finished(), null);
  playback.stop();
});
