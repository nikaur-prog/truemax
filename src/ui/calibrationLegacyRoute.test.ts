import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../../calib.html", import.meta.url), "utf8");

test("legacy calibration URL redirects to the private League workspace without loading a scanner", () => {
  assert.match(html, /<meta http-equiv="refresh" content="0; url=\/league\/tools#calibrate"\s*\/>/);
  assert.match(html, /<a href="\/league\/tools#calibrate">Continue to calibration<\/a>/);
  assert.match(html, /name="robots" content="noindex, nofollow, noarchive"/);
  assert.doesNotMatch(html, /<script\b|<input\b|<canvas\b|<video\b|rel="(?:preload|modulepreload|stylesheet)"/i);
  assert.doesNotMatch(html, /src\/calib\.(?:ts|css)|face_landmarker|tasks-vision|type="file"/);
});

test("deployed legacy aliases resolve to the lightweight redirect, not the former public scanner", () => {
  const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
  assert.ok(config.redirects.some((route: { source: string; destination: string }) => route.source === "/calib.html" && route.destination === "/calib"));
  assert.ok(config.rewrites.some((route: { source: string; destination: string }) => route.source === "/calib" && route.destination === "/calib.html"));
  const vite = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");
  assert.match(vite, /calib: resolve\(import\.meta\.dirname, "calib\.html"\)/, "the backward-compatible redirect remains a build output");
});
