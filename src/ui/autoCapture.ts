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

import { playCaptureTick } from "./captureFeedback.js";

export interface AutoCapture {
  // Called with the current readiness on every analysed frame.
  update(ready: boolean): void;
  // Stop counting and forget any progress, without firing.
  cancel(): void;
  armed(): boolean;
  // Includes a brief paused count, so its framing can remain steady.
  hasProgress(): boolean;
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
  let startedAt: number | null = null;
  let raf = 0;
  let lastBeep = -1;
  let fired = false;
  // Declared up here rather than beside the pause logic below, because frame()
  // has to be able to refuse to run while paused. See the guard in frame().
  let pausedAt = 0;
  let badSince = 0;
  // The latest time any caller has shown the countdown. frame() is driven by
  // two clocks: requestAnimationFrame's frame-start stamp, and performance.now()
  // from a readiness update that arrives after synchronous CPU inference. The
  // next paint's stamp can be OLDER than that update, and reading it raw moved
  // the count backwards across a step: 2, 1, 2, 1, with both beeps replayed.
  let clock = 0;

  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    startedAt = null;
    lastBeep = -1;
  };

  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };

  const frame = (stamp: number) => {
    // The callback identified by `raf` is the callback running now. Clear it
    // before doing any work so a readiness update arriving during this frame
    // can schedule exactly one successor, never a parallel countdown loop.
    raf = 0;
    const now = Math.max(stamp, clock);
    clock = now;
    // An iOS background/foreground transition can dispatch a queued paint
    // before the next camera result. Never spend time hidden as a countdown.
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      stop();
      pausedAt = 0;
      badSince = 0;
      opts.onTick(null);
      return;
    }
    // PAUSED MEANS PAUSED, even for a callback already in flight.
    //
    // cancelAnimationFrame is asked for below, and belt-and-braces is right
    // here: a callback the browser has already dispatched cannot be recalled,
    // and startedAt deliberately survives a pause because it is holding the
    // progress. Without this line that surviving value is all a stale callback
    // needs to complete the count and fire the shutter on a frame the gates
    // rejected — the same outcome the grace period used to produce, arriving
    // by a different route.
    if (pausedAt) return;
    if (startedAt === null || fired) return;
    const elapsed = now - startedAt;
    const remaining = Math.max(0, total - elapsed);
    // Steps remaining, not seconds remaining. Both the beep and the number on
    // screen come from the same counter, so what you hear and what you see can
    // never disagree.
    const whole = Math.min(STEPS, Math.ceil(remaining / stepMs));

    // Counting down out loud is the whole point: on the side capture the person
    // is turned away from the screen and the audio is all they have.
    // A count only ever steps down. stop() resets lastBeep for a fresh count.
    if (lastBeep < 0 || whole < lastBeep) {
      lastBeep = whole;
      if (whole > 0) {
        playCaptureTick(whole);
        // The label changes twice, not on every animation frame. Rewriting
        // identical camera text sixty times a second makes layout compete
        // with inference on the phones that need the countdown most.
        opts.onTick(whole);
      }
    }

    if (remaining <= 0) {
      fired = true;
      stop();
      opts.onTick(null);
      opts.onFire();
      // One camera attempt gets one automatic shutter. A failed/slow handoff
      // must not restart 2-1 forever. Retaking creates a new controller; manual
      // retry remains available when the caller reports a capture error.
      return;
    }
    schedule();
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
  //
  // THE FIRST BAD FRAME STOPS THE CLOCK. There is no grace period on the timer
  // and there must never be one.
  //
  // This shipped with a four-frame grace before pausing, on the reasoning that
  // a single dropped frame should not stall a count about to complete. That
  // reasoning is right about the HINT TEXT and wrong about the timer, and the
  // difference is a race that fires the shutter on a bad frame: the count sits
  // at 1.45 of 1.5 seconds, one update(false) arrives and only increments a
  // counter, the animation frame is still scheduled, and 100ms later the
  // shutter fires on framing the gates had already rejected. Readiness updates
  // arrive per analysed camera frame while the countdown runs on
  // requestAnimationFrame, so the grace window is easily long enough to
  // complete a count inside.
  //
  // The whole safety argument for pausing rather than resetting is "the
  // shutter cannot fire on a bad frame, because the timer is not running while
  // the frame is bad". A grace period on the pause is precisely the hole in
  // that sentence. Hysteresis belongs to what is DISPLAYED — see captureSettle,
  // which holds the hint text so it does not flicker — never to whether the
  // clock is running.
  const ABANDON_MS = 4000;

  return {
    update(ready: boolean) {
      if (fired) return;
      if (ready) {
        // A stalled camera may deliver no further updates until it recovers.
        // Check abandonment here too, not only on repeated bad frames.
        if (pausedAt && performance.now() - pausedAt >= ABANDON_MS) {
          stop();
          pausedAt = 0;
          opts.onTick(null);
        }
        badSince = 0;
        if (pausedAt && startedAt !== null) {
          // Resume where it stopped: push the start forward by exactly the
          // time spent paused, so the remaining count is unchanged.
          startedAt += performance.now() - pausedAt;
          pausedAt = 0;
          if (lastBeep > 0) opts.onTick(lastBeep);
          // iOS can starve animation frames while its camera and landmark
          // work are busy. A fresh readiness result is still a reliable clock
          // opportunity, so advance immediately as well as requesting paint.
          frame(performance.now());
          return;
        }
        if (startedAt === null) {
          startedAt = performance.now();
          frame(startedAt);
          return;
        }
        // Do not make the visible count depend solely on paint frames. Camera
        // analysis continues to deliver readiness updates on devices where
        // requestAnimationFrame is temporarily throttled, and both paths use
        // this same monotonic start time.
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        frame(performance.now());
        return;
      }

      if (startedAt === null) return;
      const now = performance.now();
      if (!badSince) badSince = now;
      // Gone long enough that this is no longer a wobble. Forget the progress.
      if (now - badSince >= ABANDON_MS) {
        stop();
        pausedAt = 0;
        opts.onTick(null);
        return;
      }
      // Immediately, on this frame, before anything else can be scheduled.
      if (!pausedAt) {
        pausedAt = now;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        opts.onTick(null);
      }
    },
    cancel() {
      stop();
      pausedAt = 0;
      badSince = 0;
      opts.onTick(null);
    },
    // Keep the progress internally, but let live coaching explain a pause.
    armed: () => startedAt !== null && !pausedAt,
    hasProgress: () => startedAt !== null && !fired,
  };
}
