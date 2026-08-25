import test from "node:test";
import assert from "node:assert/strict";
import { EDGE_FADE, activeCut, applyEdgeFades, coverRect, sliceAudio, sourceTime } from "./reelFrame.js";
import { planBeatCuts } from "./beatPlan.js";

const grid = (bpm: number) => ({
  bpm,
  period: 60 / bpm,
  beats: Array.from({ length: 200 }, (_, i) => i * (60 / bpm)),
  downbeatOffset: 0,
  beatsPerBar: 4,
  confidence: 1,
});

test("footage is cropped to fill, never stretched", () => {
  // Landscape 16:9 into a 9:16 reel: the sides go, the full height stays, and
  // the kept rectangle has the destination's proportions exactly. A tool that
  // measures faces must never be the one that squashes them.
  const r = coverRect(1920, 1080, 1080, 1920);
  assert.equal(r.sh, 1080);
  assert.ok(Math.abs(r.sw / r.sh - 1080 / 1920) < 1e-9, "the crop is not 9:16");
  assert.ok(Math.abs(r.sx - (1920 - r.sw) / 2) < 1e-9, "the crop is not centred");
});

test("a taller-than-target source is cropped top and bottom", () => {
  const r = coverRect(1080, 2400, 1080, 1920);
  assert.equal(r.sw, 1080);
  assert.ok(Math.abs(r.sw / r.sh - 1080 / 1920) < 1e-9);
  assert.ok(r.sy > 0 && Math.abs(r.sy - (2400 - r.sh) / 2) < 1e-9);
});

test("already 9:16 footage is used whole", () => {
  const r = coverRect(1080, 1920, 1080, 1920);
  assert.deepEqual(r, { sx: 0, sy: 0, sw: 1080, sh: 1920 });
});

test("the crop can be biased off centre without leaving the frame", () => {
  // Heads sit above the middle of a landscape frame, so a centre crop of a
  // wide shot takes the chin off. Bias must move the window and must never
  // walk it past the edge of the source.
  const high = coverRect(1080, 2400, 1080, 1920, -1);
  assert.equal(high.sy, 0);
  const low = coverRect(1080, 2400, 1080, 1920, 1);
  assert.ok(Math.abs(low.sy + low.sh - 2400) < 1e-9);
  // Beyond the ends is clamped, not extrapolated.
  assert.deepEqual(coverRect(1080, 2400, 1080, 1920, -7), high);
});

test("a zero-sized source asks for nothing rather than NaN", () => {
  // A video element queried before its metadata arrives reports 0×0, and NaN
  // in a drawImage call throws — one un-decoded clip must not kill the render.
  assert.deepEqual(coverRect(0, 0, 1080, 1920), { sx: 0, sy: 0, sw: 0, sh: 0 });
});

test("every instant of the reel belongs to exactly one clip", () => {
  const plan = planBeatCuts({ grid: grid(128), clipCount: 6, beatsPerClip: 2, songStart: 0 });
  const seen = new Set<number>();
  for (let t = 0; t < plan.duration; t += 1 / 30) {
    const hit = activeCut(plan.cuts, t);
    assert.ok(hit, `nothing on screen at ${t.toFixed(3)}s`);
    seen.add(hit!.cut.clip);
    assert.ok(hit!.into >= 0 && hit!.into <= hit!.cut.end - hit!.cut.start + 1e-9);
  }
  assert.equal(seen.size, 6, "a clip never appeared");
});

test("the final instant renders the last clip instead of going black", () => {
  // t === duration is a real frame the encoder asks for, and a naive
  // half-open lookup drops it — one black flash on the end of every export.
  const plan = planBeatCuts({ grid: grid(120), clipCount: 4, beatsPerClip: 2, songStart: 0 });
  const hit = activeCut(plan.cuts, plan.duration);
  assert.ok(hit);
  assert.equal(hit!.cut.clip, 3);
});

test("a clip shorter than its cut holds its last frame rather than looping", () => {
  // Looping a two-second clip through a three-second hold jumps visibly back
  // to the start; a held frame reads as a deliberate hold. Either way the cut
  // still lands on the beat, which is the part that cannot be compromised.
  const clip = { startAt: 0, duration: 2 };
  assert.ok(Math.abs(sourceTime(clip, 1) - 1) < 1e-9);
  const held = sourceTime(clip, 2.9);
  assert.ok(held <= 2 && held >= 1.9, `held at ${held}`);
  assert.equal(sourceTime(clip, 99), sourceTime(clip, 100));
});

test("a clip's in-point is respected and never seeked past its end", () => {
  const clip = { startAt: 5, duration: 6 };
  assert.ok(Math.abs(sourceTime(clip, 0) - 5) < 1e-9);
  assert.ok(sourceTime(clip, 10) < 6, "seeked past the end of the file");
});

test("speed remaps how fast the source is consumed", () => {
  const clip = { startAt: 0, duration: 30 };
  assert.ok(Math.abs(sourceTime(clip, 2, 2) - 4) < 1e-9);
  assert.ok(Math.abs(sourceTime(clip, 2, 0.5) - 1) < 1e-9);
});

test("only the chosen window of the song is copied out", () => {
  const sr = 100;
  const ch = new Float32Array(1000).map((_, i) => i);
  const [out] = sliceAudio([ch], sr, 2, 3);
  assert.equal(out.length, 300);
  assert.equal(out[0], 200);
  assert.equal(out[299], 499);
});

test("a window past the end of the song is padded with silence, not refused", () => {
  // The render has already run by the time the audio is cut; failing here
  // would throw away the work over a song that ends a beat early.
  const sr = 100;
  const [out] = sliceAudio([new Float32Array(150).fill(1)], sr, 1, 2);
  assert.equal(out.length, 200);
  assert.equal(out[0], 1);
  assert.equal(out[49], 1);
  assert.equal(out[50], 0);
});

test("both edges of the music are faded so a mid-waveform cut does not click", () => {
  const sr = 1000;
  const ch = new Float32Array(1000).fill(1);
  applyEdgeFades([ch], sr);
  assert.equal(ch[0], 0);
  assert.equal(ch[999], 0);
  const n = Math.round(EDGE_FADE * sr);
  assert.ok(ch[n] === 1 && ch[999 - n] === 1, "the fade ate into the music");
  assert.ok(ch[Math.floor(n / 2)] > 0 && ch[Math.floor(n / 2)] < 1, "the fade is not a ramp");
});

test("a fade longer than the audio itself cannot invert it", () => {
  const ch = new Float32Array(6).fill(1);
  applyEdgeFades([ch], 44100);
  assert.ok([...ch].every((v) => v >= 0 && v <= 1), "a short buffer was mangled");
});
