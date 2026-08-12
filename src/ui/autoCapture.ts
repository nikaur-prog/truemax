// ---------------------------------------------------------------------------
// Hands-off capture.
//
// Holding a green frame and then reaching for a button is the one moment the
// framing is guaranteed to move, and on the side profile it is worse than that:
// you are turned away from the screen, so you cannot see the button, the
// readiness lamp, or a countdown drawn on the preview. The whole guidance
// system goes blind at exactly the moment it matters.
//
// So the shutter fires itself once the frame has been good for a beat, and the
// countdown is AUDIBLE. A tick per second and a different tone on the shutter
// is the only channel that still works when the subject is not looking at the
// display. Anything the countdown says visually is a bonus for the front.
//
// The count resets the instant the frame stops being good, which is what makes
// it safe: it cannot fire on a frame that has drifted, and someone who needs
// longer simply gets a longer countdown rather than a failed photo. The manual
// button keeps working throughout for anyone who would rather take it himself.
// ---------------------------------------------------------------------------

export interface AutoCapture {
  // Called with the current readiness on every analysed frame.
  update(ready: boolean): void;
  // Stop counting and forget any progress, without firing.
  cancel(): void;
  armed(): boolean;
}

interface Opts {
  // How long the frame must stay good before the shutter fires.
  seconds?: number;
  // Remaining whole seconds, or null when not counting. For the on-screen ring.
  onTick(remaining: number | null): void;
  onFire(): void;
}

export function createAutoCapture(opts: Opts): AutoCapture {
  const total = (opts.seconds ?? 2.5) * 1000;
  let startedAt = 0;
  let raf = 0;
  let lastBeep = -1;
  let fired = false;

  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    startedAt = 0;
    lastBeep = -1;
  };

  const frame = (now: number) => {
    if (!startedAt || fired) return;
    const elapsed = now - startedAt;
    const remaining = Math.max(0, total - elapsed);
    // Clamped to the whole seconds the duration actually contains. Without the
    // clamp a 2.5s countdown opens on "3" — ceil(2.5) — so it reads and sounds
    // like a three second wait, which is not what it is. Counting 2, 1 over 2.5
    // seconds is the honest display of the same timer.
    const whole = Math.min(Math.floor(total / 1000), Math.ceil(remaining / 1000));

    // One tick per whole second as it falls. Counting down out loud is what a
    // person turned away from the screen actually has.
    if (whole !== lastBeep && whole > 0) {
      lastBeep = whole;
      tick(whole);
    }
    opts.onTick(whole);

    if (remaining <= 0) {
      fired = true;
      shutter();
      stop();
      opts.onTick(null);
      opts.onFire();
      // Allow a later re-arm (retake, second capture) once this one is spent.
      fired = false;
      return;
    }
    raf = requestAnimationFrame(frame);
  };

  return {
    update(ready: boolean) {
      if (ready) {
        if (!startedAt) {
          startedAt = performance.now();
          raf = requestAnimationFrame(frame);
        }
      } else if (startedAt) {
        stop();
        opts.onTick(null);
      }
    },
    cancel() {
      stop();
      opts.onTick(null);
    },
    armed: () => startedAt !== 0,
  };
}

// --- audio ------------------------------------------------------------------
//
// Created lazily and only ever from inside a user gesture chain (the camera is
// opened by a click), which is what browsers require. If audio is blocked or
// unavailable the countdown still runs; it just goes quiet, so nothing here can
// stop a capture.

let ac: AudioContext | null = null;
function ctx(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ac = ac ?? new Ctor();
    if (ac.state === "suspended") void ac.resume();
    return ac;
  } catch {
    return null;
  }
}

function beep(freq: number, ms: number, gain: number): void {
  const a = ctx();
  if (!a) return;
  try {
    const osc = a.createOscillator();
    const vol = a.createGain();
    osc.frequency.value = freq;
    osc.type = "sine";
    // Shaped rather than square-edged, because an abrupt gate on a sine is a
    // click, and a click is the least pleasant sound a face app could make.
    const t = a.currentTime;
    vol.gain.setValueAtTime(0, t);
    vol.gain.linearRampToValueAtTime(gain, t + 0.01);
    vol.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    osc.connect(vol).connect(a.destination);
    osc.start(t);
    osc.stop(t + ms / 1000 + 0.02);
  } catch {
    /* audio is a courtesy, never a requirement */
  }
}

// Traffic-light progression: a low first beat, a higher second beat, then the
// distinct high shutter ping. This matters most for the side photo, when the
// person is looking away from the screen and cannot read visual directions.
function tick(remaining: number): void {
  beep(remaining >= 2 ? 440 : 660, 100, 0.055);
}

// A higher, longer tone the moment the photo is taken, so "it fired" is
// unmistakably different from "it is still counting".
function shutter(): void {
  beep(1040, 160, 0.07);
}
