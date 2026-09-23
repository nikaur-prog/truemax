import test from "node:test";
import assert from "node:assert/strict";
import { runCaptureHandoff } from "./captureHandoff.js";

for (const stage of ["IMAGE mode switch", "still-image detector"]) {
  test(`${stage} failure after camera teardown shows owned recovery`, async () => {
    const camera = new AbortController();
    let errors = 0;
    await runCaptureHandoff({ isCurrent: () => true, run: async () => {
      camera.abort(); throw new Error(stage);
    }, onError: () => { errors++; } });
    assert.equal(camera.signal.aborted, true);
    assert.equal(errors, 1);
  });
}
test("an abandoned handoff cannot paint an error over a replacement scan", async () => {
  let current = true, errors = 0;
  await runCaptureHandoff({ isCurrent: () => current, run: async () => {
    current = false; throw new Error("old scan");
  }, onError: () => { errors++; } });
  assert.equal(errors, 0);
});
test("successful handoff does not report a false capture failure", async () => {
  let errors = 0;
  await runCaptureHandoff({ isCurrent: () => true, run: async () => {}, onError: () => { errors++; } });
  assert.equal(errors, 0);
});
