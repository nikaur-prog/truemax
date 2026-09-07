import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMax3DSchedule, createMaxSpeechOverlay, MAX_3D_STATES, normalizeMaxSpeechLevel, smoothMaxSpeechLevel } from "./max3dSchedule.js";

test("visible idle waits vary between five and ten seconds, with nonrepeating five-second routines", () => {
  const schedule = createMax3DSchedule();
  const seen: string[] = [];
  for (let cycle = 0; cycle < 9; cycle++) {
    let waited = 0;
    while (!schedule.automatic() && waited <= 10) { schedule.advance(1); waited++; }
    assert.ok(waited >= 5 && waited <= 10);
    const routine = schedule.state();
    assert.ok(["mirror", "skate", "guitar"].includes(routine));
    assert.notEqual(routine, seen[seen.length - 1]);
    seen.push(routine);
    assert.equal(schedule.advance(4.99), routine);
    assert.equal(schedule.advance(0.02), "idle");
    assert.equal(schedule.automatic(), false);
  }
  assert.deepEqual([...new Set(seen)], ["mirror", "skate", "guitar"]);
});

test("thinking returns to thinking, while every explicit state immediately interrupts a routine", () => {
  for (const state of MAX_3D_STATES) {
    const schedule = createMax3DSchedule("thinking");
    assert.equal(schedule.advance(6), "mirror");
    schedule.setState(state);
    assert.equal(schedule.state(), state);
    assert.equal(schedule.automatic(), false);
    // A stale action completion cannot replace an explicit request.
    if (state !== "mirror") assert.equal(schedule.finish("mirror"), state);
  }
  const thinking = createMax3DSchedule("thinking");
  thinking.advance(6); assert.equal(thinking.advance(5), "thinking");
  thinking.setState("wave"); assert.equal(thinking.finish("wave"), "thinking");
});

test("listening, speaking and quiet never schedule playful interruptions; disabling is immediate", () => {
  for (const state of ["listening", "speaking", "quiet"] as const) {
    const schedule = createMax3DSchedule(state);
    assert.equal(schedule.advance(3_600), state);
  }
  const schedule = createMax3DSchedule("idle", false);
  assert.equal(schedule.advance(100), "idle");
  schedule.setPlayfulEnabled(true); assert.equal(schedule.advance(6), "mirror");
  schedule.setPlayfulEnabled(false); assert.equal(schedule.state(), "idle");
  assert.equal(schedule.advance(100), "idle");
  schedule.setState("guitar"); schedule.setPlayfulEnabled(true); schedule.setPlayfulEnabled(false);
  assert.equal(schedule.state(), "guitar", "the toggle does not erase an explicit showcase clip");
});

test("no clock or timer advances hidden routines; zero or invalid deltas leave progress untouched", () => {
  const schedule = createMax3DSchedule();
  schedule.advance(5);
  for (const value of [0, -1, NaN, Infinity]) assert.equal(schedule.advance(value), "idle");
  assert.equal(schedule.advance(1), "mirror");
  const source = readFileSync(new URL("./max3dSchedule.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /setTimeout|setInterval|Date\.now|performance\.now/);
});

test("speech input is bounded, smooth, frame-rate independent and null selects authored motion", () => {
  assert.equal(normalizeMaxSpeechLevel(null), null);
  assert.equal(normalizeMaxSpeechLevel(NaN), null);
  assert.equal(normalizeMaxSpeechLevel(Infinity), null);
  assert.equal(normalizeMaxSpeechLevel(-2), 0);
  assert.equal(normalizeMaxSpeechLevel(5), 1);
  let thirty = 0, sixty = 0;
  for (let i = 0; i < 30; i++) thirty = smoothMaxSpeechLevel(thirty, 1, 1 / 30);
  for (let i = 0; i < 60; i++) sixty = smoothMaxSpeechLevel(sixty, 1, 1 / 60);
  assert.ok(thirty > 0.99 && thirty <= 1);
  assert.ok(Math.abs(thirty - sixty) < 0.000001);
  assert.equal(smoothMaxSpeechLevel(0.4, 1, 0), 0.4);
  assert.equal(smoothMaxSpeechLevel(0.4, 1, NaN), 0.4);
  assert.ok(smoothMaxSpeechLevel(1, 0, 1 / 30) < 1);
});

test("speech overlay restores authored geometry when null, quiet or a new clip takes over", () => {
  class Scale {
    constructor(public x: number, public y: number, public z: number) {}
    set(x: number, y: number, z: number): void { this.x = x; this.y = y; this.z = z; }
    values(): number[] { return [this.x, this.y, this.z]; }
  }
  const open = new Scale(0.9, 0.4, 1), smile = new Scale(0, 0, 0);
  const overlay = createMaxSpeechOverlay(open, smile);
  overlay.apply(1, true, 0.1);
  assert.ok(open.y > 0.4);
  overlay.restore(); overlay.apply(null, true, 0.1);
  assert.deepEqual(open.values(), [0.9, 0.4, 1]);
  assert.deepEqual(smile.values(), [0, 0, 0]);
  // A quiet clip authors a visibly relaxed smile. External levels cannot erase it.
  open.set(0, 0, 0); smile.set(1, 0.7, 1);
  overlay.apply(1, false, 0.1);
  assert.deepEqual(smile.values(), [1, 0.7, 1]);
  assert.deepEqual(open.values(), [0, 0, 0]);
});
