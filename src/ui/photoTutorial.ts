import { scopedStorageKey } from "../engine/scanScope.js";

// ---------------------------------------------------------------------------
// The pre-capture tutorial.
//
// Almost every bad scan is a bad photograph, and the app currently finds that
// out afterwards — it rejects the shot, or worse, measures a three-quarter view
// as though it were a profile. A tutorial cannot be a wall of rules nobody
// reads, so this is pictures: the mistakes first, each struck through, then the
// one that is right.
//
// Mistakes first is deliberate. "Don't stand under a downlight" means nothing
// until you have seen the half-shadowed face it produces; shown that way round,
// the correct frame at the end reads as the answer to something rather than as
// an instruction.
//
// It is offered, never imposed. The ask has three outcomes — watch it, skip it,
// or never be asked again — and the "again" is remembered per VIEW, because
// somebody who has the front shot down may still be turning only halfway for
// the profile. Both flags are owner-scoped: a browser shared by two accounts
// must not have one person's preference answer for the other.
//
// The same tick sits at the end of the tutorial, so the decision can be made
// after seeing what is being declined rather than before.
// ---------------------------------------------------------------------------

export type TutorialView = "front" | "side";

const HIDE_KEY = (view: TutorialView) => scopedStorageKey(`truemax:photo-tutorial-hidden:${view}`);

/** Whether this owner has asked not to be shown the tutorial for this view. */
export function tutorialSuppressed(view: TutorialView): boolean {
  try {
    const key = HIDE_KEY(view);
    // A null key means identity has not resolved. Showing the offer anyway is
    // harmless; silently suppressing it would not be.
    return key ? localStorage.getItem(key) === "1" : false;
  } catch {
    return false;
  }
}

export function setTutorialSuppressed(view: TutorialView, hidden: boolean): void {
  try {
    const key = HIDE_KEY(view);
    if (!key) return;
    if (hidden) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    // A browser refusing storage just means the offer comes back next time,
    // which is the safe direction to fail in.
  }
}

export interface Step {
  src: string;
  kind: "dont" | "do";
  title: string;
  caption: string;
  /**
   * A short muted clip to play instead of the still, with `src` as its poster.
   *
   * Only one thing in either tutorial genuinely needs motion — the profile
   * turn, where the mistake is stopping partway and a still cannot show
   * stopping. Everything else is a frame you are being asked to match, and a
   * still is the better teacher for that.
   *
   * The still is not a fallback of last resort, it is the poster: the clip
   * fades in over it, so a device that will not autoplay, a slow connection,
   * or a missing file all leave the step showing the right picture rather
   * than a black rectangle.
   */
  video?: string;
  /**
   * The window, in seconds within the clip, during which the subject is
   * turning — and over which the app draws the turn cue.
   *
   * The cue is drawn HERE rather than baked into the footage for two reasons.
   * A generated clip renders text and graphics badly, so a "90" burned into it
   * comes out as a smear; and a cue that lives in the DOM stays crisp, scales
   * with the frame, and can be corrected without paying to regenerate a video.
   *
   * It is driven off the video's own currentTime rather than a CSS animation
   * of the same length, because the clip loops and any independent timeline
   * drifts out of phase with it within a few passes — an arrow sweeping while
   * the head is already still teaches the opposite of the point.
   */
  cue?: { start: number; end: number };
  /**
   * The shutter: when it fires, and WHERE the phone is in the frame.
   *
   * The position matters because the light comes from the phone, not from the
   * room. A full-frame white wash is a scene transition; a burst at the handset
   * with a falloff is a camera going off, and the difference is the whole
   * reason the beat is there.
   *
   * x and y are fractions of the frame. They are config rather than constants
   * because the clip cannot be decoded in every environment that edits this
   * file, so the position has to be nudgeable from the outside by whoever CAN
   * watch it.
   *
   * Drawn rather than filmed for the same reason as the cue, and one more: the
   * clip is the one the shot was approved on, and regenerating it to add a
   * flash would re-roll the framing that made it worth keeping.
   */
  flash?: { at: number; x: number; y: number };
}

// The captions are the tutorial; the pictures make them land. If an image is
// missing the step still teaches, which is why the panel renders text over the
// frame rather than inside it.
const STEPS: Record<TutorialView, Step[]> = {
  front: [
    {
      src: "/tutorial/front-close.jpg", kind: "dont",
      title: "Too close",
      caption: "Held near your face, a phone lens bends the middle of it outward and crops the top of your head. Hold it at arm's length so the whole head sits inside the frame.",
    },
    {
      src: "/tutorial/front-tilt.jpg", kind: "dont",
      title: "Head tilted or turned",
      caption: "A few degrees of turn changes every width on the face. Square on, head level.",
    },
    {
      src: "/tutorial/front-light.jpg", kind: "dont",
      title: "Light from one side",
      caption: "One lamp or one window puts half the face in shadow, and the engine measures the shadow's edge instead of the cheekbone. Face a window, or stand where the light is even.",
    },
    {
      src: "/tutorial/front-cover.jpg", kind: "dont",
      title: "Hat, hood, glasses",
      caption: "The hairline, the brow and the eye corners are all landmarks. Anything over them is a measurement you do not get.",
    },
    {
      src: "/tutorial/front-do.jpg", kind: "do",
      title: "This is the one",
      caption: "Head and shoulders in frame, face square to the camera, head level, mouth closed and expression neutral, with even light and no hard shadow across the face.",
    },
  ],
  side: [
    {
      src: "/tutorial/side-partial.jpg", kind: "dont",
      title: "Only turned halfway",
      caption: "If you can see both eyes, it is not a profile. Every projection measurement is taken along the line you are turning off.",
    },
    {
      src: "/tutorial/side-chin.jpg", kind: "dont",
      title: "Chin up",
      caption: "Raising the chin lengthens the jaw and flattens the angle under it. Keep the head level and look straight ahead.",
    },
    {
      src: "/tutorial/side-hair.jpg", kind: "dont",
      title: "Ear covered",
      caption: "The ear notch anchors the jaw measurements. Push hair back so the whole ear shows.",
    },
    {
      src: "/tutorial/side-do.jpg", kind: "do",
      video: "/tutorial/side-turn.mp4",
      // The clip runs 0-1s square on, 1-3s turning, 3-5s phone raised toward
      // the lens. The cue tracks the turn; the shutter fires once the phone is
      // up and steady.
      cue: { start: 1, end: 3 },
      // Measured off the clip, not eyeballed: the phone's centroid was tracked
      // frame by frame (it is the one near-black object on a grey shirt) and
      // it rises until 4.2s, then holds at exactly this point to the end. The
      // flash fires mid-hold. Re-run the tracker if the clip is ever recut.
      flash: { at: 4.45, x: 0.435, y: 0.557 },
      title: "This is the one",
      caption: "Turn your head a full ninety degrees \u2014 one ear to the camera, chin level \u2014 and hold still. The phone stays where it is; only your head moves.",
    },
  ],
};

const STEP_MS = 3400;

/** The steps for one view, in the order they are shown. Exported for tests. */
export function tutorialSteps(view: TutorialView): readonly Step[] {
  return STEPS[view];
}

/**
 * Offer the tutorial, then continue.
 *
 * Calls `then` exactly once, whatever route the person takes — including the
 * suppressed case, where nothing is shown at all.
 */
export function offerTutorial(view: TutorialView, then: () => void): void {
  if (tutorialSuppressed(view)) {
    then();
    return;
  }
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    then();
  };

  const wrap = document.createElement("div");
  wrap.className = "tut-ask";
  wrap.innerHTML = `
    <div class="tut-ask-panel" role="dialog" aria-modal="true" aria-labelledby="tut-ask-h">
      <h2 id="tut-ask-h">${view === "front"
        ? "Would you like a tutorial on how to take the front-on photo for best results?"
        : "Would you like a tutorial on how to take the side profile for best results?"}</h2>
      <p>${view === "front"
        ? "Twenty seconds on what ruins a front photo, and what a good one looks like."
        : "The profile is the shot people get wrong most. Twenty seconds on why."}</p>
      <!-- One right, one wrong, before anybody has committed to watching. The
           question above is abstract until you have seen the difference it is
           asking about; two photographs answer "is this worth twenty seconds?"
           faster than the sentence does. -->
      ${view === "front"
        ? `<div class="tut-egs">
            <figure class="tut-eg good">
              <img src="/tutorial/front-good.jpg" alt="A correctly taken front photo: square to the lens, level, evenly lit" loading="lazy" />
              <figcaption><span class="tut-eg-mark">✓</span>Square, level, evenly lit</figcaption>
            </figure>
            <figure class="tut-eg bad">
              <img src="/tutorial/front-bad.jpg" alt="A poorly taken front photo: tilted, shot from below, half in shadow" loading="lazy" />
              <figcaption><span class="tut-eg-mark">✕</span>Tilted, from below, half shadowed</figcaption>
            </figure>
          </div>`
        : `<div class="tut-egs">
            <figure class="tut-eg good">
              <img src="/tutorial/side-do.jpg" alt="A correctly taken side profile: a full ninety degrees, chin level" loading="lazy" />
              <figcaption><span class="tut-eg-mark">✓</span>A full quarter turn, chin level</figcaption>
            </figure>
            <figure class="tut-eg bad">
              <img src="/tutorial/side-partial.jpg" alt="A poorly taken side profile: only half turned, so both eyes are still visible" loading="lazy" />
              <figcaption><span class="tut-eg-mark">✕</span>Half turned — both eyes showing</figcaption>
            </figure>
          </div>`}
      <div class="tut-ask-actions">
        <button class="btn pri" id="tut-yes" type="button">Show me</button>
        <button class="btn gho" id="tut-no" type="button">Skip</button>
      </div>
      <label class="tut-never"><input type="checkbox" id="tut-never" /><span>Don't show me this again</span></label>
    </div>`;
  document.body.appendChild(wrap);

  const never = wrap.querySelector<HTMLInputElement>("#tut-never")!;
  const closeAsk = () => wrap.remove();

  wrap.querySelector("#tut-no")!.addEventListener("click", () => {
    setTutorialSuppressed(view, never.checked);
    closeAsk();
    finish();
  });
  wrap.querySelector("#tut-yes")!.addEventListener("click", () => {
    // The tick carries across: answering it here and then watching anyway must
    // not quietly un-answer it.
    const carried = never.checked;
    closeAsk();
    playTutorial(view, carried, finish);
  });
  wrap.querySelector<HTMLButtonElement>("#tut-yes")!.focus();
}

/** The player. Exported so a settings screen can replay it on demand. */
export function playTutorial(view: TutorialView, neverChecked: boolean, onClose: () => void): void {
  const steps = STEPS[view];
  let index = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const wrap = document.createElement("div");
  wrap.className = "tut";
  wrap.innerHTML = `
    <div class="tut-bars">${steps.map((_, i) => `<i data-bar="${i}"><b></b></i>`).join("")}</div>
    <!-- A gray ✕, outside the photograph. It used to say "Skip", and the
         verdict mark on the photo used to be a lone red ✕ in a circle — so the
         close control and the "this is wrong" mark were the same glyph, and
         people read the verdict as an exit button. One gray ✕ off the picture
         closes; the verdict on the picture now carries its word. -->
    <button class="tut-close" id="tut-close" type="button" aria-label="Close the tutorial">✕</button>
    <div class="tut-stage">
      <!-- The mark pins to the PHOTOGRAPH, not to the stage. object-fit
           letterboxes the image inside the stage, so a badge positioned
           against the stage floats in the black margin above it. -->
      <div class="tut-shot">
        <img id="tut-img" alt="" />
        <video id="tut-vid" muted playsinline loop preload="none"></video>
        <svg class="tut-cue" id="tut-cue" viewBox="0 0 100 60" aria-hidden="true">
          <path class="tut-cue-track" d="M 18 44 A 32 32 0 0 1 82 44" />
          <path class="tut-cue-sweep" id="tut-cue-sweep" d="M 18 44 A 32 32 0 0 1 82 44" />
          <circle class="tut-cue-head" id="tut-cue-head" r="3.4" cx="18" cy="44" />
          <text class="tut-cue-num" id="tut-cue-num" x="50" y="40">0&#176;</text>
        </svg>
        <div class="tut-flash" id="tut-flash"></div>
        <div class="tut-mark" id="tut-mark"></div>
      </div>
    </div>
    <div class="tut-copy">
      <b id="tut-title"></b>
      <p id="tut-caption"></p>
    </div>
    <div class="tut-foot">
      <label class="tut-never"><input type="checkbox" id="tut-never2" ${neverChecked ? "checked" : ""} /><span>Don't show me this again</span></label>
      <button class="btn pri" id="tut-got" type="button">Okay, got it</button>
    </div>
    <button class="tut-tap back" id="tut-back" type="button" aria-label="Previous"></button>
    <button class="tut-tap fwd" id="tut-fwd" type="button" aria-label="Next"></button>`;
  document.body.appendChild(wrap);

  const img = wrap.querySelector<HTMLImageElement>("#tut-img")!;
  const vid = wrap.querySelector<HTMLVideoElement>("#tut-vid")!;
  const cue = wrap.querySelector<SVGElement>("#tut-cue")!;
  const cueSweep = wrap.querySelector<SVGPathElement>("#tut-cue-sweep")!;
  const cueHead = wrap.querySelector<SVGCircleElement>("#tut-cue-head")!;
  const cueNum = wrap.querySelector<SVGTextElement>("#tut-cue-num")!;
  const flash = wrap.querySelector<HTMLElement>("#tut-flash")!;
  let flashedThisPass = false;
  let cueFrame = 0;

  // The arc is a half-circle of radius 32 centred at (50,44) in the SVG's own
  // 100x60 box. Progress 0 sits at its left end, 1 at its right, and the dash
  // offset reveals exactly that much of it — so the sweep, the travelling dot
  // and the degree readout are all one number and cannot disagree.
  const ARC_LEN = Math.PI * 32;
  const paintCue = (progress: number) => {
    const t = Math.max(0, Math.min(1, progress));
    cueSweep.style.strokeDasharray = String(ARC_LEN);
    cueSweep.style.strokeDashoffset = String(ARC_LEN * (1 - t));
    const angle = Math.PI * (1 - t);
    cueHead.setAttribute("cx", (50 + 32 * Math.cos(angle)).toFixed(2));
    cueHead.setAttribute("cy", (44 - 32 * Math.sin(angle)).toFixed(2));
    cueNum.textContent = `${Math.round(t * 90)}\u00B0`;
  };
  // Exposed for the harness: the cue has to be checkable without a playable
  // video, which is exactly the thing this environment cannot provide.
  (wrap as unknown as Record<string, unknown>).__paintCue = paintCue;

  const runCue = (step: Step) => {
    cancelAnimationFrame(cueFrame);
    flash.classList.remove("fire");
    flashedThisPass = false;
    if (step.flash) {
      flash.style.setProperty("--fx", `${(step.flash.x * 100).toFixed(1)}%`);
      flash.style.setProperty("--fy", `${(step.flash.y * 100).toFixed(1)}%`);
    }
    if (!step.video || (!step.cue && !step.flash)) {
      cue.classList.remove("on");
      return;
    }
    const { start, end } = step.cue ?? { start: 0, end: 1 };
    if (!step.cue) cue.classList.add("hidden");
    else cue.classList.remove("hidden");
    const tick = () => {
      // Only while the clip is genuinely running: over a poster, a sweeping
      // arrow is claiming a turn that is not happening.
      const live = !vid.paused && vid.readyState >= 2 && vid.classList.contains("ready");
      cue.classList.toggle("on", live);
      if (live) {
        paintCue((vid.currentTime - start) / Math.max(0.001, end - start));
        // The shutter, fired off the same clock as the cue so it lands on the
        // frame it is meant to. The clip loops, so the latch is cleared when
        // playback wraps back past the flash point rather than on a timer.
        if (step.flash) {
          if (vid.currentTime < step.flash.at) flashedThisPass = false;
          else if (!flashedThisPass) {
            flashedThisPass = true;
            flash.classList.remove("fire");
            void flash.offsetWidth; // restart the animation
            flash.classList.add("fire");
          }
        }
      }
      cueFrame = requestAnimationFrame(tick);
    };
    tick();
  };
  const mark = wrap.querySelector<HTMLElement>("#tut-mark")!;
  const title = wrap.querySelector<HTMLElement>("#tut-title")!;
  const caption = wrap.querySelector<HTMLElement>("#tut-caption")!;
  const never2 = wrap.querySelector<HTMLInputElement>("#tut-never2")!;

  const paint = () => {
    const step = steps[index];
    wrap.classList.toggle("is-do", step.kind === "do");
    // A missing asset must not leave an empty frame with a broken-image icon:
    // the caption is the lesson and can carry the step on its own.
    img.classList.remove("ready");
    img.src = step.src;
    // The clip lives over the poster and only reveals itself once it is
    // actually playing, so autoplay being refused is indistinguishable from
    // there never having been a clip.
    vid.classList.remove("ready");
    vid.pause();
    if (step.video) {
      vid.src = step.video;
      void vid.play().catch(() => {
        /* autoplay refused — the poster is already the right picture */
      });
    } else if (vid.getAttribute("src")) {
      vid.removeAttribute("src");
      vid.load();
    }
    runCue(step);
    // The word is the fix: "✕" alone reads as a close button, and a red
    // circle in the corner of a photograph is exactly where apps put one.
    // "Incorrect" cannot be misread as chrome.
    mark.innerHTML = step.kind === "do" ? `Correct<i>✓</i>` : `Incorrect<i>✕</i>`;
    mark.className = `tut-mark ${step.kind}`;
    title.textContent = step.title;
    caption.textContent = step.caption;
    for (const bar of wrap.querySelectorAll<HTMLElement>("[data-bar]")) {
      const i = Number(bar.dataset.bar);
      bar.classList.toggle("done", i < index);
      bar.classList.toggle("live", i === index);
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (index < steps.length - 1) go(index + 1);
    }, STEP_MS);
  };

  img.addEventListener("load", () => img.classList.add("ready"));
  img.addEventListener("error", () => img.classList.remove("ready"));
  vid.addEventListener("playing", () => vid.classList.add("ready"));
  vid.addEventListener("error", () => vid.classList.remove("ready"));

  const go = (next: number) => {
    index = Math.max(0, Math.min(steps.length - 1, next));
    paint();
  };

  const close = () => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    cancelAnimationFrame(cueFrame);
    vid.pause();
    setTutorialSuppressed(view, never2.checked);
    document.removeEventListener("keydown", key);
    wrap.remove();
    onClose();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
    if (e.key === "ArrowRight") go(index + 1);
    if (e.key === "ArrowLeft") go(index - 1);
  };

  wrap.querySelector("#tut-close")!.addEventListener("click", close);
  wrap.querySelector("#tut-got")!.addEventListener("click", close);
  wrap.querySelector("#tut-fwd")!.addEventListener("click", () => {
    if (index >= steps.length - 1) close();
    else go(index + 1);
  });
  wrap.querySelector("#tut-back")!.addEventListener("click", () => go(index - 1));
  document.addEventListener("keydown", key);

  paint();
}
