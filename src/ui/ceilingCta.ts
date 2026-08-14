import { aggregateScoreToPercentile } from "../engine/scoring.js";
import { rankShort } from "./templates.js";

// ---------------------------------------------------------------------------
// The ceiling, as something worth reaching for.
//
// The number was already on the paywall card and it was doing nothing, because
// "your potential is 7.4" is a sentence, and a sentence next to a blurred wall
// of text is not a reason to get a card out. The number needs a picture.
//
// What it does NOT get is a fabricated one. Every looksmaxxing app in this
// category will happily generate the face you could have, and it is the single
// most dishonest thing in the category: it is a rendering, it is not derived
// from any measurement, and the person is being sold a photograph of somebody
// who does not exist. TrueMax's entire pitch is that it shows the actual maths.
// One fake after-photo and there is nothing left to defend.
//
// So the second image is THEIR OWN PHOTOGRAPH, out of focus, and the caption
// says so in as many words. That is not a compromise, it is the better image:
// the blur reads as the part that is not decided yet, which is exactly what a
// ceiling is. The two numbers underneath are real, computed by the engine from
// the fixable metrics alone, and they are what the person is actually buying
// the route to.
// ---------------------------------------------------------------------------

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
    <p class="ceil-line">Our engine puts your ceiling <b>${gap.toFixed(1)} points higher</b>, in the ${pct} of the reference set. Every point of that gap is a metric that moves without surgery.</p>
    <p class="ceil-hon">That second image is your own photo, out of focus. We do not generate a face you have not got.</p>
  </div>`;
}

// Paints both canvases from the front capture. Called after the markup is in
// the document; does nothing without a photo, in which case the CSS leaves an
// empty frame rather than a broken one.
export function paintCeilingCta(root: ParentNode, photo: HTMLCanvasElement | null): void {
  if (!photo) {
    root.querySelector(".ceil-faces")?.classList.add("nophoto");
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
