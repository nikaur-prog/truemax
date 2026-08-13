import type { Sex } from "../engine/types.js";

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
  g.lineCap = "round";
  g.lineJoin = "round";

  // Filled, not outlined. The previous version drew every feature as a separate
  // stroked bezier — jaw, hairline, two side-locks, two eye arcs, a mouth — and
  // at low opacity over a dark frame that reads as a tangle of loose wire
  // rather than a person. A solid mass with the features knocked out of it is
  // the same silhouette every "no photo yet" placeholder uses, and it is what
  // the side-capture guide already does on the other screen.
  const skin = "rgba(255,255,255,0.13)";

  // Shoulders: one soft mound, cropped by the bottom of the frame.
  g.fillStyle = skin;
  g.beginPath();
  g.moveTo(-u * 1.25, u * 1.7);
  g.bezierCurveTo(-u * 1.1, u * 0.82, -u * 0.5, u * 0.66, 0, u * 0.66);
  g.bezierCurveTo(u * 0.5, u * 0.66, u * 1.1, u * 0.82, u * 1.25, u * 1.7);
  g.closePath();
  g.fill();

  // Head. The female outline carries a narrower jaw and a softer chin — the
  // same dimorphism the engine measures, drawn rather than asserted.
  const jaw = sex === "female" ? 0.6 : 0.7;
  const chin = sex === "female" ? 0.92 : 0.88;
  g.beginPath();
  g.moveTo(0, -u * 0.95);
  g.bezierCurveTo(u * 0.63, -u * 0.95, u * 0.72, -u * 0.26, u * jaw, u * 0.08);
  g.bezierCurveTo(u * (jaw - 0.05), u * 0.52, u * 0.33, u * chin, 0, u * chin);
  g.bezierCurveTo(-u * 0.33, u * chin, -u * (jaw - 0.05), u * 0.52, -u * jaw, u * 0.08);
  g.bezierCurveTo(-u * 0.72, -u * 0.26, -u * 0.63, -u * 0.95, 0, -u * 0.95);
  g.closePath();
  g.fill();

  // Hair sits on top of the head as one more filled shape: a rounded cap, or a
  // longer fall that widens past the jaw.
  g.beginPath();
  if (sex === "female") {
    g.moveTo(-u * 0.7, u * 0.62);
    g.bezierCurveTo(-u * 1.02, u * 0.1, -u * 1.0, -u * 1.18, 0, -u * 1.18);
    g.bezierCurveTo(u * 1.0, -u * 1.18, u * 1.02, u * 0.1, u * 0.7, u * 0.62);
    g.bezierCurveTo(u * 0.86, -u * 0.1, u * 0.8, -u * 0.62, 0, -u * 0.62);
    g.bezierCurveTo(-u * 0.8, -u * 0.62, -u * 0.86, -u * 0.1, -u * 0.7, u * 0.62);
  } else {
    g.moveTo(-u * 0.7, -u * 0.44);
    g.bezierCurveTo(-u * 0.78, -u * 1.16, u * 0.78, -u * 1.16, u * 0.7, -u * 0.44);
    g.bezierCurveTo(u * 0.5, -u * 0.76, -u * 0.5, -u * 0.76, -u * 0.7, -u * 0.44);
  }
  g.closePath();
  g.fill();

  // Features knocked back out of the mass, so they read at any size without
  // adding more line weight to the drawing.
  g.globalCompositeOperation = "destination-out";
  g.strokeStyle = "rgba(0,0,0,1)";
  g.lineWidth = Math.max(2.4, u * 0.055);

  // Closed, upward-curved eyes. A smiling arc reads as friendly; two dots read
  // as a target, on a page whose whole subject is being looked at.
  for (const side of [-1, 1]) {
    g.beginPath();
    g.arc(side * u * 0.29, -u * 0.14, u * 0.135, Math.PI * 1.16, Math.PI * 1.84);
    g.stroke();
  }
  g.beginPath();
  g.arc(0, u * 0.26, u * 0.27, Math.PI * 0.16, Math.PI * 0.84);
  g.stroke();

  g.restore();
}
