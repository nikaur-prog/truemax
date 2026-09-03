import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  BACK_LANDMARK_IDS,
  LANDMARK_GRID_STEP,
  LANDMARK_TOOL,
  LANDMARK_VERSION,
  SIDE_LANDMARK_IDS,
  ZOOM_CLUSTERS,
  ZOOM_SIZES,
  anchorVertical,
  constructGonion,
  finePrompt,
  fromZoom,
  gridOverlaySvg,
  landmarkPrompt,
  landmarkTool,
  landmarksToPixels,
  markerOverlaySvg,
  mentonLooksWrong,
  outlineOverlaySvg,
  parseLandmarkToolInput,
  parsePixelToolInput,
  parseSeedHint,
  prepareLandmarkImage,
  squareWindow,
  toZoom,
  zoomCrop,
  zoomPrompt,
  zoomWindow,
} from "./_sideLandmarks.js";
import type { PixelPlacement, SideLandmarkId } from "./_sideLandmarks.js";

const FRAME = { width: 1000, height: 1400 };
const GRID = { ...FRAME, step: LANDMARK_GRID_STEP };

// A profile facing image-right, in pixels of FRAME: the nose tip sits
// further right than the ear notch.
function facingRight(): Record<string, { x: number; y: number; confidence: number }> {
  const at = (x: number, y: number, confidence = 0.9) => ({ x, y, confidence });
  return {
    trichion: at(420, 250),
    glabella: at(470, 420),
    nasion: at(460, 475),
    pronasale: at(550, 630),
    subnasale: at(500, 685),
    labialeSuperius: at(510, 740),
    labialeInferius: at(500, 800),
    pogonion: at(490, 880),
    menton: at(450, 940),
    cervicale: at(350, 980),
    gonion: at(280, 870, 0.6),
    condylion: at(240, 615, 0.5),
    tragion: at(220, 615, 0.7),
  };
}

test("the tool schema requires every one of the thirteen points and nothing else, bounded by the frame", () => {
  const tool = landmarkTool(SIDE_LANDMARK_IDS, FRAME);
  const schema = tool.input_schema as unknown as {
    required: string[];
    properties: Record<string, { properties: { x: { maximum: number }; y: { maximum: number } } }>;
    additionalProperties: boolean;
  };
  assert.deepEqual([...schema.required].sort(), [...SIDE_LANDMARK_IDS].sort());
  assert.deepEqual(Object.keys(schema.properties).sort(), [...SIDE_LANDMARK_IDS].sort());
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.tragion.properties.x.maximum, FRAME.width);
  assert.equal(schema.properties.tragion.properties.y.maximum, FRAME.height);
  // The five the seeder infers are a subset, and the split is exact.
  for (const id of BACK_LANDMARK_IDS) assert.ok(SIDE_LANDMARK_IDS.includes(id));
  assert.equal(BACK_LANDMARK_IDS.length, 5);
  // The two clusters that get a second look are all back points plus the chin front.
  const zoomIds = ZOOM_CLUSTERS.flatMap((c) => c.ids);
  for (const id of BACK_LANDMARK_IDS) assert.ok(zoomIds.includes(id), id);
  assert.equal(new Set(zoomIds).size, zoomIds.length);
  assert.equal(LANDMARK_TOOL.name, "place_side_landmarks");
});

test("the prompt names every landmark, states the frame and the grid, asks for pixels, and describes nobody", () => {
  const prompt = landmarkPrompt(GRID);
  for (const id of SIDE_LANDMARK_IDS) assert.ok(prompt.includes(`- ${id}:`), id);
  assert.match(prompt, /1000 pixels wide and 1400 pixels high/);
  assert.match(prompt, new RegExp(`every ${LANDMARK_GRID_STEP} pixels`));
  assert.match(prompt, /whole pixels/);
  assert.match(prompt, /Do not describe the person/);
  const ear = zoomPrompt("ear", ["tragion", "condylion", "gonion"], { width: 1024, height: 1024, step: 100 }, 1);
  assert.match(ear, /pointing to the right/);
  assert.match(ear, /Find the ear first/);
  assert.ok(ear.includes("- tragion:") && ear.includes("- gonion:") && !ear.includes("- pronasale:"));
  const chin = zoomPrompt("chin", ["pogonion", "menton", "cervicale"], { width: 1024, height: 1024, step: 100 }, -1);
  assert.match(chin, /pointing to the left/);
  const jaw = finePrompt("jaw", ["gonion", "jawLower", "jawBack"], { width: 1024, height: 1024, step: 50 }, 1);
  assert.match(jaw, /SECOND image only/);
  assert.match(jaw, /every 50 pixels/);
  assert.ok(jaw.includes("- jawLower:") && jaw.includes("- jawBack:") && jaw.includes("never on the ear"));
  const redo = finePrompt("chin", ["pogonion", "menton", "cervicale"], { width: 1024, height: 1024, step: 50 }, 1, "The markers show a previous placement.");
  assert.match(redo, /markers show a previous placement/);
  // The two definitions the model got wrong say what the point is NOT.
  assert.match(prompt, /menton: .*not on the neck/i);
  assert.match(prompt, /gonion: .*never on the ear/i);
  for (const text of [prompt, ear, chin, jaw, redo]) {
    assert.doesNotMatch(text, /—/, "no em dash");
    for (const word of ["attractive", "ethnic", "race", "age", "gender"]) {
      assert.doesNotMatch(text, new RegExp(`\\b${word}\\b`, "i"), word);
    }
  }
});

test("a complete answer parses to fractions, with the facing taken from the points", () => {
  const result = parseLandmarkToolInput(facingRight(), FRAME);
  assert.equal(result.faceDir, 1);
  assert.equal(result.points.pronasale.x, 0.55);
  assert.equal(result.points.pronasale.y, 0.45);
  assert.equal(result.confidence.condylion, 0.5);
  // Mirror it and the facing flips.
  const mirrored = Object.fromEntries(
    Object.entries(facingRight()).map(([id, p]) => [id, { ...p, x: FRAME.width - p.x }]),
  );
  assert.equal(parseLandmarkToolInput(mirrored, FRAME).faceDir, -1);
});

test("a missing or out-of-image point is a refusal, not a guess", () => {
  const missing = facingRight();
  delete missing.gonion;
  assert.throws(() => parseLandmarkToolInput(missing, FRAME), /gonion is missing/);
  const outside = facingRight();
  outside.tragion = { x: 1200, y: 400, confidence: 0.9 };
  assert.throws(() => parseLandmarkToolInput(outside, FRAME), /tragion is outside/);
  const nan = facingRight();
  nan.menton = { x: Number.NaN, y: 600, confidence: 0.9 };
  assert.throws(() => parseLandmarkToolInput(nan, FRAME), /menton is outside/);
  assert.throws(() => parseLandmarkToolInput(null, FRAME), /not an object/);
  // A zoom answer is checked against its own crop, and only for its own points.
  const partial = parsePixelToolInput({ tragion: { x: 10, y: 20, confidence: 0.8 } }, ["tragion"], { width: 100, height: 100 });
  assert.deepEqual(partial.tragion, { x: 10, y: 20, confidence: 0.8 });
  assert.throws(() => parsePixelToolInput({ tragion: { x: 101, y: 20, confidence: 0.8 } }, ["tragion"], { width: 100, height: 100 }), /outside/);
});

test("a nose on top of the ear is not a profile", () => {
  const flat = facingRight();
  flat.tragion = { x: 530, y: 615, confidence: 0.9 };
  assert.throws(() => parseLandmarkToolInput(flat, FRAME), /too close together/);
});

test("confidence outside 0 to 1 falls back to the middle rather than failing the pass", () => {
  const odd = facingRight();
  odd.trichion = { x: 420, y: 250, confidence: 7 };
  assert.equal(parseLandmarkToolInput(odd, FRAME).confidence.trichion, 0.5);
});

test("pixels are fractions times the frame", () => {
  const result = parseLandmarkToolInput(facingRight(), FRAME);
  const px = landmarksToPixels(result, 480, 640);
  assert.equal(px.pronasale.x, 0.55 * 480);
  assert.equal(px.pronasale.y, 0.45 * 640);
});

test("the version stamp is a short tag, not a model name", () => {
  assert.match(LANDMARK_VERSION, /^vision-\d+$/);
  assert.equal(LANDMARK_VERSION, "vision-3");
});

test("the zoom window is a square around the cluster, at least a head width wide, inside the image", () => {
  const placed = facingRight() as Record<SideLandmarkId, PixelPlacement>;
  const ear = zoomWindow(placed, ["tragion", "condylion", "gonion"], FRAME);
  const unit = Math.hypot(550 - 220, 630 - 615);
  assert.ok(ear.size >= unit * 1.2 - 1, `size ${ear.size} for unit ${unit}`);
  // Every cluster point is inside the crop.
  for (const id of ["tragion", "condylion", "gonion"] as const) {
    assert.ok(placed[id].x >= ear.left && placed[id].x <= ear.left + ear.size, id);
    assert.ok(placed[id].y >= ear.top && placed[id].y <= ear.top + ear.size, id);
  }
  assert.ok(ear.left >= 0 && ear.top >= 0);
  assert.ok(ear.left + ear.size <= FRAME.width && ear.top + ear.size <= FRAME.height);
  // A cluster hard against an edge is shifted in, not cut.
  const edge = { ...placed, tragion: { x: 5, y: 615, confidence: 0.7 }, condylion: { x: 25, y: 615, confidence: 0.5 }, gonion: { x: 40, y: 870, confidence: 0.6 } };
  const shifted = zoomWindow(edge, ["tragion", "condylion", "gonion"], FRAME);
  assert.equal(shifted.left, 0);
  assert.ok(shifted.size <= FRAME.width);
});

test("a point read in the enlarged crop maps back to the frame it was cut from", () => {
  const window = { left: 100, top: 300, size: 500 };
  const scale = 1024 / 500;
  const back = fromZoom({ x: 512, y: 0, confidence: 0.4 }, window, scale);
  assert.equal(back.x, 350);
  assert.equal(back.y, 300);
  assert.equal(back.confidence, 0.4);
});

test("the grid is drawn every step with the coordinate written on each line", () => {
  const svg = gridOverlaySvg({ width: 320, height: 240, step: 100 });
  assert.match(svg, /^<svg /);
  for (const n of [100, 200, 300]) assert.ok(svg.includes(`>${n}</text>`), String(n));
  assert.ok(!svg.includes(">400</text>"));
  // Vertical lines at 100, 200, 300; horizontal at 100, 200.
  assert.equal((svg.match(/<line /g) ?? []).length, 5);
});

test("preparing an image uprights it, caps the long side, and reports the size the grid is drawn at", async () => {
  // A 2400 by 1200 rotated-by-EXIF portrait would need a real camera file;
  // a plain landscape tests the resize and the reported size.
  const wide = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: { r: 200, g: 170, b: 150 } } })
    .png()
    .toBuffer();
  const prepared = await prepareLandmarkImage(wide);
  assert.equal(prepared.width, 1568);
  assert.equal(prepared.height, 784);
  const small = await prepareLandmarkImage(await sharp({ create: { width: 300, height: 400, channels: 3, background: "#888" } }).png().toBuffer());
  assert.equal(small.width, 300, "never enlarged");
  const crop = await zoomCrop(prepared.plain, { left: 100, top: 100, size: 400 }, 800);
  assert.equal(crop.scale, 2);
  assert.deepEqual(crop.frame, { width: 800, height: 800, step: LANDMARK_GRID_STEP });
  const meta = await sharp(Buffer.from(crop.data, "base64")).metadata();
  assert.equal(meta.width, 800);
  assert.equal(meta.format, "jpeg");
});

test("anchoring fits only the vertical scale and offset, from the front points, and leaves x alone", () => {
  const truth = Object.fromEntries(Object.entries(facingRight()).map(([id, p]) => [id, { x: p.x, y: p.y }])) as Record<SideLandmarkId, { x: number; y: number }>;
  // The model's answer: every y stretched by 1.25 and pushed down 40, x untouched.
  const stretched = Object.fromEntries(Object.entries(truth).map(([id, p]) => [id, { x: p.x, y: p.y * 1.25 + 40 }])) as Record<SideLandmarkId, { x: number; y: number }>;
  const anchored = anchorVertical(stretched, truth);
  for (const id of SIDE_LANDMARK_IDS) {
    assert.ok(Math.abs(anchored[id].y - truth[id].y) < 1e-6, `${id} y`);
    assert.equal(anchored[id].x, stretched[id].x, `${id} x`);
  }
  // Fewer than two anchors: nothing happens.
  assert.deepEqual(anchorVertical(stretched, { pronasale: truth.pronasale }), stretched);
});

test("a seed hint is all thirteen fractions or nothing", () => {
  const full = Object.fromEntries(Object.entries(facingRight()).map(([id, p]) => [id, { x: p.x / FRAME.width, y: p.y / FRAME.height }]));
  const parsed = parseSeedHint(JSON.stringify(full));
  assert.ok(parsed);
  assert.equal(parsed!.pronasale.x, 0.55);
  assert.deepEqual(parseSeedHint(full), parsed, "an object is accepted as well as JSON text");
  const partial = { ...full } as Record<string, unknown>;
  delete partial.gonion;
  assert.equal(parseSeedHint(partial), null);
  assert.equal(parseSeedHint({ ...full, tragion: { x: 1.4, y: 0.4 } }), null);
  assert.equal(parseSeedHint("not json"), null);
  assert.equal(parseSeedHint(null), null);
});

test("a square window is centred, at least a head width fraction wide, and kept inside the frame", () => {
  const w = squareWindow({ x: 500, y: 700 }, 360, FRAME);
  assert.deepEqual(w, { left: 320, top: 520, size: 360 });
  const edge = squareWindow({ x: 20, y: 1390 }, 360, FRAME);
  assert.equal(edge.left, 0);
  assert.equal(edge.top, FRAME.height - 360);
  const huge = squareWindow({ x: 500, y: 700 }, 5000, FRAME);
  assert.equal(huge.size, FRAME.width);
  // The stages narrow: coarse is wider than every fine crop.
  for (const fine of [ZOOM_SIZES.fineEar, ZOOM_SIZES.fineJaw, ZOOM_SIZES.fineChin]) assert.ok(fine < ZOOM_SIZES.coarse);
});

test("frame to crop and back is the identity", () => {
  const window = { left: 100, top: 300, size: 500 };
  const scale = 1024 / 500;
  const p = { x: 350, y: 420 };
  const z = toZoom(p, window, scale);
  const back = fromZoom({ ...z, confidence: 1 }, window, scale);
  assert.ok(Math.abs(back.x - p.x) < 1e-9 && Math.abs(back.y - p.y) < 1e-9);
});

test("the overlays draw what they say: an outlined box, and labelled markers", () => {
  const box = outlineOverlaySvg({ width: 1024, height: 1024 }, { left: 200, top: 300, size: 400 });
  assert.match(box, /<rect x="200" y="300" width="400" height="400" fill="none"/);
  const marks = markerOverlaySvg({ width: 1024, height: 1024 }, [{ x: 10, y: 20, label: "chin bottom?" }]);
  assert.match(marks, /<circle cx="10" cy="20"/);
  assert.ok(marks.includes(">chin bottom?</text>"));
});

test("the jaw corner is constructed from the two tangents and reconciled with the guess", () => {
  const unit = 300;
  // Lower border runs from the chin bottom back and slightly up; the back
  // edge runs from the hinge straight down. They meet at (200, 880).
  const menton = { x: 450, y: 940 };
  const jawLower = { x: 325, y: 910 };
  const condylion = { x: 200, y: 615 };
  const jawBack = { x: 200, y: 750 };
  const agree = constructGonion({ x: 205, y: 875, confidence: 0.6 }, menton, jawLower, condylion, jawBack, unit);
  assert.equal(agree.method, "snapped");
  assert.ok(Math.abs(agree.point.x - 200) < 1 && Math.abs(agree.point.y - 880) < 1);
  assert.ok(agree.point.confidence >= 0.8);
  // The guess a third of a head up the ramus, where the model kept putting it.
  const lobe = constructGonion({ x: 215, y: 800, confidence: 0.6 }, menton, jawLower, condylion, jawBack, unit);
  assert.equal(lobe.method, "construction");
  assert.ok(Math.abs(lobe.point.y - 880) < 1);
  // Tangents that meet above the hinge: not a corner a jaw can have, so keep the guess, doubt it.
  const wild = constructGonion({ x: 215, y: 800, confidence: 0.6 }, menton, { x: 325, y: 700 }, condylion, jawBack, unit);
  assert.equal(wild.method, "guess");
  assert.ok(wild.point.confidence <= 0.3);
  // Parallel tangents: the guess, unchanged.
  const parallel = constructGonion({ x: 215, y: 800, confidence: 0.6 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 }, unit);
  assert.equal(parallel.method, "guess");
  assert.equal(parallel.disagreement, null);
});

test("a chin bottom below the neck point or behind the chin is refused", () => {
  const pogonion = { x: 490, y: 880 };
  const cervicale = { x: 350, y: 980 };
  assert.equal(mentonLooksWrong({ x: 450, y: 940 }, pogonion, cervicale, 1), false);
  assert.equal(mentonLooksWrong({ x: 450, y: 1000 }, pogonion, cervicale, 1), true, "below the neck point");
  assert.equal(mentonLooksWrong({ x: 380, y: 940 }, pogonion, cervicale, 1), true, "behind the chin");
  // Mirrored face: behind is the other way.
  assert.equal(mentonLooksWrong({ x: 1000 - 380, y: 940 }, { x: 1000 - 490, y: 880 }, { x: 1000 - 350, y: 980 }, -1), true);
  assert.equal(mentonLooksWrong({ x: 1000 - 450, y: 940 }, { x: 1000 - 490, y: 880 }, { x: 1000 - 350, y: 980 }, -1), false);
});

test("a fine crop can carry an overlay and a finer grid", async () => {
  const img = await sharp({ create: { width: 800, height: 800, channels: 3, background: "#a08070" } }).png().toBuffer();
  const crop = await zoomCrop(img, { left: 100, top: 100, size: 400 }, 800, 50, markerOverlaySvg({ width: 800, height: 800 }, [{ x: 400, y: 400, label: "x" }]));
  assert.equal(crop.frame.step, 50);
  assert.equal((await sharp(crop.plain).metadata()).width, 800);
  assert.equal((await sharp(Buffer.from(crop.data, "base64")).metadata()).width, 800);
});
