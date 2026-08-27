// The search lockup: "truemax.app" drawn as a small search bar, on screen for
// the whole video.
//
// The observation this steals is a pattern, not an asset: a persistent
// watermark that LOOKS like a search field converts better than a flat
// wordmark, because it is not a signature — it is an instruction the viewer's
// thumbs already know how to follow. What it looks like is entirely ours:
// house ink on the house dark, the mint kept for the accent, a magnifier
// drawn from two strokes rather than any borrowed icon.
//
// One drawing routine shared by every export renderer, so the lockup is
// identical on a rundown, a breakdown and a verdict frame — and so the next
// renderer gets it by calling one function instead of re-deriving a pill.
// Deterministic: pure function of its inputs, no clock, no randomness.

export interface SearchLockupOpts {
  /** Horizontal centre of the pill. */
  cx: number;
  /** Vertical centre of the pill. */
  cy: number;
  /** Pill height; everything else scales from it. Default 34. */
  h?: number;
  /** 0..1 master alpha. Default 1. */
  alpha?: number;
}

export function drawSearchLockup(ctx: CanvasRenderingContext2D, opts: SearchLockupOpts): void {
  const h = opts.h ?? 34;
  const alpha = opts.alpha ?? 1;
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;

  const fontPx = Math.round(h * 0.44);
  ctx.font = `500 ${fontPx}px Inter, Arial, sans-serif`;
  ctx.letterSpacing = "1px";
  const name = "truemax";
  const tld = ".app";
  const textW = ctx.measureText(name).width + ctx.measureText(tld).width;
  const glassR = h * 0.17; // magnifier lens radius
  const padX = h * 0.5;
  const gap = h * 0.32; // between magnifier and text
  const w = padX + glassR * 2.9 + gap + textW + padX;
  const x = opts.cx - w / 2;
  const y = opts.cy - h / 2;
  const r = h / 2;

  // The pill: dark glass with a faint mint rim and a soft outer glow. The
  // glow is what keeps it legible over a bright cheek without needing a hard
  // box; shadowBlur on the fill pass only, so the strokes stay crisp.
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.save();
  ctx.shadowColor = "rgba(12, 135, 111, 0.55)";
  ctx.shadowBlur = h * 0.5;
  ctx.fillStyle = "rgba(8, 11, 10, 0.72)";
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "rgba(63, 191, 154, 0.5)";
  ctx.lineWidth = Math.max(1, h * 0.038);
  ctx.stroke();

  // The magnifier: a ring and a handle, from the same two strokes every
  // drawn magnifier is made of.
  const gx = x + padX + glassR;
  const gy = opts.cy - h * 0.03;
  ctx.strokeStyle = "#3fbf9a";
  ctx.lineWidth = Math.max(1.4, h * 0.055);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(gx, gy, glassR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(gx + glassR * 0.74, gy + glassR * 0.74);
  ctx.lineTo(gx + glassR * 1.55, gy + glassR * 1.55);
  ctx.stroke();

  // The address, in the two-colour treatment every other surface uses.
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const tx = x + padX + glassR * 2.9 + gap;
  ctx.fillStyle = "#f5f5f1";
  ctx.fillText(name, tx, opts.cy + h * 0.03);
  ctx.fillStyle = "#3fbf9a";
  ctx.fillText(tld, tx + ctx.measureText(name).width, opts.cy + h * 0.03);
  ctx.restore();
}
