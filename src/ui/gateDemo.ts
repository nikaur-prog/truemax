import { mountDemoReel } from "./demoReel.js";
import type { ReelHandle } from "./demoReel.js";

// ---------------------------------------------------------------------------
// The live demo strip under the account gate.
//
// The gate is the one screen where somebody has done the work — two captures,
// a landmark review — and is being asked for an email before they see anything.
// That is the moment the product has to look worth an account, and a wall of
// text saying "trust us" is not it. So the engine runs, on a face they know,
// while they decide.
//
// It is deliberately a FIXED-HEIGHT strip rather than a panel that grows to fit
// whatever is inside it. A demo under a call to action competes with the call to
// action; the one thing it must never do is become the biggest object on the
// screen. One row, one face at a time, the same height whatever is playing.
//
// It reuses mountDemoReel — the same renderer as the landing page, and the same
// nine reference faces with their real measured scores. Nothing here is a mock.
// ---------------------------------------------------------------------------

export interface GateDemoHandle {
  stop(): void;
}

export function mountGateDemo(host: HTMLElement): GateDemoHandle {
  const strip = document.createElement("div");
  strip.className = "gatedemo";
  strip.innerHTML = `
    <div class="gatedemo-head">
      <span class="klabel">THE SAME ENGINE, RUNNING NOW</span>
      <p>Reference faces, measured the way yours is about to be.</p>
    </div>
    <div class="gatedemo-row">
      <div class="gatedemo-stage">
        <canvas class="gatedemo-canvas"></canvas>
      </div>
      <div class="gatedemo-read">
        <b class="gatedemo-score"></b>
      </div>
    </div>`;
  host.appendChild(strip);

  const canvas = strip.querySelector<HTMLCanvasElement>(".gatedemo-canvas")!;
  // The score is the whole read now. The line above it held the face's name
  // and then the AI-generated disclosure; both are gone, so the number that
  // was the small print becomes the thing beside the picture.
  const score = strip.querySelector<HTMLElement>(".gatedemo-score")!;

  let reel: ReelHandle | null = null;
  // Only render while it is actually on screen. This sits below a call to
  // action on a page that has just finished two captures and a face-mesh run;
  // an animation looping in a scrolled-past region is heat for nothing.
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting && !reel) reel = mountDemoReel(canvas, score);
      else if (!entry.isIntersecting && reel) {
        reel.stop();
        reel = null;
      }
    }
  }, { threshold: 0.15 });
  io.observe(strip);

  return {
    stop() {
      io.disconnect();
      reel?.stop();
      reel = null;
      strip.remove();
    },
  };
}
