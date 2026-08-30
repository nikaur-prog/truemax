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
// The count PAUSES while the frame is not good, which is what makes it safe:
// the timer is not running, so the shutter cannot fire on a frame that has
// drifted. It resumes where it stopped rather than starting again, so somebody
// who wobbles gets a slightly longer countdown instead of an endless one. The
// manual button keeps working throughout for anyone who would rather take it
// himself.
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
  const total = (opts.seconds ?? 1.5) * 1000;
  // Two beeps then the shutter, evenly spaced, however long the timer is.
  //
  // This used to tick once per whole SECOND, which tied the number of beeps to
  // the duration: shortening the countdown to 1.5s under that rule would have
  // produced a single lonely beep and then a shutter, which does not read as a
  // countdown at all. Counting in fixed steps instead means the rhythm is the
  // same — beep, beep, click — whether the wait is 1.5 seconds or three.
  const STEPS = 2;
  const stepMs = total / STEPS;
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
    // Steps remaining, not seconds remaining. Both the beep and the number on
    // screen come from the same counter, so what you hear and what you see can
    // never disagree.
    const whole = Math.min(STEPS, Math.ceil(remaining / stepMs));

    // Counting down out loud is the whole point: on the side capture the person
    // is turned away from the screen and the audio is all they have.
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

  // IT PAUSES. IT DOES NOT START AGAIN.
  //
  // This used to throw away the whole count on a sustained bad frame, and the
  // symptom was reported from a real run: the countdown restarting three, four,
  // five times before a photo finally landed, with nothing on screen explaining
  // why. Every blocking gate is a live measurement of a moving person — face
  // width, centring, pitch, yaw, roll, motion blur, expression — so on a phone
  // held at arm's length, something dips below its threshold every second or
  // so. Under a reset rule, a 1.5-second countdown needs 1.5 uninterrupted
  // seconds, and a person who twitches every second never gets one.
  //
  // Pausing costs the interruption and nothing more. Two half-second wobbles
  // add half a second to the wait instead of restarting the wait twice. It is
  // also strictly safer than the old rule in the way that matters: the shutter
  // still cannot fire on a bad frame, because the timer is not running while
  // the frame is bad.
  //
  // A LONG absence still cancels outright, because at that point the person has
  // put the phone down or walked out of frame, and a countdown that resumes
  // from 0.2 seconds when they come back would fire before they were ready.
  const GRACE_FRAMES = 4;
  const ABANDON_MS = 4000;
  let misses = 0;
  let pausedAt = 0;
  let badSince = 0;

  return {
    update(ready: boolean) {
      if (ready) {
        misses = 0;
        badSince = 0;
        if (pausedAt) {
          // Resume where it stopped: push the start forward by exactly the
          // time spent paused, so the remaining count is unchanged.
          startedAt += performance.now() - pausedAt;
          pausedAt = 0;
          raf = requestAnimationFrame(frame);
          return;
        }
        if (!startedAt) {
          startedAt = performance.now();
          raf = requestAnimationFrame(frame);
        }
        return;
      }

      if (!startedAt) return;
      const now = performance.now();
      if (!badSince) badSince = now;
      // Gone long enough that this is no longer a wobble. Forget the progress.
      if (now - badSince >= ABANDON_MS) {
        stop();
        pausedAt = 0;
        opts.onTick(null);
        return;
      }
      // A brief dip is held, exactly as the hint text is (captureSettle), so a
      // single bad frame cannot stall a count that is about to complete.
      if (!pausedAt && ++misses >= GRACE_FRAMES) {
        pausedAt = now;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    cancel() {
      stop();
      pausedAt = 0;
      badSince = 0;
      misses = 0;
      opts.onTick(null);
    },
    // Paused still counts as armed: the count is held, not discarded, and a
    // caller asking "is a capture under way" should hear yes.
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

// An actual camera shutter, not another beep.
//
// This was a 1040Hz sine, and a sine is the one thing a shutter is not: a
// mechanical shutter is broadband noise — a snap, not a pitch. On the side
// capture the person is turned away from the screen and the sound is the entire
// feedback channel, so "the photo was taken" has to be unmistakable from "the
// countdown is still running". Two beeps and a third beep is a countdown that
// stopped. Two beeps and a CLICK is a photograph.
//
// Built as two short filtered noise bursts a few milliseconds apart, which is
// what an SLR mirror actually does — up, then down. Nobody consciously hears
// the two halves; they hear a camera.
function shutter(): void {
  noiseClick(0, 0.055, 2600);
  noiseClick(0.045, 0.04, 1800);
}

function noiseClick(delay: number, gain: number, cutoff: number): void {
  const a = ctx();
  if (!a) return;
  try {
    const t = a.currentTime + delay;
    const len = Math.floor(a.sampleRate * 0.05);
    const buffer = a.createBuffer(1, len, a.sampleRate);
    const data = buffer.getChannelData(0);
    // White noise, decaying fast. The steep envelope is what makes it read as a
    // mechanism rather than as static.
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 6;
    }
    const src = a.createBufferSource();
    src.buffer = buffer;
    // Band-passed so it sits where a small mechanism sits, instead of hissing
    // across the whole spectrum.
    const filter = a.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = cutoff;
    filter.Q.value = 0.8;
    const vol = a.createGain();
    vol.gain.setValueAtTime(gain, t);
    vol.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(filter).connect(vol).connect(a.destination);
    src.start(t);
    src.stop(t + 0.06);
  } catch {
    /* audio is a courtesy, never a requirement */
  }
}
