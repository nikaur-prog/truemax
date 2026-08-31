import test from "node:test";
import assert from "node:assert/strict";
import { requestedActionPlan } from "./maxActionBridge.js";

test("a real request for actions offers the vetted TrueMax plan", () => {
  for (const question of [
    "What should I do? Make a plan for me?",
    "Build me a routine around this",
    "Turn that into a plan",
    "Yes, do that.",
  ]) {
    assert.equal(requestedActionPlan(question), true, question);
  }
});

test("the Max subscription and ordinary questions are not mistaken for habit requests", () => {
  for (const question of [
    "How much is the Max plan?",
    "Why is my jaw reading low?",
    "What can I actually change?",
    "Is this my current plan price?",
  ]) {
    assert.equal(requestedActionPlan(question), false, question);
  }
});

test("empty and runaway input do not create an action route", () => {
  assert.equal(requestedActionPlan("   "), false);
  assert.equal(requestedActionPlan("x".repeat(800) + " make me a plan"), false);
});
