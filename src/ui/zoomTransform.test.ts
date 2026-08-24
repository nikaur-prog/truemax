import test from "node:test";
import assert from "node:assert/strict";
import { IDENTITY_ZOOM, zoomToBounds, zoomTransform } from "./zoomTransform.js";

// ---------------------------------------------------------------------------
// The zoom is algebra, and algebra is testable without a browser.
//
// zoomTransform claims that translate((1−s)·o) scale(s) about origin 0 0 is
// the same map as scale(s) about origin o. These pin that claim, because the
// whole reason the helper exists — transitions that glide instead of jumping —
// is only safe if the END states are pixel-identical to what transform-origin
// produced before.
// ---------------------------------------------------------------------------

// Where a point (in % of the element) lands under the emitted transform.
function apply(spec: Parameters<typeof zoomTransform>[0], p: number, axis: "x" | "y"): number {
  const t = zoomTransform(spec);
  const m = t.match(/translate\((-?[\d.]+)%, (-?[\d.]+)%\) scale\(([\d.]+)\)/);
  assert.ok(m, `unparseable transform: ${t}`);
  const tx = Number(m[1]);
  const ty = Number(m[2]);
  const s = Number(m[3]);
  return s * p + (axis === "x" ? tx : ty);
}

test("the origin point does not move — that is what 'origin' means", () => {
  for (const spec of [
    { scale: 2, originX: 30, originY: 70 },
    { scale: 1.4, originX: 0, originY: 100 },
    { scale: 2.8, originX: 50, originY: 50 },
  ]) {
    assert.ok(Math.abs(apply(spec, spec.originX, "x") - spec.originX) < 0.01, `x drifted at ${JSON.stringify(spec)}`);
    assert.ok(Math.abs(apply(spec, spec.originY, "y") - spec.originY) < 0.01, `y drifted at ${JSON.stringify(spec)}`);
  }
});

test("scale 1 is the identity, spelled out rather than 'none'", () => {
  // Explicit so a transition TO rest interpolates instead of snapping.
  const t = zoomTransform(IDENTITY_ZOOM);
  assert.match(t, /translate\(0\.000%, 0\.000%\) scale\(1\.0000\)/);
});

test("any origin inside the element keeps a zoomed frame covered", () => {
  // Coverage interval [o(1−s), o(1−s)+s·100] must contain [0,100] — otherwise
  // the pan reveals empty stage past the photograph's edge.
  for (const o of [0, 10, 50, 90, 100]) {
    for (const s of [1.15, 2, 2.8]) {
      const lo = apply({ scale: s, originX: o, originY: o }, 0, "x");
      const hi = apply({ scale: s, originX: o, originY: o }, 100, "x");
      assert.ok(lo <= 0.01 && hi >= 99.99, `gap at origin ${o}%, scale ${s}: [${lo}, ${hi}]`);
    }
  }
});

test("zoomToBounds frames the box and respects its clamps", () => {
  // A tiny construction must not invert into an absurd magnification.
  const eye = zoomToBounds({ x0: 0.44, y0: 0.38, x1: 0.5, y1: 0.4 });
  assert.ok(eye.scale <= 2.8, `tiny box exploded to ${eye.scale}`);
  // A construction that already fills the frame cannot be zoomed into, and
  // must not be faked: it sits at 1 rather than being pushed to the floor and
  // cropped. (This assertion originally demanded >= 1.25 and was wrong — it
  // encoded the very cropping the floor now avoids.)
  const face = zoomToBounds({ x0: 0.1, y0: 0.05, x1: 0.9, y1: 0.95 });
  assert.ok(face.scale >= 1 && face.scale <= 1.01, `full-frame box scaled to ${face.scale}`);
  // A mid-sized one still gets a real move.
  const mid = zoomToBounds({ x0: 0.3, y0: 0.3, x1: 0.65, y1: 0.62 });
  assert.ok(mid.scale >= 1.25, `mid-sized box collapsed to ${mid.scale}`);
  // And the camera centres on the box, wherever it sits.
  const jaw = zoomToBounds({ x0: 0.2, y0: 0.7, x1: 0.6, y1: 0.9 });
  assert.ok(Math.abs(jaw.originX - 40) < 0.01);
  assert.ok(Math.abs(jaw.originY - 80) < 0.01);
});

test("the minimum-scale floor never crops the box it is framing", () => {
  // The floor exists so a wide construction still reads as a camera move. It
  // must not achieve that by pushing the measurement's own ends out of frame —
  // which is what a blunt Math.max(min, …) did at spans above 1/min.
  for (const span of [0.5, 0.74, 0.8, 0.9, 0.98]) {
    const half = span / 2;
    const b = { x0: 0.5 - half, y0: 0.5 - half, x1: 0.5 + half, y1: 0.5 + half };
    const z = zoomToBounds(b, { pad: 0 });
    assert.ok(
      span * z.scale <= 1.0001,
      `span ${span} at scale ${z.scale.toFixed(3)} covers ${(span * z.scale).toFixed(3)} frames — the ends are cropped`,
    );
  }
});
