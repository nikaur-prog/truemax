import assert from "node:assert/strict";
import test from "node:test";
import { releaseThinkingPose } from "./maxCharacter.js";

test("the thinking pose resolves to the happy idle face", async () => {
  const classes = new Set(["mx-svg", "mx-mood-thinking"]);
  const svg = {
    isConnected: true,
    classList: {
      contains: (name: string) => classes.has(name),
      remove: (...names: string[]) => names.forEach((name) => classes.delete(name)),
      add: (...names: string[]) => names.forEach((name) => classes.add(name)),
    },
  } as unknown as SVGSVGElement;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { setTimeout },
  });
  try {
    releaseThinkingPose(svg, 0);
    await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(classes.has("mx-mood-thinking"), false);
    assert.equal(classes.has("mx-mood-happy"), true);
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("a non-thinking pose is left alone", () => {
  const svg = {
    isConnected: true,
    classList: {
      contains: (name: string) => name === "mx-mood-excited",
      remove: () => assert.fail("should not remove a settled mood"),
      add: () => assert.fail("should not add a settled mood"),
    },
  } as unknown as SVGSVGElement;
  assert.equal(releaseThinkingPose(svg, 0), null);
});
