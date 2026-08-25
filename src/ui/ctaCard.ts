// ---------------------------------------------------------------------------
// The endcard, shared by every video this product exports.
//
// One card, one drawing function, three exporters: the beat reel, the rundown,
// and the breakdown/verdict cuts. It was born inside the beat reel and moved
// here the day the others wanted it, because three hand-copied endcards is how
// a brand ends up with three slightly different wordmarks in the wild — the
// tracking drifts on one, the accent on another, and none of them is wrong
// enough for anyone to file a bug.
//
// Drawn from type at whatever resolution the caller runs, so a 4K export gets
// a 4K card rather than an upscaled screenshot. The landing page's own line,
// in its own faces.
// ---------------------------------------------------------------------------

/**
 * Paint the card over the whole frame.
 *
 * `into` is seconds since the card appeared: the text fades up over a third of
 * a second and the rule under the headline draws in over `ruleSeconds` — the
 * only motion on an otherwise still close. The background is painted at full
 * strength immediately, because the card arrives on a cut, not a dissolve.
 */
export function drawCtaCard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  into: number,
  ruleSeconds: number,
): void {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#0d0f11";
  ctx.fillRect(0, 0, w, h);
  const u = w / 1080; // identical proportions at every export size
  const cx = w / 2;
  const fade = Math.min(1, into / 0.35);
  ctx.globalAlpha = fade;

  ctx.textAlign = "center";
  ctx.fillStyle = "#f4f2ec";
  ctx.font = `300 ${Math.round(64 * u)}px "Fraunces Variable", Fraunces, Georgia, serif`;
  ctx.fillText("Looks are no longer", cx, h * 0.44);
  ctx.fillText("subjective.", cx, h * 0.44 + 76 * u);

  const grow = Math.min(1, into / Math.max(0.2, ruleSeconds));
  ctx.fillStyle = "#2f9e73";
  ctx.fillRect(cx - 90 * u * grow, h * 0.52, 180 * u * grow, Math.max(2, 3 * u));

  ctx.fillStyle = "rgba(244,242,236,0.92)";
  ctx.font = `500 ${Math.round(26 * u)}px "Inter Variable", Inter, system-ui, sans-serif`;
  // Canvas has no letter-spacing; the wordmark's tracking is the identity, so
  // it is spaced by hand.
  const gap = 10 * u;
  const text = "TRUEMAX";
  const widths = [...text].map((c) => ctx.measureText(c).width);
  const totalW = widths.reduce((a, b) => a + b, 0) + gap * (text.length - 1);
  let x = cx - totalW / 2;
  [...text].forEach((c, i) => {
    ctx.fillText(c, x + widths[i] / 2, h * 0.585);
    x += widths[i] + gap;
  });

  ctx.fillStyle = "rgba(244,242,236,0.6)";
  ctx.font = `400 ${Math.round(24 * u)}px "Inter Variable", Inter, system-ui, sans-serif`;
  ctx.fillText("truemax.app", cx, h * 0.63);
  ctx.restore();
}
