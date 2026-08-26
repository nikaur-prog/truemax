import { scopedStorageKey } from "../engine/scanScope.js";

// ---------------------------------------------------------------------------
// The small sounds of placing thirteen points.
//
// The landmark review is the one part of a scan that is genuinely fiddly: you
// are dragging rings onto features on a photograph of your own face, and the
// only feedback is visual, on a screen your thumb is covering. Sound is the
// channel that is free — it reaches you through the hand in the way.
//
// Four of them, and each one is answering a specific question:
//
//   drag      "the ring is moving"        a dry tick, quiet, rate-limited
//   thinking  "I know you are mid-drag"   a slow pulse under the bouncing dots
//   advance   "that one is placed"        two notes RISING — a progression
//   chapter   "second photograph now"     a warm bell, the only one with tail
//
// Deliberately not a ding on advance. A ding is a full stop and there are
// twelve more points after it; two notes going up says "and the next" without
// anybody having to be told. Only the front-to-side handover gets a real bell,
// because that one IS a full stop: one photograph is finished and a different
// one is being asked for, and the person is about to turn away from the screen
// where they cannot read that.
//
// Everything here is a courtesy. No sound can fail a scan: the context is
// created lazily inside a gesture chain, every call is wrapped, and a browser
// that refuses audio outright leaves the flow working in silence.
//
// The whole layer is one module and one toggle on purpose. If it turns out to
// be irritating rather than helpful, deleting this file and its four call
// sites removes it completely.
// ---------------------------------------------------------------------------

const PREF_KEY = () => scopedStorageKey("truemax:scan-sounds");

// Cached, because the review asks whether sound is on for every pointermove.
let enabled: boolean | null = null;

/**
 * Whether the small review sounds are on. Defaults to ON.
 *
 * On rather than off because these are quiet, short, and the thing they help
 * with — knowing a drag registered without watching the ring — is invisible
 * until you have heard it. Somebody who dislikes them turns them off in one
 * tap and the choice sticks, per owner, like every other preference here.
 *
 * The capture countdown is NOT governed by this. Those beeps are the entire
 * feedback channel for a photograph taken with your head turned away from the
 * screen, and silencing them would break the shot rather than tidy it up.
 */
export function soundEnabled(): boolean {
  if (enabled !== null) return enabled;
  try {
    const key = PREF_KEY();
    enabled = key ? localStorage.getItem(key) !== "0" : true;
  } catch {
    enabled = true;
  }
  return enabled;
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  try {
    const key = PREF_KEY();
    if (key) localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* a browser refusing storage just forgets the choice next time */
  }
  if (!on) stopThinking();
}

/** Drops the cached preference, so a change of owner re-reads their own. */
export function resetSoundPreference(): void {
  enabled = null;
}

let ac: AudioContext | null = null;
let master: GainNode | null = null;

function audio(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!ac) {
      ac = new Ctor();
      master = ac.createGain();
      // Everything below is written at its natural level and scaled here, so
      // the whole layer moves together rather than four constants drifting.
      master.gain.value = 0.5;
      master.connect(ac.destination);
    }
    if (ac.state === "suspended") void ac.resume();
    return ac;
  } catch {
    return null;
  }
}

/**
 * One shaped note.
 *
 * The envelope is the whole job. A sine gated on and off square is a click at
 * both ends, and a click is the least pleasant noise a face app can make; an
 * attack of a few milliseconds and an exponential tail is the difference
 * between an instrument and a fault.
 */
function note(
  freq: number,
  ms: number,
  gain: number,
  opts: { type?: OscillatorType; delay?: number; glideTo?: number } = {},
): void {
  const a = audio();
  if (!a || !master) return;
  try {
    const osc = a.createOscillator();
    const vol = a.createGain();
    osc.type = opts.type ?? "sine";
    const t = a.currentTime + (opts.delay ?? 0);
    osc.frequency.setValueAtTime(freq, t);
    if (opts.glideTo) osc.frequency.exponentialRampToValueAtTime(opts.glideTo, t + ms / 1000);
    vol.gain.setValueAtTime(0.0001, t);
    vol.gain.linearRampToValueAtTime(gain, t + 0.008);
    vol.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    osc.connect(vol).connect(master);
    osc.start(t);
    osc.stop(t + ms / 1000 + 0.03);
  } catch {
    /* audio is a courtesy, never a requirement */
  }
}

// A ring being dragged fires pointermove at the display's refresh rate. A tick
// per frame is a buzz, so they are thinned to something the ear reads as
// texture rather than as a tone.
const DRAG_TICK_MS = 85;
let lastTick = 0;

/** The ring moved. Quiet, dry and short — felt more than heard. */
export function soundDrag(): void {
  if (!soundEnabled()) return;
  const now = performance.now();
  if (now - lastTick < DRAG_TICK_MS) return;
  lastTick = now;
  note(1180, 26, 0.016, { type: "triangle" });
}

/** A ring was picked up. A shade firmer than the drag tick. */
export function soundGrab(): void {
  if (!soundEnabled()) return;
  lastTick = performance.now();
  note(760, 42, 0.03, { type: "triangle" });
}

let thinkingTimer: ReturnType<typeof setInterval> | null = null;

/**
 * The pulse under the three bouncing dots, at the dots' own tempo, so the
 * sound and the animation read as one thing rather than as two things
 * happening at once.
 */
export function startThinking(): void {
  if (!soundEnabled() || thinkingTimer) return;
  const beat = () => note(228, 120, 0.022, { type: "sine" });
  beat();
  thinkingTimer = setInterval(beat, 430);
}

export function stopThinking(): void {
  if (!thinkingTimer) return;
  clearInterval(thinkingTimer);
  thinkingTimer = null;
}

/**
 * That point is placed, here comes the next one.
 *
 * Two notes rising a fourth. Not a ding: a ding closes something, and there
 * are usually a dozen points still to go.
 */
export function soundAdvance(): void {
  if (!soundEnabled()) return;
  stopThinking();
  note(587.33, 90, 0.05, { type: "sine" });            // D5
  note(783.99, 150, 0.045, { type: "sine", delay: 0.075 }); // G5
}

/**
 * The speaker, on the photograph, small.
 *
 * Bottom left, tucked into the corner opposite the retake glyph, at the size
 * of a control you are meant to be able to find rather than one you are meant
 * to notice. It only ever appears where the sounds do — the landmark review —
 * so it never has to explain what it is turning off.
 *
 * Returns its own teardown, so a frame rebuilt for a retake cannot end up with
 * two of them.
 */
export function mountSoundToggle(frame: HTMLElement): { destroy(): void } {
  frame.querySelector(".sound-toggle")?.remove();
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sound-toggle";
  // The verifier treats anything on the frame as photo unless it says
  // otherwise, and a tap here must not place a landmark.
  btn.dataset.verifyChrome = "1";
  btn.addEventListener("pointerdown", (ev) => ev.stopPropagation());

  const ON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6.5 9H3v6h3.5L11 19V5Z"/><path d="M15.4 9.4a3.6 3.6 0 0 1 0 5.2"/><path d="M18 6.8a7.2 7.2 0 0 1 0 10.4"/></svg>`;
  const OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6.5 9H3v6h3.5L11 19V5Z"/><path d="m16 10 5 4M21 10l-5 4"/></svg>`;

  const paint = () => {
    const on = soundEnabled();
    btn.innerHTML = on ? ON : OFF;
    btn.classList.toggle("off", !on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.setAttribute("aria-label", on ? "Turn the placement sounds off" : "Turn the placement sounds on");
    btn.title = on ? "Sounds on" : "Sounds off";
  };
  paint();
  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const next = !soundEnabled();
    setSoundEnabled(next);
    paint();
    // Turning them ON plays one, because a toggle for something inaudible
    // gives no way to tell it worked.
    if (next) soundAdvance();
  });
  frame.appendChild(btn);
  return { destroy: () => btn.remove() };
}

/**
 * Moving ON to the next point, as opposed to answering the current one.
 *
 * These are two different events and the button already treats them as two —
 * the first press turns it green and names what is coming, the second press
 * goes there — so they should not share a sound. This one is the shorter,
 * brighter of the pair: a single note that slides up rather than two notes
 * stepping, which reads as travel where soundAdvance reads as agreement.
 *
 * Same family on purpose. Thirteen points is a lot of repetitions, and two
 * sounds from obviously different instruments would be a novelty for one
 * scan and an irritation by the third.
 */
export function soundNext(): void {
  if (!soundEnabled()) return;
  stopThinking();
  note(698.46, 130, 0.042, { type: "sine", glideTo: 987.77 }); // F5 → B5
}

/** The last point. The same move, one step further up, so it lands. */
export function soundFinish(): void {
  if (!soundEnabled()) return;
  stopThinking();
  note(587.33, 90, 0.05);
  note(783.99, 90, 0.05, { delay: 0.08 });
  note(1046.5, 320, 0.045, { delay: 0.16 });
}

/**
 * Front photograph done, profile now.
 *
 * The one real bell in the app, and the one place a bell is right: it marks a
 * boundary rather than a step, and it plays at the moment somebody is about to
 * turn their head away from the screen that would otherwise have told them.
 *
 * Not governed by the review toggle, for the same reason the countdown is not:
 * it is orientation for a photograph you take without looking.
 */
export function soundChapter(): void {
  stopThinking();
  // Two partials struck together with a long tail is what makes a bell read as
  // a bell rather than as another beep.
  note(659.25, 900, 0.05);                    // E5
  note(987.77, 700, 0.028, { delay: 0.012 }); // B5
  note(1318.5, 460, 0.014, { delay: 0.02 });  // E6
}
