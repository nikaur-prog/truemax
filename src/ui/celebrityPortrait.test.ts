import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { celebrityPortraitImage, celebrityPortraitCredits, PORTRAIT_DISCLOSURE } from "./celebrityPortrait.js";
import { celebrityPortrait } from "../engine/celebrityPortraits.js";
import { CELEBS } from "../engine/celebs.js";

const name = CELEBS.find(entry => celebrityPortrait(entry.name))!.name;

test("decorative reference images load lazily, asynchronously and without a referrer", () => {
  const markup = celebrityPortraitImage(name);
  for (const attribute of ['loading="lazy"', 'decoding="async"', 'referrerpolicy="no-referrer"', 'alt=""', 'data-celebrity-portrait']) assert.ok(markup.includes(attribute));
  assert.doesNotMatch(markup, /fetchpriority|onerror|upload\.wikimedia/);
  assert.equal(celebrityPortraitImage("Sha'Carri Richardson"), "");
  assert.equal(celebrityPortraitImage("unknown"), "");
});

test("each used portrait exposes its source, author, license and crop disclosure", () => {
  const photo = celebrityPortrait(name)!;
  const markup = celebrityPortraitCredits([name, name]);
  assert.equal((markup.match(/<li>/g) ?? []).length, 1);
  assert.ok(markup.includes(photo.sourceUrl.replace(/&/g, "&amp;")));
  assert.ok(markup.includes(photo.licenseUrl));
  assert.ok(markup.includes(photo.license));
  assert.ok(markup.includes(PORTRAIT_DISCLOSURE));
  assert.match(markup, /layout crop only\. No facial edits/);
  assert.match(markup, /earlier crops or edits/);
  assert.match(markup, /rel="noopener noreferrer"/);
  assert.equal(celebrityPortraitCredits(["unknown"]), "");
});

test("dashboard, results and metric details wire credits and resource-error fallback", () => {
  for (const file of ["dashboard.ts", "results.ts", "metricDetail.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /celebrityPortraitImage\(/, file);
    assert.match(source, /celebrityPortraitCredits\(/, file);
    assert.match(source, /installCelebrityPortraitFallback\(\)/, file);
  }
  const source = readFileSync(new URL("celebrityPortrait.ts", import.meta.url), "utf8");
  assert.match(source, /image\.hidden = true/);
  assert.match(source, /addEventListener\("error"/);
  assert.doesNotMatch(source, /image\.src\s*=/);
  const css = readFileSync(new URL("celebrityPortrait.css", import.meta.url), "utf8");
  assert.match(css, /\.cd-photo \{ position: relative/);
  assert.match(css, /\[hidden\] \{ display: none !important/);
});

test("CSP allows only the exact derivative host in addition to existing image sources", () => {
  const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
  const policy = config.headers.find((row: { source: string }) => row.source === "/(.*)").headers.find((row: { key: string }) => row.key === "Content-Security-Policy").value as string;
  const images = policy.split(";").find(part => part.trim().startsWith("img-src"))!;
  assert.match(images, /https:\/\/thumb\.wikimedia\.org/);
  assert.match(images, /https:\/\/\*\.tiktokcdn\.com/);
  assert.doesNotMatch(images, /upload\.wikimedia|\*\.wikimedia|https:\s/);
});
