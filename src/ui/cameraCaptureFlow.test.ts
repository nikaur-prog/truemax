import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
const side = readFileSync(new URL("./sideFlow.ts", import.meta.url), "utf8");
const frontCapture = main.slice(main.indexOf("async function takeFrontPhoto"), main.indexOf('el.btnCancel.addEventListener'));
const sideCapture = side.slice(side.indexOf("async function takeSidePhoto"), side.indexOf('document.getElementById("side-shoot")!.onclick'));

test("automatic shutters call the same owned capture as manual actions, never a disabled DOM click", () => {
  assert.match(main, /onFire: \(\) => \{ if \(ownsCamera\(\)\) void takeFrontPhoto\(\); \}/);
  assert.match(side, /onFire: \(\) => \{\s*if \(!ownsCamera\(\)\) return;\s*void takeSidePhoto\(\);\s*\}/);
  assert.match(frontCapture, /frontCaptureBusy \|\| !lastCheck\?\.gates\.face/);
  assert.match(sideCapture, /!ready \|\| capturing/);
});

test("camera-only feedback follows a real frame and guards both sides of the await", () => {
  for (const body of [frontCapture, sideCapture]) {
    assert.match(body, /showCaptureFeedback\(shot,/);
    assert.match(body, /Photo not captured/);
    assert.match(body, /signal\.aborted/);
    assert.match(body, /finally/);
  }
  assert.ok(frontCapture.indexOf("if (shot)") < frontCapture.indexOf("showCaptureFeedback"));
  assert.ok(sideCapture.indexOf("if (!shot)") < sideCapture.indexOf("showCaptureFeedback"));
  assert.equal((main.match(/await showCaptureFeedback\(/g) ?? []).length, 1);
  assert.equal((side.match(/await showCaptureFeedback\(/g) ?? []).length, 1);
  assert.ok(frontCapture.indexOf("await showCaptureFeedback") < frontCapture.indexOf("await handOffFrontPhoto"));
});

test("side camera asks keep or retake before point estimation, without adding a question to uploads", () => {
  assert.ok(sideCapture.indexOf("await confirmScanAction") < sideCapture.indexOf("await loadCanvas"));
  assert.match(sideCapture, /Happy with this side photo/);
  assert.match(sideCapture, /else void openSideCamera\(ctx\)/);
  assert.match(sideCapture, /sideAttempt\.current\(reviewSignal\)/);
  assert.match(sideCapture, /trackDialog\(closeScanConfirm\)/);
  const upload = side.slice(side.indexOf("async function load(file:"), side.indexOf("function showSideLoadFailure"));
  assert.doesNotMatch(upload, /showCaptureFeedback|confirmScanAction/);
});

test("a failed front photo retains the live camera generation for a genuine manual retry", () => {
  assert.match(frontCapture, /const generation = scanGeneration/);
  assert.match(frontCapture, /await handOffFrontPhoto\(shot, \+\+scanGeneration/);
  assert.match(frontCapture, /controller\.signal\.aborted \|\| cam !== held/);
  assert.match(frontCapture, /setCameraLabel\("Capture"\)/);
});

test("failed captures keep manual retry guidance and block swaps during the burst", () => {
  assert.match(main, /!frontCaptureRetry && performance\.now\(\) >= holdHintUntil/);
  assert.match(frontCapture, /frontCaptureRetry = true/);
  assert.match(main, /if \(!cam \|\| frontCaptureBusy\) return/);
  assert.match(side, /if \(!captureRetry && !auto\?\.armed\(\)\)/);
  assert.match(sideCapture, /captureRetry = true/);
  assert.match(side, /!sideCam \|\| capturing\) return/);
});

test("side capture owns its controls before feedback and no guidance writes follow an automatic shutter", () => {
  const onCheck = side.slice(side.indexOf("      onCheck: (c) => {"), side.indexOf("    sideCam = started;"));
  const lastGuidanceWrite = onCheck.lastIndexOf('shoot.textContent = "Capture"');
  assert.ok(lastGuidanceWrite >= 0);
  assert.ok(onCheck.indexOf("auto?.update(c.ready)") > lastGuidanceWrite);
  assert.match(sideCapture, /shoot\.disabled = true;\s*shoot\.textContent = "Capturing…"/);
  assert.ok(sideCapture.indexOf("shoot.disabled = true") < sideCapture.indexOf("held.capture()"));
  assert.match(sideCapture, /e\.hintDetail\.textContent = "Taking your photo"/);
  assert.match(sideCapture, /if \(ownsCamera\(\) && sideCam === held\) \{[\s\S]*shoot\.disabled = false;\s*shoot\.textContent = "Capture"/);
});

test("post-teardown errors use scan ownership and offer retry/retake instead of disappearing", () => {
  const body = main.slice(main.indexOf("async function handOffFrontPhoto"), main.indexOf('el.btnCancel.addEventListener'));
  assert.match(body, /runCaptureHandoff/);
  assert.match(body, /isCurrent: \(\) => scanIsCurrent\(token, generation\)/);
  assert.match(body, /await setRunningMode\("IMAGE"\)/);
  assert.match(body, /Try this photo again/);
  assert.match(body, /retakeFront\("camera"\)/);
  assert.doesNotMatch(body, /controller\.signal/);
});

test("brief camera stalls pause instead of resetting while hidden pages and swaps reset safely", () => {
  for (const source of [main, side]) {
    assert.match(source, /if \(isAppForeground\(\)\) auto(?:Front)?\?\.update\(false\);\s*else auto(?:Front)?\?\.cancel\(\);/);
    assert.match(source, /Camera paused/);
    assert.match(source, /\|\| !auto(?:Front)?\?\.hasProgress\(\)\) return;\s*(?:el\.camHintTitle|e\.hintTitle)\.textContent = "Camera paused"/);
    assert.match(source, /setFramingLocked\?\.\(remaining != null \|\| !!auto(?:Front)?\?\.hasProgress\(\)\)/);
  }
  assert.match(main, /if \(!cam \|\| frontCaptureBusy\) return;\s*autoFront\?\.cancel\(\)/);
  assert.match(side, /if \(!ownsCamera\(\) \|\| !sideCam \|\| capturing\) return;\s*auto\?\.cancel\(\)/);
});
test("each side camera attempt starts from the turn instruction, not the last attempt's capture copy", () => {
  const open = side.slice(side.indexOf("async function openSideCamera"), side.indexOf("const started = await startCamera"));
  const reset = open.indexOf('e.hintTitle.textContent = "Turn to the side"');
  assert.ok(reset > 0, "openSideCamera resets the hint title");
  assert.match(open, /e\.hintDetail\.textContent = "One ear toward the lens"/);
  assert.match(open, /e\.hint\.classList\.remove\("counting"\)/);
  // Nothing in the attempt writes capture copy before the camera starts.
  assert.doesNotMatch(open, /textContent = "(Hold still|Taking your photo|Photo not captured)"/);
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  assert.match(html, /<b id="side-hint-title">Turn to the side<\/b>/, "same copy as the page's initial side hint");
});
