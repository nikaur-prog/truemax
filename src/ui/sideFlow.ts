import { currentAccessToken } from "../engine/auth.js";
import { analyzeSide } from "../engine/scoring.js";
import type { Report, Sex } from "../engine/types.js";
import { SIDE_POINTS, faceDirFromPoints, sidePointIntegrityIssues } from "../engine/sideMetrics.js";
import { GuidedAdvance } from "./guidedAdvance.js";
import type { SidePoints } from "../engine/sideMetrics.js";
import { mountVerifier, seedSidePoints } from "./sideVerify.js";
import { GUIDE_PHOTO_URL, drawGuideCrop, guidePhotoReady } from "./sideGuidePhoto.js";
import { mountSideReference } from "./sideReference.js";
import type { ReferenceHandle } from "./sideReference.js";
import type { VerifyHandle } from "./sideVerify.js";
import {
  cloneSidePoints,
  createSideFeedbackIntent,
  movedSidePointIds,
} from "../engine/sideFeedbackPayload.js";
import type {
  SideFeedbackIntent,
  SideSeedMethod,
} from "../engine/sideFeedbackPayload.js";
import { startCamera } from "./camera.js";
import { setRunningMode } from "../engine/landmarker.js";
import { resetSideTracking } from "../engine/captureGuide.js";
import { createAutoCapture } from "./autoCapture.js";
import type { AutoCapture } from "./autoCapture.js";
import type { CameraHandle } from "./camera.js";

// Side-profile capture flow: camera or upload → auto-seeded landmarks → user
// verifies by dragging → side report.
//
// The camera still coaches the turn, but its shutter is never held hostage by
// a heuristic. The review screen is the accuracy gate: TrueMax estimates the
// points, then the user corrects them before any side score is calculated.

// Raised from 1000. The review screen now draws the photo up to ~1300px wide on
// a desktop, and at 1000 the canvas was being upscaled to fill it — soft edges
// exactly where somebody is trying to put a landmark on a feature boundary. The
// cost is a slightly slower seed pass on one image, which is not on any hot path.
const MAX_DIM = 1400;

// The walkthrough's step order is SIDE_POINTS order; the crop renderer needs
// the id for a step index without reaching into the verifier's internals.
const SIDE_POINT_IDS = SIDE_POINTS.map((s) => s.id);

interface SideCtx {
  scanId: string;
  sex: Sex;
  // How the front was captured, so the side matches it. "camera" opens the
  // profile camera straight away; "upload" offers only the file drop; undefined
  // shows both choices.
  method?: "camera" | "upload";
  onDone: (
    report: Report,
    points: SidePoints,
    faceDir: number,
    review: SidePlacementReview,
  ) => void;
  onBack: () => void;
}

export interface SidePlacementReview {
  automaticPoints: SidePoints;
  seedMethod: SideSeedMethod;
  feedback: SideFeedbackIntent | null;
  /**
   * The reviewed photograph, as an OWNED copy taken at the moment of confirm.
   *
   * A correction is only worth anything paired with the picture it corrects, and
   * until now the flow kept the canvas to itself. The main scan happened to have
   * its own copy from an earlier step, so it could submit feedback; the Calibrate
   * side slot had no such step and therefore threw every correction away —
   * somebody could drag thirteen landmarks into place on fifty profiles and the
   * seeding would learn nothing from any of them.
   *
   * Copied rather than handed over, for the same reason the front capture is:
   * `#side-canvas` is reused by the next photograph, so a reference would be
   * repainted underneath whoever held it.
   */
  photo: HTMLCanvasElement;
}

interface SidePlacementSeed {
  points: SidePoints;
  faceDir: number;
  automaticPoints?: SidePoints;
  method?: SideSeedMethod;
  // Absent when re-opening an already-corrected placement, which by definition
  // no longer needs the "we guessed this" framing.
  confidence?: number;
}

let verifier: VerifyHandle | null = null;
let reference: ReferenceHandle | null = null;
let sideCam: CameraHandle | null = null;
let auto: AutoCapture | null = null;
let sideKeyHandler: ((e: KeyboardEvent) => void) | null = null;

const el = () => ({
  section: document.getElementById("v-side")!,
  canvas: document.getElementById("side-canvas") as HTMLCanvasElement,
  lines: document.getElementById("side-lines") as unknown as SVGSVGElement,
  layer: document.getElementById("side-verify")!,
  cap: document.getElementById("side-cap")!,
  drop: document.getElementById("side-drop")!,
  input: document.getElementById("side-input") as HTMLInputElement,
  actions: document.getElementById("side-actions")!,
  panelCopy: document.getElementById("side-panel-copy")!,
  frame: document.getElementById("side-frame")!,
  live: document.getElementById("side-live")!,
  video: document.getElementById("side-video") as HTMLVideoElement,
  guide: document.getElementById("side-guide") as HTMLCanvasElement,
  hintTitle: document.getElementById("side-hint-title")!,
  hintDetail: document.getElementById("side-hint-detail")!,
  hint: document.getElementById("side-hint")!,
  lamp: document.getElementById("side-lamp")!,
  lampFill: document.getElementById("side-lamp-fill")!,
  turnCue: document.getElementById("side-turn-cue")!,
});

function renderSideCaptureCopy(copy: HTMLElement): void {
  copy.innerHTML = `<h2 class="side-title">Now the side profile</h2>
    <p class="side-sub">Second of two. Chin projection, jaw angle and facial convexity can only be measured from the side. Face exactly sideways with one ear toward the camera, your head level, and your full forehead and chin visible.</p>
    <p class="side-sub"><b>You will not be able to see this screen.</b> Turn until you hear the countdown, then hold still. Two beeps, then a higher shutter beep. Space bar takes it immediately.</p>
    <p class="side-sub">Afterwards, TrueMax places thirteen points for you to review. If any missed, choose edit and drag only those points before confirming.</p>`;
}

/**
 * Marks the document while this flow owns the screen.
 *
 * /quick lays itself out as a 460px phone column, which is right for every
 * other step there and wrong for this one: the landmark review needs the photo
 * drawn as large as the display allows, because how accurately thirteen points
 * can be placed is a direct function of how many pixels the face occupies. The
 * class lets quick.css widen its column for the duration; nothing outside
 * /quick styles it, so the main app is unaffected.
 */
function markSideOpen(open: boolean): void {
  document.body.classList.toggle("side-open", open);
}

export function openSideCapture(ctx: SideCtx): void {
  const e = el();
  verifier?.destroy();
  verifier = null;
  // Or the guide badge stays pinned over the live camera preview.
  reference?.destroy();
  reference = null;
  markSideOpen(true);
  e.section.classList.remove("hidden");
  e.cap.textContent = "AWAITING PHOTO";
  e.drop.classList.remove("hidden");
  e.live.classList.add("hidden");
  e.lines.replaceChildren();
  renderSideCaptureCopy(e.panelCopy);

  // The side matches how the front was taken. Shot the front on camera → open
  // the profile camera straight away; uploaded it → offer only the file drop.
  // With no method known, both choices are shown as before.
  if (ctx.method === "camera") {
    void openSideCamera(ctx);
    wireSideInputs(e, ctx);
    return;
  }

  // Both views are required, so there is no "skip" — but backing out of the
  // capture must still be possible, because capture is free. Nothing has been
  // spent at this point: the analysis is the costly step and it has not run.
  // So this is a plain Cancel, not an offer to abandon a half-finished scan.
  const camBtn = ctx.method === "upload"
    ? ""
    : `<button class="btn pri" id="side-cam">Use camera</button>`;
  const pickBtn = ctx.method === "upload"
    ? `<button class="btn pri" id="side-pick">Upload a photo</button>`
    : `<button class="btn gho" id="side-pick">Upload a photo</button>`;
  e.actions.innerHTML = camBtn + pickBtn;
  e.actions.insertAdjacentHTML(
    "beforeend",
    `<button class="btn cancel" id="side-quit">Cancel</button>`,
  );
  document.getElementById("side-cam")?.addEventListener("click", () => openSideCamera(ctx));
  document.getElementById("side-pick")!.onclick = () => e.input.click();
  document.getElementById("side-quit")!.onclick = () => {
    close();
    ctx.onBack();
  };
  wireSideInputs(e, ctx);
}

// The paste listener, module-level so re-wiring the inputs replaces it
// instead of stacking a second copy that would load the same file twice.
let sidePaste: ((ev: ClipboardEvent) => void) | null = null;

// The file input and drop handlers, shared by the choice screen and the
// camera-first path (so an upload still works even when the camera opened first).
function wireSideInputs(e: ReturnType<typeof el>, ctx: SideCtx): void {
  // Paste works here for the same reason it works on the front capture: the
  // profile photo has usually just been cropped or screenshotted and is
  // already on the clipboard. Scoped to this screen being visible, and torn
  // down in close(), so a stray Cmd-V anywhere else in the app does nothing.
  if (sidePaste) document.removeEventListener("paste", sidePaste);
  sidePaste = (ev: ClipboardEvent) => {
    if (e.section.classList.contains("hidden")) return;
    const f = [...(ev.clipboardData?.items ?? [])]
      .find((i) => i.type.startsWith("image/"))
      ?.getAsFile();
    if (f) {
      ev.preventDefault();
      void load(f, ctx);
    }
  };
  document.addEventListener("paste", sidePaste);
  // Say so in the pane instead of leaving a black void. The awaiting state
  // showed nothing at all, which read as broken rather than as waiting.
  e.cap.textContent = "AWAITING PHOTO · PASTE, DROP OR UPLOAD";
  e.input.onchange = async () => {
    const file = e.input.files?.[0];
    // Clear the selection before handling it. A file input fires `change` only
    // when the chosen file DIFFERS from what is already there, so without this
    // the sequence "pick a profile, skip, come back, pick the same profile"
    // silently does nothing and the screen looks frozen. The front input has
    // always cleared itself; this one did not. Found by testing the skip path.
    e.input.value = "";
    if (file) await load(file, ctx);
  };
  e.drop.ondragover = (ev) => {
    ev.preventDefault();
    e.drop.classList.add("dragover");
  };
  e.drop.ondragleave = () => e.drop.classList.remove("dragover");
  e.drop.ondrop = async (ev) => {
    ev.preventDefault();
    e.drop.classList.remove("dragover");
    const f = (ev as DragEvent).dataTransfer?.files?.[0];
    if (f?.type.startsWith("image/")) await load(f, ctx);
  };
}

async function openSideCamera(ctx: SideCtx): Promise<void> {
  const e = el();
  if (sideCam) return;
  e.drop.classList.add("hidden");
  e.live.classList.remove("hidden");
  e.frame.classList.add("live");
  e.turnCue.classList.remove("hidden");
  e.cap.textContent = "LINE UP YOUR PROFILE";
  // The gate remembers having seen the head turn, so that losing the face can
  // be read as "they turned away" rather than "there was never anyone there".
  // That memory has to start empty on every new attempt.
  resetSideTracking();
  let ready = false;
  // Hands-off shutter. On the side you are turned away from the screen, so the
  // countdown is mostly audible; see ui/autoCapture.ts.
  auto = createAutoCapture({
    onTick: (remaining) => {
      const shoot = document.getElementById("side-shoot") as HTMLButtonElement | null;
      if (remaining == null) {
        e.hint.classList.remove("counting");
        if (shoot && !shoot.disabled) shoot.textContent = "Capture";
        return;
      }
      e.hint.classList.add("counting");
      e.hintTitle.textContent = `Hold still · ${remaining}`;
      e.hintDetail.textContent = "Taking it automatically · space to take it now";
      if (shoot) shoot.textContent = `Capturing in ${remaining}`;
    },
    onFire: () => {
      const shoot = document.getElementById("side-shoot") as HTMLButtonElement | null;
      shoot?.click();
    },
  });
  try {
    sideCam = await startCamera({
      video: e.video,
      guideCanvas: e.guide,
      mode: "side",
      onCheck: (c) => {
        // Guidance and auto-capture can wait for the ideal turn. Manual
        // capture cannot: side detection is deliberately uncertain at a true
        // 90-degree profile, and that uncertainty used to strand users even
        // though the following screen already supports point correction.
        ready = true;
        e.turnCue.classList.toggle("hidden", c.ready || Math.abs(c.pose.yaw) >= 38);
        auto?.update(c.ready);
        // While the count is running the hint belongs to the countdown, which
        // has just written it. Only the two text lines are skipped — the lamp
        // and the shutter below must keep updating, or the frame freezes
        // visually at the exact moment it is about to fire.
        if (!auto?.armed()) {
          e.hintTitle.textContent = c.hint;
          e.hintDetail.textContent = c.detail;
        }
        e.hint.classList.toggle("ready", c.ready);
        e.hint.classList.toggle("red", c.status === "red");
        e.hint.classList.toggle("amber", c.status === "amber");
        e.lamp.className = `lamp ${c.status === "green" ? "green" : c.status}`;
        e.lampFill.className = c.status === "green" ? "green" : c.status;
        e.lampFill.style.width = `${Math.round((c.status === "green" ? 1 : c.progress) * 100)}%`;
        const shoot = document.getElementById("side-shoot") as HTMLButtonElement | null;
        if (shoot) shoot.disabled = false;
      },
    });
  } catch {
    e.live.classList.add("hidden");
    e.frame.classList.remove("live");
    e.drop.classList.remove("hidden");
    e.hintTitle.textContent = "Camera unavailable";
    return;
  }
  // Same order as the front screen: the shutter first, upload second. They were
  // reversed here, so the button under your thumb changed meaning between the
  // two steps of the same flow.
  e.actions.innerHTML = `
    <button class="btn pri" id="side-shoot">Capture</button>
    <button class="btn gho" id="side-stop">Upload a photo</button>`;
  e.actions.insertAdjacentHTML(
    "beforeend",
    `<button class="btn cancel" id="side-quit2">Cancel</button>`,
  );
  document.getElementById("side-quit2")!.onclick = () => {
    close();
    ctx.onBack();
  };
  document.getElementById("side-stop")!.onclick = () => {
    stopSideCamera();
    openSideCapture(ctx);
  };
  document.getElementById("side-shoot")!.onclick = async () => {
    if (!sideCam || !ready) return;
    const shot = sideCam.capture();
    stopSideCamera();
    if (shot) await loadCanvas(shot, ctx);
  };

  // Space or Enter takes it now rather than waiting out the countdown. On a
  // laptop the keyboard is under your hands while the screen is turned away,
  // which makes it the one control you can still hit blind — and it does not
  // shift the framing the way reaching for a button does.
  sideKeyHandler = (e: KeyboardEvent) => {
    if (e.key !== " " && e.key !== "Enter") return;
    const t = e.target as HTMLElement | null;
    // Never hijack a key from a field or another button.
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (t?.tagName === "BUTTON" && t.id !== "side-shoot") return;
    if (!sideCam || !ready) return;
    e.preventDefault();
    document.getElementById("side-shoot")?.click();
  };
  window.addEventListener("keydown", sideKeyHandler);
}

function stopSideCamera(): void {
  // Cancelled before the early return: the countdown must die even on paths
  // where the camera was already gone, or a pending fire could click a shutter
  // that no longer has a preview behind it.
  auto?.cancel();
  auto = null;
  if (sideKeyHandler) {
    window.removeEventListener("keydown", sideKeyHandler);
    sideKeyHandler = null;
  }
  if (!sideCam) return;
  sideCam.stop();
  sideCam = null;
  // Hand the detector back to still-image mode. Anything downstream of here
  // works on stills, and leaving it in VIDEO mode makes them throw.
  //
  // Fire-and-forget is fine HERE because loadCanvas awaits the same switch
  // before it seeds. It did not used to, and that was a silent bug: seeding
  // runs the detector, the detector throws in VIDEO mode, the throw is caught
  // as "no face", and every camera-captured profile quietly fell back to the
  // silhouette trace — the worse path, on the most common route into this
  // screen.
  void setRunningMode("IMAGE");
  const e = el();
  e.live.classList.add("hidden");
  e.turnCue.classList.add("hidden");
  e.frame.classList.remove("live");
}

// Re-open the verifier on a profile that has already been captured, so the
// thirteen points can be corrected without shooting the photo again.
//
// "Retake" was the only route back, which is the wrong tool for the actual
// problem: the photograph is usually fine and the seed landed a point or two
// off. Making someone re-shoot to fix a dot they can see is wrong throws away
// the good capture and their time.
export function openSideAdjust(
  photo: HTMLCanvasElement,
  seed: SidePlacementSeed,
  ctx: SideCtx,
): void {
  const e = el();
  markSideOpen(true);
  e.section.classList.remove("hidden");
  e.drop.classList.add("hidden");
  e.live.classList.add("hidden");
  e.frame.classList.remove("live");
  mountVerify(photo, { ...seed, method: seed.method ?? "existing" }, ctx, "REVIEW LANDMARKS");
}

export function close(): void {
  stopSideCamera();
  verifier?.destroy();
  verifier = null;
  reference?.destroy();
  reference = null;
  if (sidePaste) {
    document.removeEventListener("paste", sidePaste);
    sidePaste = null;
  }
  markSideOpen(false);
  el().section.classList.add("hidden");
}

async function load(file: File, ctx: SideCtx): Promise<void> {
  const img = await loadImage(file);
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext("2d")!.drawImage(img, 0, 0);
  await loadCanvas(c, ctx);
}

// Both entry points — a chosen file and a captured frame — converge here, so
// the verify step cannot behave differently depending on where the pixels came
// from.
async function loadCanvas(src: HTMLCanvasElement, ctx: SideCtx): Promise<void> {
  const e = el();
  stopSideCamera();
  // Awaited, not assumed: seeding runs the still-image detector below.
  await setRunningMode("IMAGE");
  const scale = Math.min(1, MAX_DIM / Math.max(src.width, src.height));
  const w = Math.round(src.width * scale);
  const h = Math.round(src.height * scale);
  e.canvas.width = w;
  e.canvas.height = h;
  e.canvas.getContext("2d")!.drawImage(src, 0, 0, w, h);

  // Do not reject a side still here. Profile focus, crop, lighting, pose and
  // silhouette classifiers all produced false negatives on plainly usable
  // photos. The safer workflow is visible and reversible: estimate thirteen
  // points on every loaded image, show them over the actual photo, and require
  // confirmation/correction before analysis. If automatic detection fails,
  // seedSidePoints deliberately falls back to an editable centred template.
  e.drop.classList.add("hidden");
  e.cap.textContent = "VERIFY LANDMARKS";

  // Canonicalise the facing. A profile photograph mirrored horizontally has
  // identical geometry — faces are measured bilaterally — so instead of
  // rejecting a photo taken the "wrong" way, flip it. After this point every
  // downstream surface (the verify screen, the reference guide, the template
  // seeding, the analysis) deals with exactly one orientation, and the
  // platform-dependent question of whether a front camera delivers mirrored
  // or true frames stops mattering at all: whatever arrives, it leaves here
  // facing image-right.
  // Only on a seed the detector actually believes. Facing detection can read
  // a marginal image backwards (a sepia sketch in testing did exactly that),
  // and mirroring somebody's photo on a wrong guess is worse than leaving a
  // left-facing photo alone — the analysis handles either direction; this
  // flip exists for consistency, not correctness.
  let seed = seedSidePoints(e.canvas);
  if (seed.faceDir === -1 && (seed.method === "mesh" || seed.confidence >= 0.5)) {
    const w2 = e.canvas.width;
    const flipped = document.createElement("canvas");
    flipped.width = w2;
    flipped.height = e.canvas.height;
    const g = flipped.getContext("2d")!;
    g.translate(w2, 0);
    g.scale(-1, 1);
    g.drawImage(e.canvas, 0, 0);
    e.canvas.getContext("2d")!.drawImage(flipped, 0, 0);
    const mirror = (pts: SidePoints): SidePoints => {
      const out = cloneSidePoints(pts);
      for (const key of Object.keys(out) as Array<keyof SidePoints>) {
        out[key] = { x: w2 - out[key].x, y: out[key].y };
      }
      return out;
    };
    seed = { ...seed, points: mirror(seed.points), faceDir: 1 };
  }

  mountVerify(e.canvas, seed, ctx, "VERIFY LANDMARKS");
}

// Shared by the first pass and by a later correction, so the two cannot drift
// apart in what dragging a point does.
/**
 * Give the photo as much of the screen as it can take without scrolling.
 *
 * Thirteen landmarks are dragged into position on this picture, and precision
 * scales with how big it is drawn. The layout used to give it a fixed 44% of a
 * 1080px column — about 450 pixels of face — which is enough to confirm a good
 * placement and not enough to repair a bad one.
 *
 * The cap has to be applied to the FRAME rather than to the canvas. The two
 * overlays that draw the points and the guide lines are `position: absolute;
 * inset: 0` on the frame, so they follow the frame's box exactly. Capping the
 * canvas instead would letterbox it inside a taller frame and every point would
 * sit off the feature it names by half the difference.
 *
 * Width is derived from the photo's own aspect ratio so the height cap lands
 * where intended: a 3:4 portrait gets a narrower frame than a square crop, and
 * both end up the same height on screen.
 */
function fitFrameToViewport(frame: HTMLElement, w: number, h: number): void {
  if (!(w > 0 && h > 0)) return;
  const maxH = window.innerHeight * 0.78;
  frame.style.maxWidth = `${Math.round((w / h) * maxH)}px`;
}

function mountVerify(
  photo: HTMLCanvasElement,
  seed: SidePlacementSeed,
  ctx: SideCtx,
  caption: string,
): void {
  const e = el();
  if (photo !== e.canvas) {
    e.canvas.width = photo.width;
    e.canvas.height = photo.height;
    e.canvas.getContext("2d")!.drawImage(photo, 0, 0);
  }
  const w = e.canvas.width;
  const h = e.canvas.height;
  e.drop.classList.add("hidden");
  e.cap.textContent = caption;
  fitFrameToViewport(e.frame, w, h);

  const automaticPoints = cloneSidePoints(seed.automaticPoints ?? seed.points);
  const seedMethod = seed.method ?? "existing";

  verifier?.destroy();
  verifier = mountVerifier(e.layer, e.canvas, seed, (pts) => drawGuides(e.lines, pts, w, h));
  // The reference diagram, in the corner of the photo. Mounted with the seed's
  // own facing so it points the same way the subject does — a guide facing the
  // wrong way is harder to read than none.
  reference?.destroy();
  reference = mountSideReference(e.frame, seed.faceDir);
  drawGuides(e.lines, seed.points, w, h);

  // Whether the person told us the placement was wrong, and what they said to
  // "send it to our team". Answered at most once, at the moment of the
  // complaint — not re-asked at confirm.
  let flaggedWrong = false;
  let consentAnswer: boolean | null = null;
  // Set once the "nothing was moved" prompt has been shown, so the second press
  // goes through. Scoped per mounted photo, so the next face asks again.
  let untouchedAcknowledged = false;

  // The walkthrough: one point at a time, tap to place, next.
  //
  // The first live test found the failure plainly: a fresh seed shows thirteen
  // rings, several of them visibly wrong, and the honest read of that screen is
  // "this is a lot of work" — so people declined to start. The same thirteen
  // corrections framed as "Nose tip. Tap it. Next." get done, because each step
  // is one decision and the count is visibly shrinking. The free-editing screen
  // is still the final state; this is a different door into it.
  const showGuidedActions = () => {
    verifier?.setEditable(true);
    e.layer.querySelector(".gnext-in")?.remove();
    e.cap.textContent = "PLACE THE POINTS";
    // The photographic "it goes here" patch, when the reference exists. Loaded
    // once per mount; a missing or unshipped image just means the step shows
    // its words alone, which is what it always did.
    let guideImage: HTMLImageElement | null = null;
    if (guidePhotoReady()) {
      guideImage = new Image();
      guideImage.src = GUIDE_PHOTO_URL;
    }
    // The advance control lives INSIDE the photo, just above the name of the
    // point it is asking about, because that is where the eye already is: a
    // button under the frame means looking away from the ring to press it and
    // back again to see what happened.
    //
    // How much confirmation each step still needs lives in GuidedAdvance; this
    // only paints what that says.
    const inFrame = document.createElement("button");
    inFrame.type = "button";
    inFrame.className = "gnext-in";
    inFrame.id = "side-gnext-in";
    // It sits over the photo, so it must not read as photo — see the matching
    // guard in the verifier's pointerdown.
    inFrame.dataset.verifyChrome = "1";
    inFrame.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    e.layer.appendChild(inFrame);
    const advance = new GuidedAdvance();

    const paintButton = () => {
      const { ready, text } = advance.view();
      inFrame.classList.toggle("ready", ready);
      inFrame.textContent = text;
    };

    const paint = (index: number, total: number, moved = false) => {
      const { label, hint } = verifier!.guidedCurrent();
      e.panelCopy.innerHTML = `<h2 class="side-title">${label}</h2>
        <p class="side-sub">${hint}. Tap where it belongs on the photo — hold and drag to
        fine-tune with the lens. Moving it counts as your answer. If it is already right,
        the button asks you once to say so.</p>
        ${guideImage ? `<div class="side-refcrop"><canvas id="side-refcrop"></canvas><span>On a real face, it sits here</span></div>` : ""}
        <p class="side-review-note">Point ${index + 1} of ${total}. The five behind the face
        are guesses from an average head, so they are the ones that usually need the tap.</p>`;
      if (guideImage) {
        const crop = document.getElementById("side-refcrop") as HTMLCanvasElement | null;
        const id = SIDE_POINT_IDS[index];
        const render = () => {
          if (crop && guideImage!.naturalWidth) drawGuideCrop(crop, guideImage!, id, verifier!.faceDir);
        };
        if (guideImage.complete) render();
        else guideImage.onload = render;
      }
      const counter = document.getElementById("side-gcount");
      if (counter) counter.textContent = `${index + 1} / ${total}`;
      advance.step(index, total, moved);
      paintButton();
    };
    // Back and "all at once" stay under the photo, where they were. Only the
    // advance moved: it is the one control pressed thirteen times.
    // Back, the counter, and the escape hatch. The advance is not here any
    // more, so this row must not stretch two buttons to full width to fill the
    // gap it left.
    e.actions.classList.add("guided-row");
    e.actions.innerHTML = `
      <button class="btn gho" id="side-gback" type="button" aria-label="Previous point">‹</button>
      <span class="side-gcount" id="side-gcount"></span>
      <button class="btn cancel" id="side-gall" type="button">All points at once</button>`;
    document.getElementById("side-gback")!.onclick = () => verifier?.guidedBack();
    document.getElementById("side-gall")!.onclick = () => {
      inFrame.remove();
      verifier?.endGuided();
      showReviewActions();
    };
    inFrame.onclick = () => {
      if (advance.press() === "confirm") paintButton();
      else verifier?.guidedNext();
    };
    verifier!.startGuided(paint, () => {
      inFrame.remove();
      showReviewActions();
    });
  };

  const showReviewActions = () => {
    // Editable from the first frame. The old flow parked the points behind an
    // "Edit point placement" button, which meant the natural gesture — grab
    // the wrong dot and drag it — did nothing until you found the mode switch.
    // A control that looks draggable must drag.
    verifier?.setEditable(true);
    e.layer.querySelector(".gnext-in")?.remove();
    e.actions.classList.remove("guided-row");
    e.cap.textContent = "REVIEW LANDMARKS";
    const low = (seed.confidence ?? 1) < 0.7;
    e.panelCopy.innerHTML = `<h2 class="side-title">${low ? "These points need a check" : "Check the automatic points"}</h2>
      <p class="side-sub">${low
        ? "The automatic placement was unsure on this photo, so treat every ring as a starting position. Drag any ring straight onto the feature it names — the hollow centre shows the pixel underneath."
        : "The front of the face is measured; the five behind it — jaw corner, ear, and the neck point — are estimated from an average head, so they are the ones worth checking. Drag any ring straight onto the feature it names."}</p>
      <p class="side-review-note">Nothing leaves this device unless you separately choose to share it.</p>`;
    e.actions.innerHTML = `
      <button class="side-reset-glyph" id="side-reset" type="button" aria-label="Reset points to the automatic placement" title="Reset to automatic placement">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3.5 8a9 9 0 1 1-1 6.5"/><path d="M3 3v5h5"/>
        </svg>
      </button>
      <button class="btn gho" id="side-back">Retake picture</button>
      <button class="btn gho" id="side-guided">One by one</button>
      <button class="btn gho" id="side-wrong">Points are wrong</button>
      <button class="btn pri" id="side-go">Confirm</button>`;
    document.getElementById("side-reset")!.onclick = () => {
      verifier?.reset(automaticPoints);
      drawGuides(e.lines, automaticPoints, w, h);
    };
    document.getElementById("side-guided")!.onclick = () => showGuidedActions();
    document.getElementById("side-back")!.onclick = () => openSideCapture(ctx);
    document.getElementById("side-go")!.onclick = () => void confirmPlacement();
    document.getElementById("side-wrong")!.onclick = async () => {
      // The complaint is the moment to ask, because the complaint is the
      // evidence. What is deliberately NOT here is any mention of an account:
      // being asked to sign up before you have even confirmed your points is
      // the moment an app starts feeling like a funnel, so the send waits
      // until after Confirm, when sign-in happens anyway.
      flaggedWrong = true;
      consentAnswer = await askSideFeedbackConsent();
      const wrongButton = document.getElementById("side-wrong");
      wrongButton?.setAttribute("disabled", "true");
      if (wrongButton) wrongButton.textContent = consentAnswer ? "Thanks — noted" : "Noted";
      e.panelCopy.innerHTML = `<h2 class="side-title">Drag them where they belong</h2>
        <p class="side-sub">${consentAnswer
          ? "Thank you — that photo and the correction will be shared privately after you confirm, and it directly teaches the automatic placement to land closer. Move each wrong ring onto the feature it names, then confirm."
          : "No problem — nothing will be shared. Move each wrong ring onto the feature it names, then confirm."}</p>
        <p class="side-review-note">The circular arrow under the photo resets every point to the automatic placement.</p>`;
    };
  };

  // A fresh seed opens IN the walkthrough; a placement being re-opened for
  // corrections goes straight to the free-editing review, because those points
  // have already been through the walk once and the person came back for one
  // or two of them, not all thirteen.
  const startInGuidedMode = seedMethod !== "existing";

  const confirmPlacement = async () => {
    if (!verifier) return;
    const confirmButton = document.getElementById("side-go") as HTMLButtonElement | null;
    if (confirmButton) confirmButton.disabled = true;
    // The facing comes from the confirmed points, not from the detector that
    // seeded them. A tester's profile was seeded with the points in the right
    // places but the facing detected backwards, which both blocked Confirm and
    // would have inverted every projection measurement in the report.
    const faceDir = faceDirFromPoints(verifier.points);
    const issues = sidePointIntegrityIssues(verifier.points, w, h, faceDir);
    if (issues.length) {
      if (confirmButton) confirmButton.disabled = false;
      e.cap.textContent = "CHECK LANDMARKS";
      const first = issues[0];
      const hint = e.layer.querySelector<HTMLElement>(".verify-hint");
      if (hint) {
        hint.textContent = first;
        hint.classList.add("show");
      }
      return;
    }
    try {
      const correctedPoints = cloneSidePoints(verifier.points);
      const report = analyzeSide(verifier.points, faceDir, ctx.sex);

      // A measurement outside anatomical bounds is a misplaced point, and this
      // is the last moment it can be caught.
      //
      // sidePointIntegrityIssues above checks the POINTS against each other —
      // ordering, spacing, facing. It cannot see a pair that is individually
      // reasonable and jointly impossible. A Cavill capture exported a ramus to
      // mandible ratio of 1.19 against a bound of 0.35-0.95, meaning the two
      // arms of the jaw came out nearly equal length, which no mandible is; and
      // a nasofrontal angle of 83.6 against a bound of 95-170. Both passed the
      // point checks, both landed in an export that looked entirely ordinary,
      // and neither was noticed until the numbers were read one by one weeks
      // later.
      //
      // The engine already knows — scoreMetric sets `implausible` and drops the
      // metric from every aggregate. It just was not telling anybody. This says
      // it, names the measurement, and refuses to store the scan until the
      // points behind it have been moved.
      const impossible = report.metrics.filter((m) => m.implausible);
      if (impossible.length) {
        if (confirmButton) confirmButton.disabled = false;
        e.cap.textContent = "CHECK LANDMARKS";
        const names = impossible.map((m) => m.def.name.toLowerCase());
        const points = [...new Set(impossible.flatMap((m) => m.def.points ?? []))];
        // The measured value and the bound it broke, in the message itself.
        //
        // The refusal used to say only that something was outside what a face
        // can be. That is enough to stop a bad scan and nowhere near enough to
        // tell the two possible causes apart: a misplaced point, or a bound
        // that does not describe this measurement. Those need opposite fixes,
        // and without the number the only way to tell them apart was to read
        // coordinates off a screenshot and work backwards — which is how a
        // guard that rejected its own ground truth survived three reports.
        const readings = impossible.map((m) => {
          const bound = m.def.plausible;
          const value = m.value.toFixed(m.def.decimals);
          return bound ? `${m.def.name} ${value} (expected ${bound[0]}–${bound[1]})` : `${m.def.name} ${value}`;
        });
        const hint = e.layer.querySelector<HTMLElement>(".verify-hint");
        if (hint) {
          hint.textContent = `${readings.join("; ")} — check ${
            points.length ? points.join(", ") : "the points behind it"
          }`;
          hint.classList.add("show");
        }
        e.panelCopy.innerHTML = `<h2 class="side-title">One of these cannot be right</h2>
          <p class="side-sub">The ${names.join(" and ")} measured outside the range a human
          face occupies, which means a point is in the wrong place rather than that this is an
          unusual profile. ${points.length
            ? `Check <b>${points.join("</b>, <b>")}</b>.`
            : ""}</p>
          <p class="side-review-note">Storing it anyway would put a number in the calibration
          set that describes where a point landed, not the face.</p>`;
        return;
      }

      // Confirming a seed nobody touched.
      //
      // Allowed, because a good automatic placement should not have to be
      // nudged to be accepted — but it takes a second press, and the copy says
      // what is being accepted. Every side scan in the benchmark file was
      // confirmed untouched, and their measurements disagree with an
      // independent product by 22, 12 and 48 degrees on metrics that agreed to
      // within two degrees on the one capture that happened to seed well.
      if (!movedSidePointIds(automaticPoints, correctedPoints).length && !untouchedAcknowledged) {
        untouchedAcknowledged = true;
        if (confirmButton) {
          confirmButton.disabled = false;
          confirmButton.textContent = "Confirm as-is";
        }
        e.panelCopy.innerHTML = `<h2 class="side-title">Nothing was moved</h2>
          <p class="side-sub">These are the automatic positions exactly as they were estimated.
          The five behind the face — jaw corner, ear and the neck point — are inferred from an
          average head rather than found in the photo, so they are the ones that drift.</p>
          <p class="side-review-note">If they are genuinely right, press Confirm as-is. If you
          have not looked yet, this is the moment — a side score built on a guessed jaw corner
          measures the guess.</p>`;
        return;
      }

      // Consent, asked only when there is something to learn.
      //
      //   Flagged wrong          — already asked, at the complaint.
      //   Edited without a flag  — they fixed something and did not say so;
      //                            ask now, framed around the edit.
      //   Confirmed untouched    — the seed was right and there is nothing to
      //                            teach. Asking would be pure friction.
      let consented = consentAnswer ?? false;
      if (!flaggedWrong && consentAnswer === null) {
        const moved = movedSidePointIds(automaticPoints, correctedPoints);
        if (moved.length > 0) consented = await askSideFeedbackConsent(true);
      }
      const feedback = createSideFeedbackIntent(
        consented,
        ctx.scanId,
        crypto.randomUUID(),
        automaticPoints,
        seedMethod,
      );
      e.cap.textContent = "ANALYZED";
      const reviewed = document.createElement("canvas");
      reviewed.width = e.canvas.width;
      reviewed.height = e.canvas.height;
      reviewed.getContext("2d")?.drawImage(e.canvas, 0, 0);

      ctx.onDone(report, correctedPoints, faceDir, {
        automaticPoints,
        seedMethod,
        feedback,
        photo: reviewed,
      });
    } catch (err) {
      if (confirmButton) confirmButton.disabled = false;
      e.cap.textContent = "CHECK LANDMARKS";
      const hint = e.layer.querySelector<HTMLElement>(".verify-hint");
      if (hint) {
        hint.textContent = err instanceof Error ? err.message : "Those points could not be measured";
        hint.classList.add("show");
      }
    }
  };

  if (startInGuidedMode) showGuidedActions();
  else showReviewActions();
}

function askSideFeedbackConsent(afterEdit = false): Promise<boolean> {
  // Resolved while the dialog is still being read rather than at the moment of
  // the tap, so the confirmation never waits on a network round trip to decide
  // which sentence to print. Defaults to the signed-out wording if the check
  // has not landed yet, which is the safe direction: it names a condition that
  // is already met rather than promising something conditional on nothing.
  let signedIn = false;
  void currentAccessToken().then((token) => {
    signedIn = Boolean(token);
  });
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "side-feedback-backdrop";
    backdrop.innerHTML = `<section class="side-feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="side-feedback-title" aria-describedby="side-feedback-copy">
      <span class="klabel">OPTIONAL · YOUR CHOICE</span>
      <h2 id="side-feedback-title">${afterEdit ? "We noticed you adjusted the points" : "Help improve TrueMax?"}</h2>
      <p id="side-feedback-copy">${afterEdit
        ? "Was that because the automatic placement was wrong? With your permission, TrueMax will privately send this side-profile photo, where the points landed automatically, and where you moved them — corrections like yours are exactly what teaches the placement to land right next time."
        : "With your permission, TrueMax will privately send this side-profile photo, the points placed automatically, and the final points you confirmed. This helps us improve landmark placement for future scans."}</p>
      <p class="side-feedback-privacy">Saying no will not change your analysis. If you say yes, the submission is stored privately for up to 90 days and is not used for advertising.</p>
      <div class="side-feedback-actions">
        <button type="button" class="btn gho" data-choice="no">No, keep it on this device</button>
        <button type="button" class="btn pri" data-choice="yes">Yes, share this scan</button>
      </div>
    </section>`;
    document.body.appendChild(backdrop);
    const no = backdrop.querySelector<HTMLButtonElement>('[data-choice="no"]')!;
    const yes = backdrop.querySelector<HTMLButtonElement>('[data-choice="yes"]')!;
    let finished = false;
    const finish = (choice: boolean) => {
      if (finished) return;
      finished = true;
      if (!choice) {
        backdrop.remove();
        resolve(false);
        return;
      }
      const dialog = backdrop.querySelector<HTMLElement>(".side-feedback-dialog")!;
      // Telling somebody who is already signed in that we will send it "after
      // you are signed in" reads as a task they still owe us, and the only
      // thing they can do about it is the thing they have already done.
      //
      // Note the tense is the same in both: nothing has been sent at this
      // point either way — the upload happens on confirm, a few taps later.
      // What differs is what it is waiting FOR, so that is what the sentence
      // says. Claiming "sent" here would be a nicer sentence about a thing that
      // has not happened yet.
      const waiting = signedIn ? "when you confirm" : "once you are signed in";
      dialog.innerHTML = `<span class="side-feedback-thanks" aria-live="polite">Thank you.</span>
        <p>We’ll share it privately ${waiting}.</p>`;
      window.setTimeout(() => {
        backdrop.remove();
        resolve(true);
      }, 850);
    };
    no.onclick = () => finish(false);
    yes.onclick = () => finish(true);
    backdrop.addEventListener("keydown", (event) => {
      if (event.key === "Escape") finish(false);
    });
    no.focus();
  });
}

// Reference lines the user can sanity-check their placement against:
// Ricketts' E-line (nose tip → chin) and the facial-convexity legs.
function drawGuides(svg: SVGSVGElement, p: SidePoints, w: number, h: number): void {
  const X = (v: number) => (v / w) * 100;
  const Y = (v: number) => (v / h) * 100;
  const line = (a: keyof SidePoints, b: keyof SidePoints, dash: string) =>
    `<line x1="${X(p[a].x)}" y1="${Y(p[a].y)}" x2="${X(p[b].x)}" y2="${Y(p[b].y)}"
      stroke="rgba(143,243,224,.75)" stroke-width="0.35" stroke-dasharray="${dash}" vector-effect="non-scaling-stroke"/>`;
  svg.innerHTML =
    line("pronasale", "pogonion", "2 2") +
    line("glabella", "subnasale", "1 3") +
    line("subnasale", "pogonion", "1 3") +
    line("condylion", "gonion", "2 2") +
    line("gonion", "menton", "2 2");
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not load image"));
    };
    img.src = url;
  });
}
