import test from "node:test";
import assert from "node:assert/strict";
import { LABEL_H, LABEL_W, captionTop, placeCallouts } from "./demoReelLayout.js";
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
