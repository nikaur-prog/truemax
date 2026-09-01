import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const results = readFileSync(new URL("./results.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../style.css", import.meta.url), "utf8");
const shareCard = readFileSync(new URL("./shareCard.ts", import.meta.url), "utf8");
const photoLifecycle = readFileSync(new URL("./scoreStrip.ts", import.meta.url), "utf8");

test("mobile results start with one complete score summary before navigation", () => {
  assert.match(results, /c\.analysis\.appendChild\(mobileSummary\);\s+c\.analysis\.appendChild\(rail\)/);
  assert.match(results, /data-summary-view="\$\{card\.view\}"/);
  assert.match(results, /class="mobile-pillars"/);
  assert.match(styles, /\.mobile-score-summary \{ display: grid/);
});

test("the old mobile duplicates and provenance pills stay out of the hierarchy", () => {
  assert.match(styles, /\.pane-photo \.quality-chips,[\s\S]*\.pane-photo \.viewtoggle/);
  assert.doesNotMatch(styles, /\.ss-score|\.ss-rank|\.ss-share/);
  assert.match(styles, /\.side-score-head,[\s\S]*\.sideprov,[\s\S]*\.side-overview-regions \{ display: none; \}/);
  assert.doesNotMatch(results, /btn-diag/);
});

test("Max has one Profile surface and no floating results pet", () => {
  assert.match(results, /const headline = hasProfile \? "Profile" : "Overview"/);
  assert.match(results, /mk\("Profile", "side"\)/);
  assert.doesNotMatch(results, /mk\("Overview", "side"\)/);
  assert.doesNotMatch(results, /\bmountMaxPet\(/);
  assert.doesNotMatch(results, /\barmMaxPetReveal\(/);
  assert.match(results, /unmountMaxPet\(\)/);
});

test("the first mobile detail layer is scored primary measurements", () => {
  assert.match(results, /PRIMARY MEASUREMENTS/);
  assert.match(results, /metric\.score\.toFixed\(1\)/);
  assert.match(styles, /\.primary-measurements \{ display: block/);
});

test("the exported share card carries overall, front, side and pillars", () => {
  assert.match(shareCard, /label: "OVERALL"/);
  assert.match(shareCard, /label: "FRONT"/);
  assert.match(shareCard, /label: "SIDE"/);
  assert.match(shareCard, /Object\.entries\(report\.pillars\)/);
});

test("mobile report scrolling compacts chrome without building a hidden score card", () => {
  assert.match(photoLifecycle, /pane\.classList\.add\("results-ready"\)/);
  assert.match(photoLifecycle, /detach = watchReportScroll\(pane\)/);
  assert.doesNotMatch(photoLifecycle, /createElement|countUp|typeInto|renderShareCard|setInterval/);
  assert.match(photoLifecycle, /const startY = window\.scrollY/);
  assert.match(photoLifecycle, /classList\.toggle\("report-compact", compact\)/);
  assert.doesNotMatch(photoLifecycle, /classList\.(?:add|remove)\("shrunk"/);
  assert.match(styles, /\.pane-photo \{\s+position: static/);
  assert.match(styles, /\.rtabs-rail \{ top: var\(--report-header-h, 38px\); \}/);
});
