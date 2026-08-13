import { analyzeSide } from "../engine/scoring.js";
import type { Report, Sex } from "../engine/types.js";
import { sidePointIntegrityIssues } from "../engine/sideMetrics.js";
import type { SidePoints } from "../engine/sideMetrics.js";
import { mountVerifier, seedSidePoints } from "./sideVerify.js";
import type { VerifyHandle } from "./sideVerify.js";
import {
  cloneSidePoints,
  createSideFeedbackIntent,
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

const MAX_DIM = 1000;

interface SideCtx {
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
}

interface SidePlacementSeed {
  points: SidePoints;
  faceDir: number;
  automaticPoints?: SidePoints;
  method?: SideSeedMethod;
}

let verifier: VerifyHandle | null = null;
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

export function openSideCapture(ctx: SideCtx): void {
  const e = el();
  verifier?.destroy();
  verifier = null;
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

// The file input and drop handlers, shared by the choice screen and the
// camera-first path (so an upload still works even when the camera opened first).
function wireSideInputs(e: ReturnType<typeof el>, ctx: SideCtx): void {
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

  mountVerify(e.canvas, seedSidePoints(e.canvas), ctx, "VERIFY LANDMARKS");
}

// Shared by the first pass and by a later correction, so the two cannot drift
// apart in what dragging a point does.
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

  const automaticPoints = cloneSidePoints(seed.automaticPoints ?? seed.points);
  const seedMethod = seed.method ?? "existing";

  verifier?.destroy();
  verifier = mountVerifier(e.layer, e.canvas, seed, (pts) => drawGuides(e.lines, pts, w, h));
  drawGuides(e.lines, seed.points, w, h);

  const showReviewActions = () => {
    verifier?.setEditable(false);
    e.cap.textContent = "REVIEW LANDMARKS";
    e.panelCopy.innerHTML = `<h2 class="side-title">Check the automatic points</h2>
      <p class="side-sub">TrueMax has estimated the thirteen profile landmarks. If every ring sits on the named feature, confirm them. If one is wrong, choose <b>Edit point placement</b> and drag only the points that need correcting.</p>
      <p class="side-review-note">Nothing leaves this device unless you separately choose to share it after confirming.</p>`;
    e.actions.innerHTML = `
      <button class="btn gho" id="side-back">Retake profile</button>
      <button class="btn gho" id="side-edit">Edit point placement</button>
      <button class="btn pri" id="side-go">Points look right</button>`;
    document.getElementById("side-back")!.onclick = () => openSideCapture(ctx);
    document.getElementById("side-edit")!.onclick = () => showEditActions();
    document.getElementById("side-go")!.onclick = () => void confirmPlacement();
  };

  const showEditActions = () => {
    verifier?.setEditable(true);
    e.cap.textContent = "EDIT LANDMARKS";
    e.panelCopy.innerHTML = `<h2 class="side-title">Correct only what is wrong</h2>
      <p class="side-sub">Drag a ring onto the exact feature named when you touch it. The hollow centre lets you see the pixel underneath. Confirm when the placement matches the photo.</p>
      <p class="side-review-note">You can reset every point to TrueMax's automatic placement at any time.</p>`;
    e.actions.innerHTML = `
      <button class="btn gho" id="side-reset">Reset automatic</button>
      <button class="btn gho" id="side-back">Retake profile</button>
      <button class="btn pri" id="side-go">Confirm placement</button>`;
    document.getElementById("side-reset")!.onclick = () => {
      verifier?.reset(automaticPoints);
      drawGuides(e.lines, automaticPoints, w, h);
    };
    document.getElementById("side-back")!.onclick = () => openSideCapture(ctx);
    document.getElementById("side-go")!.onclick = () => void confirmPlacement();
  };

  const confirmPlacement = async () => {
    if (!verifier) return;
    const confirmButton = document.getElementById("side-go") as HTMLButtonElement | null;
    if (confirmButton) confirmButton.disabled = true;
    const issues = sidePointIntegrityIssues(verifier.points, w, h, verifier.faceDir);
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
      const report = analyzeSide(verifier.points, verifier.faceDir, ctx.sex);
      const consented = await askSideFeedbackConsent();
      const feedback = createSideFeedbackIntent(
        consented,
        crypto.randomUUID(),
        automaticPoints,
        seedMethod,
      );
      e.cap.textContent = "ANALYZED";
      ctx.onDone(report, correctedPoints, verifier.faceDir, {
        automaticPoints,
        seedMethod,
        feedback,
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

  showReviewActions();
}

function askSideFeedbackConsent(): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "side-feedback-backdrop";
    backdrop.innerHTML = `<section class="side-feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="side-feedback-title" aria-describedby="side-feedback-copy">
      <span class="klabel">OPTIONAL · YOUR CHOICE</span>
      <h2 id="side-feedback-title">Help improve TrueMax?</h2>
      <p id="side-feedback-copy">With your permission, TrueMax will privately send this side-profile photo, the points placed automatically, and the final points you confirmed. This helps us improve landmark placement for future scans.</p>
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
      dialog.innerHTML = `<span class="side-feedback-thanks" aria-live="polite">Thank you.</span>
        <p>We’ll share it privately after you are signed in.</p>`;
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
