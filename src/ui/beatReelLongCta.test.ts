import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";
import { appendAudio, resampleAudioChannel } from "./beatReelExport.js";

test("the long CTA voice is appended after the reel instead of mixed over it", () => {
  const base = [new Float32Array([0.1, 0.2])];
  const tail = [new Float32Array([0.7, 0.8, 0.9])];
  const joined = appendAudio(base, tail);
  assert.equal(joined.length, 1);
  assert.deepEqual([...joined[0]], [
    Math.fround(0.1), Math.fround(0.2), Math.fround(0.7), Math.fround(0.8), Math.fround(0.9),
  ]);
});

test("resampling keeps the requested duration and finite samples", () => {
  const out = resampleAudioChannel(new Float32Array([0, 1, 0, -1]), 4, 8, 1);
  assert.equal(out.length, 8);
  assert.ok([...out].every(Number.isFinite));
  assert.equal(out[0], 0);
  assert.equal(out[2], 1);
});

test("reel finalisation offers the 30-second film while Rundown keeps its embedded short CTA", () => {
  const panel = readFileSync(new URL("./beatReelPanel.ts", import.meta.url), "utf8");
  const exporter = readFileSync(new URL("./beatReelExport.ts", import.meta.url), "utf8");
  const rundownExport = readFileSync(new URL("./rundownExport.ts", import.meta.url), "utf8");
  const rundownFrame = readFileSync(new URL("./rundownFrame.ts", import.meta.url), "utf8");
  assert.match(panel, /id="brp-long-cta" checked/);
  assert.match(panel, /longCta,/);
  assert.match(exporter, /fetch\("\/cta\/cta2\.mp4"/);
  assert.match(exporter, /"Appending CTA film"/);
  assert.match(rundownFrame, /drawCtaCard/);
  assert.doesNotMatch(rundownExport + rundownFrame, /cta2\.mp4|longCta/);
  assert.ok(statSync(new URL("../../public/cta/cta2.mp4", import.meta.url)).size > 1_000_000);
});
