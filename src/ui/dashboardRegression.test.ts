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

test("closing the dashboard also tears down an open celebrity detail", () => {
  const closeBody = dashboard.slice(
    dashboard.indexOf("export function close(): void"),
    dashboard.indexOf("// ---------------------------------------------------------------------------", dashboard.indexOf("export function close(): void")),
  );
  assert.match(closeBody, /closeCelebDetail\(false\)/);
  assert.match(dashboard, /detailEl\?\.remove\(\);\s*detailEl = null;/);
});

test("the dashboard header has explicit Home navigation without the Max AI marketing pill", () => {
  assert.doesNotMatch(dashboard, /max-ai-badge|MAX AI · YOUR ASSISTANT/);
  const start = dashboard.indexOf('<div class="header-home-group">');
  const headerHome = dashboard.slice(start, dashboard.indexOf("</div>", start));
  assert.equal((headerHome.match(/data-goto="home"/g) ?? []).length, 2);
  assert.match(headerHome, /aria-label="TrueMax home dashboard"/);
  assert.match(headerHome, /aria-label="Go to home dashboard" title="Dashboard"/);
  assert.match(headerHome, /width="20" height="20"/);
  assert.match(headerHome, /M4 10\.6 12 4l8 6\.6/);
  assert.doesNotMatch(headerHome, />Home<\/button>/);
  assert.match(dashboard, /querySelectorAll<HTMLElement>\("\[data-goto\]"\)[\s\S]*?btn\.onclick = \(\) => \{[\s\S]*?showView\(destination\)/);
});

test("header Home returns to the top while bottom tabs retain their saved scroll positions", () => {
  const start = dashboard.indexOf('for (const btn of overlay.querySelectorAll<HTMLElement>("[data-goto]"))');
  const navigation = dashboard.slice(start, dashboard.indexOf('overlay.querySelector("#dash-celeb-strip")', start));
  assert.match(navigation, /showView\(destination\);[\s\S]*?if \(destination === "home" && btn\.closest\("\.header-home-group"\) && overlay\) \{\s*overlay\.scrollTop = 0;\s*scrollMemory\.set\("home", 0\);/);
  assert.match(dashboard, /scrollMemory\.set\(currentView, overlay\.scrollTop\)/);
  assert.match(dashboard, /overlay\.scrollTop = scrollMemory\.get\(name\) \?\? 0/);
});

test("header Home controls do not alter dashboard tab order or acquire tab-only selection state", () => {
  assert.match(dashboard, /const order = \[\.\.\.overlay\.querySelectorAll<HTMLElement>\("\.dash-bar \[data-goto\]"\)/);
  assert.match(dashboard, /querySelectorAll<HTMLElement>\('\.dash-bar \[data-goto\]\[role="tab"\]'\)/);
});

test("appearance stays in Settings rather than adding another dashboard header control", () => {
  assert.doesNotMatch(dashboard, /data-dashboard-theme|mountThemeToggle/);
});

test("celebrity detail labels its estimate as measurement-only and does not imply a fresh scan", () => {
  const detail = dashboard.slice(dashboard.indexOf("function openCelebDetail("), dashboard.indexOf("function celebCard("));
  assert.match(detail, /const estimate = celebrityReferenceEstimate\(celebrity\)/);
  assert.match(detail, /Front reference estimate/);
  assert.match(detail, /Current TrueMax model · measurement-only/);
  assert.match(detail, /stored front measurements, not a fresh scan/);
  assert.match(detail, /Side measurements and the outline descriptor are not included/);
  assert.match(detail, /Measurements only/);
  assert.doesNotMatch(detail, /overallPercentile|\.potential|applyShim/);
});

test("celebrity detail focuses its close button, handles Escape and restores the opening control", () => {
  const detail = dashboard.slice(dashboard.indexOf("function closeCelebDetail("), dashboard.indexOf("function celebCard("));
  assert.match(detail, /document\.activeElement instanceof HTMLElement/);
  assert.match(detail, /closeButton\.focus\(\{ preventScroll: true \}\)/);
  assert.match(detail, /event\.key !== "Escape"/);
  assert.match(detail, /restoreFocus && target\?\.isConnected\) target\.focus/);
});

test("reference estimate styles remain responsive and use the active theme tokens", () => {
  const referenceCss = readFileSync(new URL("./celebrityReferenceScore.css", import.meta.url), "utf8");
  assert.match(dashboard, /import "\.\/celebrityReferenceScore\.css"/);
  assert.match(referenceCss, /background: var\(--card\)/);
  assert.match(referenceCss, /color: var\(--ink\)/);
  assert.match(referenceCss, /width: 88px; height: 88px/);
  assert.match(referenceCss, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(referenceCss, /flex-wrap: wrap/);
});
