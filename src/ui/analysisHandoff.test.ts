import test from "node:test";
import assert from "node:assert/strict";
import { beginAnalysisHandoff } from "./analysisHandoff.js";

class Classes {
  private readonly values = new Set<string>();
  constructor(...initial: string[]) { initial.forEach((v) => this.values.add(v)); }
  add(value: string): void { this.values.add(value); }
  remove(value: string): void { this.values.delete(value); }
  contains(value: string): boolean { return this.values.has(value); }
}

interface FakeNode {
  classList: Classes;
  textContent: string;
  innerHTML: string;
  style: { width: string };
  parentElement: FakeNode | null;
}

function node(...classes: string[]): FakeNode {
  return {
    classList: new Classes(...classes),
    textContent: "",
    innerHTML: "old",
    style: { width: "" },
    parentElement: null,
  };
}

test("the scan view is visible and working before the session read can begin", () => {
  const upload = node();
  const main = node("hidden");
  const frame = node();
  const analysis = node();
  const capRight = node();
  const status = node("swapping");
  const bar = node("spent");
  const barFill = node();
  barFill.parentElement = bar;
  let painted = false;

  beginAnalysisHandoff(
    { upload, main, frame, analysis, capRight, status, barFill } as unknown as Parameters<typeof beginAnalysisHandoff>[0],
    () => { painted = true; },
  );

  assert.equal(main.classList.contains("hidden"), false, "the main scan must be restored synchronously");
  assert.equal(upload.classList.contains("hidden"), true);
  assert.equal(frame.classList.contains("scanning"), true, "the existing smooth reading treatment should be running");
  assert.equal(status.classList.contains("swapping"), false, "a faded prior sentence must not hide the handoff");
  assert.equal(bar.classList.contains("spent"), false);
  assert.equal(barFill.style.width, "8%");
  assert.equal(capRight.textContent, "PREPARING ANALYSIS");
  assert.match(status.innerHTML, /Bringing both views together/);
  assert.equal(analysis.innerHTML, "");
  assert.equal(painted, true);
});
