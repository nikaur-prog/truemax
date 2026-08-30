import { currentAccessToken } from "../engine/auth.js";
import { analyzeSide } from "../engine/scoring.js";
import type { Report, Sex } from "../engine/types.js";
import { SIDE_POINTS, faceDirFromPoints, sidePointIntegrityIssues } from "../engine/sideMetrics.js";
import { createSettler } from "../engine/captureSettle.js";
import { GuidedAdvance } from "./guidedAdvance.js";
import {
  mountSoundToggle,
  soundAdvance,
  soundDrag,
  soundFinish,
  soundGrab,
  soundNext,
  startThinking,
  stopThinking,
} from "./scanSounds.js";
import type { SidePointId, SidePoints } from "../engine/sideMetrics.js";
import { mountVerifier, seedSidePointsSmart } from "./sideVerify.js";
import { GUIDE_PHOTO_URL, drawGuideCrop, drawGuideWhole, guidePhotoReady, playGuideZoom } from "./sideGuidePhoto.js";
import { mountSideReference } from "./sideReference.js";
import type { ReferenceHandle } from "./sideReference.js";
import { mountRetakeGlyph } from "./retakeGlyph.js";
import type { RetakeHandle } from "./retakeGlyph.js";
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
import { cameraCount, startCamera } from "./camera.js";
import { clearCameraTakeover, enterCameraTakeover, exitCameraTakeover } from "./camTakeover.js";
import { setRunningMode } from "../engine/landmarker.js";
import { resetSideTracking } from "../engine/captureGuide.js";
import { createAutoCapture } from "./autoCapture.js";
import type { AutoCapture } from "./autoCapture.js";
import type { CameraHandle } from "./camera.js";

// The upload glyph: a cloud with an arrow going up into it.
//
// Named rather than inlined three times. "Upload a photo" appears on the
// awaiting screen, on the camera screen as the escape hatch, and the two must
// carry the same mark — three hand-copied SVGs is how one of them ends up a
// pixel off and nobody notices for a month.
//
// currentColor throughout, so it inherits whichever button variant it lands
// in: mint on the primary, ink on the ghost.
const UPLOAD_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
  fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
  <path d="M17.5 18.5a4 4 0 0 0 .3-8 6 6 0 0 0-11.5-1.4 3.6 3.6 0 0 0 .2 7.2"/>
  <path d="M12 21V11"/><path d="M8.5 14.2 12 10.7l3.5 3.5"/>
</svg>`;

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

// One per module: only one side capture screen exists at a time.
const sideSettle = createSettler();

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
let retake: RetakeHandle | null = null;
let soundToggle: { destroy(): void } | null = null;
let sideCam: CameraHandle | null = null;
let sideCamOpening = false;
let sideCamAttempt = 0;
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
  swap: document.getElementById("side-swap") as HTMLButtonElement,
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

/**
 * Strip the guided walkthrough's furniture off the photo frame.
 *
 * The pill and the reference crop are appended straight to the frame by
 * paint() rather than being owned by the verifier, so `verifier.destroy()`
 * left them behind. Retaking the side photo therefore opened a live camera
 * with "Ear notch 13/13" pinned to one corner and a cropped ear photograph
 * in the other — a walkthrough for a photograph that no longer existed,
 * naming a landmark on a face that had not been captured yet.
 *
 * Called from every path that puts the frame back into a state where there is
 * no photograph to point at: opening the capture, retaking, and closing.
 */
function clearWalkthrough(frame: HTMLElement): void {
  frame.querySelector(".side-pointpill")?.remove();
  frame.querySelector(".side-refcrop")?.remove();
  // The popped-out reference lives on <body>, so it survives the frame being
  // emptied and would hang over the camera on its own.
  document.querySelector(".refcrop-full")?.remove();
}

export function openSideCapture(ctx: SideCtx): void {
  // Any dialog belonging to the placement that is being retaken goes with it.
  //
  // The placement sheet stops pointer events reaching the photograph beneath
  // it, and layering keeps a mouse away from the retake control, but neither
  // makes that control unreachable: Shift-Tab from the sheet's own button
  // lands on it and Enter fires it. The verifier was then destroyed while the
  // sheet stayed on screen, and answering it ran the previous placement's
  // callback against a capture that no longer existed.
  //
  // Cancelled here rather than defended against at the retake button, because
  // this is the one function every retake goes through whatever reached it:
  // keyboard, pointer or assistive technology.
  cancelDialogs();
  const e = el();
  verifier?.destroy();
  verifier = null;
  // Or the guide badge stays pinned over the live camera preview.
  reference?.destroy();
  reference = null;
  // Same for retake: it acts on a photograph, and there is not one yet.
  retake?.destroy();
  retake = null;
  soundToggle?.destroy();
  soundToggle = null;
  stopThinking();
  clearWalkthrough(e.frame);
  markSideOpen(true);
  e.section.classList.remove("hidden");
  e.cap.textContent = "AWAITING PHOTO";
  e.drop.classList.remove("hidden");
  e.live.classList.add("hidden");
  // Frame is empty, so the exemplar has the frame. Cleared by the camera and
  // by mountVerify; nothing else may show it, or it sits under a real face.
  e.frame.classList.add("awaiting");
  e.lines.replaceChildren();
  renderSideCaptureCopy(e.panelCopy);

  // The side matches how the front was taken. Shot the front on camera → open
  // the profile camera straight away; uploaded it → offer only the file drop.
  // With no method known, both choices are shown as before.
  if (ctx.method === "camera") {
    // Inputs FIRST, camera second. wireSideInputs writes the awaiting caption,
    // and openSideCamera writes the live one before its first await — so in
    // the old order the awaiting text landed on top of a running camera and
    // the screen read "AWAITING PHOTO · PASTE, DROP OR UPLOAD" over a live
    // preview. The camera owns the caption once it starts.
    wireSideInputs(e, ctx);
    void openSideCamera(ctx);
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
    ? `<button class="btn pri" id="side-pick">${UPLOAD_ICON}<span>Upload a photo</span></button>`
    : `<button class="btn gho" id="side-pick">${UPLOAD_ICON}<span>Upload a photo</span></button>`;
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
  if (sideCam || sideCamOpening) return;
  const attempt = ++sideCamAttempt;
  sideCamOpening = true;
  // The retake button reaches here without going through openSideCapture, and
  // it is the path that produced the bug: a walkthrough part-way through, then
  // a live camera underneath the point it had reached.
  verifier?.destroy();
  verifier = null;
  reference?.destroy();
  reference = null;
  soundToggle?.destroy();
  soundToggle = null;
  stopThinking();
  clearWalkthrough(e.frame);
  e.lines.replaceChildren();
  e.drop.classList.add("hidden");
  e.live.classList.remove("hidden");
  e.frame.classList.add("live");
  e.frame.classList.remove("awaiting");
  // fitFrameToViewport stamps an inline max-width on the frame for the VERIFY
  // step, sized to that photograph's aspect. It is stale the moment the camera
  // reopens, and an inline width beats the takeover's stylesheet — so a
  // retake after a verify would open the full-screen viewfinder pinned to the
  // last photo's width. Cleared here rather than fought with !important.
  e.frame.style.maxWidth = "";
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
    const started = await startCamera({
      video: e.video,
      guideCanvas: e.guide,
      mode: "side",
      // See main.ts: a swap that loses both cameras leaves nothing behind the
      // viewfinder, so the screen closes instead of decorating a dead frame.
      onLost: () => {
        stopSideCamera();
        openSideCapture(ctx);
        e.hintTitle.textContent = "Camera unavailable";
      },
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
        // Settled, not raw — see engine/captureSettle.ts. The lamp underneath
        // still tracks every frame; the sentence and its colour wait for a
        // reading to repeat, so a face sitting on the boundary between two
        // checks stops strobing the screen.
        const shown = sideSettle.settle({ status: c.status, hint: c.hint, detail: c.detail });
        if (!auto?.armed()) {
          e.hintTitle.textContent = shown.hint;
          e.hintDetail.textContent = shown.detail;
        }
        e.hint.classList.toggle("ready", c.ready);
        e.hint.classList.toggle("red", shown.status === "red");
        e.hint.classList.toggle("amber", shown.status === "amber");
        e.lamp.className = `lamp ${c.status === "green" ? "green" : c.status}`;
        e.lampFill.className = c.status === "green" ? "green" : c.status;
        e.lampFill.style.width = `${Math.round((c.status === "green" ? 1 : c.progress) * 100)}%`;
        const shoot = document.getElementById("side-shoot") as HTMLButtonElement | null;
        // The first frame is what makes the shutter real. Until onCheck has
        // fired at least once the camera has produced nothing, and a Capture
        // button that silently ignores taps is indistinguishable from a
        // crashed app — which is exactly how it was reported.
        if (shoot && shoot.disabled) {
          shoot.disabled = false;
          shoot.textContent = "Capture";
        }
      },
    });
    if (attempt !== sideCamAttempt) {
      started.stop();
      await setRunningMode("IMAGE");
      return;
    }
    sideCam = started;
  } catch {
    if (attempt !== sideCamAttempt) return;
    clearCameraTakeover();
    e.live.classList.add("hidden");
    e.frame.classList.remove("live");
    e.frame.classList.add("awaiting");
    e.drop.classList.remove("hidden");
    e.hintTitle.textContent = "Camera unavailable";
    return;
  } finally {
    if (attempt === sideCamAttempt) sideCamOpening = false;
  }

  // The same full-screen viewfinder the front shot gets. This step needs it
  // more, not less: the profile is taken with your head turned away from the
  // display, so the directive and the shutter have to be as large and as
  // findable as the hardware allows.
  enterCameraTakeover(e.frame.closest(".cam-stage"));

  // The switch appears only when there is a second camera to switch to. On the
  // side shot this is the one most people actually want: a second person
  // taking the photo holds the phone the way a photographer does, back camera
  // out.
  void cameraCount().then((n) => {
    e.swap.classList.toggle("hidden", n < 2 || !sideCam);
  });
  e.swap.onclick = async () => {
    if (!sideCam) return;
    e.swap.disabled = true;
    await sideCam.swap();
    e.swap.disabled = false;
  };
  // Same order as the front screen: the shutter first, upload second. They were
  // reversed here, so the button under your thumb changed meaning between the
  // two steps of the same flow.
  e.actions.innerHTML = `
    <button class="btn pri" id="side-shoot" disabled>Starting camera…</button>
    <button class="btn gho" id="side-stop">${UPLOAD_ICON}<span>Upload a photo</span></button>`;
  e.actions.insertAdjacentHTML(
    "beforeend",
    `<button class="btn cancel" id="side-quit2">Cancel</button>`,
  );
  document.getElementById("side-quit2")!.onclick = () => {
    // Back one step, NOT out of the scan.
    //
    // This used to run resetToUpload() directly, so cancelling the profile
    // camera threw away the finished FRONT photo and returned to the very
    // start. Reported from a phone: "I clicked redo for the side profile and
    // it took me all the way back to the front photo." Cancelling a shot you
    // have not taken yet should cost you the shot, nothing else.
    //
    // onBack is now the caller's one-step-back, not its abandon: the capture
    // flow shows the front photograph again with retake / continue / cancel on
    // it, and the adjust flow returns to the results it was opened from.
    stopSideCamera();
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
  sideCamAttempt++;
  sideCamOpening = false;
  const held = sideCam;
  sideCam = null;
  held?.stop();
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
  exitCameraTakeover(e.frame.closest(".cam-stage"));
  e.live.classList.add("hidden");
  e.turnCue.classList.add("hidden");
  e.frame.classList.remove("live");
  e.swap.classList.add("hidden");
  e.swap.onclick = null;
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

// ---------------------------------------------------------------------------
// Dialogs that outlive the function call that opened them.
//
// Both the placement sheet and the consent dialog hand a promise back to a
// caller holding closures over the CURRENT scan: which photograph, which
// points, which feedback record. Neither was torn down by close(), so an
// identity change or a retake left the sheet on screen with its handlers
// live, and the next tap ran the previous scan's code against the new one.
// The promise never settled either, so the awaiting closure was held forever.
//
// Registering the cancel here is what lets close() be the single place that
// knows how to take the side flow down. Cancelling settles the promise in the
// direction that does nothing: no mode chosen, no consent given.
// ---------------------------------------------------------------------------
const openDialogs = new Set<() => void>();

function trackDialog(cancel: () => void): () => void {
  openDialogs.add(cancel);
  return () => openDialogs.delete(cancel);
}

function cancelDialogs(): void {
  // Copied before iterating: each cancel removes itself from the set.
  for (const cancel of [...openDialogs]) cancel();
  openDialogs.clear();
}

export function close(): void {
  cancelDialogs();
  stopSideCamera();
  verifier?.destroy();
  verifier = null;
  reference?.destroy();
  reference = null;
  retake?.destroy();
  retake = null;
  soundToggle?.destroy();
  soundToggle = null;
  stopThinking();
  clearWalkthrough(el().frame);
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
  // The photo is already on the canvas by this line. mountVerify clears this
  // too, but there is async work between here and there, and one frame of an
  // exemplar sitting over somebody's own face is one frame too many.
  e.frame.classList.remove("awaiting");
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
  let seed = await seedSidePointsSmart(e.canvas);
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
  e.frame.classList.remove("awaiting");
  e.cap.textContent = caption;
  fitFrameToViewport(e.frame, w, h);

  const automaticPoints = cloneSidePoints(seed.automaticPoints ?? seed.points);
  const seedMethod = seed.method ?? "existing";

  // A fresh seed opens IN the walkthrough; a placement being re-opened for
  // corrections goes straight to the free-editing review, because those points
  // have already been through the walk once and the person came back for one
  // or two of them, not all thirteen. Decided here because the reference badge
  // below keys off it.
  const startInGuidedMode = seedMethod !== "existing";
  verifier?.destroy();
  verifier = mountVerifier(e.layer, e.canvas, seed, (pts) => drawGuides(e.lines, pts, w, h));
  // The whole-face reference badge, for the free-editing review where a person
  // is looking at all thirteen rings at once and wants to compare the set.
  //
  // NOT during the guided walk. That step now carries its own reference — the
  // crop for the point being placed, in the same corner — and two reference
  // widgets stacked in one corner is how the walkthrough ended up with a
  // labelled thumbnail sitting on top of an unlabelled one. One reference per
  // screen, and on the walkthrough it is the one that answers the question
  // actually being asked: where does THIS point go.
  reference?.destroy();
  reference = startInGuidedMode ? null : mountSideReference(e.frame, seed.faceDir);
  // And the way back out, in the opposite corner. Mounted once here rather
  // than per step, so it is the same control in the same place whether you are
  // thirteen taps into the walkthrough or looking at the whole set at once —
  // which is the point of moving it out of the button rows below.
  retake?.destroy();
  retake = mountRetakeGlyph(e.frame, "Retake this photo", () => openSideCapture(ctx));
  // Retake reopens the SIDE step only — never the front. openSideCapture with
  // ctx.method === "camera" goes straight back to the profile camera, which is
  // what "retake this photo" means on this screen.
  drawGuides(e.lines, seed.points, w, h);

  // Whether the person told us the placement was wrong, and what they said to
  // "send it to our team". Answered at most once, at the moment of the
  // complaint — not re-asked at confirm.
  let flaggedWrong = false;
  let consentAnswer: boolean | null = null;
  // Set when the automatic placement was TAKEN rather than walked through, so
  // the review panel knows to ask whether it was right. Cleared once answered:
  // the question is asked once, not every time the panel repaints.
  let askedAccuracy = false;
  // Set once the "nothing was moved" prompt has been shown, so the second press
  // goes through. Scoped per mounted photo, so the next face asks again.
  let untouchedAcknowledged = false;

  // The photographic "it goes here" patch, when the reference exists. Loaded
  // once per mount; a missing or unshipped image just means the steps show
  // their words alone, which is what they always did.
  //
  // Out here rather than inside the walkthrough because the all-points view
  // needs the same picture: it was declared in showGuidedActions, so the two
  // screens could not share one reference even though they are describing the
  // same thirteen landmarks on the same photograph.
  let guideImage: HTMLImageElement | null = null;
  if (guidePhotoReady()) {
    guideImage = new Image();
    guideImage.src = GUIDE_PHOTO_URL;
  }

  // -----------------------------------------------------------------------
  // The reference in the corner, for ONE named point.
  //
  // It used to be built inside the walkthrough's paint() and nowhere else,
  // which is why "all points at once" showed a cropped ear while the ring in
  // your hand was the upper lip: the reference was left wherever the walk had
  // last put it, describing a point you were no longer on. Lifted out here so
  // the walkthrough and the all-points view drive the same thing — the walk
  // by its step, the all-points view by whichever ring you pick up.
  // -----------------------------------------------------------------------
  const setReference = (id: SidePointId, label: string, hint: string): void => {
  let refWrap = e.frame.querySelector<HTMLElement>(".side-refcrop");
  if (guideImage && !refWrap) {
    refWrap = document.createElement("div");
    refWrap.className = "side-refcrop";
    refWrap.innerHTML = `<div class="side-refcrop-stage">
        <canvas id="side-refcrop"></canvas>
        <button type="button" class="refcrop-big" id="refcrop-big" aria-label="Show where this sits on the whole profile">⤢</button>
      </div>`;
    e.frame.appendChild(refWrap);
  }
  if (guideImage) {
    const crop = document.getElementById("side-refcrop") as HTMLCanvasElement | null;
    const render = () => {
      if (crop && guideImage!.naturalWidth) drawGuideCrop(crop, guideImage!, id, verifier!.faceDir);
    };
    if (guideImage.complete) render();
    else guideImage.onload = render;
    // The "show me" zoom: full profile, ring on the point, smooth zoom in.
    // A step change re-renders this whole panel, so the cancel handle never
    // outlives the canvas it paints.
    // The thumb is a STILL. Playing a zoom inside a 92px square was an
    // animation nobody could follow, and it ran on the same canvas the
    // person was using as a reference — so the reference kept moving.
    // Tap it and it opens; the movement lives there, where it is legible.
    const big = document.getElementById("refcrop-big");
    const openBig = () => {
        const overlay = document.createElement("div");
        overlay.className = "sref-overlay refcrop-full";
        overlay.innerHTML = `<div class="refcrop-fullcard" role="dialog" aria-modal="true" aria-label="Reference for this point">
          <div class="refcrop-stage">
            <canvas></canvas>
            <button type="button" class="refcrop-play-big" aria-label="Play the zoom">▶</button>
            <button type="button" class="refcrop-close" aria-label="Minimise">⤡</button>
          </div>
          <p class="refcrop-hint"><b>${label}</b>${hint ? ` — ${hint}` : ""}</p>
        </div>`;
        document.body.appendChild(overlay);
        const bigCanvas = overlay.querySelector("canvas")!;
        const size = Math.min(640, Math.min(window.innerWidth, window.innerHeight) - 48);
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        bigCanvas.width = size * dpr;
        bigCanvas.height = size * dpr;
        bigCanvas.style.width = `${size}px`;
        bigCanvas.style.height = `${size}px`;
        // Opens on the WHOLE profile, held still. The zoom is a thing you
        // ask for with the play button, not a thing that happens at you
        // the moment a panel appears — which is what made this feel like a
        // glitch rather than a demonstration.
        drawGuideWhole(bigCanvas, guideImage!, id, verifier!.faceDir);
        let stop: (() => void) | null = null;
        const close = () => {
          stop?.();
          stop = null;
          overlay.remove();
          document.removeEventListener("keydown", onKey);
        };
        const onKey = (ev: KeyboardEvent) => {
          if (ev.key === "Escape") close();
        };
        document.addEventListener("keydown", onKey);
        overlay.querySelector(".refcrop-play-big")?.addEventListener("click", (ev) => {
          ev.stopPropagation();
          stop?.();
          stop = playGuideZoom(bigCanvas, guideImage!, id, verifier!.faceDir, {
            durationMs: 1900,
            holdMs: 650,
            onDone: () => (stop = null),
          });
        });
        overlay.addEventListener("click", (ev) => {
          if (ev.target === overlay || (ev.target as HTMLElement).closest(".refcrop-close")) close();
        });
    };
    if (big) big.onclick = openBig;
    // The picture itself is the target people reach for, not the small
    // glyph in its corner.
    if (crop) crop.onclick = openBig;
  }
  };

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
    // The sounds start here, so the control for them does too. It is the same
    // toggle in the same corner on both screens, because it is the same
    // question — points are dragged in the walkthrough as much as in the
    // all-points view.
    soundToggle?.destroy();
    soundToggle = mountSoundToggle(e.frame);
    const advance = new GuidedAdvance();

    // Three dots, bouncing out of phase, while a finger is down on the ring.
    // Built as elements rather than an ellipsis character so each one can carry
    // its own animation delay.
    const DOTS = `<i class="gnext-dot"></i><i class="gnext-dot"></i><i class="gnext-dot"></i>`;

    // The blue-to-green change is the moment the step is answered, and it used
    // to be a text swap: the same button, a different word, a different colour,
    // all in one frame. Nothing about that said "you did that" — it read as the
    // label being wrong a moment ago.
    //
    // So the change is played rather than applied. The old label leaves
    // upward, the colour crosses under it, and the new one arrives from below,
    // which is the same direction the walkthrough itself is travelling. Fast
    // enough (about a fifth of a second) that pressing thirteen times never
    // becomes a wait.
    let wasReady = false;
    const paintButton = (animate = false) => {
      const { ready, busy, text } = advance.view();
      const changed = ready !== wasReady;
      wasReady = ready;
      const apply = () => {
        inFrame.classList.toggle("ready", ready);
        inFrame.classList.toggle("busy", busy);
        if (busy) inFrame.innerHTML = DOTS;
        else {
          inFrame.textContent = text;
          // The return-key glyph rides on the button so the shortcut teaches
          // itself. CSS shows it only on fine-pointer devices: a phone has no
          // Enter, and a hint for a key that does not exist reads as clutter.
          const kbd = document.createElement("kbd");
          kbd.className = "gnext-kbd";
          kbd.textContent = "⏎";
          inFrame.appendChild(kbd);
        }
      };
      if (animate && changed && !busy) {
        inFrame.classList.add("swapping");
        window.setTimeout(() => {
          apply();
          inFrame.classList.remove("swapping");
          inFrame.classList.add("swapped");
          window.setTimeout(() => inFrame.classList.remove("swapped"), 260);
        }, 130);
      } else {
        apply();
      }
      // The marker under the walkthrough goes green the moment the step is
      // answered, so the photo and the button agree without being read
      // separately.
      e.layer.classList.toggle("step-answered", advance.answered());
    };

    // The verifier owns the pointer; it tells us when one is down on a ring so
    // the button can stop offering something the finger is not free to take.
    verifier!.onDragChange = (dragging) => {
      advance.setDragging(dragging);
      // The pulse runs for exactly as long as the dots do, so the two are one
      // signal rather than two.
      if (dragging) {
        soundGrab();
        startThinking();
      } else {
        stopThinking();
      }
      paintButton();
    };
    verifier!.onDragMove = () => soundDrag();

    const paint = (index: number, total: number, moved = false) => {
      const { label, hint } = verifier!.guidedCurrent();
      // ---------------------------------------------------------------------
      // The walkthrough is the photograph, and nothing else.
      //
      // This step used to be a photo on the left and a column of prose on the
      // right: a heading, a paragraph of instructions, a reference thumbnail
      // under a caption, and a note about which points are guesses — read once
      // on the first point and never again on the other twelve, while the
      // thing the person is actually doing (looking at a ring on their own
      // face and deciding whether it is in the right place) had half a screen.
      //
      // So the column is gone. What survives is the only thing that changes
      // per point: its NAME, on a pill in the corner of the photograph, where
      // the eye already is. The reference sits on the picture too, small, and
      // opens when it is wanted rather than occupying the layout in case.
      // ---------------------------------------------------------------------
      e.panelCopy.innerHTML = "";
      let pill = e.frame.querySelector<HTMLElement>(".side-pointpill");
      if (!pill) {
        pill = document.createElement("span");
        pill.className = "side-pointpill";
        e.frame.appendChild(pill);
      }
      pill.innerHTML = `<b>${label}</b><em>${index + 1}/${total}</em>`;
      // Re-arm the entrance so each point's name arrives rather than swaps.
      pill.classList.remove("in");
      void pill.offsetWidth;
      pill.classList.add("in");

      setReference(SIDE_POINT_IDS[index], label, hint);


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
    // Retake is not here. It was added to this row for a real reason — anyone
    // who noticed their photo was wrong DURING the walkthrough, which is
    // exactly when you notice, had no way out except finishing thirteen points
    // on a picture they were about to discard — but a word in a row of words
    // was the wrong shape for it. It is on the photograph now, bottom right,
    // for the whole of both steps. See retakeGlyph.ts.
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
    const pressAdvance = () => {
      if (advance.press() === "confirm") {
        // Answering an untouched point turns the button green and names what
        // is next. That is the change worth playing — both the animation and
        // the two rising notes belong here rather than on the step after.
        paintButton(true);
        soundAdvance();
      } else {
        // A different ping from the confirm above: that one was agreement,
        // this one is travel.
        soundNext();
        verifier?.guidedNext();
      }
    };
    inFrame.onclick = pressAdvance;
    // Enter mirrors the advance for anyone on a keyboard. Thirteen presses is
    // exactly the count at which reaching for the trackpad between each one
    // starts to grate. Focused buttons already fire their own click on Enter,
    // so those are left to the browser rather than fired twice.
    const onWalkKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Enter") return;
      const t = ev.target as HTMLElement | null;
      if (t && ["BUTTON", "INPUT", "TEXTAREA", "SELECT", "A"].includes(t.tagName)) return;
      ev.preventDefault();
      pressAdvance();
    };
    window.addEventListener("keydown", onWalkKey);
    const gall = document.getElementById("side-gall");
    if (gall) {
      const leaveViaAll = gall.onclick;
      gall.onclick = (ev) => {
        window.removeEventListener("keydown", onWalkKey);
        leaveViaAll?.call(gall, ev);
      };
    }
    verifier!.startGuided(paint, () => {
      window.removeEventListener("keydown", onWalkKey);
      soundFinish();
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
    // Thirteen rings at once and no walkthrough to say which is which, so the
    // corner reference follows the hand: pick up a ring and the reference
    // becomes that landmark. Without this it sat on whatever the walk last
    // showed — an ear crop while you were dragging the upper lip.
    stopThinking();
    e.frame.querySelector(".side-pointpill")?.remove();
    soundToggle?.destroy();
    soundToggle = mountSoundToggle(e.frame);
    if (verifier) {
      verifier.onDragChange = (dragging) => {
        if (dragging) {
          soundGrab();
          startThinking();
        } else {
          stopThinking();
          soundAdvance();
        }
      };
      verifier.onDragMove = () => soundDrag();
      verifier.onSelect = (id) => {
        const def = SIDE_POINTS.find((sp) => sp.id === id);
        if (def) setReference(id, def.label, def.hint);
      };
    }
    const low = (seed.confidence ?? 1) < 0.7;
    e.panelCopy.innerHTML = `<h2 class="side-title">${low ? "These points need a check" : "Check the automatic points"}</h2>
      <p class="side-sub">${low
        ? "The automatic placement was unsure on this photo, so treat every ring as a starting position. Drag any ring straight onto the feature it names: the hollow centre shows the pixel underneath."
        : "The front of the face is measured; the five behind it, jaw corner, ear, and the neck point, are estimated from an average head, so they are the ones worth checking. Drag any ring straight onto the feature it names."}</p>
      <p class="side-review-note">Nothing leaves this device unless you separately choose to share it.</p>`;
    e.actions.innerHTML = `
      <button class="side-reset-glyph" id="side-reset" type="button" aria-label="Reset points to the automatic placement" title="Reset to automatic placement">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3.5 8a9 9 0 1 1-1 6.5"/><path d="M3 3v5h5"/>
        </svg>
      </button>
      <button class="btn gho" id="side-guided">One by one</button>
      ${askedAccuracy ? "" : `<button class="btn gho" id="side-wrong">Points are wrong</button>`}
      <button class="btn pri" id="side-go">Confirm</button>`;
    if (askedAccuracy) {
      // Asked as a question with two answers rather than left as a button
      // somebody has to think to press. "Points are wrong" is a complaint, and
      // people do not complain, they shrug and carry on: the yes half of this
      // is what makes answering it feel like part of the flow. Only the no
      // half goes anywhere, which is the same consent ask the button had.
      const ask = document.createElement("div");
      ask.className = "side-accuracy";
      ask.innerHTML = `<p>Do you think the points landed in the right places?</p>
        <span class="side-accuracy-btns">
          <button type="button" class="btn gho" data-acc="no">No</button>
          <button type="button" class="btn gho" data-acc="yes">Yes</button>
        </span>`;
      e.panelCopy.appendChild(ask);
      ask.onclick = async (ev) => {
        const answer = (ev.target as HTMLElement).dataset.acc;
        if (!answer) return;
        askedAccuracy = false;
        if (answer === "yes") {
          ask.innerHTML = `<p>Noted. Drag any ring that still looks off, then confirm.</p>`;
          return;
        }
        ask.innerHTML = `<p>Thanks. Drag each wrong ring onto the feature it names, then confirm.</p>`;
        flaggedWrong = true;
        consentAnswer = await askSideFeedbackConsent();
        ask.innerHTML = `<p>${consentAnswer
          ? "That photo and your corrections will be shared privately after you confirm, and they directly teach the automatic placement to land closer."
          : "Nothing will be shared. Drag each wrong ring onto the feature it names, then confirm."}</p>`;
      };
    }
    document.getElementById("side-reset")!.onclick = () => {
      verifier?.reset(automaticPoints);
      drawGuides(e.lines, automaticPoints, w, h);
    };
    document.getElementById("side-guided")!.onclick = () => showGuidedActions();
    document.getElementById("side-go")!.onclick = () => void confirmPlacement();
    const wrong = document.getElementById("side-wrong");
    if (wrong) wrong.onclick = async () => {
      // Disabled BEFORE the await, not after it. The dialog takes a frame to
      // appear and the button stayed live across it, so a double tap opened
      // two consent backdrops stacked on each other: answering the top one
      // left the second still standing over the photograph, and the second
      // answer overwrote the first.
      if (wrong.hasAttribute("disabled")) return;
      wrong.setAttribute("disabled", "true");
      // The complaint is the moment to ask, because the complaint is the
      // evidence. What is deliberately NOT here is any mention of an account:
      // being asked to sign up before you have even confirmed your points is
      // the moment an app starts feeling like a funnel, so the send waits
      // until after Confirm, when sign-in happens anyway.
      flaggedWrong = true;
      consentAnswer = await askSideFeedbackConsent();
      const wrongButton = document.getElementById("side-wrong");
      if (wrongButton) wrongButton.textContent = consentAnswer ? "Thanks, noted" : "Noted";
      e.panelCopy.innerHTML = `<h2 class="side-title">Drag them where they belong</h2>
        <p class="side-sub">${consentAnswer
          ? "Thank you: that photo and the correction will be shared privately after you confirm, and it directly teaches the automatic placement to land closer. Move each wrong ring onto the feature it names, then confirm."
          : "No problem: nothing will be shared. Move each wrong ring onto the feature it names, then confirm."}</p>
        <p class="side-review-note">The circular arrow under the photo resets every point to the automatic placement.</p>`;
    };
  };



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
          hint.textContent = `${readings.join("; ")}, check ${
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
          The five behind the face, jaw corner, ear and the neck point, are inferred from an
          average head rather than found in the photo, so they are the ones that drift.</p>
          <p class="side-review-note">If they are genuinely right, press Confirm as-is. If you
          have not looked yet, this is the moment: a side score built on a guessed jaw corner
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

  if (startInGuidedMode) {
    // The choice, before the walkthrough rather than instead of it.
    //
    // A fresh seed used to drop straight into thirteen guided taps whether the
    // automatic placement was good or not, so somebody whose points had landed
    // perfectly still had to confirm every one of them, and somebody whose had
    // not could not tell until they were four points in. The seed is already
    // computed by the time this runs, so there is nothing to save by hiding
    // it: showing the rings and asking is strictly more information for the
    // person and one fewer decision made on their behalf.
    //
    // The review state is put up first, so whichever answer comes back lands
    // on a finished screen rather than building one underneath the person.
    showReviewActions();
    // ...and then hidden again while the question is up. It is the same two
    // choices the dialog is offering, in the same order, four inches lower:
    // leaving it live means a person can answer twice, and the two answers do
    // not have to agree.
    e.actions.classList.add("mode-pending");
    void askPlacementMode(e.canvas, seed.points, seed.confidence ?? 1).then((mode) => {
      e.actions.classList.remove("mode-pending");
      // Null is a cancelled dialog: the flow was closed or the identity changed
      // underneath it, and there is nothing left for either branch to act on.
      if (mode === null) return;
      if (mode === "manual") {
        showGuidedActions();
        return;
      }
      // Taking the automatic placement is the branch that owes an answer back:
      // the person has just accepted a guess, and whether the guess was right
      // is the single most useful thing they can tell us. Asked in the review
      // panel rather than in another sheet, because a second modal in a row
      // reads as an interrogation.
      askedAccuracy = true;
      showReviewActions();
    });
  } else showReviewActions();
}

/**
 * Take these points, or place them yourself.
 *
 * A centred dialog over a blurred screen, with its own small copy of the
 * photograph and the thirteen rings drawn on it. The earlier version was a
 * sheet pinned to the bottom of the photo frame, on the reasoning that the
 * question is about the rings so the rings had to stay visible. That was true
 * and still cost more than it bought: the sheet sat directly on top of the
 * review row it was asking about, so "Confirm" and "One by one" were legible
 * and pressable underneath a dialog offering the same two choices in different
 * words. Two live readings of the same screen both called it cluttered, and
 * both were reading four buttons where there are two decisions.
 *
 * So the evidence moves INTO the dialog instead of being framed around it. The
 * preview is small on purpose: at this size nobody is auditing a landmark, they
 * are answering "did that land roughly on my face" — which is the whole
 * question, and the one the full-size frame behind is there to answer properly
 * once an answer is given. The row below is hidden while this is up, because a
 * control offering a choice that is currently being asked in a modal is not a
 * shortcut, it is a second answer to the same question.
 *
 * The fine print is not boilerplate and does not always say the same thing.
 * The seeder already reports its own confidence, and the walkthrough copy
 * downstream branches on it, so this does too: an unsure placement says so
 * plainly instead of leaving somebody to discover it four rings in.
 *
 * There is no way past this without answering, and deliberately so. Both
 * answers are complete and neither is destructive: taking the points still
 * lands on a screen where every one of them can be dragged.
 */
function askPlacementMode(
  photo: HTMLCanvasElement,
  points: SidePoints,
  confidence: number,
): Promise<"auto" | "manual" | null> {
  const low = confidence < 0.7;
  return new Promise((resolve) => {
    let done = false;
    const backdrop = document.createElement("div");
    backdrop.className = "side-mode-backdrop";
    backdrop.innerHTML = `<section class="side-mode-card" role="dialog" aria-modal="true" aria-labelledby="side-mode-title">
      <span class="klabel">${low ? "LOW CONFIDENCE" : "AUTOMATIC PLACEMENT"}</span>
      <h2 id="side-mode-title">${low ? "Here is our best guess" : "We placed the points for you"}</h2>
      <figure class="side-mode-shot">
        <button type="button" class="side-mode-zoom" data-zoom aria-expanded="false"
          aria-label="Enlarge the photo to see the points">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path class="zoom-out" d="M4 9V4h5M20 15v5h-5M15 4h5v5M9 20H4v-5"/>
            <path class="zoom-in" d="M9 4v5H4M15 20v-5h5M20 9h-5V4M4 15h5v5"/>
          </svg>
        </button>
        <canvas data-zoom aria-label="Your side profile with the thirteen automatic points marked"></canvas>
      </figure>
      <p class="side-mode-copy">${low
        ? "This photo was a hard one to read, so treat these as starting positions rather than an answer."
        : "This is where our system put them, on your photo."}</p>
      <div class="side-mode-actions">
        <button type="button" class="btn gho" data-mode="manual">Place them myself</button>
        <button type="button" class="btn pri" data-mode="auto">Use these points</button>
      </div>
      <p class="side-mode-fine">Placing them yourself gives a more accurate score. Taking these still lets you drag any point.</p>
    </section>`;
    document.body.appendChild(backdrop);
    const shot = backdrop.querySelector("canvas")!;
    const zoom = backdrop.querySelector<HTMLButtonElement>(".side-mode-zoom")!;
    // Small by default and big on demand.
    //
    // Thirteen rings on a 168px picture land within a few pixels of each other
    // around the nose and mouth, which reads as one teal smudge: enough to
    // answer "did those go on my face", not enough to answer "is that one on
    // my lip". Both questions get asked here, so both get a size. The card
    // grows with the picture rather than the picture escaping the card.
    let expanded = false;
    const draw = () => {
      paintPlacementPreview(shot, photo, points, expanded);
      zoom.setAttribute("aria-expanded", String(expanded));
      zoom.setAttribute("aria-label", expanded ? "Shrink the photo" : "Enlarge the photo to see the points");
      backdrop.classList.toggle("expanded", expanded);
    };
    draw();
    // Re-measured rather than re-scaled: the expanded size is bounded by the
    // viewport, and a phone that rotates mid-decision would otherwise keep a
    // picture sized for the other orientation.
    const onResize = () => { if (expanded) draw(); };
    window.addEventListener("resize", onResize);
    backdrop.querySelector<HTMLButtonElement>('[data-mode="auto"]')?.focus();
    const settle = (mode: "auto" | "manual" | null) => {
      if (done) return;
      done = true;
      untrack();
      window.removeEventListener("resize", onResize);
      backdrop.remove();
      resolve(mode);
    };
    const untrack = trackDialog(() => settle(null));
    backdrop.onclick = (ev) => {
      const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-zoom],[data-mode]");
      if (!el) return;
      if (el.hasAttribute("data-zoom")) {
        expanded = !expanded;
        draw();
        return;
      }
      const mode = el.dataset.mode;
      if (mode !== "auto" && mode !== "manual") return;
      settle(mode);
    };
  });
}

/**
 * How big the dialog's copy of the photograph is.
 *
 * Separated from the painting so the two rules that matter can be checked
 * without a canvas.
 *
 * It never upscales. A capture narrower than the box would otherwise be blown
 * up to fill it, and a soft, enlarged thumbnail of a photo that was already too
 * small is the worst possible evidence to hand somebody who is being asked
 * whether the points landed right.
 *
 * And it is bounded on BOTH axes, which a picture in a dialog has to be. A
 * width cap alone is fine for the 3:4 the camera produces and useless for the
 * 9:16 a phone gallery hands back: 168 wide is then 299 tall, and the card
 * around it stops fitting on the screen it is being read on. Capping the height
 * costs a narrower picture on a tall capture and keeps the card on screen,
 * which is the trade worth making every time.
 */
export const PLACEMENT_PREVIEW_W = 168;
export const PLACEMENT_PREVIEW_H = 200;

export function placementPreviewBox(
  photoW: number,
  photoH: number,
  maxW = PLACEMENT_PREVIEW_W,
  maxH = PLACEMENT_PREVIEW_H,
): { w: number; h: number; scale: number } {
  if (!(photoW > 0) || !(photoH > 0)) return { w: 0, h: 0, scale: 1 };
  const scale = Math.min(1, maxW / photoW, maxH / photoH);
  return { w: Math.round(photoW * scale), h: Math.round(photoH * scale), scale };
}

/**
 * The enlarged size, bounded by the screen it is being read on.
 *
 * Not a fixed number. The whole dialog has to stay on the display with its
 * heading and both buttons still reachable, so the picture gets what is left
 * after that furniture rather than a size chosen on a desktop and discovered
 * on a phone. The reserve is deliberately generous: a card whose buttons are
 * below the fold is a dialog somebody cannot answer.
 */
const EXPANDED_RESERVE_H = 320;
const EXPANDED_MARGIN_W = 76;

export function expandedPreviewLimits(
  viewportW: number,
  viewportH: number,
): { maxW: number; maxH: number } {
  return {
    maxW: Math.max(PLACEMENT_PREVIEW_W, Math.min(560, viewportW - EXPANDED_MARGIN_W)),
    maxH: Math.max(PLACEMENT_PREVIEW_H, Math.min(640, viewportH - EXPANDED_RESERVE_H)),
  };
}

/**
 * The photograph and its thirteen rings, small.
 *
 * Drawn rather than cloned. The live frame carries the rings as positioned DOM
 * elements sized for a finger, and shrinking that whole apparatus to thumbnail
 * width would give thirteen 44px hit targets on a 150px picture, which is a
 * solid block of teal rather than a placement. Painted at this size they read
 * as marks on a face, which is the only thing being asked about here.
 *
 * The connector lines come too, at half strength: three of the five estimated
 * points sit off the silhouette, and without the lines back to the face they
 * look like stray dots in the room rather than the jaw and neck geometry they
 * are.
 */
function paintPlacementPreview(
  target: HTMLCanvasElement,
  photo: HTMLCanvasElement,
  points: SidePoints,
  expanded = false,
): void {
  const limits = expanded
    ? expandedPreviewLimits(window.innerWidth, window.innerHeight)
    : { maxW: PLACEMENT_PREVIEW_W, maxH: PLACEMENT_PREVIEW_H };
  const { w, h, scale } = placementPreviewBox(photo.width, photo.height, limits.maxW, limits.maxH);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // The backing store is resized to the TARGET before the CSS box finishes
  // travelling, so the picture is already sharp at the size it is arriving at
  // and the browser only scales it during the transition itself. Repainting
  // after the animation instead would land a soft picture and then snap it.
  target.style.width = `${w}px`;
  target.style.height = `${h}px`;
  target.width = Math.round(w * dpr);
  target.height = Math.round(h * dpr);
  const g = target.getContext("2d");
  if (!g) return;
  g.scale(dpr, dpr);
  g.drawImage(photo, 0, 0, w, h);
  const at = (id: keyof SidePoints) => ({ x: points[id].x * scale, y: points[id].y * scale });
  // Ring and line weight are in DISPLAY units, not image units, so they stay
  // the same apparent thickness at both sizes. Scaling them with the picture
  // would make the enlarged view thirteen fat discs and defeat the enlarging.
  const ring = expanded ? 5.4 : 3.1;
  g.strokeStyle = "rgba(143, 243, 224, 0.42)";
  g.lineWidth = 1;
  const pairs: [keyof SidePoints, keyof SidePoints][] = [
    ["pronasale", "pogonion"],
    ["glabella", "subnasale"],
    ["subnasale", "pogonion"],
    ["condylion", "gonion"],
    ["gonion", "menton"],
  ];
  for (const [a, b] of pairs) {
    const p1 = at(a);
    const p2 = at(b);
    g.beginPath();
    g.moveTo(p1.x, p1.y);
    g.lineTo(p2.x, p2.y);
    g.stroke();
  }
  g.strokeStyle = "#8ff3e0";
  g.lineWidth = expanded ? 1.8 : 1.4;
  for (const def of SIDE_POINTS) {
    const p = at(def.id);
    g.beginPath();
    g.arc(p.x, p.y, ring, 0, Math.PI * 2);
    g.stroke();
  }
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
        ? "Was that because the automatic placement was wrong? With your permission, TrueMax will privately send this side-profile photo, where the points landed automatically, and where you moved them. Corrections like yours are exactly what teaches the placement to land right next time."
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
    let thanksTimer = 0;
    // Cancelled by close(), which is also the identity-change path. No consent
    // is the safe direction and the honest one: nobody answered.
    const untrack = trackDialog(() => {
      if (finished) {
        // Already on the thank-you card with its timer running. The dialog is
        // going away now, so the timer must not fire into a torn-down flow.
        //
        // The promise is still settled, with TRUE, and both halves of that
        // matter. Returning without resolving left the awaiting closure and
        // its scan pending for the life of the page, which is the leak this
        // whole cancel mechanism exists to prevent. And true is the answer
        // they actually gave: the thank-you card is only ever reached by
        // pressing yes, so resolving false here would record a consent they
        // did give as one they refused.
        window.clearTimeout(thanksTimer);
        backdrop.remove();
        resolve(true);
        return;
      }
      finished = true;
      backdrop.remove();
      resolve(false);
    });
    const finish = (choice: boolean) => {
      if (finished) return;
      finished = true;
      if (!choice) {
        untrack();
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
      thanksTimer = window.setTimeout(() => {
        untrack();
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
