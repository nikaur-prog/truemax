import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { scenesFor } from "./engine/aiSceneCatalog.js";
import type { SidePoints } from "./engine/sideMetrics.js";
import { captureAttribution } from "./engine/attribution.js";
import { FACE_FLAWS } from "./engine/faceFlawCatalog.js";
import { detect, initLandmarker, isReady, setRunningMode } from "./engine/landmarker.js";
import { detectStable } from "./engine/consensus.js";
import { assessQuality } from "./engine/quality.js";
import { analyze } from "./engine/scoring.js";
import { aggregateScoreToPercentile } from "./engine/scoring.js";
import { REGION_NAMES, REGION_RELIABLE_MIN } from "./engine/scoring.js";
import { moveLabel, regionMoves } from "./engine/comparison.js";
import { isSupported, startCamera } from "./ui/camera.js";
import type { CameraHandle } from "./ui/camera.js";
import { rankShort } from "./ui/templates.js";
import { storeSex, storedSex } from "./engine/sexPref.js";
import { enablePhotoPaste, pasteHintApplies } from "./ui/pastePhoto.js";
import { track } from "./engine/track.js";
import { drawQuickSilhouette } from "./ui/quickSilhouette.js";
import { openSexChooser } from "./ui/sexChooser.js";
import { openSideCapture, close as closeSideFlow } from "./ui/sideFlow.js";
import { DEFAULT_VERDICT_TONE, loadVerdictTone, verdictForPercentile } from "./engine/analysisMode.js";
import { askVerdictTone } from "./ui/tonePrompt.js";
import { drawLandmarksAnimated } from "./ui/overlay.js";
import type { Report, ScoredMetric, Sex } from "./engine/types.js";
import { hasSideOverlay } from "./ui/sideMeasureOverlay.js";
import { downloadCtaOutro, downloadQuickVideo, renderQuickVideoFrame } from "./ui/quickVideoExport.js";
import { clearFaces, deleteFace, faceToCanvas, listFaces, saveFace } from "./engine/faceLibrary.js";
import type { QuickVariant } from "./ui/quickVideoExport.js";
import { RundownBlocked, RundownCancelled, downloadRundownVideo } from "./ui/rundownExport.js";
import { NarrationFailed } from "./ui/rundownAudio.js";
import { showCaptionStep } from "./ui/captionStep.js";
import { spokenSeconds } from "./engine/reelScript.js";
import { toAvatarThumb } from "./engine/avatar.js";
import {
  addRatedFace,
  clearCalibrationSet,
  confirmOwnRating,
  reviseRating,
  corpusJSON,
  loadCalibrationSet,
  missingCoverage,
  sideCount,
  removeRatedFace,
  setHealth,
  splitByProvenance,
} from "./engine/calibrationSet.js";
import type { RatedFace } from "./engine/calibrationSet.js";
import { submitSideCorrectionFeedback } from "./engine/sideFeedback.js";
import { currentAccessToken, currentUser, isAuthAvailable, onAuthChange } from "./engine/auth.js";
import { activateScanOwner, activeScanOwner, scopedStorageKey } from "./engine/scanScope.js";
import { canShareFiles, exportName, outcomeMessage, saveFile, savesDirectly, setSavesDirectly } from "./ui/saveFile.js";
import { denyQuickAccess, quickAccessProfile } from "./ui/quickGate.js";
import { copyDiagnostics } from "./ui/diagnostics.js";
import { mergeReports } from "./engine/scoring.js";
import { assessPhotoQuality } from "./engine/photoQuality.js";
import type { PhotoQuality } from "./engine/photoQuality.js";
import { LOOKS, applyEnhance, lookFor } from "./engine/enhance.js";

// ---------------------------------------------------------------------------
// The quick breakdown.
//
// A second, unlisted entry point built for filming rather than for using. One
// photo, front only, straight to a full multi-score card that fits in a phone
// screen recording.
//
// It shares the engine with the main app rather than approximating it — same
// detect, same analyze, same percentile tables — so a number read out on camera
// is a number the product would actually give. What it does NOT share is the
// results panel: tabs, overlays, the plan and the celebrity matches are all
// built for someone sitting with the thing, and none of them survive being
// filmed. This is the same data, laid out to be read at arm's length.
//
// Front only, deliberately. The full flow requires a profile and merges the two
// views, which is the right call for a real scan and the wrong one for a
// fifteen-second clip: the side view needs thirteen points dragged into place
// by hand. So the score here is the front-only score, and the page says so
// rather than presenting it as the same number.
// ---------------------------------------------------------------------------

// Ingest cap. This was 1280, which quietly capped every EXPORT: the analysis
// frame is authored at 720x1280 but rendered at 1080x1920 (and 4K), and the
// photograph fills most of that height — so a 1280-tall source was upscaled
// ~1.5x into every reel and looked exactly as pixelated as that sounds.
// 2160 is native at 1080 output with headroom, and detection cost is
// unchanged (MediaPipe resizes internally); only the one-off skin pass pays.
const MAX_DIM = 2160;

const el = {
  pillars: document.getElementById("q-pillars")!,
  ai: document.getElementById("q-ai")!,
  cal: document.getElementById("q-cal")!,
  calBody: document.getElementById("q-cal-body")!,
  calStep: document.getElementById("q-cal-step")!,
  calBack: document.getElementById("q-cal-back")!,
  aiBack: document.getElementById("q-ai-back")!,
  aiForm: document.getElementById("q-ai-form") as HTMLFormElement,
  aiSex: document.getElementById("q-ai-sex")!,
  aiNote: document.getElementById("q-ai-note")!,
  aiMsg: document.getElementById("q-ai-msg")!,
  modeBack: document.getElementById("q-mode-back")!,
  modeName: document.getElementById("q-mode-name")!,
  modeStep: document.getElementById("q-mode-step")!,
  capture: document.getElementById("q-capture")!,
  result: document.getElementById("q-result")!,
  frame: document.getElementById("q-frame")!,
  video: document.getElementById("q-video") as HTMLVideoElement,
  guide: document.getElementById("q-guide") as HTMLCanvasElement,
  hint: document.getElementById("q-hint")!,
  hintTitle: document.getElementById("q-hint-title")!,
  hintDetail: document.getElementById("q-hint-detail")!,
  lampFill: document.getElementById("q-lamp-fill")!,
  shoot: document.getElementById("q-shoot") as HTMLButtonElement,
  pick: document.getElementById("q-pick") as HTMLButtonElement,
  file: document.getElementById("q-file") as HTMLInputElement,
  engine: document.getElementById("q-engine")!,
  stage: document.getElementById("q-stage")!,
  shot: document.getElementById("q-shot") as HTMLCanvasElement,
  dots: document.getElementById("q-dots") as HTMLCanvasElement,
  cards: document.getElementById("q-cards")!,
  silhouette: document.getElementById("q-silhouette") as HTMLCanvasElement,
  lib: document.getElementById("q-lib")!,
  libStrip: document.getElementById("q-lib-strip")!,
  libClear: document.getElementById("q-lib-clear")!,
};

// Stage timings. Long enough to read on camera, short enough that nobody
// reaches for the skip they do not have.
const SWEEP_MS = 2500; // two passes of the scan line
const DOTS_HOLD_MS = 550; // beat after the dots land, before the photo moves

let cam: CameraHandle | null = null;
let camOpening = false;
let camOpenAttempt = 0;
let ready = false;

// Checked before anything else starts.
//
// The markup ships in the HTML, so the interface would otherwise be on screen
// throughout this round trip — a stranger would see the whole tool, then have it
// taken away, which shows them exactly what they were not supposed to find. The
// page therefore starts hidden in the document itself and is revealed only on a
// pass, so the refusal is the first and only thing an unauthorised visitor gets.
//
// The landmarker is deferred behind the same check for the plainer reason that
// downloading multiple megabytes of face model for somebody about to be refused
// is a waste of their data.
void quickAccessProfile().then((access) => {
  if (!access.allowed) {
    denyQuickAccess();
    return;
  }
  applyPillarGrants(access);
  document.querySelector(".q-wrap")?.classList.remove("q-locked");
  openFromHash();
  initLandmarker()
  .then(() => {
    el.engine.textContent = "ENGINE READY";
    el.engine.classList.add("ready");
    // The camera opens only on an explicit "Use camera" click. This page is
    // built to be filmed, so a creator needs to start the preview on cue rather
    // than have it spring open the moment the page loads. Matches the main app,
    // which also no longer auto-opens.
    if (import.meta.env.DEV && new URLSearchParams(location.search).get("preview") === "video") {
      void loadPreviewPhoto();
    }
  })
  .catch(() => {
    el.engine.textContent = "ENGINE FAILED TO LOAD · REFRESH";
    el.engine.classList.add("error");
  });
});

// Which pillar buttons each grant unlocks, and which rooms only staff see.
//
// The grant keys are the League's ("cta", "polisher", "clips", "studio"),
// ticked by the owner at approval; the buttons are this page's modes. CTA
// covers both content cuts because they are the same job: footage of a scan,
// posted.
//
// The AI Model Reel moved from staff-only to the `studio` grant, and the move
// is the point of it. Generating a pair costs money per call, which is why it
// was locked to staff at all, but "costs money" is what a METER is for and the
// League already has one. A grant plus a reserved quota slot lets somebody run
// the room without holding the keys to the whole product.
//
// Calibrate stays staff-only and is REMOVED rather than locked, because it
// feeds the rating corpus the scoring is fitted against: it is not a tool
// somebody is missing from their plan, it is not a tool at all.
const PILLAR_GRANT: Record<string, string> = {
  reel: "cta",
  analysis: "cta",
  enhance: "polisher",
  ai: "studio",
};
const STAFF_ONLY_MODES = ["calibrate"];

function applyPillarGrants(access: { staff: boolean; grants: Record<string, boolean> }): void {
  if (access.staff) return;
  for (const button of document.querySelectorAll<HTMLButtonElement>(".q-pillar")) {
    const mode = button.dataset.mode ?? "";
    if (STAFF_ONLY_MODES.includes(mode)) {
      button.remove();
      continue;
    }
    const grant = PILLAR_GRANT[mode];
    if (grant && access.grants[grant] !== true) {
      // Locked, not removed: the League Tools page shows the same card with
      // the same words, and a member who can see what exists knows what to
      // ask the owner for.
      button.disabled = true;
      button.classList.add("q-pillar-locked");
      const chip = document.createElement("span");
      chip.className = "q-pillar-lock-chip";
      chip.textContent = "NOT IN YOUR PLAN";
      button.appendChild(chip);
    }
  }
}

// Deep links from the League Tools page. Each pillar card over there is a
// door into a specific room here, so a member lands in the tool they clicked
// rather than on the menu. Unknown hashes fall through to the pillars, which
// is where everybody else already starts. A hash pointing at a room the
// member does not hold (or that was removed above) lands on the pillars too —
// the locked card explains itself better than an error would.
function openFromHash(): void {
  const target = {
    polisher: "enhance",
    enhance: "enhance",
    cta: "reel",
    reel: "reel",
    analysis: "analysis",
    // The Rundown's own door on the League Tools page. It lives inside the
    // analysis room — the video is built from a scan — so the door opens that
    // room.
    rundown: "analysis",
    // The Studio card's door. Without this the League link landed on the
    // pillar menu, which reads as the link being broken.
    ai: "ai",
    studio: "ai",
  }[location.hash.slice(1).toLowerCase()];
  if (target) {
    const button = document.querySelector<HTMLButtonElement>(`.q-pillar[data-mode="${target}"]`);
    if (!button || button.disabled) return;
  }
  openFromHashInner();
}

function openFromHashInner(): void {
  const hash = location.hash.slice(1).toLowerCase();
  if (!hash) return;
  if (hash === "polisher" || hash === "enhance") {
    void import("./ui/enhancePanel.js").then((m) => m.openEnhancePanel());
    return;
  }
  if (hash === "cta" || hash === "reel") {
    enterMode("reel");
    return;
  }
  if (hash === "analysis" || hash === "rundown") {
    enterMode("analysis");
    return;
  }
  if (hash === "ai" || hash === "studio") {
    enterMode("ai");
    return;
  }
  if (hash === "clips") {
    // The saved-face strip is the clips library. It renders async and only
    // when it has faces, so the scroll waits a beat and lands wherever the
    // strip is — or stays on the pillars when the library is empty.
    window.setTimeout(() => {
      const lib = document.getElementById("q-lib");
      if (lib && !lib.classList.contains("hidden")) lib.scrollIntoView({ behavior: "smooth" });
    }, 600);
  }
}

async function loadPreviewPhoto(): Promise<void> {
  // One of the reel's AI-generated portraits; the celebrity set is gone.
  const response = await fetch("/demo/dev.jpg");
  const blob = await response.blob();
  const image = await loadImage(new File([blob], "preview.jpg", { type: blob.type }));
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth * 2;
  canvas.height = image.naturalHeight * 2;
  canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
  const result = detectStable(canvas);
  const landmarks = result.faceLandmarks[0];
  if (!landmarks) return;
  el.capture.classList.add("hidden");
  el.result.classList.remove("hidden");
  el.cards.innerHTML = `<div class="q-actions"><button class="btn pri" id="q-preview-export">Export preview MP4</button></div>`;
  el.stage.classList.add("q-video-preview");
  const regions = ["Eyes", "Jaw", "Chin", "Midface", "Lips", "Nose", "Symmetry", "Proportions"]
    .map((name, i) => ({ name, score: [7.2, 7.8, 7.1, 6.9, 7.4, 6.8, 8.1, 7.3][i] }));
  renderQuickVideoFrame(el.shot, canvas, landmarks, "male", {
    overall: 7.4,
    percentile: 82,
    regions,
  }, 4.2);
  document.getElementById("q-preview-export")!.onclick = () => void downloadQuickVideo(
    canvas,
    landmarks,
    "male",
    { overall: 7.4, percentile: 82, regions },
  );
}

async function openCamera(): Promise<void> {
  if (cam || camOpening || !isSupported()) return;
  const attempt = ++camOpenAttempt;
  camOpening = true;
  el.frame.classList.add("live");
  try {
    const started = await startCamera({
      video: el.video,
      guideCanvas: el.guide,
      onCheck: (c) => {
        // Quick is a creator tool, not the accuracy-sensitive analysis flow.
        // Once the detector can see a face, never hold the shutter for focus,
        // lighting, expression, pose, crop, glasses, or framing. Those checks
        // made ordinary webcam footage impossible to film and add no value to
        // a short-form clip whose main job is simply capturing the creator.
        ready = c.gates.face;
        el.hintTitle.textContent = ready ? "Ready to capture" : "Center your face in the frame";
        el.hintDetail.textContent = ready
          ? "Quick mode accepts the frame as shown"
          : "Looking for one visible face…";
        el.hint.classList.toggle("ready", ready);
        el.lampFill.className = ready ? "green" : "red";
        el.lampFill.style.width = ready ? "100%" : "0%";
        el.shoot.disabled = !ready;
      },
    });
    if (attempt !== camOpenAttempt) {
      started.stop();
      await setRunningMode("IMAGE");
      return;
    }
    cam = started;
  } catch {
    if (attempt !== camOpenAttempt) return;
    el.frame.classList.remove("live");
    el.hintTitle.textContent = "Camera unavailable";
    el.hintDetail.textContent = "Upload a photo instead";
    return;
  } finally {
    if (attempt === camOpenAttempt) camOpening = false;
  }
  el.shoot.textContent = "Capture";
  el.shoot.disabled = true;
}

// The reference population, asked once, before anything is captured.
//
// The main app asks at the start of a scan for a measured reason: the choice
// moves the score by a median of 0.70 points, and inferring it from face shape
// was 58.8% accurate against a 54.1% base rate. /quick used to skip the
// question and quietly default to men, which meant a woman filming this page
// got a men's percentile unless she noticed a small label afterwards.
//
// Asked BEFORE the camera opens, not after the photo, so it never lands in the
// middle of the clip someone is recording.
// Asked EVERY scan here, unlike the main app.
//
// The main app remembers, correctly: it scans one person repeatedly and their
// sex does not change between Tuesday and Thursday. /quick is the opposite tool
// — it scans a different stranger every time — so a remembered answer means
// every face after the first is silently scored against whichever population
// happened to be chosen weeks ago.
//
// That is not a small error. Switching population moves the score by a median
// of 0.70 points, 2.10 at the 90th percentile and 4.50 at worst, which is
// larger than the entire within-person noise band the rest of the engine works
// so hard to account for. A remembered answer is a wrong answer most of the
// time on a tool built for scanning other people.
//
// The previous choice is pre-selected, so the common case is still one tap.
// Asked once per FACE, not once per button press. The question is about the
// person in the photo, so pressing "Use camera", changing your mind and
// pressing "Upload" is still the same face and still the same answer — but it
// used to re-ask, and so did coming back after dismissing a file picker. Two
// identical full-screen questions in a row read as a bug, because they are one.
//
// Cleared when a face is finished or abandoned (see resetSexAsk), so the next
// face always gets asked afresh — which is the property that actually matters:
// a remembered answer is a wrong answer most of the time on a tool built for
// scanning other people.
let askedForThisFace = false;

function resetSexAsk(): void {
  askedForThisFace = false;
}

function withSex(next: () => void): void {
  if (askedForThisFace && storedSex()) {
    next();
    return;
  }
  openSexChooser(
    (sex) => {
      storeSex(sex);
      askedForThisFace = true;
      paintSilhouette();
      next();
    },
    storedSex() ?? undefined,
    // Backing out has to land somewhere that makes sense, and on /quick that is
    // not "the capture screen you were pushed onto". In Calibrate especially:
    // the set is the home screen of that mode, so a cancelled scan returns to
    // it with the count intact rather than leaving a camera pointed at nothing.
    () => {
      resetSexAsk();
      if (mode !== "calibrate") return;
      el.capture.classList.add("hidden");
      el.cal.classList.remove("hidden");
      renderCalibrationSet();
    },
  );
}

function paintSilhouette(): void {
  drawQuickSilhouette(el.silhouette, storedSex() ?? "male");
}
// Where this visit came from, read off the URL before anything else runs.
// First touch wins and it expires; see engine/attribution.ts.
captureAttribution();
track("quick-visit");

// Resolve the account before reading the persistent face library. IndexedDB is
// shared by everyone using one browser; an unqualified list would show the last
// producer's saved faces to the next signed-in identity.
if (!isAuthAvailable()) {
  activateScanOwner(null);
  void refreshLibrary();
} else {
  let previousOwner: string | null | undefined;
  const syncOwner = () => {
    const owner = activeScanOwner();
    const changed = previousOwner !== undefined && previousOwner !== owner;
    previousOwner = owner;
    if (changed) leaveMode();
    void refreshLibrary();
  };
  onAuthChange(() => syncOwner());
  void currentUser().then(() => {
    if (previousOwner === undefined) syncOwner();
  });
}
el.libClear.onclick = async () => {
  await clearFaces();
  await refreshLibrary();
};
paintSilhouette();
window.addEventListener("resize", paintSilhouette);

el.shoot.onclick = () => withSex(async () => {
  if (!cam) {
    await openCamera();
    return;
  }
  if (!ready) return;
  const shot = cam.capture();
  stopCamera();
  if (shot) await run(shot);
});

el.pick.onclick = () => withSex(() => el.file.click());
el.file.onchange = async () => {
  const f = el.file.files?.[0];
  el.file.value = "";
  if (!f) return;
  await useFile(f);
};

// Paste or drag straight onto the page. The photo somebody wants scanned has
// almost always just been looked at, so it is already on the clipboard; sending
// them to save it and find it again in a picker is three steps back to where
// they started. Goes through withSex so a pasted first photo still picks a
// reference population rather than silently defaulting.
enablePhotoPaste({
  busy: () => el.stage.classList.contains("scanning"),
  dropZone: el.frame,
  onImage: (file) => withSex(() => void useFile(file)),
});

// Only shown where the gesture exists.
if (pasteHintApplies()) {
  const hint = document.getElementById("q-paste-hint");
  if (hint) {
    hint.innerHTML = "…or paste a photo with <kbd>" + (navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl") + "</kbd><kbd>V</kbd>, or drag one in";
    hint.hidden = false;
  }
}

let quickScanGeneration = 0;

async function useFile(f: File): Promise<void> {
  const generation = ++quickScanGeneration;
  stopCamera();
  const img = await loadImage(f);
  if (generation !== quickScanGeneration) return;
  const s = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * s);
  c.height = Math.round(img.naturalHeight * s);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  await run(c, generation);
}

function stopCamera(): void {
  camOpenAttempt++;
  camOpening = false;
  const held = cam;
  cam = null;
  held?.stop();
  el.frame.classList.remove("live");
  // Hand the detector back to still-image mode. Everything past this point
  // works on stills, and leaving it in VIDEO mode makes them throw — the same
  // bug the main flow hit.
  void setRunningMode("IMAGE");
}

async function run(
  src: HTMLCanvasElement,
  generation = ++quickScanGeneration,
): Promise<void> {
  if (generation !== quickScanGeneration) return;
  // A new attempt owns the active scan immediately. If detection fails, no
  // later control may fall back to the previous person's photo, landmarks, or
  // creator attachments.
  last = null;
  shown = null;
  clearRundownMedia();
  if (!isReady()) return;
  await setRunningMode("IMAGE");
  if (generation !== quickScanGeneration) return;
  const det = detectStable(src);
  const q = assessQuality(det);
  if (!q.faceFound) {
    el.hintTitle.textContent = "No face found";
    el.hintDetail.textContent = "Try again with the whole face in frame";
    return;
  }
  const lm = det.faceLandmarks[0];
  // Deliberately no quality rejection here. /quick exists for filming social
  // clips, so a detected face proceeds even if the full scan would warn about
  // softness, lighting, expression, glasses, framing, or camera angle.
  // No demographic question in front of the score — on a page built for
  // filming, that is the one interaction guaranteed to end up in the clip. The
  // stored choice is used if there is one, and the label on the card is a
  // button either way, so correcting it costs one tap and re-scores instantly.
  //
  // What is NOT used here is the shape model's guess. It classified a bearded
  // man as female while testing this page, and at 58.8% on held-out faces
  // against a 54.1% base rate that is not an unlucky case — see sexPref.ts.
  last = { lm, w: src.width, h: src.height, photo: src };
  // The photograph is taken, so whatever happens next is a different face and
  // gets asked afresh. Placed on the way out of every mode rather than in each
  // one, since "a scan finished" is exactly the condition that ends a face.
  resetSexAsk();
  track("quick-scan-done");
  show(storedSex() ?? "male", true);
}

// The last analysed photo, kept so switching reference population re-scores it
// rather than making someone shoot again.
let last: { lm: NormalizedLandmark[]; w: number; h: number; photo: HTMLCanvasElement } | null = null;

// The report the result screen is currently showing.
//
// `last` holds the photograph and the landmarks; this holds the numbers. Needed
// because the headline score is editable and re-deriving the verdict from an
// edit means knowing which reference population to derive it against — and a
// woman handed the men's word is the most obvious error the page could make.
let shown: Report | null = null;

// ---------------------------------------------------------------------------
// Which of the three jobs this session is doing.
//
// The page has three distinct products in it and they want different things at
// the door: two photographs, one photograph, or none at all. Asking first is
// what lets each flow request exactly what it needs — a single capture screen
// that afterwards asks what you meant has already taken the wrong photograph.
//
//   reel     — before and after, both scanned, cut together with the clips
//   analysis — one face, one narrated rundown. Deliberately ONE photograph:
//              extra angles of the same person do not make the measurement
//              better, they make it ambiguous, and the operator was right that
//              a second look with different lighting confuses more than it adds
//   ai       — no photograph at all; a description, a preview, then footage
//
//   calibrate — the odd one out, and deliberately so. It produces nothing to
//              post. It takes one photograph, asks the operator what the face
//              is actually worth BEFORE showing what the engine said, and adds
//              the pair to a growing set. Its output is the corpus every other
//              number in this product is fitted against.
//
//              It sits here rather than on its own page because this is the
//              page the person doing that work already has open, and because a
//              calibration tool nobody opens calibrates nothing.
// ---------------------------------------------------------------------------
type QuickMode = "reel" | "analysis" | "ai" | "calibrate";

const MODE_NAMES: Record<QuickMode, string> = {
  reel: "Reel Creator",
  analysis: "Full Analysis",
  ai: "AI Model Reel",
  calibrate: "Calibrate",
};

let mode: QuickMode | null = null;

// Reel Creator scans twice. This holds the first one while the second is taken,
// so the pair can be compared at the end — the whole reason the mode exists.
let beforeScan: { report: Report; photo: HTMLCanvasElement; lm: NormalizedLandmark[] } | null = null;

/** Which half of a Reel Creator run we are on. Meaningless in the other modes. */
let reelStage: "before" | "after" = "before";

// One photo, or the before-and-after glow-up. Chosen at the door of the mode,
// because it decides how many scans the flow asks for: "single" skips the
// before stage entirely and the reel's analysis segment plays this scan alone.
let reelKind: "single" | "pair" = "pair";

function openReelKindChoice(): void {
  document.querySelector(".q-kindpick")?.remove();
  const sheet = document.createElement("div");
  sheet.className = "q-kindpick";
  sheet.innerHTML = `
    <div class="q-kindpick-card" role="dialog" aria-modal="true" aria-label="What kind of TikTok">
      <b>What are we making?</b>
      <button type="button" class="q-kind" data-kind="pair">
        <span>Before &amp; after</span>
        <em>Two photos, scanned separately. The video is the glow-up: the after score climbs out of the before.</em>
      </button>
      <button type="button" class="q-kind" data-kind="single">
        <span>One photo</span>
        <em>One scan, cut with your clips to a song.</em>
      </button>
    </div>`;
  document.body.appendChild(sheet);
  for (const b of sheet.querySelectorAll<HTMLButtonElement>(".q-kind")) {
    b.onclick = () => {
      reelKind = b.dataset.kind === "single" ? "single" : "pair";
      // Single starts on the AFTER stage so the before-capture branch never
      // fires: the one photo IS the result.
      if (reelKind === "single") reelStage = "after";
      updateModeStep();
      sheet.remove();
    };
  }
}

function enterMode(next: QuickMode): void {
  quickScanGeneration += 1;
  last = null;
  shown = null;
  clearRundownMedia();
  mode = next;
  beforeScan = null;
  reelStage = "before";
  reelKind = "pair";
  el.pillars.classList.add("hidden");
  // The reel's first question is not a photograph, it is what KIND of video
  // this is — one photo, or the before/after pair. Everything downstream
  // (how many scans, what the analysis segment plays) follows from it.
  if (next === "reel") openReelKindChoice();

  // Nothing is photographed in the AI flow, so it gets its own screen rather
  // than the capture screen with a notice bolted on. Leaving the camera up
  // was worse than an unfinished feature: it told somebody to do something
  // that could not possibly help them.
  if (next === "ai") {
    el.ai.classList.remove("hidden");
    el.capture.classList.add("hidden");
    paintFlawChips();
    renderAiNote();
    track("quick-visit");
    return;
  }

  el.ai.classList.add("hidden");
  el.modeName.textContent = MODE_NAMES[next];
  updateModeStep();
  track("quick-visit");

  // Calibrate opens on the SET, not the camera. The other three modes exist to
  // make one thing and the camera is step one; this one is a session of twenty
  // faces, and the first question is always "where am I up to" — how many are
  // in, whether the ratings still span the scale, which faces the engine is
  // worst at. Opening on a viewfinder answers none of that.
  if (next === "calibrate") {
    el.capture.classList.add("hidden");
    el.cal.classList.remove("hidden");
    renderCalibrationSet();
    return;
  }

  el.cal.classList.add("hidden");
  el.capture.classList.remove("hidden");
}

function updateModeStep(): void {
  if (mode !== "reel") {
    el.modeStep.textContent =
      mode === "analysis" ? "One photo" : mode === "calibrate" ? "One photo · then your rating" : "";
    return;
  }
  if (reelKind === "single") {
    el.modeStep.textContent = "One photo · then your clips and a song";
    return;
  }
  el.modeStep.textContent =
    reelStage === "before" ? "Step 1 of 2: the before photo" : "Step 2 of 2: the after photo";
}

function leaveMode(): void {
  quickScanGeneration += 1;
  last = null;
  shown = null;
  clearRundownMedia();
  mode = null;
  beforeScan = null;
  reelStage = "before";
  document.querySelector(".q-kindpick")?.remove();
  el.capture.classList.add("hidden");
  el.result.classList.add("hidden");
  el.ai.classList.add("hidden");
  el.cal.classList.add("hidden");
  el.pillars.classList.remove("hidden");
}

for (const button of document.querySelectorAll<HTMLButtonElement>(".q-pillar")) {
  button.onclick = () => {
    // Enhance is a tool over the person's own files — no camera, no scan, no
    // mode machinery. It opens as a panel over the pillars and closes back to
    // them. Loaded on demand: its encoder stack has no business in the main
    // bundle of a page most visitors use to scan a face.
    if (button.dataset.mode === "enhance") {
      void import("./ui/enhancePanel.js").then((m) => m.openEnhancePanel());
      return;
    }
    enterMode(button.dataset.mode as QuickMode);
  };
}
el.modeBack.onclick = () => leaveMode();
// The wordmark is the way back. Every other page in the product treats a logo
// in the corner as "home", and this one was the exception — mid-flow the only
// way out was the browser's back button, which leaves the URL and the mode
// disagreeing about where you are.
document.getElementById("q-home")?.addEventListener("click", () => {
  if (mode) leaveMode();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
el.calBack.onclick = () => leaveMode();

// ---------------------------------------------------------------------------
// The saved-face strip.
//
// Filming a set of clips means coming back to the same handful of faces over
// and over, and the slow part was never the scan — it was finding the
// photograph again and waiting through detection. A saved face carries its
// landmarks, so loading one skips the model entirely and scores instantly.
//
// Everything stays in IndexedDB on this device. See engine/faceLibrary.ts for
// why that is a requirement rather than a convenience.
// ---------------------------------------------------------------------------
async function refreshLibrary(): Promise<void> {
  const faces = await listFaces();
  el.lib.classList.toggle("hidden", faces.length === 0);
  if (!faces.length) {
    el.libStrip.innerHTML = "";
    return;
  }
  el.libStrip.innerHTML = faces
    .map(
      (f) => `<div class="q-lib-item">
        <button type="button" class="q-lib-load" data-id="${f.id}" title="Load ${escapeHtml(f.label)}">
          <img src="${f.photo}" alt="${escapeHtml(f.label)}" loading="lazy" />
          <b>${f.score.toFixed(1)}</b>
        </button>
        <button type="button" class="q-lib-del" data-del="${f.id}" aria-label="Remove ${escapeHtml(f.label)}">&times;</button>
      </div>`,
    )
    .join("");

  for (const button of el.libStrip.querySelectorAll<HTMLButtonElement>("[data-id]")) {
    button.onclick = async () => {
      const face = faces.find((f) => f.id === button.dataset.id);
      if (!face) return;
      const canvas = await faceToCanvas(face);
      // A corrupt entry costs that one face, not the page. Drop it so the
      // strip cannot keep offering something that will never load.
      if (!canvas) {
        await deleteFace(face.id);
        await refreshLibrary();
        return;
      }
      last = { lm: face.landmarks, w: face.width, h: face.height, photo: canvas };
      show(storedSex() ?? "male", true);
    };
  }
  for (const button of el.libStrip.querySelectorAll<HTMLButtonElement>("[data-del]")) {
    button.onclick = async (event) => {
      event.stopPropagation();
      await deleteFace(button.dataset.del!);
      await refreshLibrary();
    };
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[c] as string);
}

function show(sex: Sex, animate = false): void {
  if (!last) return;
  storeSex(sex);
  render(analyze(last.lm, last.w, last.h, sex, last.photo), last.photo, animate);
}

// Scan line, then landmarks, then the photo gives up its space to the cards.
//
// Sequenced in script rather than as one long CSS animation because the middle
// stage is a canvas reveal that has to be started and awaited, and because the
// whole thing has to be skippable when someone switches reference population —
// re-running the theatre on every toggle would be unwatchable.
async function playSequence(r: Report, photo: HTMLCanvasElement): Promise<void> {
  void r;
  el.stage.classList.remove("open");
  el.stage.classList.add("scanning");
  await wait(SWEEP_MS);
  el.stage.classList.remove("scanning");

  if (last) {
    const reveal = drawLandmarksAnimated(el.dots, last.lm, photo.width, photo.height);
    await reveal.done;
  }
  await wait(DOTS_HOLD_MS);

  // The photo shrinks and the cards drop out of the space it vacates, then the
  // numbers count up and the bars fill as each card settles.
  el.stage.classList.add("open");
  await wait(180);
  settleNumbers(true);
}


// ---------------------------------------------------------------------------
// Calibrate: rate the face, then meet the disagreement.
// ---------------------------------------------------------------------------

// The face currently being assembled. A calibration face is one person, and a
// person has two views — but requiring both would mean no side data until every
// face had one, and requiring neither is not a face. So both slots are
// optional, at least one is required, and the pair is committed together.
let pendingFront: Report | null = null;
let pendingSide: Report | null = null;
// The front capture itself, held only until the face is committed. The row
// stores a 96px thumbnail so a fifty-row set stays auditable — "which face
// was m7" must be answerable without re-scanning anybody.
let pendingFrontShot: HTMLCanvasElement | null = null;
// The rest of what the Dual-View export needs, held over the same window as
// the shot above and cleared with it. This face, both views, its confirmed
// points — the one moment in the product where all of it is in hand at once,
// which is exactly why the dual cut is exported from here and nowhere else.
let pendingFrontLandmarks: NormalizedLandmark[] | null = null;
let pendingSidePhoto: HTMLCanvasElement | null = null;
let pendingSidePoints: SidePoints | null = null;

// The last correction upload's fate, shown in the slots panel.
//
// The upload is fire-and-forget by design — a failed send must never cost the
// operator the scan — but its outcome used to go to the console, which on the
// phone this runs on is nowhere. During a fifty-face calibration session that
// is the difference between believing fifty corrections were collected and
// knowing it: a persistent auth or network failure would have lost every one
// of them silently while the measurements kept saving and everything looked
// fine. The measurements are the corpus; the corrections are what teaches the
// seeder; only one of the two was confirmable.
let shareStatus = "";

// The failed upload itself, held so a Retry button can resend it.
//
// Reporting a failure fixed the SILENT half of the problem and left the loss:
// the photo-and-points pair exists only in memory at that moment, so a status
// line saying "not shared" was an honest note on data that was already gone.
// A dropped connection between faces should cost one tap, not a correction.
// One deep — a second failure overwrites the first — because holding a queue
// of consented photos in memory indefinitely is a bigger liability than
// re-dragging one profile.
let failedUpload: {
  photo: HTMLCanvasElement;
  points: Parameters<typeof submitSideCorrectionFeedback>[1];
  faceDir: number;
  feedback: NonNullable<Parameters<typeof submitSideCorrectionFeedback>[3]>;
} | null = null;

function setShareStatus(text: string): void {
  shareStatus = text;
  // Painted in place when the slots screen is up; renderFaceSlots prints the
  // stored copy otherwise, so an outcome that lands mid-navigation still shows.
  const line = document.getElementById("q-slot-share");
  if (line) line.textContent = text;
  const retry = document.getElementById("q-slot-retry");
  if (retry) retry.classList.toggle("hidden", !failedUpload);
}

// Sends one correction and narrates the result. Shared by the first attempt
// and the Retry button, so the two cannot drift in what an outcome means.
function sendCorrection(upload: NonNullable<typeof failedUpload>): void {
  failedUpload = null;
  setShareStatus("Sharing the corrected side privately…");
  void submitSideCorrectionFeedback(upload.photo, upload.points, upload.faceDir, upload.feedback)
    .then((result) => {
      if (result.ok) {
        setShareStatus("Side correction shared: it will teach the automatic placement.");
      } else if (result.rateLimited) {
        // Retrying a limit would return the same answer all day, so nothing is
        // kept: the correction is declined, not lost in transit.
        setShareStatus("Daily sharing limit reached: this correction stayed on this device.");
      } else {
        failedUpload = upload;
        setShareStatus(`Correction NOT shared, ${result.message ?? "the upload failed"}. The face itself is saved.`);
      }
    });
}

function clearPending(): void {
  pendingFront = null;
  pendingFrontShot = null;
  pendingFrontLandmarks = null;
  pendingSide = null;
  pendingSidePhoto = null;
  pendingSidePoints = null;
}

/**
 * The two slots, side by side, then Analyse.
 *
 * Front and side are shown together rather than in sequence because they are
 * two views of one face, not two steps of one process — and because the
 * operator usually knows which of the two they actually have. A sequence would
 * make the side feel mandatory and the front feel like a gate.
 */
function renderFaceSlots(): void {
  el.calStep.textContent = "This face";
  const slot = (
    id: string,
    name: string,
    got: Report | null,
    note: string,
  ) => `
    <button type="button" class="q-slot${got ? " got" : ""}" id="${id}">
      <span class="q-slot-name">${name}</span>
      <span class="q-slot-state">${got ? "Captured" : "Add"}</span>
      <span class="q-slot-note">${got ? "Tap to replace" : note}</span>
    </button>`;

  el.calBody.innerHTML = `
    <div class="q-slots">
      ${slot("q-slot-front", "Front", pendingFront, "Camera or upload")}
      ${slot("q-slot-side", "Side", pendingSide, "Upload, then check 13 points")}
    </div>
    <button type="button" class="btn pri q-slot-go" id="q-slot-go"
      ${pendingFront || pendingSide ? "" : "disabled"}>Analyse</button>
    <p class="q-cal-hint">Either view on its own is worth having: a front-only
    face still carries every front metric. Both together is what lets a side
    measurement ever be checked against a human rating.</p>
    <p class="q-cal-hint" id="q-slot-share" role="status">${shareStatus}</p>
    <button type="button" class="btn gho${failedUpload ? "" : " hidden"}" id="q-slot-retry">Retry sending the correction</button>
    <button type="button" class="q-slot-back" id="q-slot-back">Back to the set</button>`;

  document.getElementById("q-slot-front")!.onclick = () => {
    el.cal.classList.add("hidden");
    el.capture.classList.remove("hidden");
  };

  document.getElementById("q-slot-side")!.onclick = () => withSex(() => {
    el.cal.classList.add("hidden");
    openSideCapture({
      scanId: crypto.randomUUID(),
      sex: storedSex() ?? "male",
      // Upload only. The live profile camera coaches a turn the operator cannot
      // see, which is the right flow for scanning yourself and the wrong one for
      // working through a folder of photographs.
      method: "upload",
      onDone: (report, points, faceDir, review) => {
        closeSideFlow();
        pendingSide = report;
        // Held for the Dual-View export, cleared with the rest of the pending
        // face. The correction upload below consumes the same pair without
        // owning it.
        pendingSidePhoto = review.photo;
        pendingSidePoints = points;
        // Send the correction, if the operator consented to sharing it.
        //
        // This slot used to take the report and drop the other three arguments,
        // which meant every landmark dragged into place here was thrown away.
        // That is the wrong way round: a calibration session is precisely where
        // somebody sits and corrects profile after profile, so it is the richest
        // source of training signal the seeding will ever get, and it was the
        // one place not feeding it.
        //
        // Fire-and-forget. Nothing on this screen waits for it and a failed
        // upload must not cost the operator the scan they just corrected — the
        // measurements are already in `report` and go into the set regardless.
        // `feedback` is null unless the operator consented — createSideFeedbackIntent
        // returns null in that case — so its existence IS the permission.
        if (review.feedback) {
          sendCorrection({ photo: review.photo, points, faceDir, feedback: review.feedback });
        } else {
          failedUpload = null;
          setShareStatus("");
        }
        el.cal.classList.remove("hidden");
        renderFaceSlots();
      },
      onBack: () => {
        closeSideFlow();
        el.cal.classList.remove("hidden");
        renderFaceSlots();
      },
    });
  });

  document.getElementById("q-slot-go")!.onclick = () => {
    // Front is the primary when present: `scored` has to stay the front score,
    // since that is the figure the corpus is fitted against.
    const primary = pendingFront ?? pendingSide;
    if (primary) renderRatingStep(primary);
  };

  document.getElementById("q-slot-retry")!.onclick = () => {
    if (failedUpload) sendCorrection(failedUpload);
  };

  document.getElementById("q-slot-back")!.onclick = () => {
    clearPending();
    renderCalibrationSet();
  };
}

/**
 * Changing a rating that is already stored.
 *
 * The screen asks WHY, and it is not bureaucracy. By the time a row exists the
 * verdict screen has already printed the engine's number beside the human one,
 * so every edit happens with that number known — and a rating that moved toward
 * it is no longer independent evidence. Fitting to it would be the engine
 * marking its own homework: agreement would improve while nothing about the
 * measurements got better, which is the one failure that looks like success.
 *
 * A genuine mis-entry is a different act and stays fittable, because the
 * intended answer was never influenced by anything. Only the person who typed
 * it can tell those apart, so they are asked plainly rather than guessed at.
 */
function renderRatingEdit(id: string): void {
  const face = loadCalibrationSet().find((f) => f.id === id);
  if (!face) return renderCalibrationSet();

  el.calStep.textContent = "Change a rating";
  el.calBody.innerHTML = `
    <div class="q-cal-rate">
      <p class="q-cal-ask">${face.label ? escapeHtml(face.label) : face.id}:
      you said ${face.rating === null ? "nothing" : face.rating.toFixed(1)},
      the engine said ${face.scored.toFixed(1)}.</p>
      <div class="q-cal-input">
        <input type="number" id="q-edit-num" min="1" max="10" step="0.1" inputmode="decimal"
               value="${face.rating ?? ""}" autocomplete="off" />
      </div>
      <p class="q-cal-hint">Why is it changing? This decides whether the row can still
      be fitted against, and it is the whole reason the rating box comes before the
      verdict.</p>
      <div class="q-actions">
        <button type="button" class="btn pri" id="q-edit-typo">I mistyped it</button>
        <button type="button" class="btn gho" id="q-edit-mind">I changed my mind</button>
      </div>
      <p class="q-cal-hint"><b>Mistyped</b> means the number you meant was always this one:
      nothing was learned from the engine, so the row stays in the fit.
      <b>Changed my mind</b> means the engine's number moved yours. That is worth keeping as a
      record and worth nothing as a target: a corpus fitted to numbers the engine suggested
      would agree with itself perfectly and measure nothing. The row is kept, marked, and left
      out of the export.</p>
      <p class="q-cal-msg" id="q-edit-msg" role="status"></p>
      <button type="button" class="q-slot-back" id="q-edit-back">Back to the set</button>
    </div>`;

  const num = document.getElementById("q-edit-num") as HTMLInputElement;
  const msg = document.getElementById("q-edit-msg")!;
  num.focus();
  const commit = (keepsProvenance: boolean) => {
    const rating = Number(num.value);
    if (!(rating >= 1 && rating <= 10)) {
      msg.textContent = "A number between 1 and 10.";
      num.focus();
      return;
    }
    reviseRating(id, Math.round(rating * 10) / 10, keepsProvenance);
    renderCalibrationSet();
  };
  document.getElementById("q-edit-typo")!.onclick = () => commit(true);
  document.getElementById("q-edit-mind")!.onclick = () => commit(false);
  document.getElementById("q-edit-back")!.onclick = () => renderCalibrationSet();
}

/**
 * The "where do exports go" line.
 *
 * Only shown where the browser can actually honour it — Chromium on a desktop.
 * Safari, Firefox and every phone keep the behaviour they had, and see no
 * control at all, because a disabled button that explains itself is a worse
 * answer than a setting that is simply not offered.
 *
 * The folder is chosen ONCE. Everything after that is written into it without a
 * dialog, into a subfolder per kind, which is the entire point: a save prompt
 * per file would be worse than Downloads for anybody exporting thirty clips in
 * an evening.
 */
async function wireSaveFolder(): Promise<void> {
  const row = document.getElementById("q-folder-row");
  const state = document.getElementById("q-folder-state");
  const pick = document.getElementById("q-folder-pick");
  const clear = document.getElementById("q-folder-clear");
  if (!row || !state || !pick || !clear) return;

  const { canChooseSaveFolder, chooseSaveFolder, clearSaveFolder, saveFolderName } =
    await import("./ui/saveLocation.js");
  if (!canChooseSaveFolder()) return;
  row.classList.remove("hidden");

  const paint = (name: string | null) => {
    state.textContent = name
      ? `Exports go to ${name}, sorted into Reels, Rundowns, Verdict cards and Scans.`
      : "Exports go to Downloads.";
    pick.textContent = name ? "Change folder" : "Choose a folder";
    clear.classList.toggle("hidden", !name);
  };
  paint(await saveFolderName());

  pick.onclick = async () => {
    // Called straight from the click: the picker is gated on a user gesture,
    // and awaiting anything first would spend it.
    const name = await chooseSaveFolder();
    if (name) paint(name);
  };
  clear.onclick = async () => {
    await clearSaveFolder();
    paint(null);
  };
}

function renderRatingStep(r: Report): void {
  el.calStep.textContent = "Your rating";
  el.calBody.innerHTML = `
    <div class="q-cal-rate">
      <p class="q-cal-ask">Before you see what it said, what is this face, out of ten?
      Leave it empty if you are not sure; the face saves either way.</p>
      <div class="q-cal-input">
        <input type="number" id="q-cal-num" min="1" max="10" step="0.1" inputmode="decimal"
               placeholder="Optional" autocomplete="off" />
        <input type="text" id="q-cal-label" placeholder="Label (optional, never exported)"
               maxlength="40" autocomplete="off" />
        <button type="button" class="btn pri" id="q-cal-save">Save face</button>
      </div>
      <p class="q-cal-hint">Whole face, one number, gut answer. Use the ends of the scale:
      a set where everybody sits between 4.5 and 6 cannot settle anything, which is exactly
      how the men in the current corpus ended up useless.</p>
      <label class="q-cal-prov">
        <input type="checkbox" id="q-cal-external" />
        <span>This number came off another app's analysis, not out of my own head.</span>
      </label>
      <p class="q-cal-hint">Worth naming because it is easy to do by accident with a
      competitor's read of the same face open in the next tab. Fitting our weights to
      another product's scores is reverse-engineering its formula with arithmetic, so a
      borrowed number is kept with the face and left out of the corpus export.</p>
      <p class="q-cal-hint">Skipping is a real answer, not a failure. A face saved
      without a rating still carries its measurements and its side corrections: it
      just sits out of the agreement fit. A corpus full of hesitant 5s settles nothing;
      the nine men already in it span 4.5 to 6.1 and are useless for that exact reason.
      Rate the ones you are sure about.</p>
      <p class="q-cal-msg" id="q-cal-msg" role="status"></p>
    </div>`;

  const num = document.getElementById("q-cal-num") as HTMLInputElement;
  const label = document.getElementById("q-cal-label") as HTMLInputElement;
  const external = document.getElementById("q-cal-external") as HTMLInputElement;
  const msg = document.getElementById("q-cal-msg")!;
  num.focus();
  const store = (rating: number | null) => {
    addRatedFace(
      r,
      rating,
      // Provenance describes the NUMBER. With no number there is nothing
      // borrowed, so a skipped rating is recorded as `self` regardless of the
      // checkbox — an "external" tag on an absent value would read as a row
      // needing scrubbing when there is nothing in it to scrub.
      rating !== null && external.checked ? "external" : "self",
      label.value.trim() || undefined,
      pendingSide ?? undefined,
      {
        thumb: pendingFrontShot ? (toAvatarThumb(pendingFrontShot) ?? undefined) : undefined,
        // Front and side counted together: a misplaced point poisons the row
        // whichever view it came from.
        suspect:
          r.metrics.filter((m) => m.implausible).length +
          (pendingSide?.metrics.filter((m) => m.implausible).length ?? 0),
      },
    );
    const held = pendingSide;
    clearPending();
    renderVerdictStep(r, rating, held);
  };
  // One button, and it always stores. The old shape — a primary button that
  // ERRORED on an empty box, with skipping exiled to a second button — made
  // the rating feel mandatory, and a face lost because nobody could name a
  // number would be the wrong trade: the measurements and any side corrections
  // are exactly as valuable without one. Empty means unrated; a typed value
  // still has to be a real rating before it is kept.
  const commit = () => {
    if (!num.value.trim()) {
      store(null);
      return;
    }
    const rating = Number(num.value);
    if (!(rating >= 1 && rating <= 10)) {
      msg.textContent = "A number between 1 and 10, or leave it empty to save without one.";
      num.focus();
      return;
    }
    store(Math.round(rating * 10) / 10);
  };
  document.getElementById("q-cal-save")!.onclick = commit;
  num.onkeydown = (event) => { if (event.key === "Enter") commit(); };
}

function renderVerdictStep(r: Report, rating: number | null, side: Report | null = null): void {
  const withSide = side !== null;
  const gap = rating === null ? null : r.overall - rating;
  // Named rather than left as a number. "−2.3" is a figure; "the engine is
  // two points below you on this face" is the thing worth acting on, and the
  // whole set is a list of these.
  //
  // A skipped face has no disagreement to name, and inventing one by showing
  // the engine's number alone would quietly turn this screen into the thing
  // the skip exists to avoid: a place where the engine's opinion becomes the
  // reference. It says what was stored and nothing else.
  const verdict =
    gap === null
      ? null
      : Math.abs(gap) < 0.6 ? "agrees with you" : gap > 0 ? "is too generous here" : "is too harsh here";
  el.calStep.textContent = "Saved";
  el.calBody.innerHTML = `
    <div class="q-cal-verdict">
      ${
        gap === null
          ? `<p class="q-cal-said">Stored without a rating. Its measurements${
              withSide ? " and side corrections are" : " are"
            } kept; it sits out of the agreement fit.</p>`
          : `<div class="q-cal-pair">
        <div><span>YOU</span><b>${rating!.toFixed(1)}</b></div>
        <div class="q-cal-gap">${gap >= 0 ? "+" : ""}${gap.toFixed(1)}</div>
        <div><span>ENGINE</span><b>${r.overall.toFixed(1)}</b></div>
      </div>
      <p class="q-cal-said">It ${verdict}.${
        withSide ? " Front and side both stored." : ""
      }</p>`
      }
      <div class="q-actions">
        <button class="btn pri" id="q-cal-next">Next face</button>
        <button class="btn gho" id="q-cal-diag">Copy diagnostics</button>
        <button class="btn gho" id="q-cal-list">See the set</button>
        ${withSide && pendingFrontShot && pendingFrontLandmarks && pendingSidePhoto && pendingSidePoints
          ? `<button class="btn gho" id="q-cal-dual">Export Dual-View MP4</button>`
          : ""}
      </div>
    </div>`;
  // The captured face as pasteable text, both views, at the one moment both
  // are in hand.
  //
  // Calibrate has had front and side slots since #46, and no way to get the
  // NUMBERS back out of it — the diagnostics button lives on the analysis
  // results panel, which is a different mode holding a different report. So the
  // one screen in the product that captures a verified profile could not export
  // it, and an external comparison of a side measurement meant reading region
  // cards off a screenshot. That is how a side pairing gets mis-matched to the
  // wrong metric.
  //
  // Merged rather than front-only when both are present, because a merged
  // report carries BOTH views' metrics (mergeReports concatenates them) and its
  // header prints the two view scores separately. Front-only when that is all
  // there is, which the dump then says explicitly rather than leaving the
  // reader to notice an absence.
  const diag = document.getElementById("q-cal-diag") as HTMLButtonElement | null;
  if (diag) {
    diag.onclick = async () => {
      const full = side ? mergeReports(r, side) : r;
      const copied = await copyDiagnostics(full, "");
      diag.textContent = copied ? "Copied" : "Copy from the box";
      window.setTimeout(() => (diag.textContent = "Copy diagnostics"), 2600);
    };
  }
  // The Dual-View cut: both photographs, both scans, the merged number the
  // in-app header already prints. Exported from here because this is the only
  // screen where a front, a hand-confirmed side, and the merged report all
  // exist at once — the honesty condition for ever printing a side figure.
  const dualBtn = document.getElementById("q-cal-dual") as HTMLButtonElement | null;
  if (dualBtn && side) {
    dualBtn.onclick = async () => {
      if (!pendingFrontShot || !pendingFrontLandmarks || !pendingSidePhoto || !pendingSidePoints) return;
      const merged = mergeReports(r, side);
      if (!merged.views) return; // merge fell back to front-only: nothing dual to show
      dualBtn.disabled = true;
      // The most legible constructions first; whatever the side actually
      // measured fills the rest, four at most — the beat is 2.4s long.
      const preferred = ["facialConvexity", "nasalProjection", "chinRecession", "lowerThirdDepth"];
      const withOverlay = side.metrics.filter((m) => hasSideOverlay(m.def.id));
      const sideMetrics = [
        ...preferred.map((id) => withOverlay.find((m) => m.def.id === id)).filter((m): m is ScoredMetric => Boolean(m)),
        ...withOverlay.filter((m) => !preferred.includes(m.def.id)),
      ].slice(0, 4);
      try {
        await downloadQuickVideo(
          pendingFrontShot,
          pendingFrontLandmarks,
          r.sex,
          { overall: merged.overall, percentile: merged.overallPercentile, regions: [] },
          (p) => (dualBtn.textContent = p < 1 ? `Rendering ${Math.round(p * 100)}%` : "Saved"),
          "dual",
          {
            sidePhoto: pendingSidePhoto,
            sidePoints: pendingSidePoints,
            sideMetrics,
            frontScore: merged.views.front.score,
            sideScore: merged.views.side.score,
          },
        );
        dualBtn.textContent = "Saved";
      } catch (error) {
        dualBtn.textContent = error instanceof Error ? error.message : "Export failed";
      } finally {
        dualBtn.disabled = false;
        window.setTimeout(() => (dualBtn.textContent = "Export Dual-View MP4"), 3200);
      }
    };
  }

  document.getElementById("q-cal-next")!.onclick = () => {
    resetSexAsk();
    clearPending();
    renderFaceSlots();
  };
  document.getElementById("q-cal-list")!.onclick = () => renderCalibrationSet();
}

/**
 * How far the engine is from the human, for sorting. Unrated rows sort last.
 *
 * -1 rather than 0, so a face nobody rated sits below one the engine agrees
 * with exactly. Both are "nothing to look at here", but only one of them is
 * evidence of that.
 */
function gapOf(f: RatedFace): number {
  return f.rating === null ? -1 : Math.abs(f.scored - f.rating);
}

function renderCalibrationSet(): void {
  // The set is the one screen with no face in flight, so arriving here always
  // ends the current one.
  resetSexAsk();
  const faces = loadCalibrationSet();
  el.calStep.textContent = `${faces.length} face${faces.length === 1 ? "" : "s"}`;
  // Everything below counts only what may be fitted against. A withheld row is
  // still a scan worth keeping, but reporting it as progress towards a usable
  // corpus would overstate what the export can actually deliver.
  const { own, withheld } = splitByProvenance(faces);
  const health = (["male", "female"] as const).map((sex) => setHealth(own, sex));
  const missing = missingCoverage(own);
  const sides = sideCount(own);
  const missingSide = missingCoverage(own, "side");

  el.calBody.innerHTML = `
    <div class="q-cal-set">
      <div class="q-cal-health">
        ${health
          .map(
            (h) => `<div class="q-cal-hcard${h.enough ? " ok" : ""}">
              <span>${h.sex === "male" ? "MEN" : "WOMEN"}</span>
              <b>${h.count}</b>
              <small>${h.note}</small>
            </div>`,
          )
          .join("")}
      </div>
      ${
        missing.length
          ? `<p class="q-cal-missing">No face in this set carries ${missing.join(", ")} yet,
             so those stay on a prior until one does.</p>`
          : ""
      }
      <p class="q-cal-missing">${
        sides === 0
          ? `No face carries a side profile yet, so all ${missingSide.length} side
             measurements are still on a prior. Add one from the Side slot.`
          : `${sides} of ${own.length} carr${sides === 1 ? "ies" : "y"} a side profile${
              missingSide.length
                ? `, ${missingSide.length} side measurement${
                    missingSide.length === 1 ? "" : "s"
                  } still uncovered`
                : ", and every side measurement is covered"
            }.`
      }</p>
      ${
        withheld.length
          ? `<p class="q-cal-missing">${withheld.length} row${withheld.length === 1 ? "" : "s"}
             held out of the export, because the rating is not marked as your own. A row marked
             <b>borrowed</b> stays out for good; a row marked <b>unknown</b> predates the
             provenance field and one tap on "mine" clears it, but only do that for a number
             you remember writing yourself.</p>`
          : ""
      }
      ${
        faces.length
          ? `<div class="q-cal-rows">
              <div class="q-cal-row q-cal-head"><span>FACE</span><span>YOU</span><span>ENGINE</span><span>GAP</span><span></span></div>
              ${[...faces]
                // Unrated rows sort last rather than crashing the comparator.
                // They have no disagreement to rank by, which is the whole
                // point of the column.
                .sort((a, b) => gapOf(b) - gapOf(a))
                .map((f) => {
                  const gap = f.rating === null ? null : f.scored - f.rating;
                  // Four states now. The middle two are the whole point: a row
                  // whose provenance nobody recorded is not the same as one
                  // known to be the operator's own, and a row with no rating at
                  // all is a third thing again — not suspect, just not fittable.
                  const flag =
                    f.rating === null
                      ? ` <em class="q-cal-flag">unrated</em>`
                      : f.ratedBy === "self"
                        ? ""
                        : f.ratedBy === "external"
                          ? ` <em class="q-cal-flag">borrowed</em>`
                          : f.ratedBy === "revised"
                            ? ` <em class="q-cal-flag">revised after the score</em>`
                            : ` <em class="q-cal-flag">unknown</em>`;
                  const fittable = f.ratedBy === "self" && f.rating !== null;
                  // The audit trail, in the row: the face itself, and a flag
                  // when any of its readings fell outside anatomical range at
                  // capture. A corpus row with misplaced points poisons the
                  // fit, and the time to notice is while the person is still
                  // around to re-scan.
                  const suspectFlag = f.suspect
                    ? ` <em class="q-cal-flag bad">${f.suspect} reading${f.suspect === 1 ? "" : "s"} off-anatomy</em>`
                    : "";
                  return `<div class="q-cal-row${fittable ? "" : " held"}">
                    <span>${
                      f.thumb ? `<img class="q-cal-thumb" src="${f.thumb}" alt="" />` : `<i class="q-cal-thumb none"></i>`
                    }${f.label ? escapeHtml(f.label) : f.id}${flag}${suspectFlag}</span>
                    <span>${f.rating === null ? "–" : f.rating.toFixed(1)}</span>
                    <span>${f.scored.toFixed(1)}</span>
                    <span class="${gap !== null && Math.abs(gap) >= 1.5 ? "bad" : ""}">${
                      gap === null ? "–" : `${gap >= 0 ? "+" : ""}${gap.toFixed(1)}`
                    }</span>
                    <span class="q-cal-acts">${
                      f.ratedBy === undefined && f.rating !== null
                        ? `<button type="button" class="linkish" data-mine="${f.id}">mine</button>`
                        : ""
                    }<button type="button" class="linkish" data-edit="${f.id}">rating</button><button type="button" class="linkish" data-drop="${f.id}">remove</button></span>
                  </div>`;
                })
                .join("")}
            </div>`
          : `<p class="q-cal-empty">Nothing yet. Scan a face and give it a number.</p>`
      }
      <div class="q-actions">
        <button class="btn pri" id="q-cal-add">Add a face</button>
        <button class="btn gho" id="q-cal-copy"${own.length ? "" : " disabled"}>Copy corpus JSON${
          withheld.length ? ` (${own.length} of ${faces.length})` : ""
        }</button>
        <button class="btn gho" id="q-cal-clear"${faces.length ? "" : " disabled"}>Clear the set</button>
      </div>
      <p class="q-cal-hint">Copy pastes straight over src/engine/calibration/corpus.json.
      Rows sort by disagreement, so the faces the engine is worst at are at the top.</p>
      <p class="q-cal-msg" id="q-cal-msg" role="status"></p>
    </div>`;

  document.getElementById("q-cal-add")!.onclick = () => {
    resetSexAsk();
    clearPending();
    renderFaceSlots();
  };
  for (const button of el.calBody.querySelectorAll<HTMLButtonElement>("[data-drop]")) {
    button.onclick = () => { removeRatedFace(button.dataset.drop!); renderCalibrationSet(); };
  }
  for (const button of el.calBody.querySelectorAll<HTMLButtonElement>("[data-mine]")) {
    button.onclick = () => { confirmOwnRating(button.dataset.mine!); renderCalibrationSet(); };
  }
  for (const button of el.calBody.querySelectorAll<HTMLButtonElement>("[data-edit]")) {
    button.onclick = () => renderRatingEdit(button.dataset.edit!);
  }
  const msg = document.getElementById("q-cal-msg")!;
  document.getElementById("q-cal-copy")!.onclick = async () => {
    const text = corpusJSON(loadCalibrationSet());
    try {
      await navigator.clipboard.writeText(text);
      msg.textContent = "Copied.";
    } catch {
      // Same reasoning as the diagnostics dump: the entire job of this button
      // is getting text OUT, so a silent clipboard failure is the one outcome
      // worth handling rather than logging.
      const area = document.createElement("textarea");
      area.className = "q-cal-fallback";
      area.readOnly = true;
      area.value = text;
      el.calBody.appendChild(area);
      area.focus();
      area.select();
      msg.textContent = "Clipboard refused. Select and copy from the box.";
    }
  };
  document.getElementById("q-cal-clear")!.onclick = () => {
    // Two taps. Fifty scans is a day of work and a stray tap should not end it.
    const button = document.getElementById("q-cal-clear") as HTMLButtonElement;
    if (button.dataset.armed !== "1") {
      button.dataset.armed = "1";
      button.textContent = "Really clear it?";
      window.setTimeout(() => {
        button.dataset.armed = "";
        button.textContent = "Clear the set";
      }, 4000);
      return;
    }
    clearCalibrationSet();
    renderCalibrationSet();
  };
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function render(r: Report, photo: HTMLCanvasElement, animate = false): void {
  // Calibrate: the rating comes FIRST, and the engine's number is not on screen
  // while it is being given.
  //
  // This is the whole methodological point of the mode and it is worth being
  // strict about. A rating typed underneath a 6.8 is not an independent
  // judgement of the face, it is a reaction to a 6.8 — and a corpus of ratings
  // anchored to the engine's own output would fit the engine to itself and
  // report excellent agreement while measuring nothing. The scan runs, the
  // score is held back, the number is typed, and only then are the two shown
  // side by side.
  if (mode === "calibrate") {
    el.result.classList.add("hidden");
    el.capture.classList.add("hidden");
    el.cal.classList.remove("hidden");
    // Into the slot, not straight to the rating — the operator may still want
    // to add a side before committing the face.
    pendingFront = r;
    pendingFrontShot = photo;
    // The landmarks ride along for the Dual-View export; `last` is the scan
    // that produced this report, still current at this point in the flow.
    pendingFrontLandmarks = last?.lm ?? null;
    renderFaceSlots();
    return;
  }

  // Reel Creator: the first scan is not a result, it is half of a comparison.
  // Showing the full card set here would be a dead end — the operator would
  // have to work out for themselves that they are meant to go round again.
  if (mode === "reel" && reelStage === "before" && last) {
    beforeScan = { report: r, photo, lm: last.lm };
    last = null;
    shown = null;
    reelStage = "after";
    updateModeStep();
    el.result.classList.add("hidden");
    el.capture.classList.remove("hidden");
    el.hintTitle.textContent = "After photo";
    // The one instruction that decides whether the finished video survives
    // contact with a comment section. Most of the jump in a viral before/after
    // is the camera moving, not the face changing, and the person who notices
    // is always in the replies. Said here because this is the only moment it
    // can still be acted on.
    el.hintDetail.textContent = "Match the before: same angle, same distance, same light";
    return;
  }

  el.capture.classList.add("hidden");
  el.result.classList.remove("hidden");
  shown = r;

  // The photo lives in its own element now, painted once, so the sequence can
  // move it without the card markup being rebuilt underneath it.
  el.shot.width = photo.width;
  el.shot.height = photo.height;
  el.shot.getContext("2d")!.drawImage(photo, 0, 0);

  const regions = [...r.regions].sort((a, b) => b.score - a.score);

  // Trimmed for TikTok on purpose: the score, the percentile under it, and the
  // eight face-part grid, then nothing. Every number here is a `.q-num`: it
  // counts up on reveal, and it is editable, because this page is a content
  // tool. A creator whose scan came out wrong needs to nudge a number to
  // something believable rather than reshoot — see the edit wiring below.
  const num = (target: number, cls = "") =>
    `<b class="q-num ${cls}" data-target="${target.toFixed(1)}" contenteditable="true"
        inputmode="decimal" spellcheck="false">0.0</b>`;
  // The verdict cut of the same result. One word, then the same measurements
  // underneath as a short strip of units — because a word on its own is a claim
  // and a word above the numbers it came from is a read. The toggle is on the
  // card, not in settings, since this page is used standing up with a camera in
  // one hand.
  const verdict = verdictForPercentile(r.overallPercentile, r.sex, loadVerdictTone() ?? DEFAULT_VERDICT_TONE);
  const dimorphism = r.sex === "female" ? "FEMININITY" : "MASCULINITY";
  const micro: Array<[string, number]> = [
    ["FACE", r.overall],
    ["ANGULARITY", r.pillars.Angularity ?? 5],
    [dimorphism, r.pillars.Dimorphism ?? 5],
    ["HARMONY", r.pillars.Harmony ?? 5],
  ];

  el.cards.innerHTML = `
    <div class="q-modes" role="group" aria-label="How to show the result">
      <button type="button" class="q-mode on" data-qmode="score">Score</button>
      <button type="button" class="q-mode" data-qmode="verdict">Verdict</button>
    </div>
    ${beforeScan ? comparisonHTML(beforeScan.report, r) : ""}

    <div class="q-hero">
      <div class="q-headline">
        <button class="q-klabel q-switch" id="q-sex" type="button"
          title="Switch the reference population">VS ${r.sex === "male" ? "MEN" : "WOMEN"} ⇄</button>
        <div class="q-score"><span class="q-num q-score-num" data-target="${r.overall.toFixed(1)}"
          contenteditable="true" inputmode="decimal" spellcheck="false">0.0</span><small>/10</small></div>
        <span class="q-rank">${rankShort(r.overallPercentile)}</span>
      </div>
      ${potentialHTML(r)}
    </div>

    <div class="q-verdict hidden" id="q-verdict">
      <span class="q-klabel">VERDICT</span>
      <b class="q-verdict-word ${verdict.tone}">${verdict.word}</b>
      <div class="q-units">
        ${micro
          .map(
            ([label, value]) => `<div class="q-unit">
              <span>${label}</span>
              <div class="q-unit-bar"><i data-w="${Math.max(0, Math.min(100, value * 10))}" style="width:0%"></i></div>
              <b>${value.toFixed(1)}<small>/10</small></b>
            </div>`,
          )
          .join("")}
      </div>
    </div>

    <div class="q-grid">
      ${regions
        .map(
          (g) => `<div class="q-cell${g.reliability < REGION_RELIABLE_MIN ? " q-cell-weak" : ""}">
            <span>${REGION_NAMES[g.region]}</span>
            ${num(g.score)}
            <div class="q-bar"><i data-w="${Math.max(2, Math.min(100, g.score * 10))}" style="width:0%"></i></div>
            ${g.reliability < REGION_RELIABLE_MIN ? `<em class="q-cell-note">indicative</em>` : ""}
          </div>`,
        )
        .join("")}
    </div>

    <!-- The rundown opens on "How attractive is X?", so it cannot be built
         without a name. Asked for here rather than in a prompt() at click time:
         a modal that appears after you have committed to a sixty-second render
         is a modal you dismiss by accident. -->
    <!-- Labelled above rather than explained inside.

         Both of these carried their entire meaning in a placeholder longer than
         the box that held it, so they read as "Name for the rundow" and
         "Earlier score for a t": and a placeholder is the wrong place for the
         only explanation anyway, because it vanishes the moment somebody types
         into the field it was explaining. -->
    <div class="q-namerow">
      <label class="q-namefield">
        <span>Whose face is this?</span>
        <input id="q-rundown-name" class="q-input" type="text" maxlength="48"
               placeholder="LeBron James" autocomplete="off" />
        <small>Said once, in the opening line.</small>
      </label>
      <!-- The first two seconds, which is the whole retention argument. The
           default question works for a straight breakdown and is the wrong
           framing for rage bait or a fallen-off angle, and which one to post is
           a judgement about a subject and an audience the engine cannot make. -->
      <label class="q-namefield q-openfield">
        <span>Opening line <i>(optional)</i></span>
        <input id="q-rundown-opening" class="q-input" type="text" maxlength="120"
               placeholder="How attractive is {name}?" autocomplete="off" />
        <small>{name} becomes the full name. Empty opens with the default question.</small>
      </label>
      <label class="q-namefield">
        <span>Call them <i>(optional)</i></span>
        <input id="q-rundown-short" class="q-input" type="text" maxlength="24"
               placeholder="LeBron" autocomplete="off" />
        <small>Used for the rest of the video. Defaults to the first name.</small>
      </label>
      <!-- The two cuts. Short is the TikTok default: trait-led clauses, the
           number drawn on screen instead of spoken, the face matted onto the
           dark ground, about fifty seconds. Full is the deep read. -->
      <label class="q-namefield">
        <span>Cut</span>
        <select id="q-rundown-cut" class="q-input">
          <option value="short" selected>Short, fast, trait-led (~50s)</option>
          <option value="full">Full read, every figure spoken (~90s)</option>
        </select>
        <small>Short says the verdict and shows the number. Full says both.</small>
      </label>
      <!-- Turns the score card into a before/after. Left empty the card shows
           now-versus-potential, which is the FIRST card in a glow-up video;
           filled in it shows before-versus-now, which is the last one. -->
      <label class="q-namefield">
        <span>Their earlier score <i>(optional)</i></span>
        <input id="q-card-before" class="q-input" type="number" min="0" max="10" step="0.1"
               placeholder="4.5" autocomplete="off" />
        <small>Makes the card a before/after. Empty shows now vs potential.</small>
      </label>
    </div>

    <!-- Cutaways get a strip of their own rather than a fourth column: they are
         pictures, and a file input squeezed into a quarter of a row shows
         neither what is attached nor how many. -->
    <div class="q-cut">
      <div class="q-cut-head">
        <span>Cutaway photos <i>(optional)</i></span>
        <small>More shots of the same person. Cut to between measurements: the numbers
        always come from the photo above.</small>
      </div>
      <div class="q-cut-slots" id="q-cut-slots"></div>
      <p class="q-cut-status hidden" id="q-cut-status" role="status"></p>
      <input id="q-rundown-broll" type="file" accept="image/*" multiple hidden />
    </div>

    <!-- The thing the engine could not have known to say.
         Optional, and it sits here rather than behind the render button on
         purpose: it changes the length of the voiceover, so it has to be
         written BEFORE somebody commits to a sixty-second encode and goes to
         find footage. The counter under it says how much extra picture the
         sentence will need, while it is still cheap to shorten. -->
    <label class="q-namefield q-notefield">
      <span>Anything the measurement misses <i>(optional)</i></span>
      <textarea id="q-rundown-note" class="q-input" rows="2" maxlength="320"
                placeholder="He's a singer with a stadium career, and that moves how he's seen far more than a jaw measurement does."></textarea>
      <small id="q-rundown-note-len">Read out verbatim just before the call to action.</small>
    </label>

    <!-- The one beat whose length is known BEFORE the render, and therefore the
         one an operator can go and cut footage for. -->
    <!-- Disabled until there is a line for it to play under. Attaching footage
         for a sentence nobody has written is a control that cannot do anything
         yet, and one that silently does nothing is worse than one that says so. -->
    <div class="q-cut q-disc" id="q-disc-row" data-armed="0">
      <div class="q-cut-head">
        <span>Footage for that line <i>(optional)</i></span>
        <small id="q-disc-note">Write the line above first.</small>
      </div>
      <div class="q-disc-clips" id="q-disc-clips"></div>
      <input id="q-disc-clip" type="file" accept="video/*" hidden />
    </div>

    <div class="q-actions">
      <button class="btn pri" id="q-produce">Create Reel</button>
      <button class="btn gho" id="q-download">${canShareFiles("image/png") ? "Save image" : "Download image"}</button>
      <button class="btn gho" id="q-video-download">Breakdown MP4</button>
      <button class="btn gho" id="q-verdict-download">Verdict MP4</button>
      <button class="btn gho" id="q-rundown-download">Rundown MP4</button>
      <!-- The endcard on its own, for the operator cutting an edit elsewhere.
           Every export already closes on it; this hands over just the card. -->
      <button class="btn gho" id="q-cta-download">CTA outro MP4</button>
      <!-- The thirty-second film, as a finished file rather than a render.
           Two different things wear the word CTA on this page: the OUTRO above
           is the endcard every export already closes on, rendered client-side
           in a few seconds, and this is the standalone story film that goes on
           the end of a TikTok. Asking for one and getting the other is the
           reported fault ("it made me download a shitty 8 second one"), so
           they say which they are. -->
      <button class="btn gho" id="q-ctafilm-download">CTA film MP4 · 30s</button>
      <!-- Calibration, not a user feature. A screenshot of the region cards
           says the jaw is wrong; only the metric table says WHICH jaw metric,
           by how far, and whether the ideal or the spread is at fault. -->
      <button class="btn gho" id="q-diagnostics">Copy diagnostics</button>
      <button class="btn gho" id="q-card-download">Score card PNG</button>
      <button class="btn gho" id="q-save-face">Save to library</button>
      <button class="btn gho" id="q-again">New photo</button>
    </div>
    <!-- Where the files go.
         The share sheet is the right answer on a phone, "Save Video" writes to
         the camera roll and the TikTok app is one tap away: and the wrong one
         on a laptop, where it is an AirDrop menu in front of a folder. The
         platform is detected, and this is here because the detection is a
         heuristic about hardware and the person pressing the button knows
         better than it does. -->
    <label class="q-direct">
      <input type="checkbox" id="q-direct" ${savesDirectly() ? "checked" : ""} />
      <span>Download files straight away, no share sheet</span>
    </label>
    <!-- Point the exports at a folder, once.
         Hidden where the browser cannot do it (Safari, Firefox, every phone),
         because a control that explains why it is disabled is worse than no
         control. wireSaveFolder fills the line in and unhides it. -->
    <p class="q-direct hidden" id="q-folder-row">
      <span id="q-folder-state">Exports go to Downloads.</span>
      <button type="button" class="btn gho q-folder-btn" id="q-folder-pick">Choose a folder</button>
      <button type="button" class="btn gho q-folder-btn hidden" id="q-folder-clear">Use Downloads</button>
    </p>
    <div class="prod-caption hidden" id="q-caption"></div>`;

  // Stagger index for the drop, so the cards arrive in reading order rather
  // than all at once.
  [...el.cards.children].forEach((c, i) => (c as HTMLElement).style.setProperty("--i", String(i)));

  wireEditing();

  // The footage editor is part of the Reel Creator, not a reward revealed
  // after somebody has already exported a different file. Keeping it in the
  // primary action row also makes its clip pickers discoverable on a fresh
  // result instead of requiring the operator to guess which download unlocks
  // them.
  document.getElementById("q-produce")?.addEventListener("click", () => openCurrentProducer(r));

  // Toggling swaps two blocks that are both already rendered. Re-rendering the
  // card would restart the count-up animation and, on this page, throw away any
  // number a creator had hand-edited.
  for (const b of el.cards.querySelectorAll<HTMLButtonElement>(".q-mode")) {
    b.onclick = async () => {
      const verdictMode = b.dataset.qmode === "verdict";
      // Asked the first time the verdict is chosen, wherever it is chosen from.
      // Re-rendering afterwards so the word reflects the answer they just gave
      // rather than the default they never picked.
      if (verdictMode && loadVerdictTone() === null) {
        await askVerdictTone();
        render(r, photo);
        (el.cards.querySelector('.q-mode[data-qmode="verdict"]') as HTMLButtonElement | null)?.click();
        return;
      }
      for (const other of el.cards.querySelectorAll<HTMLElement>(".q-mode")) {
        other.classList.toggle("on", other === b);
      }
      el.cards.querySelector(".q-hero")?.classList.toggle("hidden", verdictMode);
      el.cards.querySelector(".q-grid")?.classList.toggle("hidden", verdictMode);
      el.cards.querySelector("#q-verdict")?.classList.toggle("hidden", !verdictMode);
      if (verdictMode) {
        el.cards
          .querySelectorAll<HTMLElement>(".q-unit-bar i")
          .forEach((i) => (i.style.width = `${i.dataset.w}%`));
      }
    };
  }

  if (animate) void playSequence(r, photo);
  else {
    el.stage.classList.add("open");
    settleNumbers(false);
  }

  document.getElementById("q-sex")!.onclick = () => show(r.sex === "male" ? "female" : "male");
  document.getElementById("q-download")!.onclick = () => void downloadCard();
  // Every export reads the CORRECTED report, not the one the engine produced.
  //
  // The headline score is editable, and a correction that changes the number on
  // screen and not the number in the file is worse than no edit at all — the
  // operator sees 7.2, publishes, and the video says 8.1 and calls him
  // handsome. editedReport re-derives the percentile, and the verdict follows
  // the percentile everywhere it is drawn.
  document.getElementById("q-video-download")!.onclick = () => void downloadVideo(editedReport(r), "breakdown");
  document.getElementById("q-verdict-download")!.onclick = () => void downloadVideo(editedReport(r), "verdict");
  document.getElementById("q-rundown-download")!.onclick = () => void downloadRundown(editedReport(r));
  // The film is a shipped asset, not a render: it is built offline by
  // tools/build-cta2.mjs from real VO segments and actor stills, and there is
  // nothing per-scan in it. So this fetches the finished file and hands it to
  // the same save path every other export uses — share sheet on a phone, a
  // download on a laptop.
  document.getElementById("q-ctafilm-download")!.onclick = async () => {
    const btn = document.getElementById("q-ctafilm-download") as HTMLButtonElement;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Fetching…";
    try {
      const res = await fetch("/cta/cta2.mp4", { cache: "force-cache" });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const outcome = await saveFile(blob, exportName("reel", "mp4", "cta-film"), "reel");
      btn.textContent = outcome === "cancelled" ? "Not saved, tap to retry" : outcomeMessage(outcome);
    } catch {
      btn.textContent = "Could not fetch, tap to retry";
    } finally {
      btn.disabled = false;
      // Back to what it says on the tin once the outcome has been read.
      window.setTimeout(() => {
        if (btn.isConnected) btn.textContent = label;
      }, 4000);
    }
  };
  document.getElementById("q-cta-download")!.onclick = async () => {
    const btn = document.getElementById("q-cta-download") as HTMLButtonElement;
    btn.disabled = true;
    try {
      const outcome = await downloadCtaOutro((p) => (btn.textContent = `Rendering · ${Math.round(p * 100)}%`));
      btn.textContent = outcome === "cancelled" ? "Not saved, tap to retry" : outcomeMessage(outcome);
    } catch {
      btn.textContent = "Export failed, tap to retry";
    }
    btn.disabled = false;
    window.setTimeout(() => (btn.textContent = "CTA outro MP4"), 2600);
  };
  // The before half, exported on its own. Only present after a Reel Creator run
  // — there is no before to render otherwise, and a disabled button explaining
  // that would be a control for a mode you are not in.
  const direct = document.getElementById("q-direct") as HTMLInputElement | null;
  if (direct) {
    direct.onchange = () => {
      setSavesDirectly(direct.checked);
      // The two labels that promise a share sheet have to stop promising one.
      const dl = document.getElementById("q-download");
      if (dl) dl.textContent = canShareFiles("image/png") ? "Save image" : "Download image";
    };
  }

  void wireSaveFolder();

  const before = beforeSource();
  if (before && beforeScan) {
    const held = beforeScan;
    const wire = (id: string, idle: string, variant: Exclude<QuickVariant, "dual">) => {
      const b = document.getElementById(id);
      if (b) b.onclick = () => void downloadVideo(r, variant, { source: before, buttonId: id, idle, tag: "before" });
    };
    wire("q-before-video", "Before breakdown MP4", "breakdown");
    wire("q-before-verdict", "Before verdict MP4", "verdict");
    const card = document.getElementById("q-before-card");
    if (card) {
      card.onclick = () =>
        void downloadScoreCard(r, {
          report: held.report,
          photo: held.photo,
          lm: held.lm,
          buttonId: "q-before-card",
          idle: "Before score card PNG",
        });
    }
  }

  // Live length, while the sentence is still cheap to shorten.
  //
  // The disclaimer lands as its own card near the end, and the rundown holds
  // one still frame per beat — so every second of it is a second of picture
  // that has to come from somewhere. Saying so as it is typed is the difference
  // between trimming a sentence now and discovering you are eight seconds short
  // of footage after a sixty-second encode.
  const noteField = document.getElementById("q-rundown-note") as HTMLTextAreaElement | null;
  const noteLen = document.getElementById("q-rundown-note-len");
  if (noteField && noteLen) {
    const update = () => {
      const seconds = spokenSeconds(noteField.value);
      noteLen.textContent = seconds
        ? `Adds about ${seconds.toFixed(1)}s of voiceover, find roughly that much extra footage.`
        : "Read out verbatim just before the call to action.";
    };
    noteField.addEventListener("input", update);
    update();
  }

  mountCutaways();

  mountDisclaimerClips();

  document.getElementById("q-diagnostics")!.onclick = async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const label = (document.getElementById("q-rundown-name") as HTMLInputElement | null)?.value.trim() ?? "";
    const copied = await copyDiagnostics(r, label);
    // Says which of the two things happened. "Copied" over a clipboard write
    // that silently failed is the one outcome that wastes somebody's scan.
    button.textContent = copied ? "Copied, paste it back" : "Copy from the box";
    window.setTimeout(() => (button.textContent = "Copy diagnostics"), 2600);
  };
  document.getElementById("q-card-download")!.onclick = () => void downloadScoreCard(editedReport(r));
  const saveBtn = document.getElementById("q-save-face") as HTMLButtonElement | null;
  if (saveBtn) {
    saveBtn.onclick = async () => {
      if (!last) return;
      saveBtn.disabled = true;
      // Named from the score rather than prompting. A dialog in the middle of
      // a filming session is one more thing to dismiss, and the picture in the
      // strip is what somebody actually recognises a face by.
      const saved = await saveFace({
        label: `${r.overall.toFixed(1)} · ${r.sex === "male" ? "M" : "F"}`,
        photo: last.photo.toDataURL("image/jpeg", 0.9),
        width: last.w,
        height: last.h,
        landmarks: last.lm,
        score: r.overall,
      });
      saveBtn.textContent = saved ? "Saved" : "Could not save";
      await refreshLibrary();
      window.setTimeout(() => {
        saveBtn.textContent = "Save to library";
        saveBtn.disabled = false;
      }, 1600);
    };
  }
  document.getElementById("q-again")!.onclick = () => {
    quickScanGeneration += 1;
    last = null;
    shown = null;
    clearRundownMedia();
    resetSexAsk();
    // Reset the stage, or the next scan starts already open with last scan's
    // landmarks still painted over the new photo.
    el.stage.classList.remove("open", "scanning");
    el.dots.getContext("2d")?.clearRect(0, 0, el.dots.width, el.dots.height);
    el.result.classList.add("hidden");
    el.capture.classList.remove("hidden");
    el.shoot.textContent = "Use camera";
    el.shoot.disabled = false;
    void refreshLibrary();
  };
}

// Numbers count up, bars fill. Called once the cards have dropped, so the
// motion reads as the card settling into its value rather than racing the drop.
function settleNumbers(animate: boolean): void {
  const nums = [...el.cards.querySelectorAll<HTMLElement>(".q-num")];
  for (const n of nums) {
    const target = parseFloat(n.dataset.target ?? "0");
    if (animate) countTo(n, target);
    else n.textContent = target.toFixed(1);
  }
  // Bars grow to their width via a CSS transition; setting it in a rAF ensures
  // the 0% starting width has painted first, or the browser skips the tween.
  requestAnimationFrame(() => {
    for (const i of el.cards.querySelectorAll<HTMLElement>(".q-bar i")) {
      i.style.width = `${i.dataset.w}%`;
    }
  });
}

function countTo(node: HTMLElement, target: number): void {
  const dur = 620;
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    node.textContent = (target * eased).toFixed(1);
    if (t < 1) requestAnimationFrame(step);
    else node.textContent = target.toFixed(1);
  };
  requestAnimationFrame(step);
}

// Every number is editable, because a demo scan that came out wrong should be
// fixable in place rather than by reshooting. Keeps it to one decimal, clamps
// to 0.0–10.0, and refills the bar under a region score so the edit stays
// consistent with what it draws.
function wireEditing(): void {
  for (const n of el.cards.querySelectorAll<HTMLElement>(".q-num")) {
    n.addEventListener("focus", () => {
      const range = document.createRange();
      range.selectNodeContents(n);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
    n.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        n.blur();
      }
    });
    n.addEventListener("blur", () => {
      const v = Math.max(0, Math.min(10, parseFloat(n.textContent ?? "") || 0));
      n.textContent = v.toFixed(1);
      const bar = n.parentElement?.querySelector<HTMLElement>(".q-bar i");
      if (bar) bar.style.width = `${Math.max(2, Math.min(100, v * 10))}%`;
      if (n.classList.contains("q-score-num")) {
        // The headline score is editable because the engine is not always
        // right and the operator can see the face. Everything downstream of
        // that number has to move with it — the rank did, and the VERDICT did
        // not, so a face nudged from 8.1 to 7.2 kept the word it was given at
        // 8.1 and the video went out saying "Handsome" over a 7.2.
        //
        // The measurements do not move, and must not: this is a correction to
        // the aggregate, not a claim that the canthal tilt was mismeasured.
        const pct = aggregateScoreToPercentile(v);
        const rank = el.cards.querySelector<HTMLElement>(".q-rank");
        if (rank) rank.textContent = rankShort(pct);
        refreshVerdictWord(pct);
      }
    });
  }
}

/**
 * The verdict word, re-derived from whatever the headline score now says.
 *
 * Rewrites the word in place rather than re-rendering the card, for the same
 * reason the mode toggle does: a re-render restarts the count-up and throws
 * away every other number the operator has hand-corrected.
 */
function refreshVerdictWord(percentile: number): void {
  const node = el.cards.querySelector<HTMLElement>(".q-verdict-word");
  if (!node || !shown) return;
  const v = verdictForPercentile(percentile, shown.sex, loadVerdictTone() ?? DEFAULT_VERDICT_TONE);
  node.textContent = v.word;
  // The tone class drives the colour, so a face that drops out of the top band
  // has to lose the colour that band was wearing.
  node.className = `q-verdict-word ${v.tone}`;
}

/**
 * The report as the operator has corrected it.
 *
 * The headline number on screen wins over the one the engine produced, and the
 * percentile is re-derived from it. Everything else — every measurement, every
 * region, the ceiling — is untouched, because an edit to the aggregate is a
 * correction to the summary and not a claim about the geometry.
 */
function editedReport(r: Report): Report {
  const scores = editedExportScores(r);
  const editedRegions = new Map(scores.regions.map((region) => [region.name, region.score]));
  const regions = r.regions.map((region) => {
    const score = editedRegions.get(REGION_NAMES[region.region]);
    if (score === undefined || score === region.score) return region;
    return { ...region, score, percentile: aggregateScoreToPercentile(score) };
  });
  const changedRegion = regions.some((region, index) => region !== r.regions[index]);
  if (scores.overall === r.overall && !changedRegion) return r;
  return {
    ...r,
    overall: scores.overall,
    overallPercentile: scores.percentile,
    // A manually raised score cannot export with a lower "potential" ceiling.
    potential: Math.max(scores.overall, r.potential),
    regions,
  };
}

function editedExportScores(r: Report): { overall: number; percentile: number; regions: Array<{ name: string; score: number }> } {
  const parsedOverall = parseFloat(el.cards.querySelector<HTMLElement>(".q-score-num")?.textContent ?? "");
  // Zero is a valid canonical 0–10 edit. `parsed || original` silently turned
  // that one value back into the engine score while every other edit exported.
  const overall = Number.isFinite(parsedOverall) ? Math.max(0, Math.min(10, parsedOverall)) : r.overall;
  const cells = [...el.cards.querySelectorAll<HTMLElement>(".q-cell")];
  return {
    overall,
    percentile: overall === r.overall ? r.overallPercentile : aggregateScoreToPercentile(overall),
    regions: cells.map((cell) => ({
      name: cell.querySelector("span")?.textContent ?? "Feature",
      score: parseFloat(cell.querySelector<HTMLElement>(".q-num")?.textContent ?? "") || 0,
    })),
  };
}

// ---------------------------------------------------------------------------
// Cutaway slots: + cards, clickable, pasteable.
//
// Was a bare <input type="file" multiple> in a quarter-width column, which
// showed neither what was attached nor how many. These are pictures, and the
// control for choosing pictures should show them.
//
// Paste is the point: a still off a search results page is two keystrokes
// pasted and a four-step detour through the filesystem otherwise. The
// listener is on the document and routed by an armed slot — a paste goes to
// whatever holds focus, and what holds focus after a click is a button the
// redraw replaces.
// ---------------------------------------------------------------------------
const CUT_SLOTS = 4;
interface Cutaway {
  image: HTMLImageElement;
  landmarks?: NormalizedLandmark[];
  /**
   * How this photograph will hold up at video size.
   *
   * Read once, when the file arrives, rather than at render time: the point is
   * to tell somebody BEFORE they commit to a sixty-second encode, which is the
   * same reason the disclaimer's length counter sits above the render button.
   */
  quality?: PhotoQuality;
  /** True once the sharpen has been run on this slot, so it is offered once. */
  sharpened?: boolean;
}

/**
 * Run the unsharp mask over one cutaway, in place.
 *
 * The same on-device pass the Enhance panel uses, at the "standard" look with
 * its radius scaled for this image. It cannot add detail that is not there —
 * the copy is careful to say "helps", never "fixes" — but on a soft-but-large
 * photograph it is the difference between mush and a face.
 */
async function sharpenCutaway(index: number): Promise<void> {
  const cut = cutaways[index];
  if (!cut) return;
  const img = cut.image;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  applyEnhance(data.data, w, h, lookFor(LOOKS.standard, Math.max(w, h)));
  ctx.putImageData(data, 0, 0);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.94));
  if (!blob) return;
  const next = new Image();
  const url = URL.createObjectURL(blob);
  await new Promise<void>((res) => {
    next.onload = () => res();
    next.onerror = () => res();
    next.src = url;
  });
  if (cutaways[index] !== cut) {
    // The slot was replaced or cleared while the pass ran.
    URL.revokeObjectURL(url);
    return;
  }
  revokeMediaUrl(img.src);
  // Re-read rather than assume: the sharpen is honest about what it achieved,
  // and a photograph that was too SMALL is still too small afterwards.
  cutaways[index] = {
    ...cut,
    image: next,
    quality: assessPhotoQuality(canvas, cut.landmarks),
    sharpened: true,
  };
  drawCutSlots();
}
const cutaways: Array<Cutaway | null> = Array(CUT_SLOTS).fill(null);
let cutArmed: number | null = null;

function drawCutSlots(): void {
  const host = document.getElementById("q-cut-slots");
  if (!host) return;
  host.innerHTML = "";
  // Gathered across the slots so the strip says one thing rather than three.
  const fixable: number[] = [];
  const flaggedReads: PhotoQuality[] = [];
  cutaways.forEach((image, i) => {
    const cell = document.createElement("div");
    cell.className = "q-cut-cell";
    if (image) {
      // The quality read, when there is something worth saying about it.
      //
      // Said HERE and not at render time on purpose. A cutaway that will not
      // hold up is worth knowing about while swapping it is still one tap, not
      // after a sixty-second encode has produced the picture the owner
      // described as "absolutely horrible".
      const q = image.quality;
      const flagged = Boolean(q && q.verdict !== "ok");
      const canFix = Boolean(flagged && q!.fixable && !image.sharpened);
      // The slot itself is 84x108, which holds a word and not a sentence. The
      // badge names the fault, the title carries the sentence for a pointer,
      // and the strip's status line below spells it out with the fix.
      cell.innerHTML = `<img alt="Cutaway ${i + 1}" />
        <button type="button" class="q-cut-x" title="Remove">✕</button>${
          flagged ? `<span class="q-cut-badge">${q!.facePx < 520 ? "SMALL" : "SOFT"}</span>` : ""
        }`;
      cell.querySelector("img")!.src = image.image.src;
      if (flagged) cell.title = q!.reason;
      if (!image.landmarks) cell.classList.add("q-cut-noface");
      if (flagged) cell.classList.add(q!.verdict === "poor" ? "q-cut-poor" : "q-cut-soft");
      if (canFix) fixable.push(i);
      if (flagged) flaggedReads.push(q!);
      cell.querySelector(".q-cut-x")!.addEventListener("click", () => {
        rundownMediaEpoch += 1;
        revokeMediaUrl(image.image.src);
        cutaways[i] = null;
        drawCutSlots();
      });
    } else {
      const armed = cutArmed === i;
      cell.innerHTML = `<button type="button" class="q-cut-add${armed ? " armed" : ""}">
          <span>+</span>${armed ? "⌘V" : "Photo"}</button>
        <button type="button" class="q-cut-paste">${armed ? "ready" : "paste"}</button>`;
      cell.querySelector(".q-cut-add")!.addEventListener("click", () => {
        cutArmed = i;
        (document.getElementById("q-rundown-broll") as HTMLInputElement | null)?.click();
      });
      cell.querySelector(".q-cut-paste")!.addEventListener("click", (event) => {
        event.stopPropagation();
        cutArmed = armed ? null : i;
        drawCutSlots();
      });
    }
    host.append(cell);
  });

  // One line under the strip, naming the fault and offering the pass that can
  // do something about it. The worst reading wins: told about the small photo
  // and the soft one at once, nobody acts on either.
  const status = document.getElementById("q-cut-status");
  // A "poor" outranks a "soft": the worse fault is the one worth acting on.
  const worst = flaggedReads.find((x) => x.verdict === "poor") ?? flaggedReads[0];
  if (status) {
    if (!worst) {
      status.textContent = "";
      status.classList.add("hidden");
    } else {
      status.classList.remove("hidden");
      status.innerHTML = `<span>${worst.reason}</span>${
        fixable.length ? `<button type="button" id="q-cut-fixall">Sharpen ${fixable.length > 1 ? "them" : "it"}</button>` : ""
      }`;
      document.getElementById("q-cut-fixall")?.addEventListener("click", async (event) => {
        const btn = event.currentTarget as HTMLButtonElement;
        btn.disabled = true;
        btn.textContent = "Sharpening…";
        // Sequential, not parallel: each pass is a full-resolution unsharp mask
        // on the main thread, and three at once locks the page.
        for (const i of fixable) await sharpenCutaway(i);
      });
    }
  }
}

function firstFreeCut(from = 0): number {
  for (let i = from; i < CUT_SLOTS; i++) if (!cutaways[i]) return i;
  return cutaways.findIndex((c) => !c);
}

// One boot, however early the first photo arrives, then a still-image detect.
// Returns undefined rather than throwing for every failure mode: a cutaway
// that will not landmark is still a perfectly good picture, it just cannot
// hold a measurement.
async function landmarkCutaway(image: HTMLImageElement): Promise<NormalizedLandmark[] | undefined> {
  try {
    await initLandmarker();
    await setRunningMode("IMAGE");
    const found = detect(image)?.faceLandmarks?.[0];
    return found?.length ? found : undefined;
  } catch {
    return undefined;
  }
}

async function addCutaway(file: File, at: number): Promise<void> {
  const epoch = rundownMediaEpoch;
  const image = await decodeImage(file);
  if (!image || at < 0) return;

  // Landmark it, so the measurement can be drawn where the feature actually is
  // on THIS face rather than where it was on the other one.
  //
  // The number never comes from here — one face, one set of figures, taken from
  // the measured photograph and stated once. This only supplies geometry, and a
  // cutaway with no face in it (a hand, a silhouette, the back of a head) simply
  // carries no line rather than failing.
  //
  // WAITED for, not checked for. This used to be `if (isReady())`, which
  // silently skipped landmarking whenever a photo was attached before the
  // engine finished booting — and a cutaway without landmarks renders as a
  // bare picture with a score card floating over it, the exact failure the
  // whole feature exists to avoid. The boot is idempotent and takes a couple
  // of seconds once per page; a cutaway is worth waiting that long for.
  const landmarks = await landmarkCutaway(image);
  if (epoch !== rundownMediaEpoch) {
    revokeMediaUrl(image.src);
    return;
  }
  // Measured off a canvas rather than the <img>: getImageData needs a 2D
  // context, and this is the one moment the pixels are already in hand.
  let quality: PhotoQuality | undefined;
  try {
    const probe = document.createElement("canvas");
    probe.width = image.naturalWidth;
    probe.height = image.naturalHeight;
    const pctx = probe.getContext("2d", { willReadFrequently: true });
    if (pctx && probe.width && probe.height) {
      pctx.drawImage(image, 0, 0);
      quality = assessPhotoQuality(probe, landmarks);
    }
  } catch {
    // A tainted or zero-sized canvas is not a reason to refuse the photograph.
    quality = undefined;
  }
  cutaways[at] = { image, landmarks, quality };
  rundownMediaEpoch += 1;
}

function mountCutaways(): void {
  drawCutSlots();
  const input = document.getElementById("q-rundown-broll") as HTMLInputElement | null;
  input?.addEventListener("change", async () => {
    const files = [...(input.files ?? [])];
    input.value = "";
    let at = cutArmed ?? firstFreeCut();
    for (const file of files) {
      if (at < 0) break;
      await addCutaway(file, at);
      at = firstFreeCut();
    }
    cutArmed = null;
    drawCutSlots();
  });

  // CAPTURE phase, and it stops the event dead when it takes it.
  //
  // enablePhotoPaste (ui/pastePhoto.ts) also listens for a paste on the
  // document, and its job is to start a SCAN — ask for the reference
  // population, run the landmarker, produce a report. It is registered first,
  // so on the bubble phase it ran first: pasting a cutaway kicked off a full
  // analysis of a photograph that was never meant to be measured, and asked
  // which sex to measure it against on the way.
  //
  // preventDefault does not help — it stops the browser's default action, not
  // the other listener. Registering in the capture phase is what puts this one
  // ahead regardless of who registered first, and stopImmediatePropagation is
  // what keeps the scan handler from seeing an event this panel has consumed.
  document.addEventListener("paste", async (event) => {
    // Only while this panel is on screen, and only when a slot is armed or free.
    if (!document.getElementById("q-cut-slots")) return;
    const data = (event as ClipboardEvent).clipboardData;
    if (!data) return;
    const images = [...data.files].filter((f) => /^image\//.test(f.type));
    if (!images.length) {
      for (const item of data.items) {
        if (!/^image\//.test(item.type)) continue;
        const file = item.getAsFile();
        if (file) images.push(file);
      }
    }
    if (!images.length) return;
    // No free slot is not "not ours" — it is ours and full. Swallowing it here
    // stops a paste aimed at a full cutaway strip from starting a scan instead.
    event.preventDefault();
    event.stopImmediatePropagation();
    let at = cutArmed ?? firstFreeCut();
    for (const file of images) {
      if (at < 0) break;
      await addCutaway(file, at);
      at = firstFreeCut();
    }
    cutArmed = null;
    drawCutSlots();
  }, true);
}

async function decodeImage(file: File): Promise<HTMLImageElement | null> {
  if (!/^image\//.test(file.type)) return null;
  let url = "";
  try {
    const image = new Image();
    url = URL.createObjectURL(file);
    image.src = url;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("decode failed"));
    });
    return image;
  } catch {
    revokeMediaUrl(url);
    return null;
  }
}

// ---------------------------------------------------------------------------
// The disclaimer's footage: up to four clips sharing one budget.
//
// This is the only point in a rundown where cutting to a duration is possible
// at all. Every other beat is timed by a synthesiser whose real length nobody
// has until the mp3 comes back; the disclaimer's length is derived from its own
// text by spokenSeconds, while it is still being typed.
//
// So the budget is fixed and the clips divide it. Fifteen seconds of talking
// can be five from one clip and ten from another, which is the difference
// between a disclaimer that looks like a held shot and one that looks cut.
//
// Each clip owns two numbers and they are different questions: `startAt` is
// WHERE IN THE SOURCE to begin, and `length` is HOW MUCH OF THE SENTENCE this
// clip covers. Conflating them is the mistake that makes a trimmer confusing —
// one is about the file, the other is about the video being built.
// ---------------------------------------------------------------------------
const DISC_SLOTS = 4;
interface DiscClip {
  video: HTMLVideoElement;
  startAt: number;
  length: number;
}
const discClips: Array<DiscClip | null> = Array(DISC_SLOTS).fill(null);
let rundownMediaEpoch = 0;
let rundownRendering = false;

function revokeMediaUrl(url: string): void {
  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
}

function clearDisclaimerClips(): void {
  for (const clip of discClips) {
    if (clip) revokeMediaUrl(clip.video.src);
  }
  discClips.fill(null);
}

// A creator panel can hold extra photographs and video clips. They belong to
// the scan that opened it, so a new attempt or mode must release both the data
// and its object URLs before another person's result can be shown.
function clearRundownMedia(): void {
  rundownMediaEpoch += 1;
  for (const cutaway of cutaways) {
    if (cutaway) revokeMediaUrl(cutaway.image.src);
  }
  cutaways.fill(null);
  cutArmed = null;
  clearDisclaimerClips();
  discPickInto = 0;
}

/** The voiceover length this footage has to cover, from the typed line. */
function discBudget(): number {
  const note = (document.getElementById("q-rundown-note") as HTMLTextAreaElement | null)?.value ?? "";
  return spokenSeconds(note);
}

const discUsed = () => discClips.reduce((a, c) => a + (c?.length ?? 0), 0);

function drawDiscClips(): void {
  const host = document.getElementById("q-disc-clips");
  const row = document.getElementById("q-disc-row");
  const note = document.getElementById("q-disc-note");
  if (!host || !note) return;

  const budget = discBudget();
  const armed = budget > 0;
  row?.setAttribute("data-armed", armed ? "1" : "0");

  if (!armed) {
    // No line, no footage. A clip attached to a sentence that no longer exists
    // would be rendered under nothing.
    rundownMediaEpoch += 1;
    clearDisclaimerClips();
    host.innerHTML = "";
    note.textContent = "Write the line above first.";
    return;
  }

  const used = discUsed();
  const left = budget - used;
  note.textContent =
    used === 0
      ? `The line runs about ${budget.toFixed(1)}s. Add up to ${DISC_SLOTS} clips to cover it.`
      : left > 0.05
        ? `${used.toFixed(1)}s of ${budget.toFixed(1)}s covered, ${left.toFixed(1)}s still on the last frame.`
        : `${budget.toFixed(1)}s covered. Every second of the line has picture.`;

  host.innerHTML = "";
  discClips.forEach((clip, i) => {
    const cell = document.createElement("div");
    cell.className = "q-disc-cell";
    if (!clip) {
      // Only ever one empty slot offered, right after the last filled one:
      // four empty boxes reads as four required things.
      if (i !== discClips.findIndex((c) => !c)) return;
      cell.innerHTML = `<button type="button" class="q-cut-add"><span>+</span>${
        used === 0 ? "Add a clip" : "Add another"
      }</button>`;
      cell.querySelector("button")!.addEventListener("click", () => {
        discPickInto = i;
        (document.getElementById("q-disc-clip") as HTMLInputElement | null)?.click();
      });
      host.append(cell);
      return;
    }

    const maxLen = Math.min(clip.video.duration - clip.startAt, left + clip.length);
    cell.innerHTML = `
      <video muted playsinline preload="metadata"></video>
      <button type="button" class="q-cut-x" title="Remove">✕</button>
      <div class="q-disc-fields">
        <label>Start
          <input type="range" data-k="start" min="0" step="0.1"
                 max="${Math.max(0, clip.video.duration - 0.2).toFixed(1)}" value="${clip.startAt}" />
          <b>${clip.startAt.toFixed(1)}s</b>
        </label>
        <label>Use
          <input type="range" data-k="len" min="0.5" step="0.1"
                 max="${Math.max(0.5, maxLen).toFixed(1)}" value="${clip.length}" />
          <b>${clip.length.toFixed(1)}s</b>
        </label>
      </div>`;
    const video = cell.querySelector("video")!;
    video.src = clip.video.src;
    video.currentTime = clip.startAt;
    cell.querySelector(".q-cut-x")!.addEventListener("click", () => {
      rundownMediaEpoch += 1;
      revokeMediaUrl(clip.video.src);
      discClips[i] = null;
      // Close the gap so the slots stay contiguous — a hole in the middle would
      // put a clip after a clip that is not there.
      const rest = discClips.filter(Boolean);
      discClips.fill(null);
      rest.forEach((c, n) => (discClips[n] = c));
      drawDiscClips();
    });
    for (const range of cell.querySelectorAll<HTMLInputElement>('input[type="range"]')) {
      range.addEventListener("input", () => {
        rundownMediaEpoch += 1;
        const value = Number(range.value);
        if (range.dataset.k === "start") {
          clip.startAt = value;
          // The scrub preview follows the handle, so the start point is chosen
          // by looking at the frame rather than by guessing a number.
          video.currentTime = value;
          clip.length = Math.min(clip.length, Math.max(0.5, clip.video.duration - value));
        } else {
          clip.length = value;
        }
        drawDiscClips();
      });
    }
    host.append(cell);
  });
}

let discPickInto = 0;

function mountDisclaimerClips(): void {
  drawDiscClips();
  const note = document.getElementById("q-rundown-note") as HTMLTextAreaElement | null;
  note?.addEventListener("input", () => {
    rundownMediaEpoch += 1;
    drawDiscClips();
  });
  const input = document.getElementById("q-disc-clip") as HTMLInputElement | null;
  input?.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    const epoch = rundownMediaEpoch;
    const video = await loadDisclaimerClip(file);
    if (!video) return;
    if (epoch !== rundownMediaEpoch) {
      revokeMediaUrl(video.src);
      return;
    }
    // A new clip takes whatever budget is left, capped by its own length, so
    // attaching one and touching nothing else produces a working video.
    const left = Math.max(0, discBudget() - discUsed());
    const length = Math.max(0.5, Math.min(video.duration, left || video.duration));
    discClips[discPickInto] = { video, startAt: 0, length };
    rundownMediaEpoch += 1;
    drawDiscClips();
  });
}

// Decoded far enough to know its duration and to be seekable. Metadata is
// enough for both — waiting for the whole file would stall the panel on a
// 200MB screen recording for no gain.
async function loadDisclaimerClip(file: File | undefined): Promise<HTMLVideoElement | null> {
  if (!file || !/^video\//.test(file.type)) return null;
  let url = "";
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    url = URL.createObjectURL(file);
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("decode failed"));
    });
    return video;
  } catch {
    revokeMediaUrl(url);
    return null;
  }
}

// The caption panel, under the action row and shared by all three cuts.
//
// A no-op when the node is missing rather than a throw: this runs immediately
// after a file has been saved, and failing there would report the export as
// broken when the only thing wrong is that the panel is not on this screen.
function showCaption(options: Parameters<typeof showCaptionStep>[1]): void {
  const host = document.getElementById("q-caption");
  if (host) showCaptionStep(host, options);
}

/**
 * The photograph, landmarks and numbers an export should be built from.
 *
 * The result screen shows ONE face, so every export used to read the on-screen
 * card: `last` for the picture and the editable cells for the scores. That is
 * right for the face on screen and wrong for the other one — a Reel Creator run
 * measures two, and the before is held in memory with nothing on screen to read
 * it off. Passing the source explicitly is what lets the same two functions
 * render either half.
 */
interface ExportSource {
  photo: HTMLCanvasElement;
  lm: NormalizedLandmark[];
  scores: ReturnType<typeof editedExportScores>;
}

/**
 * The before half of a Reel Creator run, as an export source.
 *
 * Its scores come from the REPORT, not from the cells — the cells hold the
 * after. A creator who nudges a number on screen is editing the face they can
 * see, and silently applying that edit to the other one would produce a
 * before/after where the movement is partly typed.
 */
function beforeSource(): ExportSource | null {
  if (!beforeScan) return null;
  const r = beforeScan.report;
  return {
    photo: beforeScan.photo,
    lm: beforeScan.lm,
    scores: {
      overall: r.overall,
      percentile: r.overallPercentile,
      // Same order the grid uses, so the two files lay out identically and can
      // be cut against each other without the rows dancing.
      regions: [...r.regions]
        .sort((a, b) => b.score - a.score)
        .map((g) => ({ name: REGION_NAMES[g.region], score: g.score })),
    },
  };
}

// Two cuts of the same scan. The breakdown explains the product; the verdict
// travels further. Which one is being built only changes the renderer and the
// button label — the footage, the landmarks and the scores are identical, so
// the two files can never tell a different story about one face.
async function downloadVideo(
  r: Report,
  // Never "dual": that cut has its own entry point on the Calibrate verdict
  // screen, because only Calibrate holds the side assets it needs.
  variant: Exclude<QuickVariant, "dual">,
  // Which face, and which button is reporting on it. Omitted for the face on
  // screen, which is what every caller but the before/after row wants.
  from?: { source: ExportSource; buttonId: string; idle: string; tag: string },
): Promise<void> {
  const source: ExportSource | null =
    from?.source ?? (last ? { photo: last.photo, lm: last.lm, scores: editedExportScores(r) } : null);
  if (!source) return;
  const id = from?.buttonId ?? (variant === "verdict" ? "q-verdict-download" : "q-video-download");
  const idle = from?.idle ?? (variant === "verdict" ? "Verdict MP4" : "Breakdown MP4");
  const btn = document.getElementById(id) as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Building video…";
  }
  try {
    const outcome = await downloadQuickVideo(
      source.photo,
      source.lm,
      r.sex,
      source.scores,
      (progress) => {
        if (btn) btn.textContent = `Building · ${Math.round(progress * 100)}%`;
      },
      variant,
    );
    // A dismissed share sheet is a "no", not a save: saying "downloaded" then
    // would send somebody looking through their camera roll for a file that is
    // not there.
    if (outcome === "cancelled") {
      if (btn) btn.textContent = "Not saved, tap to retry";
    } else {
      if (btn) btn.textContent = outcomeMessage(outcome);
      track("quick-video-downloaded");
      // The words to post it with, next to the file that was just saved. This
      // step existed only inside the before/after producer, so the two cuts an
      // operator actually publishes most often dropped them at a saved MP4 with
      // nothing to paste under it.
      // The caption describes the FILE that was just saved. On a before export
      // that is the before's numbers — captioning it with the after's would
      // hand somebody a post whose text argues with its own video.
      const subject = from && beforeScan ? beforeScan.report : r;
      showCaption({
        kind: variant,
        overall: source.scores.overall,
        percentile: source.scores.percentile,
        potential: subject.potential,
      });
      offerProducer(r);
    }
  } catch (error) {
    console.error(error);
    if (btn) btn.textContent = "MP4 unavailable here";
  } finally {
    if (btn) {
      window.setTimeout(() => {
        btn.disabled = false;
        btn.textContent = idle;
      }, 2200);
    }
  }
}

// The endcard.
//
// Eighteen seconds of the operator's own footage and then this, which makes it
// the cheapest of the four formats by a distance — the clips already exist and
// this card is the entire product placement.
//
// The name field doubles as the caption when it is filled in, so a before/after
// pair can be labelled BEFORE and AFTER without a second control. Left empty it
// simply renders without one.
async function downloadScoreCard(
  r: Report,
  // The before half, when that is what is being rendered. Same reasoning as
  // downloadVideo: the result screen shows one face and a Reel Creator run
  // measured two, so the other one has to be handed in.
  from?: { report: Report; photo: HTMLCanvasElement; lm: NormalizedLandmark[]; buttonId: string; idle: string },
): Promise<void> {
  if (!from && !last) return;
  const btn = document.getElementById(from?.buttonId ?? "q-card-download") as HTMLButtonElement | null;
  const caption = (document.getElementById("q-rundown-name") as HTMLInputElement | null)?.value.trim();
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Rendering…";
  }
  try {
    const { renderScoreCard } = await import("./ui/scoreCard.js");
    const canvas = document.createElement("canvas");
    // Anything outside the scale is a typo, not an earlier scan, and a card
    // built from a typo is worse than one without a comparison.
    // A Reel Creator run already measured the before photo, so the comparison
    // fills itself in and the operator never retypes a number they have just
    // been shown. The field still wins when it holds something valid — a scan
    // from a previous session is a legitimate before, and only the person
    // running it knows that.
    const raw = Number((document.getElementById("q-card-before") as HTMLInputElement | null)?.value);
    const typed = Number.isFinite(raw) && raw > 0 && raw <= 10 ? raw : undefined;
    // The before card carries NO comparison. A "before" that is itself drawn
    // against an earlier score is two comparisons in one image and neither of
    // them is the one the pair is about; it shows now versus ceiling, which is
    // the opening card of a glow-up video and exactly what the before is for.
    const previousOverall = from ? undefined : (typed ?? beforeScan?.report.overall);
    renderScoreCard(canvas, from?.photo ?? last!.photo, from?.lm ?? last!.lm, {
      report: from?.report ?? r,
      caption: caption || undefined,
      previousOverall,
    });
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("The card would not encode.");
    const outcome = await saveFile(blob, exportName("card", "png", from ? "before" : "after"), "card");
    if (btn) {
      btn.textContent = outcome === "cancelled" ? "Not saved, tap to retry" : outcomeMessage(outcome);
    }
    if (outcome !== "cancelled") track("quick-card-downloaded");
  } catch (error) {
    console.error(error);
    if (btn) btn.textContent = "Card unavailable here";
  } finally {
    if (btn) {
      window.setTimeout(() => {
        btn.disabled = false;
        btn.textContent = from?.idle ?? "Score card PNG";
      }, 2200);
    }
  }
}

// The long cut: a full walk down the face, narrated, about a minute.
//
// Unlike the other two this one talks to the network — speech synthesis needs a
// key the browser must never hold. A provider failure stops before rendering:
// a silent rundown has neither the promised narration nor useful captions, so
// presenting it as a successful export would hide the thing the operator must
// fix before publishing.
async function downloadRundown(r: Report): Promise<void> {
  if (!last || rundownRendering) return;
  const source = last;
  const mediaEpoch = rundownMediaEpoch;
  const btn = document.getElementById("q-rundown-download") as HTMLButtonElement | null;
  const field = document.getElementById("q-rundown-name") as HTMLInputElement | null;
  const name = (field?.value ?? "").trim();
  const shortName =
    (document.getElementById("q-rundown-short") as HTMLInputElement | null)?.value.trim() || undefined;
  const opening =
    (document.getElementById("q-rundown-opening") as HTMLInputElement | null)?.value.trim() || undefined;
  if (!name) {
    // Point at the missing thing rather than explaining it. The field is six
    // inches from the button that was just pressed.
    field?.focus();
    if (btn) {
      btn.textContent = "Name it first ↑";
      window.setTimeout(() => (btn.textContent = "Rundown MP4"), 2000);
    }
    return;
  }

  rundownRendering = true;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Starting…";
  }
  try {
    // Cutaways, each carrying its own landmark cloud so the analysis can play
    // out ON them (rundownFrame's stage system). They never touch the scoring
    // or the report — the landmarks position lines, the values stay the
    // measured photograph's. Any photo that missed its landmarking when it was
    // attached gets one more chance here, when the engine is certainly up.
    const broll = cutaways.filter((c): c is Cutaway => !!c);
    for (const c of broll) {
      if (!c.landmarks) c.landmarks = await landmarkCutaway(c.image);
      if (mediaEpoch !== rundownMediaEpoch || source !== last) throw new RundownCancelled();
    }
    drawCutSlots();
    const note = (document.getElementById("q-rundown-note") as HTMLTextAreaElement | null)?.value.trim() || undefined;
    // The token is what gets past the staff gate on /api/tts. Absent for a
    // signed-out operator, which is not an error here — it means no voice.
    const accessToken = (await currentAccessToken()) ?? undefined;
    const cutChoice = (document.getElementById("q-rundown-cut") as HTMLSelectElement | null)?.value;
    const result = await downloadRundownVideo(source.photo, source.lm, r, {
      name,
      shortName,
      opening,
      note,
      broll,
      cut: cutChoice === "full" ? "full" : "short",
      disclaimer: discClips.some(Boolean)
        ? { clips: discClips.filter((c): c is DiscClip => !!c) }
        : undefined,
      accessToken,
      onProgress: (progress, stage) => {
        if (btn) btn.textContent = `${stage} · ${Math.round(progress * 100)}%`;
      },
      shouldCancel: () => mediaEpoch !== rundownMediaEpoch || source !== last,
    });
    if (result.outcome === "cancelled") {
      if (btn) btn.textContent = "Not saved, tap to retry";
    } else {
      // Say when it came out silent. An operator who does not notice until the
      // edit has wasted the whole render, and the fix is usually just signing
      // in — so the message has to name the cause, not just the symptom.
      if (btn) {
        btn.textContent = result.narrated
          ? outcomeMessage(result.outcome)
          : `${outcomeMessage(result.outcome)}: no voiceover`;
        // Which service actually spoke. The fallback voice is a different
        // narrator; an operator who hears it should learn that here rather
        // than assume the default changed.
        if (result.narrated && result.voiceProvider === "openai") {
          btn.textContent = `${outcomeMessage(result.outcome)}, fallback voice`;
        }
      }
      track("quick-rundown-downloaded");
      showCaption({
        kind: "rundown",
        overall: r.overall,
        percentile: r.overallPercentile,
        potential: r.potential,
        // The operator already typed a name for the render; asking twice is the
        // kind of small friction that stops a step being used.
        name,
      });
    }
  } catch (error) {
    console.error(error);
    // A blocked capture is not a failure of the exporter, it is the exporter
    // refusing to publish a number it cannot stand behind. Say which.
    if (btn) {
      btn.textContent =
        // The reasons, not a guess at them. RundownBlocked has carried the
        // actual blocker list all along and this printed "too tilted"
        // regardless — so a rundown refused because a cap hid the hairline
        // sent the operator off to re-shoot a head angle that was fine.
        error instanceof RundownBlocked
          ? error.blockers.join(" ")
          : error instanceof RundownCancelled
            ? error.message
          : error instanceof NarrationFailed
            // Every voice service failed. Stopping here rather than rendering
            // is deliberate: a silent rundown also has no captions, and the
            // export it produces looks broken, not minimal. The message names
            // which providers refused and why.
            ? error.message
            : "Rundown unavailable here";
    }
  } finally {
    rundownRendering = false;
    if (btn) {
      window.setTimeout(() => {
        btn.disabled = false;
        btn.textContent = "Rundown MP4";
      }, 2600);
    }
  }
}

// Create Reel opens the beat panel — the TikTok creator now. The old
// fixed-length producer asked the operator to guess clip durations, which is
// the exact question the beat panel exists to make unaskable; keeping both
// meant maintaining two answers to one problem, one of them wrong.
//
// A Reel Creator pair run rides its before scan along, so the analysis
// segment can play as the glow-up: the before card, then the after card
// counting up out of the before score. The current scan is always the LATER
// one here — reel mode only reaches the results screen on the after photo.
function openCurrentProducer(r: Report): void {
  if (!last) return;
  const before = beforeSource();
  const analysis = {
    photo: last.photo,
    landmarks: last.lm,
    sex: r.sex,
    // There is only one editable result grid and it belongs to the AFTER
    // photograph; the held before source owns its own report-derived number.
    scores: editedExportScores(r),
    before: before
      ? { photo: before.photo, landmarks: before.lm, scores: before.scores }
      : undefined,
  };
  void import("./ui/beatReelPanel.js").then((m) => m.openBeatReelPanel(analysis));
}

// Downloads still call this hook. The editor is now already present, so the
// hook simply keeps the old call sites harmless rather than inserting a second
// button with the same id.
function offerProducer(_r: Report): void {
  return;
}

// Download the card as a PNG. The stage is the whole reveal (photo + cards), so
// a screenshot of it is the shareable image. The motion is captured by screen
// recording; this is the still, for a thumbnail or a static post.
async function downloadCard(): Promise<void> {
  const btn = document.getElementById("q-download") as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Rendering image…";
  }
  try {
    const { toPng } = await import("html-to-image");
    const bg = getComputedStyle(document.body).backgroundColor || "#f4f3ee";
    const url = await toPng(el.stage, { pixelRatio: 2, backgroundColor: bg, cacheBust: true });
    // Same route as the videos: on a phone the share sheet puts this in the
    // camera roll, where a still meant for a post actually needs to be.
    await saveFile(await (await fetch(url)).blob(), exportName("scan", "png"), "scan");
  } catch {
    if (btn) btn.textContent = "Couldn't render";
  } finally {
    if (btn && btn.textContent !== "Couldn't render") {
      btn.disabled = false;
      btn.textContent = canShareFiles("image/png") ? "Save image" : "Download image";
    }
  }
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

// ---------------------------------------------------------------------------
// AI Model Reel — character setup.
//
// The two ratings steer the prompt; they are not a contract. The generator has
// never heard of this engine's percentile tables, so asking for a 4.5 produces
// a face that reads roughly that way to a person, and the scanner may well
// disagree by a point in either direction. Saying so before the first
// generation costs one sentence. Discovering it afterwards costs a session of
// wondering why the tool is broken when it is behaving exactly as it must.
// ---------------------------------------------------------------------------
let aiSex: Sex = "female";

function renderAiNote(): void {
  const before = Number((document.getElementById("q-ai-before") as HTMLInputElement).value);
  const after = Number((document.getElementById("q-ai-after") as HTMLInputElement).value);
  const gap = after - before;
  // A gap this wide stops being a glow-up and starts being a different person,
  // which is the one failure this format cannot survive: the whole claim of a
  // before/after is that the bones underneath did not change.
  const wide = gap >= 3.5;
  el.aiNote.innerHTML = wide
    ? `<b>${before.toFixed(1)} → ${after.toFixed(1)} is a wide jump.</b> The after is generated first
       at the level you set here, and the before is that same face with the chips applied. A gap this
       wide applies them heavily, which starts to read as a different person rather than the same one
       improved. The scan still decides the number.`
    : `The after is generated first at the level you set here, then the before is that same face with
       the chips applied. The generator has never seen our percentile tables, so the scan may land a
       point either side.`;
}

for (const b of el.aiSex.querySelectorAll<HTMLButtonElement>("button")) {
  b.onclick = () => {
    for (const other of el.aiSex.querySelectorAll("button")) other.classList.toggle("on", other === b);
    aiSex = b.dataset.v === "male" ? "male" : "female";
  };
}

for (const id of ["q-ai-before", "q-ai-after"]) {
  document.getElementById(id)!.addEventListener("input", renderAiNote);
}

el.aiBack.onclick = () => leaveMode();

el.aiForm.onsubmit = async (event) => {
  event.preventDefault();
  const name = (document.getElementById("q-ai-name") as HTMLInputElement).value.trim();
  const desc = (document.getElementById("q-ai-desc") as HTMLTextAreaElement).value.trim();
  if (!name || !desc) return;

  // Saved BEFORE the request, not after. Generation is the slow, billable and
  // failable half; the character is the half worth keeping either way, and
  // losing a description because an image service was rate limited is the kind
  // of thing that stops somebody using a tool.
  saveAiCharacter({ name, sex: aiSex, description: desc, flaws: selectedFlawIds() });

  const beforeScore = Number((document.getElementById("q-ai-before") as HTMLInputElement).value);
  const afterScore = Number((document.getElementById("q-ai-after") as HTMLInputElement).value);
  const fullBody = (document.getElementById("q-ai-fullbody") as HTMLInputElement | null)?.checked === true;

  const go = document.getElementById("q-ai-go") as HTMLButtonElement | null;
  el.aiMsg.classList.remove("err");
  // The after comes first now, and saying so matters: four images take a while
  // and a status line naming the wrong one reads as a stuck request.
  el.aiMsg.textContent = fullBody ? "Making the after, then three more…" : "Making the after…";
  if (go) {
    go.disabled = true;
    go.textContent = "Generating…";
  }
  try {
    const token = await currentAccessToken();
    const response = await fetch("/api/ai-image", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        sex: aiSex,
        description: desc,
        flaws: selectedFlawIds(),
        // SENT NOW. These two inputs sat under a note claiming they steered the
        // prompt and were never put in the body, so asking for an eight and
        // getting a five was the form talking to itself.
        beforeScore,
        afterScore,
        fullBody,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      before?: string;
      after?: string;
      beforeBody?: string | null;
      afterBody?: string | null;
      error?: string;
    };
    if (!response.ok || !payload.before || !payload.after) {
      el.aiMsg.classList.add("err");
      el.aiMsg.textContent = payload.error ?? "The pair could not be generated.";
      return;
    }
    el.aiMsg.textContent = "";
    showAiPair(name, payload.before, payload.after, payload.beforeBody, payload.afterBody);
  } catch {
    el.aiMsg.classList.add("err");
    el.aiMsg.textContent = "Could not reach the image service.";
  } finally {
    if (go) {
      go.disabled = false;
      go.textContent = "Generate the preview pair";
    }
  }
};

/**
 * A data URL to a Blob, decoded in place.
 *
 * NOT `await fetch(dataUrl)`, which is what this used to do and why Save did
 * nothing. The production CSP allows data: on img-src, so the previews render,
 * and does NOT allow it on connect-src, which is what governs fetch. So every
 * save was blocked by the policy, rejected inside an async click handler, and
 * disappeared into an unhandled rejection: no file, no error, no clue.
 *
 * Decoding the base64 ourselves needs no network permission at all, which also
 * makes it correct on any future tightening of connect-src.
 */
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  const header = dataUrl.slice(0, comma);
  const mime = /data:([^;]+)/.exec(header)?.[1] ?? "image/jpeg";
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * The file extension the image actually is.
 *
 * Hardcoded as "png" until the route began asking the provider for JPEG, so
 * every saved frame carried a name that disagreed with its own bytes. Reading
 * it off the data URL means the two can never drift again.
 */
function extensionOf(dataUrl: string): string {
  return /^data:image\/png/i.test(dataUrl) ? "png" : "jpg";
}

/**
 * One frame: the picture, its caption, and the two things you can do to it.
 *
 * Tap the picture to enlarge. Redo asks what to change and regenerates only
 * this frame, which is the difference between liking three of four images and
 * having to spend another render on all of them.
 */
function aiFrame(key: string, caption: string): string {
  return `<figure>
    <button type="button" class="q-ai-zoom" data-zoom="${key}" aria-label="Enlarge the ${caption.toLowerCase()}">
      <img data-pair="${key}" />
    </button>
    <figcaption>${caption}</figcaption>
    <button type="button" class="q-ai-redo" data-redo="${key}">Redo this one</button>
  </figure>`;
}

/**
 * The enlarged view.
 *
 * A generated face is judged on detail that a 160px preview cannot show, so
 * approving one at preview size is guessing. Escape and a tap on the backdrop
 * both close it, because a lightbox with only a small × is a trap on a phone.
 */
function openAiLightbox(src: string, alt: string): void {
  const wrap = document.createElement("div");
  wrap.className = "q-ai-light";
  wrap.innerHTML = `<button type="button" class="q-ai-light-close" aria-label="Close">✕</button><img alt="" />`;
  const image = wrap.querySelector("img")!;
  image.src = src;
  image.alt = alt;
  const close = () => {
    wrap.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };
  wrap.onclick = (event) => {
    if (event.target === wrap || (event.target as HTMLElement).classList.contains("q-ai-light-close")) close();
  };
  document.addEventListener("keydown", onKey);
  document.body.appendChild(wrap);
}

/**
 * The scene set: the approved character, filmed.
 *
 * Ten stills, five before and five after, generated ONE AT A TIME. Sequential
 * rather than parallel for two reasons that both matter: the route bills a slot
 * per scene and firing ten at once would spend a month's quota before the first
 * result came back, and a set that fills in frame by frame lets an operator
 * abandon a bad character after two rather than after ten.
 *
 * Stills before clips, deliberately. A clip costs many times a still and takes
 * minutes rather than seconds, so approving a set of stills first is what makes
 * the eventual video step cheap: an approved still IS the clip's first frame,
 * so identity is locked before anything expensive happens.
 */
/**
 * One scene shot, requested.
 *
 * Shared by the initial run and by a redo, so a rerolled frame is built the
 * same way as the one it replaces rather than by a second code path that can
 * drift from it.
 */
async function filmOne(
  want: { scene: string; side: "before" | "after" },
  anchor: string,
  description: string,
  token: string | null,
  change = "",
): Promise<string | { error: string }> {
  try {
    const response = await fetch("/api/ai-image", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        mode: "scene",
        scene: want.scene,
        side: want.side,
        anchor,
        change,
        sex: aiSex,
        description,
        flaws: selectedFlawIds(),
        beforeScore: Number((document.getElementById("q-ai-before") as HTMLInputElement).value),
        afterScore: Number((document.getElementById("q-ai-after") as HTMLInputElement).value),
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { frame?: string; error?: string };
    if (!response.ok || !payload.frame) return { error: payload.error ?? "That shot could not be made." };
    return payload.frame;
  } catch {
    return { error: "Could not reach the image service." };
  }
}

async function makeSceneSet(name: string, anchor: string, host: HTMLElement): Promise<void> {
  const scenes = scenesFor(aiSex);
  const shots: Array<{ scene: string; side: "before" | "after"; src: string }> = [];
  const grid = host.querySelector<HTMLElement>("[data-scene-grid]");
  const status = host.querySelector<HTMLElement>("[data-scene-status]");
  const desc = (document.getElementById("q-ai-desc") as HTMLTextAreaElement).value.trim();

  const paint = () => {
    if (!grid) return;
    grid.innerHTML = shots
      .map(
        (shot, index) => `<figure>
          <button type="button" class="q-ai-zoom" data-scene-zoom="${index}"><img data-scene-shot="${index}" /></button>
          <figcaption>${escapeHtml(shot.scene.replace(/-/g, " "))} · ${shot.side}</figcaption>
          <input type="text" class="q-ai-change" data-scene-change="${index}"
                 placeholder="change something (optional)" maxlength="240" />
          <div class="q-ai-shot-actions">
            <button type="button" class="q-ai-redo" data-scene-redo="${index}">Redo</button>
            <button type="button" class="q-ai-redo" data-scene-save="${index}">Save</button>
          </div>
        </figure>`,
      )
      .join("");
    for (const [index, shot] of shots.entries()) {
      const image = grid.querySelector<HTMLImageElement>(`[data-scene-shot="${index}"]`);
      if (image) {
        image.src = shot.src;
        image.alt = `${name}, ${shot.scene}, ${shot.side}`;
      }
    }
    for (const button of grid.querySelectorAll<HTMLButtonElement>("[data-scene-zoom]")) {
      button.onclick = () => {
        const shot = shots[Number(button.dataset.sceneZoom)];
        if (shot) openAiLightbox(shot.src, `${name}, ${shot.scene}`);
      };
    }
    for (const button of grid.querySelectorAll<HTMLButtonElement>("[data-scene-redo]")) {
      button.onclick = async () => {
        const index = Number(button.dataset.sceneRedo);
        const shot = shots[index];
        if (!shot) return;
        // The box is OPTIONAL, and that is the whole interaction. Empty means
        // "this one just came out wrong, roll it again"; filled means "this one
        // is close, change that". Making the operator type something to reroll
        // would turn the commonest case into the most work.
        const change = grid.querySelector<HTMLInputElement>(`[data-scene-change="${index}"]`)?.value.trim() ?? "";
        button.disabled = true;
        button.textContent = "…";
        if (status) status.textContent = `Redoing ${shot.scene.replace(/-/g, " ")}, ${shot.side}…`;
        try {
          const again = await filmOne(
            { scene: shot.scene, side: shot.side },
            anchor,
            desc,
            await currentAccessToken(),
            change,
          );
          if (typeof again === "string") {
            shots[index] = { ...shot, src: again };
            paint();
            if (status) status.textContent = "";
          } else if (status) {
            status.textContent = again.error;
          }
        } finally {
          button.disabled = false;
          button.textContent = "Redo";
        }
      };
    }

    for (const button of grid.querySelectorAll<HTMLButtonElement>("[data-scene-save]")) {
      button.onclick = async () => {
        const shot = shots[Number(button.dataset.sceneSave)];
        if (!shot) return;
        try {
          await saveFile(
            dataUrlToBlob(shot.src),
            exportName("card", extensionOf(shot.src), `${shot.scene}-${shot.side}`),
            "card",
          );
        } catch (error) {
          if (status) status.textContent = `Could not save that one. ${(error as Error).message}`;
        }
      };
    }
  };

  const token = await currentAccessToken();
  const wanted: Array<{ scene: string; side: "before" | "after" }> = [];
  for (const side of ["after", "before"] as const) {
    for (const scene of scenes) wanted.push({ scene: scene.id, side });
  }

  for (const [index, want] of wanted.entries()) {
    if (status) status.textContent = `Filming ${index + 1} of ${wanted.length}: ${want.scene.replace(/-/g, " ")}, ${want.side}…`;
    const result = await filmOne(want, anchor, desc, token);
    if (typeof result !== "string") {
      // STOPS rather than grinding on. The likeliest failure is the quota, and
      // carrying on would spend fifteen more requests learning the same thing
      // while the operator watches.
      if (status) status.textContent = result.error;
      return;
    }
    shots.push({ scene: want.scene, side: want.side, src: result });
    paint();
  }
  if (status) status.textContent = `${shots.length} shots. Save the ones you want, or change the character and film it again.`;
}

// The pair, side by side, each downloadable.
//
// Downloadable individually rather than as one composite: these are the INPUT
// to the Reel Creator, which wants two separate photographs to scan, not a
// picture of two photographs.
function showAiPair(
  name: string,
  before: string,
  after: string,
  beforeBody?: string | null,
  afterBody?: string | null,
): void {
  const host = document.getElementById("q-ai-preview");
  if (!host) return;
  const isImageData = (value: string) => /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+=*$/i.test(value);
  // Every frame is checked, not just the first two. A second pair arriving
  // unvalidated would be the one place a crafted data URL could reach an
  // <img src>, which is exactly what this guard exists to stop.
  const frames = [before, after, beforeBody, afterBody].filter((v): v is string => typeof v === "string");
  if (!frames.every(isImageData)) {
    el.aiMsg.classList.add("err");
    el.aiMsg.textContent = "The image service returned an unsafe image response.";
    return;
  }
  const hasBody = typeof beforeBody === "string" && typeof afterBody === "string";
  host.classList.remove("hidden");
  // The full-length pair sits UNDER the portrait pair rather than replacing it:
  // the portrait is what the reel opens on, and the body shot is there to show
  // what the described build actually produced before anybody films with it.
  host.innerHTML = `
    <div class="q-ai-pair">
      ${aiFrame("before", "BEFORE")}
      ${aiFrame("after", "AFTER")}
    </div>
    <div class="q-ai-pair-actions">
      <button type="button" class="btn pri" data-save="before">Save the before</button>
      <button type="button" class="btn pri" data-save="after">Save the after</button>
    </div>
    ${
      hasBody
        ? `<div class="q-ai-pair">
             ${aiFrame("beforeBody", "BEFORE, FULL LENGTH")}
             ${aiFrame("afterBody", "AFTER, FULL LENGTH")}
           </div>
           <div class="q-ai-pair-actions">
             <button type="button" class="btn" data-save="beforeBody">Save the full-length before</button>
             <button type="button" class="btn" data-save="afterBody">Save the full-length after</button>
           </div>`
        : ""
    }
    <p class="q-ai-note">Scan the two portraits in Reel Creator to get the measured before/after.
    The full-length shots are the character reference: plain black, so the scenes can dress them.</p>
    ${
      hasBody
        ? `<div class="q-ai-scenes">
             <h3>Film this character</h3>
             <p class="q-ai-note">Five scenes as the after and the same five as the before, from the
             full-length shot above. Stills first: each one is also the first frame a clip would be
             made from, so the face is locked before anything is animated. One render per shot.</p>
             <button type="button" class="btn pri" data-film>Film the set</button>
             <p class="q-ai-note" data-scene-status></p>
             <div class="q-ai-scene-grid" data-scene-grid></div>
           </div>`
        : `<p class="q-ai-note">Tick the full-length pair to unlock the scene set: the scenes are
           built from the full-length shot.</p>`
    }`;
  const sources: Record<string, string> = { before, after };
  if (hasBody) {
    sources.beforeBody = beforeBody as string;
    sources.afterBody = afterBody as string;
  }
  const labels: Record<string, string> = {
    before: `${name}, before`,
    after: `${name}, after`,
    beforeBody: `${name}, before, full length`,
    afterBody: `${name}, after, full length`,
  };
  for (const [key, src] of Object.entries(sources)) {
    const image = host.querySelector<HTMLImageElement>(`[data-pair="${key}"]`);
    if (!image) continue;
    image.src = src;
    image.alt = labels[key];
  }
  const film = host.querySelector<HTMLButtonElement>("[data-film]");
  if (film) {
    film.onclick = async () => {
      film.disabled = true;
      film.textContent = "Filming…";
      try {
        // The AFTER full-length frame is the anchor. It carries the face, the
        // build and the neutral outfit every scene is about to replace.
        await makeSceneSet(name, sources.afterBody ?? sources.after, host);
      } finally {
        film.disabled = false;
        film.textContent = "Film the set again";
      }
    };
  }

  for (const button of host.querySelectorAll<HTMLButtonElement>("[data-zoom]")) {
    button.onclick = () => {
      const key = button.dataset.zoom ?? "before";
      openAiLightbox(sources[key] ?? before, labels[key] ?? name);
    };
  }

  for (const button of host.querySelectorAll<HTMLButtonElement>("[data-redo]")) {
    button.onclick = async () => {
      const key = button.dataset.redo ?? "before";
      const instruction = window.prompt(
        `What should change about the ${(labels[key] ?? key).replace(`${name}, `, "")}?\n` +
          "Describe the change only. The face, the framing and the lighting are held.",
        "",
      );
      if (instruction === null) return;
      const asked = instruction.trim();
      if (!asked) return;

      button.disabled = true;
      button.textContent = "Redoing…";
      el.aiMsg.classList.remove("err");
      el.aiMsg.textContent = "Redoing that one…";
      try {
        const token = await currentAccessToken();
        const response = await fetch("/api/ai-image", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          // The ANCHOR is the after portrait, always, whichever frame is being
          // redone. It is the root the whole set descends from, so sending it
          // is what stops a redo quietly becoming a different person.
          body: JSON.stringify({
            mode: "redo",
            frame: key,
            instruction: asked,
            anchor: sources.after,
            current: sources[key],
            sex: aiSex,
            description: (document.getElementById("q-ai-desc") as HTMLTextAreaElement).value.trim(),
            flaws: selectedFlawIds(),
            beforeScore: Number((document.getElementById("q-ai-before") as HTMLInputElement).value),
            afterScore: Number((document.getElementById("q-ai-after") as HTMLInputElement).value),
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as { frame?: string; error?: string };
        if (!response.ok || !payload.frame) {
          el.aiMsg.classList.add("err");
          el.aiMsg.textContent = payload.error ?? "That frame could not be redone.";
          return;
        }
        // Re-render the whole set with the one frame swapped, so the redone
        // image is what every button below it now saves and zooms.
        el.aiMsg.textContent = "";
        showAiPair(
          name,
          key === "before" ? payload.frame : before,
          key === "after" ? payload.frame : after,
          key === "beforeBody" ? payload.frame : beforeBody,
          key === "afterBody" ? payload.frame : afterBody,
        );
      } catch {
        el.aiMsg.classList.add("err");
        el.aiMsg.textContent = "Could not reach the image service.";
      } finally {
        button.disabled = false;
        button.textContent = "Redo this one";
      }
    };
  }

  for (const button of host.querySelectorAll<HTMLButtonElement>("[data-save]")) {
    button.onclick = async () => {
      const key = button.dataset.save ?? "before";
      const which = sources[key] ?? before;
      const label = button.textContent ?? "Save";
      button.disabled = true;
      try {
        await saveFile(dataUrlToBlob(which), exportName("card", extensionOf(which), key), "card");
        el.aiMsg.classList.remove("err");
        el.aiMsg.textContent = "Saved.";
      } catch (error) {
        // SURFACED, not swallowed. This handler is async, so a rejection had
        // nowhere to go but the console: pressing Save did nothing at all and
        // said nothing about it, which is indistinguishable from a dead button.
        el.aiMsg.classList.add("err");
        el.aiMsg.textContent = `That image could not be saved. ${(error as Error).message}`;
      } finally {
        button.disabled = false;
        button.textContent = label;
      }
    };
  }
  host.scrollIntoView({ behavior: "smooth", block: "start" });
}

// The flaw chips, painted once from the catalogue.
//
// From the catalogue rather than typed into the markup so the list, the prompt
// fragments and the tests cannot drift: adding a chip is one entry in one file.
function paintFlawChips(): void {
  const host = document.getElementById("q-ai-flaws");
  if (!host || host.childElementCount) return;
  host.innerHTML = FACE_FLAWS.map(
    (f) => `<button type="button" class="q-flaw" data-flaw="${f.id}">${f.label}</button>`,
  ).join("");
  host.addEventListener("click", (ev) => {
    const chip = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-flaw]");
    if (chip) chip.classList.toggle("on");
  });
}

/** The chips currently lit, as catalogue ids for the server to resolve. */
function selectedFlawIds(): string[] {
  return [...document.querySelectorAll<HTMLElement>("#q-ai-flaws .q-flaw.on")]
    .map((el) => el.dataset.flaw ?? "")
    .filter(Boolean);
}

// The library the operator was promised: describe somebody once, film them
// again next week. Local for now, because a character is a prompt and a name —
// there is nothing here worth a round trip until the generator is wired up.
interface AiCharacter {
  name: string;
  sex: Sex;
  description: string;
  /**
   * What the BEFORE shot should show, as catalogue ids.
   *
   * The description is what stays the same across the pair (face, hair, age,
   * build) because a before/after where the person changes is not a before and
   * after. This is the half that is meant to disappear.
   *
   * IDS RATHER THAN PROSE, and that was a correction. A free-text field here
   * fed straight into both prompts, so "a narrow jaw" could be typed into the
   * before and then asked to be CLEARED in the after: the structural pair the
   * flaw catalogue exists to prevent, reachable by typing. See
   * src/engine/faceFlawCatalog.ts.
   *
   * There is deliberately no equivalent for the after. "Glowed up" is the
   * absence of these rather than a list of its own, and asking somebody to
   * describe an improvement twice is how the two shots stop looking like one
   * person.
   */
  flaws?: string[];
}

const AI_CHARACTERS_KEY = "truemax.aiCharacters";

function saveAiCharacter(character: AiCharacter): void {
  try {
    const key = scopedStorageKey(AI_CHARACTERS_KEY);
    if (!key) return;
    const raw = JSON.parse(localStorage.getItem(key) ?? "[]") as AiCharacter[];
    const next = [character, ...raw.filter((c) => c.name !== character.name)].slice(0, 24);
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* storage disabled: the character lives for this session only */
  }
}

// The before and after, next to each other.
//
// A Reel Creator run measured two faces and then showed one set of cards, which
// is the wrong answer to the question the mode exists to ask. The operator did
// not scan twice to see the second number; they scanned twice to see the pair.
//
// Both photographs and both scores, side by side, with the movement between
// them stated once rather than left as arithmetic for the viewer. This sits
// above the full card set rather than replacing it — the after scan still gets
// its complete breakdown underneath, because that is what the video's closing
// segment is built from.
function comparisonHTML(before: Report, after: Report): string {
  const move = after.overall - before.overall;
  // Signed explicitly. A before/after that quietly renders a drop as though it
  // were a gain is the one thing that would make this tool untrustworthy to the
  // person using it, and going down is a real outcome of a real rescan.
  const sign = move > 0 ? "+" : move < 0 ? "−" : "";
  const dir = move > 0 ? "up" : move < 0 ? "down" : "flat";

  // BOTH ANALYSES, not just both headline scores.
  //
  // This mode scans two faces and then showed one of them. The strip said 4.7 →
  // 6.1 and the eight-region grid underneath belonged entirely to the after, so
  // the question every before/after actually raises — WHICH PART moved — had no
  // answer anywhere on the page, even though the engine had measured it twice
  // and was holding both sets.
  //
  // Joined on the region rather than zipped by position: the grid above sorts
  // by score, and a face whose ranking changed between the two scans would
  // otherwise have its jaw compared against its cheekbones.
  const rows = regionMoves(before, after)
    .map(
      (m) => `
        <tr data-dir="${m.direction}">
          <th scope="row">${m.label}</th>
          <td>${m.before === null ? "–" : m.before.toFixed(1)}</td>
          <td>${m.after.toFixed(1)}</td>
          <td class="q-cmp-delta">${moveLabel(m)}</td>
        </tr>`,
    )
    .join("");

  return `
    <div class="q-compare" data-dir="${dir}">
      <div class="q-compare-side">
        <span class="q-compare-tag">BEFORE</span>
        <b>${before.overall.toFixed(1)}</b>
        <span class="q-compare-rank">${rankShort(before.overallPercentile)}</span>
      </div>
      <div class="q-compare-move">
        <span>${sign}${Math.abs(move).toFixed(1)}</span>
      </div>
      <div class="q-compare-side">
        <span class="q-compare-tag">AFTER</span>
        <b>${after.overall.toFixed(1)}</b>
        <span class="q-compare-rank">${rankShort(after.overallPercentile)}</span>
      </div>
    </div>
    <div class="q-cmp">
      <table class="q-cmp-table">
        <thead>
          <tr><th scope="col">Region</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Move</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <!-- The before, on its own.
           The buttons further down the page render the face on screen, which is
           the after: so the before existed only inside the joined cut and
           could not be taken into an edit. These are the same two exports
           pointed at the other half, for somebody assembling the video
           themselves rather than using the producer. -->
      <div class="q-cmp-get">
        <span class="q-klabel">THE BEFORE, ON ITS OWN</span>
        <div class="q-cmp-buttons">
          <button type="button" class="btn gho" id="q-before-video">Before breakdown MP4</button>
          <button type="button" class="btn gho" id="q-before-verdict">Before verdict MP4</button>
          <button type="button" class="btn gho" id="q-before-card">Before score card PNG</button>
        </div>
        <small>Every other export on this page renders the after.</small>
      </div>
    </div>`;
}

// Current score, then the ceiling.
//
// This is the number that sells the product, and it belongs on the content tool
// for exactly that reason: somebody watching a stranger get scanned does not
// buy because the stranger measured 4.7, they buy because the stranger could
// reach 6.4 and they want to know their own version of that figure. The
// measurement is the hook and the ceiling is the offer.
//
// It is still marked as a projection — "COULD REACH" rather than a second
// score, at a smaller weight, after an arrow. Not to hedge it: a decent
// projection is exciting whether or not somebody lands on it, and hedged copy
// would waste that. It is so the two numbers cannot be confused for the same
// KIND of thing on a screen that gets paused and screenshotted, because the
// left one is measured from a photograph and the right one is modelled.
//
// Suppressed when the ceiling is not meaningfully above the score. "Could reach
// 5.1" under a 5.0 reads as the product having nothing to offer, which is worse
// than saying nothing — and for a face already near its own ceiling, nothing is
// the honest answer.
const POTENTIAL_MIN_GAP = 0.3;

function potentialHTML(r: Report): string {
  const gap = r.potential - r.overall;
  if (!Number.isFinite(gap) || gap < POTENTIAL_MIN_GAP) return "";
  return `
    <div class="q-potential">
      <span class="q-potential-arrow" aria-hidden="true">→</span>
      <div class="q-potential-fig">
        <span class="q-klabel">COULD REACH</span>
        <b><span class="q-num" data-target="${r.potential.toFixed(1)}">0.0</span></b>
        <span class="q-potential-gap">+${gap.toFixed(1)} to gain</span>
      </div>
    </div>`;
}
