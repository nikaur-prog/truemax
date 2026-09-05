import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

const results = source("./results.ts");
const recovery = source("./canvasRecovery.ts");
const max = source("./maxCharacter.ts");
const history = source("./historyView.ts");
const photos = source("../engine/photoStore.ts");
const styles = source("../style.css");

test("result photos retain an encoded source and restore on every mobile return signal", () => {
  assert.match(recovery, /encoded: encode\(canvas\)/);
  assert.match(recovery, /document\.addEventListener\("visibilitychange"/);
  assert.match(recovery, /window\.addEventListener\("pageshow"/);
  assert.match(recovery, /window\.addEventListener\("focus"/);
  assert.match(recovery, /document\.removeEventListener\("visibilitychange"/);
  assert.match(results, /mountCanvasRecovery\(\[frontPhoto, c\.sidePhoto\]/);
  assert.match(results, /restoreVisiblePhoto\(\)/);
});

test("the side headline is one Profile tab backed by the side report", () => {
  assert.match(results, /mk\("Profile", "side"\)/);
  assert.doesNotMatch(results, /mk\("Overview", "side"\)/);
  assert.doesNotMatch(results, /if \(hasProfile\) mk\("Profile", "overall"\)/);
});

test("a thinking result pose is preserved but bounded before idle", () => {
  assert.match(results, /mood: "thinking"/);
  assert.match(results, /wireMaxInteractions\(root\.querySelector<HTMLElement>\("\.maxan-face"\)\)/);
  assert.match(max, /export const THINKING_POSE_MS = 4_200/);
  assert.match(max, /classList\.remove\("mx-mood-thinking"\)/);
  assert.match(max, /classList\.add\("mx-mood-happy"\)/);
});

test("mobile photographs stay full-sized and category navigation owns stickiness", () => {
  assert.match(results, /classList\.toggle\("region-focus", isRegion\)/);
  assert.match(results, /mobileRegionFocused\(\) \? IDENTITY_ZOOM : zoomFor/);
  assert.match(styles, /max-height: min\(38svh, 430px\)/);
  assert.match(styles, /height: min\(38svh, 430px\); object-fit: cover/);
  assert.doesNotMatch(styles, /\.pane-photo\.shrunk/);
  assert.match(styles, /\.topbar\.report-compact/);
  assert.match(styles, /var\(--report-header-h, 38px\) \+ var\(--report-photo-h, 38svh\)/);
  assert.match(styles, /var\(--face-x, center\)/);
  assert.match(styles, /var\(--face-y, 40%\)/);
});

test("mobile correction actions do not truncate their labels", () => {
  assert.match(styles, /\.ract-utils \.ract span\s*\{[\s\S]{0,120}?white-space:\s*normal/);
});

test("history can read a thumbnail before its IndexedDB write finishes", () => {
  assert.match(photos, /memoryPhotos\.set\(key, \{ \.\.\.photos \}\);\s+await tx\("readwrite"/);
  assert.match(photos, /const cached = memoryPhotos\.get\(key\)/);
  assert.match(history, /hist-shot-placeholder/);
  assert.match(history, /host\.innerHTML =\s+\(p\.front/);
});
