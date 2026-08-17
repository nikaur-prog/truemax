import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { Report } from "../engine/types.js";
import { REGION_NAMES, aggregateScoreToPercentile } from "../engine/scoring.js";
import { statedPct } from "../engine/precision.js";

// ---------------------------------------------------------------------------
// The endcard.
//
// Eighteen seconds of somebody's own footage and then one card. That card is
// the entire product placement in the cheapest content format there is, which
// makes it worth building properly rather than screenshotting the results page.
//
// WHY THIS LEADS WITH THE PERCENTILE.
//
// The format this imitates puts two scores side by side — 47 now, 97 possible —
// and the fifty-point gap is the hook. Our engine cannot produce that gap and
// will not be made to: potential only lifts metrics with a fixability above
// zero and leaves the shape descriptor pinned at today's value, because
// overstating what somebody can reach is what makes a potential number
// worthless (scoring.ts, at length).
//
// So on score-versus-score we lose that comparison every time. 5.4 becoming 6.3
// is not a hook.
//
// The way out is that the score is the least legible thing we own. The scale is
// a population curve where a point is 1.3 standard deviations, so most people
// sit bunched near the middle — which is exactly where the curve is STEEPEST,
// and where a small score move is a large move in rank. The same 5.4 → 6.3 is
// roughly top 36% → top 12%. A viewer can picture a room; nobody can picture
// 0.9 of a point.
//
// That is both the more watchable number and the true one, which is a rare
// alignment and worth taking. It is also the one a competitor cannot copy
// without conceding that their 97 was never a measurement.
//
// Percentiles go through statedPct, so the card never prints a precision the
// reference sample cannot support. That is why it reads "TOP 10%" and not
// "TOP 12.4%".
// ---------------------------------------------------------------------------

const W = 1080;
const H = 1920;

// The four regions the card has room for. Chosen rather than computed: a card
// showing all eight is a table, and a table is not a thing anybody screenshots.
const TILE_COUNT = 4;

export interface ScoreCardInput {
  report: Report;
  /** Optional label above the photo — a name, a week number, "AFTER". */
  caption?: string;
}

/** The top-N% a percentile corresponds to, already rounded for print. */
function topPct(percentile: number): number {
  return Math.max(1, 100 - statedPct(percentile));
}

export function renderScoreCard(
  canvas: HTMLCanvasElement,
  photo: HTMLCanvasElement,
  landmarks: NormalizedLandmark[],
  input: ScoreCardInput,
): void {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const { report } = input;

  ctx.fillStyle = "#050606";
  ctx.fillRect(0, 0, W, H);
  // A very slight lift behind the photo so the circle does not sit on flat
  // black — flat black reads as a rendering failure on an OLED phone.
  const glow = ctx.createRadialGradient(W / 2, 470, 60, W / 2, 470, 720);
  glow.addColorStop(0, "rgba(12,135,111,.16)");
  glow.addColorStop(1, "rgba(5,6,6,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, 1100);

  drawFaceCircle(ctx, photo, landmarks, W / 2, 470, 250);

  if (input.caption) {
    ctx.save();
    ctx.font = "500 26px Inter, Arial, sans-serif";
    ctx.letterSpacing = "6px";
    ctx.fillStyle = "#7f8682";
    ctx.textAlign = "center";
    ctx.fillText(input.caption.toUpperCase(), W / 2, 130);
    ctx.restore();
  }

  const nowPct = report.overallPercentile;
  const potentialPct = aggregateScoreToPercentile(report.potential);

  // The hero pair. Two columns, same layout, so the eye compares them directly
  // and the difference is the only thing that moves.
  drawHero(ctx, 96, 830, (W - 192) / 2 - 24, "NOW", report.overall, nowPct, "#f7f7f2");
  drawHero(
    ctx,
    W / 2 + 24,
    830,
    (W - 192) / 2 - 24,
    "POTENTIAL",
    report.potential,
    potentialPct,
    "#8ff3e0",
  );

  drawTiles(ctx, report, 96, 1180, W - 192);
  drawWatermark(ctx);
}

// The photograph, framed on the face and masked to a circle.
//
// Circular rather than rounded-rectangular because the card is mostly numbers,
// and a circle is the one shape in it that is obviously a person.
function drawFaceCircle(
  ctx: CanvasRenderingContext2D,
  photo: HTMLCanvasElement,
  landmarks: NormalizedLandmark[],
  cx: number,
  cy: number,
  r: number,
): void {
  let x0 = 1;
  let x1 = 0;
  let y0 = 1;
  let y1 = 0;
  for (const p of landmarks) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  const faceW = Math.max(1, (x1 - x0) * photo.width);
  const faceH = Math.max(1, (y1 - y0) * photo.height);
  // Square source, sized so the face fills about three quarters of the circle.
  let side = Math.max(faceW, faceH) * 1.34;
  side = Math.min(side, Math.min(photo.width, photo.height));
  const fx = ((x0 + x1) / 2) * photo.width;
  // Biased upward: a face centred on its bounding box in a circle looks like it
  // is sinking, because the crown of the head is not in the landmark set.
  const fy = ((y0 + y1) / 2) * photo.height - side * 0.04;

  const sx = Math.max(0, Math.min(photo.width - side, fx - side / 2));
  const sy = Math.max(0, Math.min(photo.height - side, fy - side / 2));

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(photo, sx, sy, side, side, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(143,243,224,.28)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

// One half of the hero pair: label, score, and the rank line that does the work.
function drawHero(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  label: string,
  score: number,
  percentile: number,
  colour: string,
): void {
  ctx.save();
  ctx.textAlign = "left";

  ctx.font = "500 24px Inter, Arial, sans-serif";
  ctx.letterSpacing = "5px";
  ctx.fillStyle = "#7f8682";
  ctx.fillText(label, x, y);

  ctx.font = "300 118px Fraunces, Georgia, serif";
  ctx.letterSpacing = "-4px";
  ctx.fillStyle = colour;
  const shown = score.toFixed(1);
  ctx.fillText(shown, x, y + 116);
  const scoreWidth = ctx.measureText(shown).width;
  ctx.font = "300 38px Fraunces, Georgia, serif";
  ctx.letterSpacing = "0px";
  ctx.fillStyle = "#5f6663";
  ctx.fillText("/10", x + scoreWidth + 10, y + 116);

  // The rank. Set larger and brighter than the label above it because this is
  // the line the whole card exists to deliver — the score is context for it,
  // not the other way round.
  ctx.font = "600 34px Inter, Arial, sans-serif";
  ctx.letterSpacing = "0px";
  ctx.fillStyle = colour;
  ctx.fillText(`Top ${topPct(percentile)}%`, x, y + 166);

  // The bar is positional, not decorative: it fills to the percentile, so the
  // two bars side by side show the rank gap as a length.
  const barY = y + 196;
  ctx.fillStyle = "#1b201e";
  roundRect(ctx, x, barY, width, 10, 5);
  ctx.fill();
  ctx.fillStyle = colour;
  roundRect(ctx, x, barY, Math.max(10, width * clamp01(percentile / 100)), 10, 5);
  ctx.fill();
  ctx.restore();
}

function drawTiles(
  ctx: CanvasRenderingContext2D,
  report: Report,
  x: number,
  y: number,
  width: number,
): void {
  // Strongest first. The card is a hook, and a hook opens on the best thing.
  const regions = [...report.regions]
    .filter((region) => Number.isFinite(region.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, TILE_COUNT);
  if (!regions.length) return;

  const gap = 28;
  const cw = (width - gap) / 2;
  const ch = 190;
  regions.forEach((region, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const tx = x + col * (cw + gap);
    const ty = y + row * (ch + gap);

    roundRect(ctx, tx, ty, cw, ch, 28);
    ctx.fillStyle = "#0f1211";
    ctx.fill();
    ctx.strokeStyle = "#222725";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.save();
    ctx.textAlign = "left";
    ctx.font = "500 22px Inter, Arial, sans-serif";
    ctx.letterSpacing = "3px";
    ctx.fillStyle = "#808783";
    ctx.fillText((REGION_NAMES[region.region] ?? region.region).toUpperCase(), tx + 32, ty + 52);

    ctx.font = "300 66px Fraunces, Georgia, serif";
    ctx.letterSpacing = "-2px";
    ctx.fillStyle = "#f3f4ef";
    ctx.fillText(region.score.toFixed(1), tx + 32, ty + 126);

    ctx.fillStyle = "#222725";
    roundRect(ctx, tx + 32, ty + 150, cw - 64, 8, 4);
    ctx.fill();
    ctx.fillStyle = region.score >= 6.5 ? "#8ff3e0" : region.score >= 4.5 ? "#0c876f" : "#e8a17a";
    roundRect(ctx, tx + 32, ty + 150, Math.max(8, (cw - 64) * clamp01(region.score / 10)), 8, 4);
    ctx.fill();
    ctx.restore();
  });
}

function drawWatermark(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.font = "500 30px Inter, Arial, sans-serif";
  ctx.letterSpacing = "4px";
  ctx.textAlign = "left";
  const name = "truemax";
  const tld = ".app";
  const total = ctx.measureText(name).width + ctx.measureText(tld).width;
  const x = (W - total) / 2;
  const y = H - 84;
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = "#f5f5f1";
  ctx.fillText(name, x, y);
  ctx.fillStyle = "#0c876f";
  ctx.fillText(tld, x + ctx.measureText(name).width, y);

  // The one line of provenance. A card of numbers with no statement of what
  // they are measured against is exactly the artefact this product exists to
  // argue with, and it costs one line to not be that.
  ctx.globalAlpha = 0.5;
  ctx.font = "500 21px Inter, Arial, sans-serif";
  ctx.letterSpacing = "2px";
  ctx.textAlign = "center";
  ctx.fillStyle = "#6d746f";
  ctx.fillText("MEASURED AGAINST A REFERENCE POPULATION", W / 2, H - 40);
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export { topPct };
