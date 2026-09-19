import test from "node:test";
import assert from "node:assert/strict";
import { LABEL_H, LABEL_W, captionTop, placeCallouts, reelPhotoPoint, reelPhotoRect } from "./demoReelLayout.js";
import { REEL } from "./demoReelData.js";

// The card as it actually renders on a phone: 301 CSS px wide, 3:3.76.
const W = 301;
const H = 377;

function box(p: { lx: number; ly: number }) {
  return { top: p.ly - 4, bottom: p.ly + LABEL_H - 4, left: p.lx, right: p.lx + LABEL_W };
}

function overlaps(a: ReturnType<typeof box>, b: ReturnType<typeof box>): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

// Three points per face is what calloutsFor picks, so that is what the placer
// is asked for here. Points come from the real reel data rather than made-up
// coordinates, because the bug this file exists for was a real face's jaw.
function threeFrom(face: (typeof REEL)[number]) {
  const rs = [...face.regions].sort((a, b) => b.score - a.score);
  return [rs[0]!, rs[rs.length >> 1]!, rs[rs.length - 1]!];
}

test("no callout is drawn through the score and the name", () => {
  // THE test for this module. The overall score and the name are DOM elements
  // sitting over the canvas, so nothing in the drawing code can see them and
  // nothing in a code review of the drawing code will notice a collision. The
  // jaw callout on Henry Cavill was landing squarely on "HENRY CAVILL" and it
  // took looking at a rendered frame to catch it.
  for (const face of REEL) {
    for (const p of placeCallouts(threeFrom(face), W, H)) {
      assert.ok(
        p.ly + LABEL_H - 4 <= captionTop(H),
        `${face.name}: a label reaches y=${p.ly + LABEL_H - 4}, into the caption at ${captionTop(H)}`,
      );
    }
  }
});

test("no two callouts overlap each other", () => {
  for (const face of REEL) {
    const placed = placeCallouts(threeFrom(face), W, H);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        assert.ok(
          !overlaps(box(placed[i]!), box(placed[j]!)),
          `${face.name}: callouts ${i} and ${j} overlap`,
        );
      }
    }
  }
});

test("every label stays inside the card", () => {
  for (const face of REEL) {
    for (const p of placeCallouts(threeFrom(face), W, H)) {
      assert.ok(p.lx >= 0, `${face.name}: label starts off the left edge at ${p.lx}`);
      assert.ok(p.lx + LABEL_W <= W, `${face.name}: label runs off the right edge`);
      assert.ok(p.ly - 4 >= 0, `${face.name}: label starts above the top edge`);
    }
  }
});

test("a label sits on the opposite side of the face from its point", () => {
  // Otherwise the label covers the thing it is pointing at, which is the whole
  // reason the reel bothers with leader lines.
  for (const face of REEL) {
    for (const p of placeCallouts(threeFrom(face), W, H)) {
      if (p.left) assert.ok(p.lx + LABEL_W <= p.ax + 1, "left-side label crosses its own point");
      else assert.ok(p.lx >= p.ax - 1, "right-side label crosses its own point");
    }
  }
});

test("the placer survives a card too short to hold anything", () => {
  // A very short viewport can make the reserved caption band taller than the
  // card. Clamping must still produce a finite position rather than NaN.
  for (const h of [377, 260, 160, 80]) {
    for (const p of placeCallouts(threeFrom(REEL[0]!), W, h)) {
      assert.ok(Number.isFinite(p.lx) && Number.isFinite(p.ly), `h=${h} produced ${p.lx},${p.ly}`);
      assert.ok(p.ly >= 0, `h=${h} placed a label at a negative y`);
    }
  }
});

test("cover-fit uses the actual photo aspect ratio, including the docked crop", () => {
  assert.deepEqual(reelPhotoRect(800, 1000, 300, 375), { dx: 0, dy: 0, dw: 300, dh: 375 });
  assert.deepEqual(reelPhotoRect(800, 1000, 300, 250), { dx: 0, dy: -62.5, dw: 300, dh: 375 });
  assert.deepEqual(reelPhotoRect(1200, 800, 300, 375), { dx: -131.25, dy: 0, dw: 562.5, dh: 375 });
});

test("the push-in grows around the same centre as the photo", () => {
  const rect = reelPhotoRect(800, 1000, 300, 250, 1.04);
  assert.deepEqual(rect, { dx: -6, dy: -70, dw: 312, dh: 390 });
  assert.deepEqual(reelPhotoPoint({ x: .5, y: .5 }, rect), { x: 150, y: 125 });
  const point = reelPhotoPoint({ x: .6, y: .7 }, rect);
  assert.ok(Math.abs(point.x - 181.2) < 1e-8);
  assert.equal(point.y, 203);
});

test("a jaw anchor follows the rendered portrait, not the shrinking photo viewport", () => {
  const point = { x: .5009, y: .7109 };
  const rect = reelPhotoRect(800, 1000, W, H * 2 / 3, 1.04);
  const [placed] = placeCallouts([point], W, H * 2 / 3, 18, rect);
  assert.equal(placed.ax, rect.dx + point.x * rect.dw);
  assert.equal(placed.ay, rect.dy + point.y * rect.dh);
  assert.ok(Math.abs(placed.ay - point.y * H * 2 / 3) > 20,
    "the old viewport multiplication visibly missed the actual jaw after docking");
});

test("mobile and desktop labels stay clear and contained while the photo docks and zooms", () => {
  for (const width of [240, 260, 280, 301, 320, 360, 390, 430]) {
    for (const dock of [0, .25, .5, .75, 1]) {
      for (const zoom of [1, 1.02, 1.04]) {
        const fullHeight = width * 1.25;
        const photoHeight = fullHeight * (1 - dock / 3);
        const reserve = 150 - 132 * dock;
        const rect = reelPhotoRect(800, 1000, width, photoHeight, zoom);
        for (const face of REEL) {
          const points = threeFrom(face);
          const placed = placeCallouts(points, width, photoHeight, reserve, rect);
          const context = `${face.slug}: width ${width}, dock ${dock}, zoom ${zoom}`;
          placed.forEach((callout, index) => {
            const bounds = box(callout);
            assert.ok(bounds.left >= 10 && bounds.right <= width - 10, `${context}: horizontal bounds`);
            assert.ok(bounds.top >= 0 && bounds.bottom <= photoHeight - reserve, `${context}: vertical bounds`);
            assert.deepEqual({ x: callout.ax, y: callout.ay }, reelPhotoPoint(points[index], rect),
              `${context}: the anchor stays on its feature`);
            for (const other of placed.slice(index + 1)) {
              assert.ok(!overlaps(bounds, box(other)), `${context}: callouts overlap`);
            }
          });
        }
      }
    }
  }
});

test("a cropped point is not moved to a different feature at the viewport edge", () => {
  const rect = reelPhotoRect(800, 1600, 300, 200, 1.04);
  const [placed] = placeCallouts([{ x: .5, y: .1 }], 300, 200, 18, rect);
  assert.ok(placed.ay < 0);
  assert.equal(placed.ay, rect.dy + .1 * rect.dh);
  assert.ok(box(placed).top >= 0, "only the label is constrained to the visible card");
});

test("unmounted and not-yet-decoded photos do not produce invalid cover transforms", () => {
  for (const dimensions of [[0, 0, 300, 375], [800, 1000, 0, 0], [NaN, 1000, 300, 375], [800, Infinity, 300, 375]]) {
    assert.deepEqual(reelPhotoRect(...dimensions as [number, number, number, number]),
      { dx: 0, dy: 0, dw: 0, dh: 0 });
  }
  assert.deepEqual(reelPhotoRect(800, 1000, 300, 375, NaN), reelPhotoRect(800, 1000, 300, 375));
  assert.deepEqual(reelPhotoRect(800, 1000, 300, 375, .5), reelPhotoRect(800, 1000, 300, 375));
});
