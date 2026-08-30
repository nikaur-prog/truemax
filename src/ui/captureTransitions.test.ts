import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The three moments a capture passes through, and what each of them looked
// like before this. All source assertions: these are CSS animations and DOM
// classes driven from two flows, and what would rot is the WIRING — the
// animation surviving while nothing puts it on screen, or the reading state
// being left behind on a frame that no longer holds a photograph.
const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
const live = css.replace(/\/\*[\s\S]*?\*\//g, "");
const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
const side = readFileSync(new URL("./sideFlow.ts", import.meta.url), "utf8");
const landing = readFileSync(new URL("./photoLanding.ts", import.meta.url), "utf8");

test("the hairline that ran up and down is gone entirely", () => {
  // A 2px line with a 16px glow that reached the bottom of the frame and then
  // ran back up, forever, twice a second. Nothing reads a face upward, so the
  // return leg meant nothing, and a hairline reversing direction that often is
  // read as an element that has come loose.
  assert.doesNotMatch(live, /@keyframes sweep\b/);
  assert.doesNotMatch(live, /\.sweep\b/);
  assert.doesNotMatch(
    readFileSync(new URL("../../index.html", import.meta.url), "utf8"),
    /class="sweep"/,
  );
});

test("the band that replaced it only ever travels one way", () => {
  const kf = live.slice(live.indexOf("@keyframes frame-read"));
  const body = kf.slice(0, kf.indexOf("\n}"));
  const tops = [...body.matchAll(/top:\s*(-?[\d.]+)%/g)].map((m) => Number(m[1]));
  assert.ok(tops.length >= 2, "the band has to move at all");
  for (let i = 1; i < tops.length; i++) {
    assert.ok(tops[i] > tops[i - 1], `top must only increase, saw ${tops[i - 1]} then ${tops[i]}`);
  }
  // And it is a soft band, not a line: a height in tens of percent rather than
  // a couple of pixels is what makes it impossible to see come loose.
  const band = live.slice(live.indexOf(".face-frame.scanning .frame-focus::before"));
  assert.match(band.slice(0, band.indexOf("}")), /height:\s*\d\d%/);
});

test("the frame keeps a held glow, so a long pass is never still", () => {
  // The band laps in under three seconds. A measure pass can run for much
  // longer than that, and the beat has to be carried by something that does
  // not travel once the camera is pushed in on one construction.
  assert.match(live, /\.face-frame\.scanning \.frame-focus::after \{[^}]*box-shadow/);
  assert.match(live, /\.face-frame\.measuring \.frame-focus::before \{ display: none; \}/);
  assert.doesNotMatch(live, /\.face-frame\.measuring \.frame-focus::after \{ display: none/);
});

test("both captures land the photograph, and the landing can replay", () => {
  assert.match(live, /\.face-frame\.settling \{ animation: capture-settle/);
  assert.match(live, /@keyframes capture-settle \{\s*from \{ transform: scale\(1\.0/);
  // Front and side both call it. A landing on one of two captures is worse
  // than none: the flow would visibly change character halfway through.
  assert.match(main, /landPhoto\(el\.frame\)/);
  assert.match(side, /landPhoto\(e\.frame\)/);
  // A CSS animation does not restart when its class is re-added in the same
  // frame, and a retake has to play the same landing the first shot did.
  assert.match(landing, /classList\.remove\("settling"\)[\s\S]*?offsetWidth[\s\S]*?classList\.add\("settling"\)/);
});

test("the profile is visibly read BEFORE the question about it is asked", () => {
  // The seeding is real work — segmentation, mesh, template, and a measurement
  // of each until one comes out as a shape a face can be. It used to happen
  // behind a still picture already captioned VERIFY LANDMARKS, so the screen
  // claimed the points were placed while they were being placed.
  const load = side.slice(side.indexOf("async function loadCanvas"));
  const body = load.slice(0, load.indexOf("\n}\n"));
  const reading = body.indexOf('e.frame.classList.add("scanning")');
  const seeding = body.indexOf("seedSidePointsSmart");
  const done = body.indexOf('e.frame.classList.remove("scanning")');
  const mount = body.indexOf("mountVerify(");
  assert.ok(reading > -1 && reading < seeding, "the treatment goes up before the work starts");
  assert.ok(done > seeding && done < mount, "and comes down before the points are shown");
  assert.match(body, /e\.cap\.textContent = "READING PROFILE"/);
  // A floor on the beat, because a state that sometimes flashes past in three
  // frames and sometimes holds for two seconds reads as a glitch in the fast
  // case. Raced, not added: when the seeding is slower this costs nothing.
  assert.match(body, /Promise\.all\(\[\s*seedSidePointsSmart/);
  assert.match(side, /wait\(READ_BEAT_MS\)/);
});

test("a flow abandoned mid-read does not hand its animation to the next screen", () => {
  // Exactly the defect the front scan had with the old sweep: a bare return
  // out of an await left the class on the frame, and whatever came next
  // inherited an animation belonging to a scan already thrown away.
  const fn = side.slice(side.indexOf("function clearWalkthrough"));
  assert.match(fn.slice(0, fn.indexOf("\n}\n")), /classList\.remove\("scanning", "settling"\)/);
});

test("the placement dialog rises out of the blur rather than cutting in", () => {
  assert.match(live, /animation: side-mode-card-in/);
  const kf = live.slice(live.indexOf("@keyframes side-mode-card-in"));
  const body = kf.slice(0, kf.indexOf("\n}"));
  assert.match(body, /scale\(\.9/);
  assert.match(body, /blur\(7px\)/);
  // `backwards`, never `both`: a filter is a containing block, and the zoom
  // control inside this card is absolutely positioned against it.
  assert.match(live, /side-mode-card-in [^;]*backwards;/);
  assert.doesNotMatch(live, /side-mode-card-in [^;]*both;/);
});

test("every one of these stands down for reduced motion", () => {
  const blocks = live.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g) ?? [];
  const all = blocks.join("\n");
  for (const name of ["settling", "frame-focus", "side-mode-card"]) {
    assert.ok(all.includes(name), `${name} must be answered under reduced motion`);
  }
});
