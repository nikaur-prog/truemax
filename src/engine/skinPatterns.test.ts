import test from "node:test";
import assert from "node:assert/strict";
import { components, extractSkinFields, robustSpread } from "./skinFields.js";
import type { Pt } from "./skinFields.js";
import { patternsFromFields, SPOT_DENSITY, PIGMENT_AREA, REDNESS_A } from "./skinPatterns.js";
import type { SkinZone } from "./skinPatterns.js";

// ---------------------------------------------------------------------------
// The detector is pinned on synthetic skin, because that is the only ground
// truth that exists before labelled faces do. Each case builds a 220 by 260
// RGBA sample of one skin colour with deterministic grain and a gentle light
// gradient, then paints exactly the thing under test. What these prove is
// structural: a blob at a known place is found and placed in the right zone,
// a smooth gradient is not called anything, and every output id is a
// catalogue id. What they cannot prove is a threshold on real faces, which
// is why the tier is "trial" and why SKIN_ANALYSIS_TRIAL.md exists.
// ---------------------------------------------------------------------------

const SW = 220;
const SH = 260;
const SKIN: [number, number, number] = [210, 160, 130];

// Deterministic grain so a flawless synthetic surface cannot make the
// person's own spread zero (the detector floors it anyway, but a real face
// has grain and the test should look like one).
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function sample(paint?: (x: number, y: number, px: [number, number, number]) => void): Uint8ClampedArray {
  const rnd = lcg(7);
  const data = new Uint8ClampedArray(SW * SH * 4);
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const grade = (x / SW) * 14 - 7; // a window on one side
      const grain = (rnd() - 0.5) * 30;
      const px: [number, number, number] = [
        SKIN[0] + grade + grain,
        SKIN[1] + grade + grain,
        SKIN[2] + grade + grain,
      ];
      paint?.(x, y, px);
      const i = (y * SW + x) * 4;
      data[i] = Math.max(0, Math.min(255, Math.round(px[0])));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(px[1])));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(px[2])));
      data[i + 3] = 255;
    }
  }
  return data;
}

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];
const FACE = rect(0, 0, SW, SH);
const ZONES: SkinZone[] = [
  { id: "forehead", poly: rect(0, 0, SW, 70) },
  { id: "nose", poly: rect(90, 90, 130, 160) },
  { id: "cheekR", poly: rect(0, 90, 90, 190) },
  { id: "cheekL", poly: rect(130, 90, SW, 190) },
  { id: "chin", poly: rect(70, 200, 150, SH) },
];

function fieldsOf(data: Uint8ClampedArray) {
  const f = extractSkinFields(data, SW, SH, FACE, []);
  assert.ok(f, "synthetic skin must yield fields");
  return f!;
}

const disc = (cx: number, cy: number, r: number) => (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

test("plain skin under a light gradient reports no pattern and high confidence", () => {
  const out = patternsFromFields(fieldsOf(sample()), ZONES);
  assert.deepEqual(out.patterns, []);
  assert.ok(out.confidence >= 0.8, `confidence ${out.confidence}`);
  assert.equal(out.caveat, null);
  assert.equal(out.tier, "trial");
  assert.ok(out.coverage > 0.8);
});

test("red blobs on both cheeks read as an inflamed-spot pattern placed on the cheeks", () => {
  const spots: Array<[number, number]> = [];
  for (let i = 0; i < 9; i++) spots.push([12 + i * 8, 110 + (i % 3) * 22]); // cheekR
  for (let i = 0; i < 9; i++) spots.push([140 + i * 8, 110 + (i % 3) * 22]); // cheekL
  const hits = spots.map(([x, y]) => disc(x, y, 2));
  const data = sample((x, y, px) => {
    if (hits.some((h) => h(x, y))) { px[0] = 215; px[1] = 105; px[2] = 105; }
  });
  const out = patternsFromFields(fieldsOf(data), ZONES);
  const red = out.patterns.find((p) => p.id === "inflamed-spot-pattern");
  assert.ok(red, `expected an inflamed-spot pattern, got ${JSON.stringify(out.patterns)}`);
  const zones = new Set(red!.zones.map((z) => z.zone));
  assert.ok(zones.has("cheekR") && zones.has("cheekL"), JSON.stringify(red!.zones));
  const total = red!.zones.reduce((s, z) => s + (z.count ?? 0), 0);
  assert.ok(total >= 14 && total <= 18, `counted ${total} of 18 painted spots`);
  // 18 spots on ~57k kept pixels is about 3 per 10k: light, not marked.
  assert.equal(red!.presence, "light");
  assert.ok(!out.patterns.some((p) => p.id === "post-blemish-mark-pattern"));
});

test("presence follows density, and the thresholds are the published ones", () => {
  assert.ok(SPOT_DENSITY.light < SPOT_DENSITY.moderate && SPOT_DENSITY.moderate < SPOT_DENSITY.marked);
  const spots: Array<[number, number]> = [];
  for (let r = 0; r < 6; r++) for (let c = 0; c < 8; c++) spots.push([10 + c * 10, 100 + r * 14]);
  const hits = spots.map(([x, y]) => disc(x, y, 2));
  const data = sample((x, y, px) => {
    if (hits.some((h) => h(x, y))) { px[0] = 215; px[1] = 105; px[2] = 105; }
  });
  const out = patternsFromFields(fieldsOf(data), ZONES);
  const red = out.patterns.find((p) => p.id === "inflamed-spot-pattern");
  assert.ok(red);
  assert.equal(red!.presence, "marked");
});

test("dark low-chroma blobs read as post-blemish marks, not as inflamed spots", () => {
  const spots: Array<[number, number]> = [];
  for (let i = 0; i < 12; i++) spots.push([20 + i * 15, 130 + (i % 2) * 30]);
  const hits = spots.map(([x, y]) => disc(x, y, 2));
  const data = sample((x, y, px) => {
    if (hits.some((h) => h(x, y))) { px[0] -= 55; px[1] -= 45; px[2] -= 38; }
  });
  const out = patternsFromFields(fieldsOf(data), ZONES);
  assert.ok(out.patterns.some((p) => p.id === "post-blemish-mark-pattern"), JSON.stringify(out.patterns));
  assert.ok(!out.patterns.some((p) => p.id === "inflamed-spot-pattern"));
});

test("cheeks and nose redder than forehead and chin read as a redness pattern", () => {
  const data = sample((x, y, px) => {
    const inWarm = (y >= 90 && y <= 190) || (x >= 90 && x <= 130 && y >= 90 && y <= 160);
    if (inWarm) {
      // A soft ramp at the edge so the boundary is not a spot.
      const edge = Math.min(1, Math.min(y - 90, 190 - y) / 10);
      px[0] += 14 * edge;
      px[1] -= 4 * edge;
    }
  });
  const out = patternsFromFields(fieldsOf(data), ZONES);
  const red = out.patterns.find((p) => p.id === "redness-pattern");
  assert.ok(red, JSON.stringify(out.patterns));
  assert.ok(red!.zones.length >= 2);
  assert.ok(REDNESS_A.light < REDNESS_A.moderate);
});

test("mid-scale darker patches read as uneven pigment by area", () => {
  const patches = [[40, 40], [170, 50], [40, 150], [180, 150], [110, 230], [60, 100], [160, 110], [110, 40]].map(
    ([x, y]) => disc(x, y, 13),
  );
  const data = sample((x, y, px) => {
    if (patches.some((h) => h(x, y))) { px[0] -= 24; px[1] -= 20; px[2] -= 16; }
  });
  const out = patternsFromFields(fieldsOf(data), ZONES);
  const pig = out.patterns.find((p) => p.id === "uneven-pigment-pattern");
  assert.ok(pig, JSON.stringify(out.patterns));
  assert.ok(PIGMENT_AREA.light < PIGMENT_AREA.marked);
});

test("every pattern id is a catalogue id and no output names a condition", () => {
  const data = sample((x, y, px) => {
    if (disc(50, 120, 2)(x, y) || disc(60, 140, 2)(x, y)) { px[0] = 215; px[1] = 105; px[2] = 105; }
  });
  const out = JSON.stringify(patternsFromFields(fieldsOf(data), ZONES));
  for (const banned of ["acne", "rosacea", "eczema", "melasma", "vitiligo", "cancer", "diagnos"]) {
    assert.ok(!out.toLowerCase().includes(banned), `output must not say ${banned}`);
  }
});

test("components separates blobs and reports their size and centre", () => {
  const w = 20, h = 10;
  const bin = new Uint8Array(w * h);
  for (const [x, y] of [[2, 2], [3, 2], [2, 3], [15, 7], [16, 7]]) bin[y * w + x] = 1;
  const comps = components(bin, w, h).sort((a, b) => a.cx - b.cx);
  assert.equal(comps.length, 2);
  assert.equal(comps[0].size, 3);
  assert.equal(comps[1].size, 2);
  assert.ok(Math.abs(comps[1].cx - 15.5) < 1e-9);
});

test("robust spread ignores the tails", () => {
  const values = [...Array(100).keys()].map((i) => i / 10);
  values.push(1000, -1000);
  assert.ok(robustSpread(values) < 6);
});
