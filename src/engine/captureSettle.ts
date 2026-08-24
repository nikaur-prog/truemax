import type { CaptureStatus } from "./captureGuide.js";

// ---------------------------------------------------------------------------
// Holding the capture coaching still enough to read.
//
// The guide is evaluated on every camera frame, which is right — the lamp and
// the readiness bar should track the face continuously. The HINT is a different
// thing: it is a sentence somebody has to read, and a face sitting on the
// boundary between two checks flips it thirty times a second. Colour strobes
// between amber and green, and because the box is sized by its text, the text
// changing also changes its width, so it pulses in and out at the same time.
// That is the "glitchy" capture screen: not one bad animation but a state
// machine with no hysteresis driving three properties at once.
//
// So a reading has to REPEAT before it is believed. Anything that survives
// `frames` consecutive evaluations becomes the shown state; anything that does
// not is a flicker and is ignored. At 30fps the default of 6 is about a fifth
// of a second — long enough to kill the strobe, short enough that genuinely
// fixing your pose still feels immediate.
//
// Going GREEN is exempt. The whole point of the readiness state is that the
// shutter is armed, and making somebody hold a good pose for an extra fifth of
// a second before the screen admits it is the one delay that costs a photo.
// Falling out of green still has to repeat, so a single dropped frame does not
// yank the shutter away.
// ---------------------------------------------------------------------------

export interface Reading {
  status: CaptureStatus;
  hint: string;
  detail: string;
}

export interface Settler {
  /** Feed one frame's reading; get back the one that should be on screen. */
  settle(next: Reading): Reading;
}

const same = (a: Reading, b: Reading): boolean =>
  a.status === b.status && a.hint === b.hint && a.detail === b.detail;

export function createSettler(frames = 6): Settler {
  let shown: Reading | null = null;
  let candidate: Reading | null = null;
  let seen = 0;

  return {
    settle(next: Reading): Reading {
      // Nothing on screen yet: the first reading is the truth, or there would
      // be a fifth of a second of blank coaching at the top of every session.
      if (!shown) {
        shown = next;
        candidate = next;
        seen = 1;
        return shown;
      }
      if (same(next, shown)) {
        candidate = next;
        seen = 0;
        return shown;
      }
      if (candidate && same(next, candidate)) seen++;
      else {
        candidate = next;
        seen = 1;
      }
      // Good news travels immediately; see the note above.
      if (next.status === "green" || seen >= frames) {
        shown = next;
        seen = 0;
      }
      return shown;
    },
  };
}
