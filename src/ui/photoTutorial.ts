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
      title: "This is the one",
      caption: "A full ninety degrees, one ear toward the camera, head level, mouth closed, and the whole head from crown to neck in frame.",
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
      <h2 id="tut-ask-h">${view === "front" ? "Taking the front photo" : "Taking the side profile"}</h2>
      <p>${view === "front"
        ? "Twenty seconds on what ruins a front photo, and what a good one looks like."
        : "The profile is the shot people get wrong most. Twenty seconds on why."}</p>
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
    <button class="tut-close" id="tut-close" type="button">Skip</button>
    <div class="tut-stage">
      <!-- The mark pins to the PHOTOGRAPH, not to the stage. object-fit
           letterboxes the image inside the stage, so a badge positioned
           against the stage floats in the black margin above it. -->
      <div class="tut-shot">
        <img id="tut-img" alt="" />
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
    mark.textContent = step.kind === "do" ? "✓" : "✕";
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

  const go = (next: number) => {
    index = Math.max(0, Math.min(steps.length - 1, next));
    paint();
  };

  const close = () => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
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
