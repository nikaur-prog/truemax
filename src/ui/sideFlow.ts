import { analyzeSide } from "../engine/scoring.ts";
import type { Report, Sex } from "../engine/types.ts";
import type { SidePoints } from "../engine/sideMetrics.ts";
import { mountVerifier, seedSidePoints } from "./sideVerify.ts";
import type { VerifyHandle } from "./sideVerify.ts";
import { startCamera } from "./camera.ts";
import { setRunningMode } from "../engine/landmarker.ts";
import { detectStable } from "../engine/consensus.ts";
import { assessQuality } from "../engine/quality.ts";
import { resetSideTracking } from "../engine/captureGuide.ts";
import type { CameraHandle } from "./camera.ts";

// Side-profile capture flow: camera or upload → auto-seeded landmarks → user
// verifies by dragging → side report.
//
// The camera here runs in "side" mode, which gates on exposure, focus, and the
// frontal detector NOT finding a square-on face. See checkSideFrame.

const MAX_DIM = 1000;

// Below this yaw the mesh is confident it is looking at a front-on face, which
// is precisely the photo the side step must refuse. A true profile reads much
// higher, or is not detected at all; either way it clears this gate. 35 sits
// well above ordinary front-capture yaw (the front gate allows 10) and well
// below a real profile, so it separates the two cleanly.
const PROFILE_MIN_YAW = 35;

interface SideCtx {
  sex: Sex;
  onDone: (report: Report, points: SidePoints, faceDir: number) => void;
  onBack: () => void;
}

let verifier: VerifyHandle | null = null;
let sideCam: CameraHandle | null = null;

const el = () => ({
  section: document.getElementById("v-side")!,
  canvas: document.getElementById("side-canvas") as HTMLCanvasElement,
  lines: document.getElementById("side-lines") as unknown as SVGSVGElement,
  layer: document.getElementById("side-verify")!,
  cap: document.getElementById("side-cap")!,
  drop: document.getElementById("side-drop")!,
  input: document.getElementById("side-input") as HTMLInputElement,
  actions: document.getElementById("side-actions")!,
  frame: document.getElementById("side-frame")!,
  live: document.getElementById("side-live")!,
  video: document.getElementById("side-video") as HTMLVideoElement,
  guide: document.getElementById("side-guide") as HTMLCanvasElement,
  hintTitle: document.getElementById("side-hint-title")!,
  hintDetail: document.getElementById("side-hint-detail")!,
  hint: document.getElementById("side-hint")!,
  lamp: document.getElementById("side-lamp")!,
  lampFill: document.getElementById("side-lamp-fill")!,
});

export function openSideCapture(ctx: SideCtx): void {
  const e = el();
  e.section.classList.remove("hidden");
  e.cap.textContent = "AWAITING PHOTO";
  e.drop.classList.remove("hidden");
  e.live.classList.add("hidden");
  // Both views are required, so there is no "skip" — but backing out of the
  // capture must still be possible, because capture is free. Nothing has been
  // spent at this point: the analysis is the costly step and it has not run.
  // So this is a plain Cancel, not an offer to abandon a half-finished scan.
  e.actions.innerHTML = `
    <button class="btn pri" id="side-cam">Use camera</button>
    <button class="btn gho" id="side-pick">Upload a photo</button>`;
  e.actions.insertAdjacentHTML(
    "beforeend",
    `<button class="btn cancel" id="side-quit">Cancel</button>`,
  );
  document.getElementById("side-cam")!.onclick = () => openSideCamera(ctx);
  document.getElementById("side-pick")!.onclick = () => e.input.click();
  document.getElementById("side-quit")!.onclick = () => {
    close();
    ctx.onBack();
  };
  // The camera opens only on an explicit "Use camera" click here too, matching
  // the front. It used to auto-open the profile preview because access was
  // already granted, but the same principle applies: the preview should never
  // appear until someone asks for it.

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
  e.cap.textContent = "LINE UP YOUR PROFILE";
  // The gate remembers having seen the head turn, so that losing the face can
  // be read as "they turned away" rather than "there was never anyone there".
  // That memory has to start empty on every new attempt.
  resetSideTracking();
  let ready = false;
  try {
    sideCam = await startCamera({
      video: e.video,
      guideCanvas: e.guide,
      mode: "side",
      onCheck: (c) => {
        ready = c.ready;
        e.hintTitle.textContent = c.hint;
        e.hintDetail.textContent = c.detail;
        e.hint.classList.toggle("ready", c.ready);
        e.hint.classList.toggle("red", c.status === "red");
        e.hint.classList.toggle("amber", c.status === "amber");
        e.lamp.className = `lamp ${c.status === "green" ? "green" : c.status}`;
        e.lampFill.className = c.status === "green" ? "green" : c.status;
        e.lampFill.style.width = `${Math.round((c.status === "green" ? 1 : c.progress) * 100)}%`;
        const shoot = document.getElementById("side-shoot") as HTMLButtonElement | null;
        if (shoot) shoot.disabled = !c.ready;
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
    <button class="btn pri" id="side-shoot" disabled>Capture</button>
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
}

function stopSideCamera(): void {
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
  seed: { points: SidePoints; faceDir: number },
  ctx: SideCtx,
): void {
  const e = el();
  e.section.classList.remove("hidden");
  e.drop.classList.add("hidden");
  e.live.classList.add("hidden");
  e.frame.classList.remove("live");
  mountVerify(photo, seed, ctx, "ADJUST LANDMARKS");
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

  // This must be a profile, and the shocking failure was that it did not check.
  // A near-frontal photo sailed through, got thirteen points placed on a face
  // that has no profile to measure, and produced a side score of 3.3 / "ahead
  // of 0%" — a garbage number dragging down the merged total.
  //
  // The tell of a frontal face is that the mesh detects it confidently at low
  // yaw. A true profile is the opposite: the detector either loses the face or
  // reports a large yaw as the far half self-occludes. So a face found at low
  // yaw is the one case we can be SURE is wrong, and it is the one we reject.
  // Anything turned far enough — or too turned for the mesh to see at all —
  // passes through to the hand-placed points, which is exactly what they exist
  // for.
  const q = assessQuality(detectStable(e.canvas));
  if (q.faceFound && Math.abs(q.yawDeg) < PROFILE_MIN_YAW) {
    e.cap.textContent = "SIDE";
    e.drop.classList.remove("hidden");
    const b = e.drop.querySelector("b");
    const span = e.drop.querySelector("span");
    if (b) b.textContent = "That is a front-on photo. Turn to the side.";
    if (span) span.textContent = "A profile is one ear to the lens, nose in silhouette. Chin, jaw and brow angles only exist from the side.";
    return;
  }

  e.drop.classList.add("hidden");
  e.cap.textContent = "VERIFY LANDMARKS";

  mountVerify(e.canvas, seedSidePoints(e.canvas), ctx, "VERIFY LANDMARKS");
}

// Shared by the first pass and by a later correction, so the two cannot drift
// apart in what dragging a point does.
function mountVerify(
  photo: HTMLCanvasElement,
  seed: { points: SidePoints; faceDir: number },
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

  verifier?.destroy();
  verifier = mountVerifier(e.layer, e.canvas, seed, (pts) => drawGuides(e.lines, pts, w, h));
  drawGuides(e.lines, seed.points, w, h);

  e.actions.innerHTML = `
    <button class="btn gho" id="side-back">Retake profile</button>
    <button class="btn pri" id="side-go">Run the analysis</button>`;
  document.getElementById("side-back")!.onclick = () => openSideCapture(ctx);
  document.getElementById("side-go")!.onclick = () => {
    if (!verifier) return;
    const report = analyzeSide(verifier.points, verifier.faceDir, ctx.sex);
    e.cap.textContent = "ANALYZED";
    ctx.onDone(report, verifier.points, verifier.faceDir);
  };
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
