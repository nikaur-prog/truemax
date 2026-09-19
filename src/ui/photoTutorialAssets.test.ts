import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";
import { tutorialSteps } from "./photoTutorial.js";

const source = readFileSync(new URL("./photoTutorial.ts", import.meta.url), "utf8");
// Check the actual offer markup as well as the full walkthrough. The offer
// uses different front photographs, so testing only tutorialSteps misses it.
const offerPhotos = [...source.matchAll(/<img\s+src="(\/tutorial\/[^"\s]+)"/g)].map((match) => match[1]);
const steps = [...tutorialSteps("front"), ...tutorialSteps("side")];
const photographs = [...new Set([...offerPhotos, ...steps.map((step) => step.src)])];
const clips = [...new Set(steps.flatMap((step) => step.video ? [step.video] : []))];

function asset(path: string): Buffer {
  assert.match(path, /^\/tutorial\/[a-z-]+\.(?:jpg|mp4)$/);
  return readFileSync(new URL(`../../public${path}`, import.meta.url));
}

test("the tutorial offer and all front/side steps reference real decodable photographs", async () => {
  assert.equal(offerPhotos.length, 4, "Both offers need a correct and an incorrect example");
  for (const path of photographs) {
    const input = asset(path);
    const metadata = await sharp(input).metadata();
    assert.equal(metadata.format, "jpeg", `${path} must contain JPEG pixels, not an HTML fallback`);
    assert.ok((metadata.width ?? 0) >= 320 && (metadata.height ?? 0) >= 320, `${path} is not a usable example`);
    // Metadata alone can pass for a truncated JPEG. Decode every pixel too.
    const { info } = await sharp(input, { failOn: "warning" }).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, metadata.width, `${path} failed to decode at its declared size`);
    assert.equal(info.height, metadata.height, `${path} failed to decode at its declared size`);
  }
});

test("tutorial assets resolve from nested help and League routes without a route prefix", () => {
  for (const page of ["/", "/help/take-a-good-face-scan", "/help/take-a-good-face-scan/", "/league/tools#calibrate"]) {
    for (const path of [...photographs, ...clips]) {
      const resolved = new URL(path, `https://example.test${page}`);
      assert.equal(resolved.origin, "https://example.test");
      assert.equal(resolved.pathname, path);
    }
  }
});

test("the side walkthrough motion source ships as an MP4 with its still poster", () => {
  assert.equal(clips.length, 1);
  const bytes = asset(clips[0]);
  assert.ok(bytes.length > 1024, "The side turn cannot be an empty or placeholder download");
  assert.equal(bytes.toString("ascii", 4, 8), "ftyp", "The side turn must have an MP4 container header");
  for (const step of steps.filter((entry) => entry.video)) {
    assert.ok(photographs.includes(step.src), "A failed or blocked video must retain a real still poster");
  }
});
