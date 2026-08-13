import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { initLandmarker, isReady, setRunningMode } from "./engine/landmarker.js";
import { detectStable } from "./engine/consensus.js";
import { assessQuality } from "./engine/quality.js";
import type { QualityCheck } from "./engine/quality.js";
import { analyze } from "./engine/scoring.js";
import { POSE_CALIBRATION, buildGeometry } from "./engine/geometry.js";
import { extractShape, shapeSubset } from "./engine/shape.js";
import { compareAndStore, readAllHistory, readHistory } from "./engine/history.js";
import { pruneTo, savePhotos, toThumb } from "./engine/photoStore.js";
import { toCelebEntry } from "./engine/celebs.js";
import { readOrientation } from "./engine/exif.js";
import type { Report, Sex } from "./engine/types.js";
import { drawLandmarksAnimated, drawCalm } from "./ui/overlay.js";
import { renderResults, setMaxAccess } from "./ui/results.js";
import { mountGateDemo } from "./ui/gateDemo.js";
import { mergeReports } from "./engine/scoring.js";
import { openSideAdjust, openSideCapture, close as closeSide } from "./ui/sideFlow.js";
import { analyzeSide } from "./engine/scoring.js";
import type { SidePoints } from "./engine/sideMetrics.js";
import { submitSideCorrectionFeedback } from "./engine/sideFeedback.js";
import type { SideFeedbackIntent, SideSeedMethod } from "./engine/sideFeedbackPayload.js";
import { isSupported, overrideGlasses, resetGlassesOverride, startCamera } from "./ui/camera.js";
import { mountDemoReel } from "./ui/demoReel.js";
import { hasHistory, openHistory } from "./ui/historyView.js";
import { mountAccountButton, openAccount } from "./ui/authModal.js";
import { currentUser, isAuthAvailable, onAuthChange } from "./engine/auth.js";
import { hasMaxAccess, loadEntitlement } from "./engine/entitlement.js";
import type { User } from "@supabase/supabase-js";
import { revealSideScan } from "./ui/sideScan.js";
import { openSexChooser } from "./ui/sexChooser.js";
import { createAutoCapture } from "./ui/autoCapture.js";
import type { AutoCapture } from "./ui/autoCapture.js";
import { openDashboard } from "./ui/dashboard.js";
import { mountFaceOutline } from "./ui/faceOutline.js";
import type { CameraHandle } from "./ui/camera.js";
import { stillFrameStats } from "./engine/captureGuide.js";
import type { FrameCheck } from "./engine/captureGuide.js";
import { estimateGaze } from "./engine/gaze.js";
import { openQuiz } from "./ui/goalsQuiz.js";
import { analyzeSkin } from "./engine/skin.js";
import { storeSex, storedSex } from "./engine/sexPref.js";
import { detectOcclusion } from "./engine/occlusion.js";
import { frontPhotoRejection, landmarkBox } from "./engine/photoEligibility.js";
import { headCoveringRejection } from "./engine/photoEligibility.js";
import { detectHeadCovering } from "./engine/headCovering.js";
import { REGION_LANDMARKS } from "./ui/regions.js";
import {
  clearPendingAnalysis,
  drawStoredPhoto,
  readPendingAnalysis,
  savePendingAnalysis,
} from "./engine/pendingAnalysis.js";
import {
  brandClass,
  membershipBrand,
  MEMBERSHIP_BRAND_EVENT,
} from "./ui/membershipBrand.js";
import type { MembershipBrand } from "./ui/membershipBrand.js";
import { openTrialFunnel, openTrialFunnelPreview } from "./ui/onboardingFunnel.js";

const MAX_IMAGE_DIM = 1280;

// Torn down whenever the gate is replaced, so a stale reel cannot keep painting
// into a canvas that is no longer on the page.
let gateDemo: { stop(): void } | null = null;

// Read the entitlement and tell the results screen. Never throws: a billing
// read that fails leaves the plan locked, which is the safe direction — it
// shows a paywall to a paying customer, who can retry, rather than handing the
// paid product to everyone the moment Supabase has a bad minute.
async function refreshMaxAccess(): Promise<void> {
  try {
    setMaxAccess(hasMaxAccess(await loadEntitlement()));
  } catch {
    setMaxAccess(false);
  }
}

if (import.meta.env.DEV) {
  const preview = new URLSearchParams(location.search).get("preview");
  if (preview === "funnel" || preview === "offer" || preview === "offer-minor") {
    queueMicrotask(() => void openTrialFunnelPreview(preview !== "offer-minor", preview !== "funnel"));
  }
}

const el = {
  engineStatus: document.getElementById("engine-status")!,
  upload: document.getElementById("v-upload")!,
  main: document.getElementById("v-main")!,
  fileInput: document.getElementById("file-input") as HTMLInputElement,
  ovalFrame: document.getElementById("oval-frame")!,
  camVideo: document.getElementById("cam-video") as HTMLVideoElement,
  camGuide: document.getElementById("cam-guide") as HTMLCanvasElement,
  camHint: document.getElementById("cam-hint")!,
  camHintTitle: document.getElementById("cam-hint-title")!,
  camHintDetail: document.getElementById("cam-hint-detail")!,
  btnCamera: document.getElementById("btn-camera") as HTMLButtonElement,
  btnUpload: document.getElementById("btn-upload") as HTMLButtonElement,
  btnCancel: document.getElementById("btn-cancel") as HTMLButtonElement,
  btnNoGlasses: document.getElementById("btn-noglasses") as HTMLButtonElement,
  reelCanvas: document.getElementById("reel-canvas") as HTMLCanvasElement,
  outlineCanvas: document.getElementById("outline-canvas") as HTMLCanvasElement,
  reelScore: document.getElementById("reel-score")!,
  reelName: document.getElementById("reel-name")!,
  stage: document.getElementById("capture-stage")!,
  camLight: document.getElementById("cam-light")!,
  camLamp: document.getElementById("cam-lamp")!,
  camLampFill: document.getElementById("cam-lamp-fill")!,
  frame: document.getElementById("frame")!,
  zoomable: document.getElementById("zoomable")!,
  photoCanvas: document.getElementById("photo-canvas") as HTMLCanvasElement,
  overlayCanvas: document.getElementById("overlay-canvas") as HTMLCanvasElement,
  capRight: document.getElementById("capRight")!,
  status: document.getElementById("status")!,
  barFill: document.getElementById("barFill")!,
  qualityChips: document.getElementById("quality-chips")!,
  analysis: document.getElementById("analysis")!,
};

// The reference population, chosen by the user and remembered on the device.
//
// It used to be inferred from face shape. That was the right instinct — a
// decision in front of the only thing that matters is a cost — but the
// inference turned out to be 58.8% accurate on held-out faces against a 54.1%
// base rate, while the choice itself moves the score by a median of 0.70 points
// and up to 4.50. sexPref.ts has the measurements. One tap beats that.
let selectedSex: Sex = storedSex() ?? "male";
// Whether the reference population is a real choice yet, or still the silent
// default. A face app is used mostly by young men, so "male" is the right
// default to compute against — but computing a man a percentile "of women"
// because he never saw the toggle is the kind of thing that gets screenshotted.
// So the first scan requires the pick; a returning visitor who already chose is
// never asked again.
let sexChosen = storedSex() !== null;

// How the front photo was obtained, carried into the side step so the two
// halves of one scan use the same capture method. If you shot the front with
// the camera, the side opens the camera; if you uploaded the front, the side
// asks for a file. Null until the first capture.
let captureMethod: "camera" | "upload" | null = null;

// Calibration harness API (tools/): lets the offline pipeline measure photos
// directly, skipping the UI and its scan animation. Same engine path as a
// real scan — detect, assess, analyze — so results are identical.
(window as unknown as Record<string, unknown>).__truemaxPose = POSE_CALIBRATION;
(window as unknown as Record<string, unknown>).__truemaxMeasure = async (
  dataUrl: string,
  sex: Sex,
) => {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("bad image"));
    i.src = dataUrl;
  });
  const s = Math.min(1, MAX_IMAGE_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * s);
  const h = Math.round(img.naturalHeight * s);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")!.drawImage(img, 0, 0, w, h);

  const res = detectStable(c);
  const quality = assessQuality(res);
  if (!quality.faceFound) return { faceFound: false };
  const landmarks = res.faceLandmarks[0];
  const faceBox = landmarkBox(landmarks);
  const stats = stillFrameStats(c, faceBox);
  const occlusion = detectOcclusion(c, landmarks, w, h);
  const eligibility = frontPhotoRejection(quality, stats, occlusion, landmarks, w, h);
  const report = analyze(landmarks, w, h, sex);
  return {
    faceFound: true,
    overall: report.overall,
    potential: report.potential,
    yaw: quality.yawDeg,
    pitch: quality.pitchDeg,
    smile: quality.smileScore,
    gaze: estimateGaze(landmarks),
    skin: analyzeSkin(c, landmarks, w, h),
    occlusion,
    photo: { eligible: eligibility === null, rejection: eligibility, ...stats },
    // Group shots are the main contaminant in scraped photo sets: the
    // detector locks onto whichever face it finds, which may not be the
    // subject. A face filling little of the frame is the tell.
    faceWidthFrac: quality.faceWidthFrac,
    entry: JSON.parse(toCelebEntry(report, "x")),
    zScores: report.zScores,
    shape: extractShape(buildGeometry(landmarks, w, h)),
    pillars: report.pillars,
    // Per-region score plus the centroid of that region's landmarks, so the
    // demo reel can point a callout at the actual spot on the face
    regions: report.regions.map((r) => {
      const ids = REGION_LANDMARKS[r.region];
      const lm = landmarks;
      let sx = 0, sy = 0;
      for (const i of ids) { sx += lm[i].x; sy += lm[i].y; }
      return {
        id: r.region,
        score: r.score,
        x: +(sx / ids.length).toFixed(4),
        y: +(sy / ids.length).toFixed(4),
      };
    }),
    // Outline points + face box for the landing-page reel builder
    reelLandmarks: shapeSubset().map((i) => [
      +res.faceLandmarks[0][i].x.toFixed(4),
      +res.faceLandmarks[0][i].y.toFixed(4),
    ]),
    reelBox: (() => {
      const lm = res.faceLandmarks[0];
      let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
      for (const p of lm) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    })(),
  };
};
(window as unknown as Record<string, unknown>).__truemaxMeasureFull = (
  window as unknown as Record<string, unknown>
).__truemaxMeasure;

// The idle frame runs the demo reel — real scans of public-domain portraits.
mountDemoReel(el.reelCanvas, el.reelScore, el.reelName);
el.ovalFrame.classList.add("showing-reel");

// A returning visitor with scans on this device gets a way straight into their
// history from the landing. Hidden entirely when there is nothing to show, so a
// first-time visitor never sees a dead link.
const landingHistory = document.getElementById("landing-history");
if (landingHistory && hasHistory()) {
  landingHistory.classList.remove("hidden");
  landingHistory.addEventListener("click", () => openHistory());
}

// Accounts light up only when Supabase keys are set in the build environment.
// With no keys this call returns immediately and adds no header button, so the
// signed-out product is exactly what shipped before. See src/engine/auth.ts.
mountAccountButton();

// The idealized silhouette is a framing guide for the camera, not landing art
let outline: ReturnType<typeof mountFaceOutline> | null = null;
function showGuide(sex: Sex): void {
  outline = outline ?? mountFaceOutline(el.outlineCanvas, sex);
  outline.morphTo(sex);
}

// Reference-population control. Reflects the stored choice, writes it back, and
// re-shapes the capture silhouette to match — the guide should be the average
// face someone is about to be compared against, not a fixed one.
const refpop = document.getElementById("refpop")!;
function paintRefPop(): void {
  for (const b of refpop.querySelectorAll<HTMLButtonElement>(".seg-btn")) {
    // Until the choice is made, neither button is lit — an unmade choice should
    // look unmade, not like "male" was picked for you.
    const on = sexChosen && b.dataset.sex === selectedSex;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  }
}
refpop.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>(".seg-btn");
  if (!b?.dataset.sex) return;
  selectedSex = b.dataset.sex as Sex;
  sexChosen = true;
  refpop.classList.remove("ask");
  storeSex(selectedSex);
  paintRefPop();
  showGuide(selectedSex);
});
paintRefPop();

// The gate: no scan runs against an unchosen population. If the choice has not
// been made, the full-screen man/woman chooser is shown and the scan proceeds
// only once it is picked. Chosen once, remembered forever, never asked again.
function ensureSex(then: () => void): void {
  if (sexChosen) {
    then();
    return;
  }
  openSexChooser((sex) => {
    selectedSex = sex;
    sexChosen = true;
    storeSex(sex);
    paintRefPop();
    showGuide(sex);
    then();
  });
}

document.getElementById("q-open")!.addEventListener("click", () => openQuiz(() => {}, "pre"));

initLandmarker()
  .then(() => {
    el.engineStatus.textContent = "ENGINE READY · 478-POINT MODEL LOADED";
    el.engineStatus.classList.add("ready");
  })
  .catch((err) => {
    console.error(err);
    el.engineStatus.textContent = "ENGINE FAILED TO LOAD · REFRESH TO RETRY";
    el.engineStatus.classList.add("error");
  });

el.fileInput.addEventListener("change", () => {
  const file = el.fileInput.files?.[0];
  if (file) handleFile(file);
});
el.btnUpload.addEventListener("click", () => ensureSex(() => el.fileInput.click()));
el.ovalFrame.addEventListener("dragover", (e) => {
  e.preventDefault();
  el.ovalFrame.classList.add("dragover");
});
el.ovalFrame.addEventListener("dragleave", () => el.ovalFrame.classList.remove("dragover"));
el.ovalFrame.addEventListener("drop", (e) => {
  e.preventDefault();
  el.ovalFrame.classList.remove("dragover");
  const file = (e as DragEvent).dataTransfer?.files?.[0];
  if (file) ensureSex(() => handleFile(file));
});

// Wordmark goes home only for a signed-in member. Signed-out visitors already
// are on the acquisition screen, so a fake "home" action would either do
// nothing or unexpectedly open auth. The disabled grey mark makes that state
// explicit; the account button remains the way to sign in.
//
// The dashboard is the signed-in surface on purpose: it is where the history,
// the streak and the personalised overview live, and all three are things an
// account is FOR. A signed-out visitor gets the one screen that works without
// one — scan your face — which is also the only screen a TikTok click needs.
// The public project settings are present in production; a build without auth
// configuration still leaves this control in its disabled guest state.
document.getElementById("logo-home")?.addEventListener("click", async () => {
  const user = await currentUser();
  if (!user) {
    await refreshHomeBrand(null);
    return;
  }
  if (cam) await closeCamera();
  closeSide();
  document.getElementById("v-side")?.classList.add("hidden");
  resetToUpload();
  const brand = await refreshHomeBrand(user);
  openDashboard({
    onScan: () => resetToUpload(),
    name: displayName(user),
    membership: brand === "max" ? "max" : "member",
  });
});

let homeBrandToken = 0;
let homeBrandState: MembershipBrand = "guest";

function paintHomeBrand(brand: MembershipBrand): void {
  homeBrandState = brand;
  const button = document.getElementById("logo-home") as HTMLButtonElement | null;
  if (!button) return;
  button.classList.remove("brand-guest", "brand-member", "brand-max");
  button.classList.add(brandClass(brand));
  button.disabled = brand === "guest";
  button.title = brand === "guest"
    ? "Sign in to open your dashboard"
    : brand === "max"
      ? "Open your Max dashboard"
      : "Open your dashboard";
  button.setAttribute(
    "aria-label",
    brand === "guest" ? "TrueMax dashboard unavailable while signed out" : button.title,
  );
}

async function refreshHomeBrand(user: User | null): Promise<MembershipBrand> {
  const token = ++homeBrandToken;
  if (!user) {
    paintHomeBrand("guest");
    return "guest";
  }

  // Authentication unlocks the dashboard immediately. The entitlement read
  // can then upgrade the identity to Max without holding the navigation hostage
  // on a network request or trusting client-editable metadata.
  paintHomeBrand("member");
  let max = false;
  try {
    max = hasMaxAccess(await loadEntitlement());
  } catch {
    // A temporary entitlement read failure must never lock a real member out
    // of their device-local dashboard. It simply stays in the member state.
  }
  const brand = membershipBrand(true, max);
  if (token === homeBrandToken) paintHomeBrand(brand);
  return token === homeBrandToken ? brand : homeBrandState;
}

window.addEventListener(MEMBERSHIP_BRAND_EVENT, (event) => {
  const brand = (event as CustomEvent<{ brand?: MembershipBrand }>).detail?.brand;
  if (brand !== "member" && brand !== "max") return;
  homeBrandToken++;
  paintHomeBrand(brand);
});

// First name for the greeting. The name the person actually typed into
// onboarding wins — it lives in user_metadata, written by the quiz — because
// greeting somebody by a guess parsed out of their email address when they have
// told you their name is worse than not greeting them at all ("xnikau.robertson@"
// would read as "Xnikau" forever). The email parse stays as the fallback for
// accounts that signed in but never finished the quiz.
function displayName(user: User): string | null {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  for (const key of ["first_name", "full_name", "name"]) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) {
      const first = value.trim().split(/\s+/)[0];
      if (first.length >= 2 && first.length <= 20) return first;
    }
  }
  const local = (user.email ?? "").split("@")[0];
  const first = local.split(/[._\-+0-9]+/).filter(Boolean)[0];
  if (!first || first.length < 2 || first.length > 20) return null;
  return first[0].toUpperCase() + first.slice(1).toLowerCase();
}

// ---- camera ----
let cam: CameraHandle | null = null;
let lastCheck: FrameCheck | null = null;
let autoFront: AutoCapture | null = null;
let frontKeyHandler: ((e: KeyboardEvent) => void) | null = null;
// Wall clock until which the opening capture instruction stays put.
let holdHintUntil = 0;
const HINT_HOLD_MS = 3200;

async function openCamera(): Promise<void> {
  if (!isSupported()) {
    el.camHintDetail.textContent = "This browser can't open a camera, so upload a photo instead.";
    return;
  }
  const desktop = !matchMedia("(pointer: coarse)").matches;
  holdHintUntil = 0;
  resetGlassesOverride();
  el.camHintTitle.textContent = "Allow camera access";
  el.camHintDetail.textContent = desktop
    ? "Your browser will ask at the top of the window. Choose Allow"
    : "Tap Allow when your browser asks";
  try {
    cam = await startCamera({
      video: el.camVideo,
      guideCanvas: el.camGuide,
      onCheck: (c) => {
        lastCheck = c;
        // Hold the opening instruction for a beat before the live coaching
        // takes over. Glasses can be detected once the camera is running; a
        // cap or a hood cannot, so this moment — preview up, nothing shot yet
        // — is the only chance to ask about them, and a hint that is replaced
        // on the very next frame is a hint nobody reads. The lamp underneath
        // is already live, so nothing is being hidden.
        // Not while the countdown owns the hint — it has just written it, and
        // the two would flash against each other every frame.
        if (performance.now() >= holdHintUntil && !autoFront?.armed()) {
          el.camHintTitle.textContent = c.hint;
          el.camHintDetail.textContent = c.detail;
        }
        el.camHint.classList.toggle("ready", c.ready);
        el.camHint.classList.toggle("red", c.status === "red");
        el.camHint.classList.toggle("amber", c.status === "amber");
        el.camLamp.className = `lamp ${c.status === "green" ? "green" : c.status}`;
        el.camLampFill.className = c.status === "green" ? "green" : c.status;
        el.camLampFill.style.width = `${Math.round((c.status === "green" ? 1 : c.progress) * 100)}%`;
        el.ovalFrame.classList.toggle("ready", c.ready);
        // Offer the way out only while the glasses block is what is stopping
        // them, so it is not a standing invitation to skip a real check.
        el.btnNoGlasses.classList.toggle("hidden", c.hint !== "Take your glasses off");
        el.ovalFrame.classList.toggle("tracking", c.gates.face);
        el.btnCamera.disabled = !c.ready;
        autoFront?.update(c.ready);
      },
    });
    // The front gets the same hands-off shutter as the side. It matters less
    // here — you can see the screen — but a photo taken while reaching for a
    // button is a photo that moved, and that is true of both views.
    autoFront = createAutoCapture({
      onTick: (remaining) => {
        if (remaining == null) {
          el.camHint.classList.remove("counting");
          el.btnCamera.textContent = "Capture";
          return;
        }
        el.camHint.classList.add("counting");
        el.camHintTitle.textContent = `Hold still · ${remaining}`;
        el.camHintDetail.textContent = "Taking it automatically · space to take it now";
        el.btnCamera.textContent = `Capturing in ${remaining}`;
      },
      onFire: () => el.btnCamera.click(),
    });
    // Space or Enter fires the shutter now instead of waiting out the count.
    frontKeyHandler = (e: KeyboardEvent) => {
      if (e.key !== " " && e.key !== "Enter") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (t?.tagName === "BUTTON" && t.id !== "btn-camera") return;
      if (!cam || !lastCheck?.ready) return;
      e.preventDefault();
      el.btnCamera.click();
    };
    window.addEventListener("keydown", frontKeyHandler);
    el.ovalFrame.classList.add("live");
    el.stage.classList.add("live-cam");
    // Headline and hints collapse so the preview can take the space — the
    // camera becomes the subject the moment it is granted.
    el.upload.classList.add("camera-live");
    // Starts on the male silhouette and morphs once the shape vote settles —
    // waiting for the vote would leave the frame empty at the exact moment
    // someone needs help positioning.
    showGuide(selectedSex);
    el.camHintTitle.textContent = "Glasses, hats and hoods off";
    el.camHintDetail.textContent = "They sit across the eye, brow and jaw measurements";
    holdHintUntil = performance.now() + HINT_HOLD_MS;
    el.camLight.classList.remove("hidden");
    el.btnCancel.classList.remove("hidden");
    el.btnCamera.textContent = "Capture";
    el.btnCamera.disabled = true;
  } catch {
    el.camHintTitle.textContent = "Camera unavailable";
    el.camHintDetail.textContent = "Permission was denied. You can still upload a photo.";
  }
}

// Tear the live preview down and put the landing screen back exactly as it
// was, celebrity reel and all. Shared by capture and cancel so the two can
// never drift apart and leave the page half in camera mode.
async function closeCamera(): Promise<void> {
  autoFront?.cancel();
  autoFront = null;
  if (frontKeyHandler) {
    window.removeEventListener("keydown", frontKeyHandler);
    frontKeyHandler = null;
  }
  cam?.stop();
  cam = null;
  lastCheck = null;
  el.ovalFrame.classList.remove("live", "ready", "tracking");
  el.stage.classList.remove("live-cam");
  el.upload.classList.remove("camera-live");
  el.camLight.classList.add("hidden");
  el.btnCancel.classList.add("hidden");
  el.btnNoGlasses.classList.add("hidden");
  el.btnCamera.textContent = "Use camera";
  el.btnCamera.disabled = false;
  el.camHintTitle.textContent = "Take a photo, or upload one";
  el.camHintDetail.textContent = "The camera preview will guide your framing";
  el.camHint.classList.remove("ready", "red", "amber");
  await setRunningMode("IMAGE");
}

el.btnCamera.addEventListener("click", async () => {
  if (!cam) {
    ensureSex(() => void openCamera());
    return;
  }
  if (!lastCheck?.ready) return;
  const shot = cam.capture();
  // Remember that the front came from the camera, so the side step defaults to
  // the camera too rather than making the user switch capture method mid-flow.
  captureMethod = "camera";
  await closeCamera();
  if (shot) await handleCanvas(shot);
});

el.btnCancel.addEventListener("click", async () => {
  await closeCamera();
});

el.btnNoGlasses.addEventListener("click", () => {
  overrideGlasses();
  el.btnNoGlasses.classList.add("hidden");
});

// The camera never opens on its own, even for a returning visitor who has
// already granted access. The landing plays the celebrity reel until the
// moment someone clicks "Use camera" — auto-opening the preview replaced that
// reel with a shot of the viewer's own room the instant the page loaded, which
// is both worse as a first impression and startling on a page people open in
// public. Explicit intent only.

function resetToUpload(): void {
  clearPendingAnalysis();
  // A new scan is a hard privacy boundary. Clearing only localStorage left the
  // previous front landmarks, full-resolution canvas and verified side points
  // alive in this tab. A second person could then capture only the side and
  // receive a report rendered over the first person's front photo.
  pending = null;
  lastSide = null;
  feedbackDeliveryNote = null;
  resumePendingStarted = false;
  el.photoCanvas.width = 1;
  el.photoCanvas.height = 1;
  el.photoCanvas.getContext("2d")?.clearRect(0, 0, 1, 1);
  el.overlayCanvas.width = 1;
  el.overlayCanvas.height = 1;
  el.overlayCanvas.getContext("2d")?.clearRect(0, 0, 1, 1);
  el.main.classList.add("hidden");
  el.upload.classList.remove("hidden");
  el.zoomable.style.transform = "none";
  el.analysis.innerHTML = "";
  el.qualityChips.innerHTML = "";
  el.fileInput.value = "";
}

// Two views go into the score, so the scan shows two views being measured. It
// only ever showed the front, which made the profile someone had just spent
// time verifying look like it had been filed away and ignored.
const SCAN_STAGES: Array<{ text: string; view: "front" | "side" }> = [
  { text: "Detecting facial landmarks", view: "front" },
  { text: "Normalizing to interpupillary scale", view: "front" },
  { text: "Measuring 31 front proportions", view: "front" },
  { text: "Checking bilateral symmetry", view: "front" },
  { text: "Reading the profile: chin, jaw, convexity", view: "side" },
  { text: "Measuring 15 side proportions", view: "side" },
  { text: "Comparing against population", view: "side" },
  { text: "Merging both views", view: "front" },
];

async function handleFile(file: File): Promise<void> {
  if (!isReady()) {
    el.engineStatus.textContent = "ENGINE STILL LOADING · ONE MOMENT";
    return;
  }
  // An uploaded front means the side step should ask for a file too.
  captureMethod = "upload";
  let image;
  try {
    image = await loadImage(file);
  } catch (err) {
    el.engineStatus.textContent = (err as Error).message.toUpperCase();
    el.engineStatus.classList.add("error");
    return;
  }
  // Browsers apply EXIF orientation during decode — verified against rotated
  // iPhone-style files (orientation 3 and 6 both land upright). We read the
  // flag only for diagnostics; applying it again would rotate twice, which is
  // exactly the bug this check caught.
  const exifOrientation = await readOrientation(file);
  const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(image.width, image.height));
  const dw = Math.round(image.width * scale);
  const dh = Math.round(image.height * scale);
  const width = dw;
  const height = dh;
  const src = document.createElement("canvas");
  src.width = width;
  src.height = height;
  src.getContext("2d")!.drawImage(image, 0, 0, dw, dh);
  await handleCanvas(src, exifOrientation);
}

async function handleCanvas(src: HTMLCanvasElement, exifOrientation = 1): Promise<void> {
  void exifOrientation;
  // Uploading while the live preview is running left the landmarker in VIDEO
  // mode, and the still-image detector then threw "Landmarker is in VIDEO
  // mode". Capturing had always torn the camera down first; choosing a file
  // never did.
  if (cam) await closeCamera();
  const width = src.width;
  const height = src.height;
  el.photoCanvas.width = width;
  el.photoCanvas.height = height;
  el.photoCanvas.getContext("2d")!.drawImage(src, 0, 0);

  el.upload.classList.add("hidden");
  el.main.classList.remove("hidden");
  // The front photo, kept so the scan can switch back to it after showing the
  // profile being measured.
  const frontShot = document.createElement("canvas");
  frontShot.width = el.photoCanvas.width;
  frontShot.height = el.photoCanvas.height;
  frontShot.getContext("2d")!.drawImage(el.photoCanvas, 0, 0);
  el.frame.classList.add("scanning");
  el.capRight.textContent = "SCANNING";
  el.analysis.innerHTML = "";
  el.qualityChips.innerHTML = "";
  await nextFrame();

  // Real math (milliseconds) happens inside the theatre beat (~2.2s)
  const result = detectStable(el.photoCanvas);
  const quality = assessQuality(result);

  if (!quality.faceFound) {
    el.frame.classList.remove("scanning");
    el.capRight.textContent = "NO FACE FOUND";
    el.status.innerHTML = "<b>No face detected.</b> Try a clearer, front-facing photo.";
    el.overlayCanvas.getContext("2d")?.clearRect(0, 0, el.overlayCanvas.width, el.overlayCanvas.height);
    setTimeout(() => resetToUpload(), 2600);
    return;
  }

  const landmarks = result.faceLandmarks[0];
  const faceBox = landmarkBox(landmarks);
  const stats = stillFrameStats(el.photoCanvas, faceBox);
  const occlusion = detectOcclusion(el.photoCanvas, landmarks, width, height);
  let rejection = frontPhotoRejection(quality, stats, occlusion, landmarks, width, height);
  if (!rejection) rejection = headCoveringRejection(await detectHeadCovering(el.photoCanvas));
  if (rejection) {
    el.frame.classList.remove("scanning");
    el.capRight.textContent = "PHOTO NOT VALID";
    el.status.innerHTML = `<b>${rejection.title}</b> ${rejection.detail}`;
    el.overlayCanvas.getContext("2d")?.clearRect(0, 0, el.overlayCanvas.width, el.overlayCanvas.height);
    setTimeout(() => resetToUpload(), 4200);
    return;
  }

  pending = {
    landmarks,
    width,
    height,
    quality,
    autoNote: `Scored against ${selectedSex} norms`,
  };

  // The main product is two photographs: front, then side, then one analysis of
  // both. That is the whole mechanism, so the side is a required step here, not
  // an optional extra — after the front is captured the flow goes straight to
  // the profile. (Front-only lives on the separate /quick.html page, which is
  // built for filming and deliberately skips the side.)
  //
  // runFullAnalysis still accepts null so a report restored from history can
  // render front-only; the interactive flow always supplies a side report.
  el.frame.classList.remove("scanning");
  el.capRight.textContent = "FRONT CAPTURED";
  el.status.innerHTML = "<b>Front captured.</b> Now the side profile.";
  drawCalm(el.overlayCanvas, landmarks, width, height);
  startSide();
}

interface PendingFront {
  landmarks: NormalizedLandmark[];
  width: number;
  height: number;
  quality: QualityCheck;
  autoNote: string;
}
let pending: PendingFront | null = null;
// The verified side points, kept so a change of reference population can
// re-score the profile too rather than only the front.
interface LastSide {
  points: SidePoints;
  faceDir: number;
  photo?: HTMLCanvasElement;
  automaticPoints?: SidePoints;
  seedMethod?: SideSeedMethod;
  feedback?: SideFeedbackIntent;
  feedbackSubmitted?: boolean;
}
let lastSide: LastSide | null = null;
let feedbackDeliveryNote: { ok: boolean; message: string } | null = null;

// Upload exists only after an explicit Yes. It is deliberately best-effort:
// optional product-improvement feedback must never hold a person's analysis
// hostage if Storage or the network is unavailable.
async function submitConsentedSideFeedback(): Promise<void> {
  const side = lastSide;
  if (!side?.feedback || side.feedbackSubmitted || !side.photo) return;
  const result = await submitSideCorrectionFeedback(
    side.photo,
    side.points,
    side.faceDir,
    side.feedback,
  );
  if (result.ok) {
    side.feedbackSubmitted = true;
    feedbackDeliveryNote = { ok: true, message: "Optional side-landmark feedback sent privately" };
  } else {
    feedbackDeliveryNote = {
      ok: false,
      message: "Optional side-landmark feedback could not be sent; analysis was unaffected",
    };
    console.warn("Optional side correction feedback was not sent:", result.message);
  }
}

// Both photographs are in. One analysis, one reveal, one score.
async function runFullAnalysis(sideReport: Report | null): Promise<void> {
  if (!pending) return;
  const { landmarks, width, height, quality, autoNote } = pending;
  // The scan sequence only narrates the side view when there is one. Front-only
  // is now a complete result rather than an unfinished one, so its loading bar
  // must not claim to be reading a profile that was never taken.
  const stages = sideReport ? SCAN_STAGES : SCAN_STAGES.filter((s) => s.view === "front");
  el.main.classList.remove("hidden");
  // The front photo, kept so the scan can switch back to it after showing the
  // profile being measured.
  const frontShot = document.createElement("canvas");
  frontShot.width = el.photoCanvas.width;
  frontShot.height = el.photoCanvas.height;
  frontShot.getContext("2d")!.drawImage(el.photoCanvas, 0, 0);
  el.frame.classList.add("scanning");
  el.capRight.textContent = "SCANNING";
  el.analysis.innerHTML = "";
  await nextFrame();
  const reveal = drawLandmarksAnimated(el.overlayCanvas, landmarks, width, height);

  // Staged status lines, ~360ms each, with the photo pane following whichever
  // view the current stage is about.
  const sideShot = lastSide?.photo;
  let showing: "front" | "side" = "front";
  const swapTo = (view: "front" | "side") => {
    if (view === showing) return;
    if (view === "side" && !sideShot) return;
    showing = view;
    const cap = document.querySelector(".photo-caption span");
    if (cap) cap.textContent = view === "side" ? "SIDE" : "FRONT";
    el.overlayCanvas.getContext("2d")?.clearRect(0, 0, el.overlayCanvas.width, el.overlayCanvas.height);
    if (view === "side") {
      const t = sideShot!;
      el.photoCanvas.width = t.width;
      el.photoCanvas.height = t.height;
      el.photoCanvas.getContext("2d")!.drawImage(t, 0, 0);
      // The profile gets its own reveal: a synthesised mesh sweeping the face,
      // matched to the front scan's density, with the thirteen measured anchors
      // lighting up on top. Without this the side half of the scan was a photo
      // sitting still while the text claimed it was being measured.
      if (lastSide) revealSideScan(el.overlayCanvas, lastSide.points, t.width, t.height);
    } else {
      el.photoCanvas.width = width;
      el.photoCanvas.height = height;
      el.photoCanvas.getContext("2d")!.drawImage(frontShot, 0, 0);
      drawCalm(el.overlayCanvas, landmarks, width, height);
    }
  };
  await new Promise<void>((done) => {
    let s = 0;
    const step = () => {
      if (s < stages.length) {
        el.status.innerHTML = `<b>${stages[s].text}</b> …`;
        el.barFill.style.width = `${((s + 1) / stages.length) * 100}%`;
        swapTo(stages[s].view);
        s++;
        setTimeout(step, stages[s - 1].view === "side" ? 520 : 360);
      } else done();
    };
    setTimeout(step, 200);
  });
  await reveal.done;

  const front = analyze(landmarks, width, height, selectedSex);
  // Front-only is a real result: mergeReports already returns the front report
  // untouched when the side is absent, so the same call covers both and the
  // results screen's own front-only branch (OVERALL · FRONT ONLY, with an
  // "Add side profile" nudge) does the rest.
  const report = sideReport ? mergeReports(front, sideReport) : front;
  const delta = compareAndStore(report);

  // Keep a thumbnail of each view against this scan, keyed by the log entry's
  // own date so the two cannot drift. Thumbnails only — see engine/photoStore.
  // Fire-and-forget: a storage failure must never interrupt a finished
  // analysis, and the report does not depend on it.
  void (async () => {
    const log = readHistory(report.sex);
    const date = log[log.length - 1]?.date;
    if (!date) return;
    const frontThumb = toThumb(frontShot);
    const sideThumb = lastSide?.photo ? toThumb(lastSide.photo) : null;
    await savePhotos(date, {
      front: frontThumb ?? undefined,
      side: sideThumb ?? undefined,
    });
    await pruneTo(readAllHistory().map((s) => s.date));
  })();

  el.frame.classList.remove("scanning");
  el.capRight.textContent = "ANALYZED";
  el.status.textContent = "";
  el.barFill.style.width = "0";
  drawCalm(el.overlayCanvas, landmarks, width, height);
  renderQualityChips(quality, autoNote);

  const ctxArgs = {
    report,
    delta,
    landmarks,
    photoW: width,
    photoH: height,
    analysis: el.analysis,
    zoomable: el.zoomable,
    overlay: el.overlayCanvas,
    onNewPhoto: resetToUpload,
    // Same destination as "continue" — the plan chooser, which already handles
    // signed-out users and the under-18 rule. The upgrade button is not a
    // second, parallel billing path.
    onUpgrade: async () => {
      const user = await currentUser();
      if (user) {
        await openTrialFunnel(user);
        await refreshMaxAccess();
        return;
      }
      await openAccount({
        reason: "analysis",
        notice: "Create your account to choose a plan.",
        onAuthenticated: async (signedInUser) => {
          await openTrialFunnel(signedInUser);
          await refreshMaxAccess();
        },
      });
    },
    onContinue: async () => {
      const user = await currentUser();
      if (user) {
        await openTrialFunnel(user);
        return;
      }
      await openAccount({
        reason: "analysis",
        notice: "Create your account to save your pathway and choose a trial.",
        onAuthenticated: (signedInUser) => openTrialFunnel(signedInUser),
      });
    },
    onSideProfile: () => startSide(),
    sideReport: sideReport ?? undefined,
    sidePhoto: lastSide?.photo,
    sidePoints: lastSide?.points,
    // Correct the points on the profile already taken, rather than shooting it
    // again. The photograph is usually fine; it is the seed that missed.
    onRedoSide: () => {
      feedbackDeliveryNote = null;
      if (!lastSide?.photo) {
        startSide();
        return;
      }
      el.main.classList.add("hidden");
      openSideAdjust(lastSide.photo, {
        points: lastSide.points,
        faceDir: lastSide.faceDir,
        automaticPoints: lastSide.automaticPoints,
        method: lastSide.seedMethod,
      }, {
        sex: selectedSex,
        onBack: () => {
          closeSide();
          el.main.classList.remove("hidden");
        },
        onDone: async (sideReport, points, faceDir, review) => {
          closeSide();
          lastSide = {
            points,
            faceDir,
            photo: lastSide?.photo,
            automaticPoints: review.automaticPoints,
            seedMethod: review.seedMethod,
            feedback: review.feedback ?? undefined,
          };
          await submitConsentedSideFeedback();
          await runFullAnalysis(sideReport);
        },
      });
    },
    // Changing the reference population re-runs BOTH views and the merge. It
    // cannot just relabel: every percentile, every region and the side metrics
    // are all scored against the chosen population, so a relabel would leave
    // the numbers describing a group the header no longer names.
    onSexChange: (sex: Sex) => {
      selectedSex = sex;
      storeSex(sex);
      paintRefPop();
      if (!lastSide) return;
      const f = analyze(landmarks, width, height, sex);
      const sd = analyzeSide(lastSide.points, lastSide.faceDir, sex);
      const merged = mergeReports(f, sd);
      renderQualityChips(quality, `Scored against ${sex} norms`);
      renderResults({ ...ctxArgs, report: merged, delta: null });
    },
  };
  renderResults(ctxArgs);

  // The plan renders locked and unlocks in place if this comes back positive.
  // Deliberately not awaited: a finished analysis must never wait on a billing
  // read, and a failed read leaves the paywall up rather than giving Max away.
  void refreshMaxAccess();

  exposeDev(report, landmarks, quality);
  // Any redirect-survival copy has served its one purpose. The full-size
  // captures remain in memory for this result; the reduced temporary copies
  // are removed from device storage immediately.
  clearPendingAnalysis();
  resumePendingStarted = false;
}

// The visitor has completed both photographs before we ask for an account.
// That ordering is the acquisition flow: let them experience the scan first,
// then ask for identity only at the moment the result becomes valuable.
async function gateAnalysis(sideReport: Report): Promise<void> {
  // A temporary auth/session read failure must never strand a signed-out user
  // on an empty result view. Treat an unreadable session as signed out and
  // present the account gate, which remains usable as the fallback screen even
  // if the modal itself cannot open.
  const user = await currentUser().catch(() => null);
  if (!isAuthAvailable() || user) {
    await submitConsentedSideFeedback();
    await runFullAnalysis(sideReport);
    return;
  }

  const saved = pending && lastSide
    ? savePendingAnalysis({
        sex: selectedSex,
        front: { ...pending, canvas: el.photoCanvas },
        side: {
          points: lastSide.points,
          faceDir: lastSide.faceDir,
          canvas: lastSide.photo,
          automaticPoints: lastSide.automaticPoints,
          seedMethod: lastSide.seedMethod,
          feedback: lastSide.feedback,
        },
      })
    : false;

  el.upload.classList.add("hidden");
  el.main.classList.remove("hidden");
  el.frame.classList.remove("scanning");
  el.capRight.textContent = "SCAN READY";
  el.status.innerHTML = saved
    ? "<b>Both views captured.</b> Sign up or log in to run the analysis."
    : "<b>Both views captured.</b> Sign in with an existing account to continue.";
  el.barFill.style.width = "100%";
  el.analysis.innerHTML = `<section class="analysis-gate">
    <span class="klabel">YOUR SCAN IS READY</span>
    <h2>Create an account to analyse your face</h2>
    <p>In order to be able to analyze your face, you must create an account. Sign up or log in to continue. ${lastSide?.feedback
      ? "Your front photo stays on this device; the side feedback you approved is sent privately after sign-in."
      : "Your face photos stay on this device."}</p>
    ${saved ? "" : `<p class="analysis-gate-warn">This browser could not preserve the scan through an email or social redirect. Use an existing password login to keep this result.</p>`}
    <button type="button" class="btn pri analysis-gate-open">Create account and analyse</button>
  </section>`;

  // Under the button, never above it. The demo is there to make the wait worth
  // it, not to compete with the thing being asked for.
  gateDemo?.stop();
  const gateSection = el.analysis.querySelector<HTMLElement>(".analysis-gate");
  if (gateSection) gateDemo = mountGateDemo(gateSection);

  const openGate = async () => {
    await openAccount({
      initialMode: saved ? "signup" : "password",
      reason: "analysis",
      onDeferred: () => {
        el.status.innerHTML = "<b>Scan saved on this device.</b> Open the newest email link to continue.";
      },
      onAuthenticated: async () => {
        // Supabase emits SIGNED_IN before signInWithPassword resolves. Claim
        // this continuation before the deferred auth listener gets a turn, so
        // one password login cannot analyze and append history twice.
        if (saved) resumePendingStarted = true;
        await submitConsentedSideFeedback();
        await runFullAnalysis(sideReport);
      },
    }).catch(() => {
      // Keep the visible inline gate available if a browser blocks or fails to
      // mount the modal. The user can retry without losing the scan.
      el.status.innerHTML = "<b>Your scan is ready.</b> Sign up or log in to continue.";
    });
  };
  el.analysis.querySelector(".analysis-gate-open")?.addEventListener("click", () => void openGate());
  // Mount after the result shell has painted. This avoids mobile browsers
  // dropping the overlay while the capture view is being replaced.
  requestAnimationFrame(() => void openGate());
}

let resumePendingStarted = false;
async function resumePendingAfterAuth(): Promise<void> {
  if (resumePendingStarted) return;
  const saved = readPendingAnalysis();
  if (!saved || !await currentUser()) return;
  resumePendingStarted = true;

  const frontOk = await drawStoredPhoto(
    el.photoCanvas,
    saved.front.photo,
    saved.front.width,
    saved.front.height,
  );
  if (!frontOk) {
    clearPendingAnalysis();
    resumePendingStarted = false;
    return;
  }

  let sidePhoto: HTMLCanvasElement | undefined;
  if (saved.side.photo) {
    sidePhoto = document.createElement("canvas");
    const sideOk = await drawStoredPhoto(
      sidePhoto,
      saved.side.photo,
      saved.side.width,
      saved.side.height,
    );
    if (!sideOk) sidePhoto = undefined;
  }

  selectedSex = saved.sex;
  sexChosen = true;
  storeSex(saved.sex);
  paintRefPop();
  pending = {
    landmarks: saved.front.landmarks,
    width: saved.front.width,
    height: saved.front.height,
    quality: saved.front.quality,
    autoNote: saved.front.autoNote,
  };
  lastSide = {
    points: saved.side.points,
    faceDir: saved.side.faceDir,
    photo: sidePhoto,
    automaticPoints: saved.side.automaticPoints,
    seedMethod: saved.side.seedMethod,
    feedback: saved.side.feedback,
  };
  closeSide();
  el.upload.classList.add("hidden");
  el.main.classList.remove("hidden");
  await submitConsentedSideFeedback();
  await runFullAnalysis(analyzeSide(saved.side.points, saved.side.faceDir, saved.sex));
}

function startSide(): void {
  feedbackDeliveryNote = null;
  el.main.classList.add("hidden");
  openSideCapture({
    sex: selectedSex,
    // Carry the front's capture method so the side does not make the user
    // switch: camera stays camera, upload stays upload.
    method: captureMethod ?? undefined,
    // There is no "back to results" any more, because there are no results yet.
    // The only way out of this step is forward, or starting over.
    onBack: () => resetToUpload(),
    onDone: async (sideReport, points, faceDir, review) => {
      // Copy the profile out before the side screen is torn down — the results
      // panel shows it under the Side tab, and after closeSide() the canvas it
      // lives on is fair game.
      const shot = document.getElementById("side-canvas") as HTMLCanvasElement | null;
      let photo: HTMLCanvasElement | undefined;
      if (shot?.width) {
        photo = document.createElement("canvas");
        photo.width = shot.width;
        photo.height = shot.height;
        photo.getContext("2d")!.drawImage(shot, 0, 0);
      }
      closeSide();
      lastSide = {
        points,
        faceDir,
        photo,
        automaticPoints: review.automaticPoints,
        seedMethod: review.seedMethod,
        feedback: review.feedback ?? undefined,
      };
      (window as unknown as Record<string, unknown>).__truemaxSide = sideReport;
      // The verified points, for the calibration harnesses — re-scoring the
      // profile under a different reference population needs the input, not
      // the finished report.
      (window as unknown as Record<string, unknown>).__truemaxSidePoints = { points, faceDir };
      await gateAnalysis(sideReport);
    },
  });
}

function renderQualityChips(q: QualityCheck, autoNote = ""): void {
  const chips = q.issues.map((i) => `<span class="qchip warn">${i}</span>`);
  if (autoNote) chips.push(`<span class="qchip">${autoNote}</span>`);
  if (feedbackDeliveryNote) {
    chips.push(`<span class="qchip${feedbackDeliveryNote.ok ? "" : " warn"}">${feedbackDeliveryNote.message}</span>`);
  }
  // Surfacing the correction is part of showing the math: the user can see
  // that an off-axis photo was accounted for rather than silently mismeasured.
  const off = Math.max(Math.abs(q.yawDeg), Math.abs(q.pitchDeg));
  if (off >= 6) chips.push(`<span class="qchip">Pose-corrected · ${off.toFixed(0)}° off-axis</span>`);
  if (!chips.length) chips.push(`<span class="qchip">Capture quality: good</span>`);
  el.qualityChips.innerHTML = chips.join("");
}

function exposeDev(report: Report, landmarks: unknown, quality: unknown): void {
  (window as unknown as Record<string, unknown>).__truemax = {
    report,
    landmarks,
    quality,
    // Console helper for building the celebrity DB from real scans:
    // copy(window.__truemax.celebEntry("Name")) → paste into src/engine/celebs.ts
    celebEntry: (name: string) => toCelebEntry(report, name),
    poseCalibration: POSE_CALIBRATION,
  };
}

// Phone photos are the hard case: they carry EXIF rotation (a portrait shot
// decodes sideways unless honoured) and iPhones default to HEIC, which only
// Safari can decode. createImageBitmap applies EXIF for us where supported;
// the <img> path is the fallback, and browsers apply EXIF there too.
async function loadImage(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    } catch {
      /* fall through to the <img> decoder */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return Object.assign(img, { width: img.naturalWidth, height: img.naturalHeight });
  } catch {
    const heic = /.hei[cf]$/i.test(file.name) || /hei[cf]/i.test(file.type);
    throw new Error(
      heic
        ? "HEIC photos can't be read by this browser. On iPhone: Settings › Camera › Formats › Most Compatible, or share the photo as JPEG."
        : "That image couldn't be read. Try a JPG or PNG.",
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

// INITIAL_SESSION handles an OAuth or confirmation redirect, while SIGNED_IN
// covers an immediate password flow. The guard makes the two events harmless
// when Supabase emits both for one navigation.
if (isAuthAvailable()) {
  // Also performs expiry cleanup for a signed-out visitor returning later.
  readPendingAnalysis();
  onAuthChange((user) => {
    void refreshHomeBrand(user);
    // Give an in-page password flow the first chance to continue with its
    // full-resolution canvases. OAuth and email-confirmation returns have no
    // in-page callback, so the saved scan resumes on the next navigation.
    if (user) setTimeout(() => void resumePendingAfterAuth(), 0);
  });
} else {
  paintHomeBrand("guest");
}
