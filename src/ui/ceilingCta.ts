import { aggregateScoreToPercentile } from "../engine/scoring.js";
import { rankShort } from "./templates.js";

// Reuse the person's unchanged photo beside a modelled score scenario.
// Neither the second photo nor the recomputed score is an outcome forecast.

export interface CeilingInput {
  overall: number;
  potential: number;
  photo: HTMLCanvasElement | null;
}

export function ceilingCtaMarkup({ overall, potential }: CeilingInput): string {
  const pct = rankShort(aggregateScoreToPercentile(potential)).toLowerCase();
  const gap = potential - overall;
  return `<div class="ceil">
    <div class="ceil-faces" aria-hidden="true">
      <canvas class="ceil-face ceil-now"></canvas>
      <canvas class="ceil-face ceil-then"></canvas>
      <span class="ceil-shine"></span>
    </div>
    <div class="ceil-nums">
      <span class="ceil-n">${overall.toFixed(1)}</span>
      <span class="ceil-arrow">→</span>
      <span class="ceil-n hi">${potential.toFixed(1)}</span>
    </div>
    <p class="ceil-line">This modelled scenario is <b>${gap.toFixed(1)} points higher</b>, in the ${pct} of the reference set. It is not a personal ceiling or a promise that your face or score will change.</p>
    <p class="ceil-hon">That second image is your own photo, out of focus. We do not generate a face you have not got.</p>
  </div>`;
}

// Paints both canvases from the front capture. Called after the markup is in
// the document; does nothing without a photo, in which case the CSS leaves an
// empty frame rather than a broken one.
export function paintCeilingCta(root: ParentNode, photo: HTMLCanvasElement | null): void {
  if (!photo) {
    root.querySelector(".ceil-faces")?.classList.add("nophoto");
    // And the honesty line goes with them. It says "that second image is your
    // own photo, out of focus", which is exactly the right sentence when there
    // are two images and a claim about the second one, and a description of
    // something that is not on the screen when there are none. Found when this
    // block moved onto the offer screen, where a missing capture is ordinary
    // rather than theoretical.
    root.querySelector(".ceil-hon")?.remove();
    return;
  }
  for (const canvas of root.querySelectorAll<HTMLCanvasElement>(".ceil-face")) {
    // A square crop of the upper-middle of the capture, which is where a face
    // sits in a photograph this flow has already framed and quality-checked.
    const side = Math.min(photo.width, photo.height);
    const sx = (photo.width - side) / 2;
    const sy = Math.max(0, photo.height * 0.34 - side / 2);
    canvas.width = 320;
    canvas.height = 320;
    const context = canvas.getContext("2d");
    if (!context) continue;
    context.imageSmoothingQuality = "high";
    context.drawImage(photo, sx, sy, side, Math.min(side, photo.height - sy), 0, 0, 320, 320);
  }
}
