import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./sideFlow.ts", import.meta.url), "utf8");
const camera = source.slice(source.indexOf("async function openSideCamera"), source.indexOf("function stopSideCamera"));

test("late side-camera callbacks cannot cancel or paint a replacement attempt", () => {
  assert.match(camera, /const ownsCamera = \(\) => attempt === sideCamAttempt/);
  assert.match(camera, /activeScanOwner\(\) === cameraOwner/);
  assert.match(camera, /onPause: \(\) => \{ if \(ownsCamera\(\)\) auto\?\.cancel\(\); \}/);
  for (const callback of ["onLost: () =>", "onCheck: (c) =>", "onTick: (remaining) =>", "onFire: () =>"]) {
    const start = camera.indexOf(callback);
    assert.ok(start >= 0);
    assert.match(camera.slice(start, start + callback.length + 60), /if \(!ownsCamera\(\)\) return/);
  }
});

test("a superseded camera stops only its stream and cannot switch the new detector to still mode", () => {
  const stale = camera.slice(camera.indexOf("if (!ownsCamera()) {"), camera.indexOf("sideCam = started"));
  assert.match(stale, /started\.stop\(\)/);
  assert.doesNotMatch(stale, /setRunningMode\(/);
  assert.match(camera, /if \(ownsCamera\(\) && sideCam === swappingCamera\) e\.swap\.disabled = false/);
});

test("camera startup offers upload and exits before waiting for permission", () => {
  const start = camera.indexOf("await startCamera");
  const controls = camera.indexOf('id="side-start-upload"');
  assert.ok(controls >= 0 && controls < start);
  assert.match(camera.slice(controls, start), /appendSideExitActions\(e\.actions, ctx, false\)/);
  assert.match(camera, /openSideCapture\(\{ \.\.\.ctx, method: "upload" \}\)/);
  assert.match(camera, /catch \{\s*if \(!ownsCamera\(\)\) return;\s*chooseUpload\(\)/);
});
