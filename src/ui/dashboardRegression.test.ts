import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const dashboard = readFileSync(new URL("./dashboard.ts", import.meta.url), "utf8");
const history = readFileSync(new URL("./historyView.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");

test("the Celebrities tab is backed by real reference entries, not the synthetic demo reel", () => {
  assert.match(dashboard, /import \{ CELEBS \} from "\.\.\/engine\/celebs\.js"/);
  assert.doesNotMatch(dashboard, /demoReelData|applyShim/);
  assert.match(dashboard, /<span>Celebrities<\/span>/);
  assert.match(dashboard, /const celebrities = celebrityList\(\)/);
  assert.match(dashboard, /<button type="button" class="celeb-card"/);
});

test("the Coach navigation mark is an angular face rather than the round robot", () => {
  const start = dashboard.indexOf("A sharp face mark for the coach");
  const mark = dashboard.slice(start, dashboard.indexOf("</svg>", start));
  assert.match(mark, /m8 5 4-2 4 2 2 5-1\.5 6L12 21/);
  assert.doesNotMatch(mark, /<rect[^>]+rx="6\.3"/);
});

test("a scan recall opens above the dashboard that launched it", () => {
  assert.match(history, /openScanRecall\(scan, previousForMovement\(scans, i\)\)/);
  const dashZ = Number(css.match(/\.dash \{[^}]*z-index:\s*(\d+)/s)?.[1]);
  const recallZ = Number(css.match(/\.recall-overlay \{[^}]*z-index:\s*(\d+)/s)?.[1]);
  assert.ok(Number.isFinite(dashZ) && Number.isFinite(recallZ));
  assert.ok(recallZ > dashZ, `recall layer ${recallZ} must sit above dashboard layer ${dashZ}`);
});
