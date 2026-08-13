import type { Sex } from "../engine/types.ts";

// ---------------------------------------------------------------------------
// The empty capture frame on /quick.
//
// It was a flat grey rectangle, which on a page whose entire purpose is being
// filmed is dead air: the first second of every clip was a blank box. A
// silhouette says "put your face here" without a line of instruction, and it
// gives the shot something to cut from.
//
// Drawn rather than shipped as an image because it has to answer to the chosen
// reference population — the frame after someone taps "woman" should not show a
// man's jaw — and two more image assets to keep in sync is a worse trade than
// forty lines of path.
//
// It is deliberately a friendly, smiling, generic head. This page is the front
// door for people arriving from a video; the first thing they see should not be
// a clinical outline of the thing about to be judged.
// ---------------------------------------------------------------------------

export function drawQuickSilhouette(canvas: HTMLCanvasElement, sex: Sex): void {
  const w = canvas.clientWidth || 320;
  const h = canvas.clientHeight || 420;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const g = canvas.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  // One unit is a head-width, so the whole drawing scales from the frame.
  const u = Math.min(w * 0.52, h * 0.42);
  const cx = w / 2;
  const cy = h * 0.46;

  g.save();
  g.translate(cx, cy);
  g.strokeStyle = "rgba(255,255,255,0.22)";
  g.lineWidth = Math.max(1.5, u * 0.018);
  g.lineCap = "round";
  g.lineJoin = "round";

  // Shoulders, behind everything, cropped by the frame.
  g.beginPath();
  g.moveTo(-u * 1.15, u * 1.5);
  g.bezierCurveTo(-u * 1.0, u * 0.86, -u * 0.42, u * 0.74, 0, u * 0.74);
  g.bezierCurveTo(u * 0.42, u * 0.74, u * 1.0, u * 0.86, u * 1.15, u * 1.5);
  g.stroke();

  // Head. The female outline is a narrower jaw and a softer chin — the same
  // dimorphism the engine measures, drawn rather than asserted.
  const jaw = sex === "female" ? 0.62 : 0.72;
  const chin = sex === "female" ? 0.94 : 0.9;
  g.beginPath();
  g.moveTo(0, -u * 0.92);
  g.bezierCurveTo(u * 0.62, -u * 0.92, u * 0.7, -u * 0.28, u * jaw, u * 0.06);
  g.bezierCurveTo(u * (jaw - 0.06), u * 0.5, u * 0.34, u * chin, 0, u * chin);
  g.bezierCurveTo(-u * 0.34, u * chin, -u * (jaw - 0.06), u * 0.5, -u * jaw, u * 0.06);
  g.bezierCurveTo(-u * 0.7, -u * 0.28, -u * 0.62, -u * 0.92, 0, -u * 0.92);
  g.stroke();

  // Hair: a short crop, or a longer fall past the jaw.
  g.beginPath();
  if (sex === "female") {
    g.moveTo(-u * 0.72, -u * 0.2);
    g.bezierCurveTo(-u * 0.92, -u * 0.62, -u * 0.6, -u * 1.06, 0, -u * 1.06);
    g.bezierCurveTo(u * 0.6, -u * 1.06, u * 0.92, -u * 0.62, u * 0.72, -u * 0.2);
    g.moveTo(-u * 0.78, -u * 0.34);
    g.lineTo(-u * 0.68, u * 0.62);
    g.moveTo(u * 0.78, -u * 0.34);
    g.lineTo(u * 0.68, u * 0.62);
  } else {
    g.moveTo(-u * 0.64, -u * 0.52);
    g.bezierCurveTo(-u * 0.72, -u * 1.0, u * 0.72, -u * 1.0, u * 0.64, -u * 0.52);
  }
  g.stroke();

  // Eyes — closed, curved upward. A smiling arc reads as friendly at any size,
  // where two dots read as a target.
  for (const side of [-1, 1]) {
    g.beginPath();
    g.arc(side * u * 0.3, -u * 0.16, u * 0.13, Math.PI * 1.15, Math.PI * 1.85);
    g.stroke();
  }

  // Smile.
  g.beginPath();
  g.arc(0, u * 0.3, u * 0.26, Math.PI * 0.18, Math.PI * 0.82);
  g.stroke();

  g.restore();
}
