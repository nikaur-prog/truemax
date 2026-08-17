import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { initLandmarker, isReady, setRunningMode } from "./engine/landmarker.js";
import { detectStable } from "./engine/consensus.js";
import { assessQuality } from "./engine/quality.js";
import { analyze } from "./engine/scoring.js";
import { aggregateScoreToPercentile } from "./engine/scoring.js";
import { REGION_NAMES, REGION_RELIABLE_MIN } from "./engine/scoring.js";
import { isSupported, startCamera } from "./ui/camera.js";
import type { CameraHandle } from "./ui/camera.js";
import { rankShort } from "./ui/templates.js";
import { storeSex, storedSex } from "./engine/sexPref.js";
import { enablePhotoPaste, pasteHintApplies } from "./ui/pastePhoto.js";
import { track } from "./engine/track.js";
import { drawQuickSilhouette } from "./ui/quickSilhouette.js";
import { openSexChooser } from "./ui/sexChooser.js";
import { loadVerdictTone, verdictForPercentile } from "./engine/analysisMode.js";
import { askVerdictTone } from "./ui/tonePrompt.js";
import { drawLandmarksAnimated } from "./ui/overlay.js";
import type { Report, Sex } from "./engine/types.js";
import { downloadQuickVideo, renderQuickVideoFrame } from "./ui/quickVideoExport.js";
import { clearFaces, deleteFace, faceToCanvas, listFaces, saveFace } from "./engine/faceLibrary.js";
import type { QuickVariant } from "./ui/quickVideoExport.js";
import { RundownBlocked, downloadRundownVideo } from "./ui/rundownExport.js";
import { spokenSeconds } from "./engine/reelScript.js";
import {
  addRatedFace,
  clearCalibrationSet,
  corpusJSON,
  loadCalibrationSet,
  missingCoverage,
  removeRatedFace,
  setHealth,
} from "./engine/calibrationSet.js";
import { currentAccessToken } from "./engine/auth.js";
import { openProducer } from "./ui/quickProducer.js";
import { canShareFiles, saveFile } from "./ui/saveFile.js";
import { allowQuickAccess, denyQuickAccess } from "./ui/quickGate.js";
import { copyDiagnostics } from "./ui/diagnostics.js";

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

const MAX_DIM = 1280;

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
void allowQuickAccess().then((allowed) => {
  if (!allowed) {
    denyQuickAccess();
    return;
  }
  document.querySelector(".q-wrap")?.classList.remove("q-locked");
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

async function loadPreviewPhoto(): Promise<void> {
  const response = await fetch("/demo/michael-b-jordan.jpg");
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
  if (cam || !isSupported()) return;
  el.frame.classList.add("live");
  try {
    cam = await startCamera({
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
  } catch {
    el.frame.classList.remove("live");
    el.hintTitle.textContent = "Camera unavailable";
    el.hintDetail.textContent = "Upload a photo instead";
    return;
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
track("quick-visit");

// The strip is populated before anything else happens, so a producer opening
// the page mid-session sees their faces immediately rather than after a scan.
void refreshLibrary();
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

async function useFile(f: File): Promise<void> {
  stopCamera();
  const img = await loadImage(f);
  const s = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * s);
  c.height = Math.round(img.naturalHeight * s);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  await run(c);
}

function stopCamera(): void {
  if (!cam) return;
  cam.stop();
  cam = null;
  el.frame.classList.remove("live");
  // Hand the detector back to still-image mode. Everything past this point
  // works on stills, and leaving it in VIDEO mode makes them throw — the same
  // bug the main flow hit.
  void setRunningMode("IMAGE");
}

async function run(src: HTMLCanvasElement): Promise<void> {
  if (!isReady()) return;
  await setRunningMode("IMAGE");
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

function enterMode(next: QuickMode): void {
  mode = next;
  beforeScan = null;
  reelStage = "before";
  el.pillars.classList.add("hidden");

  // Nothing is photographed in the AI flow, so it gets its own screen rather
  // than the capture screen with a notice bolted on. Leaving the camera up
  // was worse than an unfinished feature: it told somebody to do something
  // that could not possibly help them.
  if (next === "ai") {
    el.ai.classList.remove("hidden");
    el.capture.classList.add("hidden");
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
  el.modeStep.textContent =
    reelStage === "before" ? "Step 1 of 2 — the before photo" : "Step 2 of 2 — the after photo";
}

function leaveMode(): void {
  mode = null;
  beforeScan = null;
  reelStage = "before";
  el.capture.classList.add("hidden");
  el.result.classList.add("hidden");
  el.ai.classList.add("hidden");
  el.cal.classList.add("hidden");
  el.pillars.classList.remove("hidden");
}

for (const button of document.querySelectorAll<HTMLButtonElement>(".q-pillar")) {
  button.onclick = () => enterMode(button.dataset.mode as QuickMode);
}
el.modeBack.onclick = () => leaveMode();
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

function renderRatingStep(r: Report): void {
  el.calStep.textContent = "Your rating";
  el.calBody.innerHTML = `
    <div class="q-cal-rate">
      <p class="q-cal-ask">Before you see what it said — what is this face, out of ten?</p>
      <div class="q-cal-input">
        <input type="number" id="q-cal-num" min="1" max="10" step="0.1" inputmode="decimal"
               placeholder="6.4" autocomplete="off" />
        <input type="text" id="q-cal-label" placeholder="Label (optional, never exported)"
               maxlength="40" autocomplete="off" />
        <button type="button" class="btn pri" id="q-cal-save">Lock it in</button>
      </div>
      <p class="q-cal-hint">Whole face, one number, gut answer. Use the ends of the scale —
      a set where everybody sits between 4.5 and 6 cannot settle anything, which is exactly
      how the men in the current corpus ended up useless.</p>
      <p class="q-cal-msg" id="q-cal-msg" role="status"></p>
    </div>`;

  const num = document.getElementById("q-cal-num") as HTMLInputElement;
  const label = document.getElementById("q-cal-label") as HTMLInputElement;
  const msg = document.getElementById("q-cal-msg")!;
  num.focus();
  const commit = () => {
    const rating = Number(num.value);
    if (!(rating >= 1 && rating <= 10)) {
      msg.textContent = "A number between 1 and 10.";
      num.focus();
      return;
    }
    addRatedFace(r, Math.round(rating * 10) / 10, label.value.trim() || undefined);
    renderVerdictStep(r, Math.round(rating * 10) / 10);
  };
  document.getElementById("q-cal-save")!.onclick = commit;
  num.onkeydown = (event) => { if (event.key === "Enter") commit(); };
}

function renderVerdictStep(r: Report, rating: number): void {
  const gap = r.overall - rating;
  // Named rather than left as a number. "−2.3" is a figure; "the engine is
  // two points below you on this face" is the thing worth acting on, and the
  // whole set is a list of these.
  const verdict =
    Math.abs(gap) < 0.6 ? "agrees with you" : gap > 0 ? "is too generous here" : "is too harsh here";
  el.calStep.textContent = "Saved";
  el.calBody.innerHTML = `
    <div class="q-cal-verdict">
      <div class="q-cal-pair">
        <div><span>YOU</span><b>${rating.toFixed(1)}</b></div>
        <div class="q-cal-gap">${gap >= 0 ? "+" : ""}${gap.toFixed(1)}</div>
        <div><span>ENGINE</span><b>${r.overall.toFixed(1)}</b></div>
      </div>
      <p class="q-cal-said">It ${verdict}.</p>
      <div class="q-actions">
        <button class="btn pri" id="q-cal-next">Next face</button>
        <button class="btn gho" id="q-cal-list">See the set</button>
      </div>
    </div>`;
  document.getElementById("q-cal-next")!.onclick = () => {
    el.cal.classList.add("hidden");
    el.capture.classList.remove("hidden");
  };
  document.getElementById("q-cal-list")!.onclick = () => renderCalibrationSet();
}

function renderCalibrationSet(): void {
  // The set is the one screen with no face in flight, so arriving here always
  // ends the current one.
  resetSexAsk();
  const faces = loadCalibrationSet();
  el.calStep.textContent = `${faces.length} face${faces.length === 1 ? "" : "s"}`;
  const health = (["male", "female"] as const).map((sex) => setHealth(faces, sex));
  const missing = missingCoverage(faces);

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
          ? `<p class="q-cal-missing">No face in this set carries ${missing.join(", ")} yet —
             those stay on a prior until one does.</p>`
          : ""
      }
      ${
        faces.length
          ? `<div class="q-cal-rows">
              <div class="q-cal-row q-cal-head"><span>FACE</span><span>YOU</span><span>ENGINE</span><span>GAP</span><span></span></div>
              ${[...faces]
                .sort((a, b) => Math.abs(b.scored - b.rating) - Math.abs(a.scored - a.rating))
                .map((f) => {
                  const gap = f.scored - f.rating;
                  return `<div class="q-cal-row">
                    <span>${f.label ? escapeHtml(f.label) : f.id}</span>
                    <span>${f.rating.toFixed(1)}</span>
                    <span>${f.scored.toFixed(1)}</span>
                    <span class="${Math.abs(gap) >= 1.5 ? "bad" : ""}">${gap >= 0 ? "+" : ""}${gap.toFixed(1)}</span>
                    <button type="button" class="linkish" data-drop="${f.id}">remove</button>
                  </div>`;
                })
                .join("")}
            </div>`
          : `<p class="q-cal-empty">Nothing yet. Scan a face and give it a number.</p>`
      }
      <div class="q-actions">
        <button class="btn pri" id="q-cal-add">Add a face</button>
        <button class="btn gho" id="q-cal-copy"${faces.length ? "" : " disabled"}>Copy corpus JSON</button>
        <button class="btn gho" id="q-cal-clear"${faces.length ? "" : " disabled"}>Clear the set</button>
      </div>
      <p class="q-cal-hint">Copy pastes straight over src/engine/calibration/corpus.json.
      Rows sort by disagreement, so the faces the engine is worst at are at the top.</p>
      <p class="q-cal-msg" id="q-cal-msg" role="status"></p>
    </div>`;

  document.getElementById("q-cal-add")!.onclick = () => {
    resetSexAsk();
    el.cal.classList.add("hidden");
    el.capture.classList.remove("hidden");
  };
  for (const button of el.calBody.querySelectorAll<HTMLButtonElement>("[data-drop]")) {
    button.onclick = () => { removeRatedFace(button.dataset.drop!); renderCalibrationSet(); };
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
      msg.textContent = "Clipboard refused — select and copy from the box.";
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
    renderRatingStep(r);
    return;
  }

  // Reel Creator: the first scan is not a result, it is half of a comparison.
  // Showing the full card set here would be a dead end — the operator would
  // have to work out for themselves that they are meant to go round again.
  if (mode === "reel" && reelStage === "before" && last) {
    beforeScan = { report: r, photo, lm: last.lm };
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
  const verdict = verdictForPercentile(r.overallPercentile, r.sex, loadVerdictTone() ?? "blunt");
  const dimorphism = r.sex === "female" ? "FEMININITY" : "MASCULINITY";
  const micro: Array<[string, number]> = [
    ["FACE", r.overallPercentile],
    ["ANGULARITY", Math.max(1, Math.min(99, Math.round((r.pillars.Angularity ?? 5) * 10)))],
    [dimorphism, Math.max(1, Math.min(99, Math.round((r.pillars.Dimorphism ?? 5) * 10)))],
    ["HARMONY", Math.max(1, Math.min(99, Math.round((r.pillars.Harmony ?? 5) * 10)))],
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
              <div class="q-unit-bar"><i data-w="${value}" style="width:0%"></i></div>
              <b>${value}</b>
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
         "Earlier score for a t" — and a placeholder is the wrong place for the
         only explanation anyway, because it vanishes the moment somebody types
         into the field it was explaining. -->
    <div class="q-namerow">
      <label class="q-namefield">
        <span>Whose face is this?</span>
        <input id="q-rundown-name" class="q-input" type="text" maxlength="48"
               placeholder="LeBron James" autocomplete="off" />
        <small>Used in the rundown's opening line.</small>
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

    <div class="q-actions">
      <button class="btn pri" id="q-download">${canShareFiles("image/png") ? "Save image" : "Download image"}</button>
      <button class="btn pri" id="q-video-download">Breakdown MP4</button>
      <button class="btn pri" id="q-verdict-download">Verdict MP4</button>
      <button class="btn pri" id="q-rundown-download">Rundown MP4</button>
      <!-- Calibration, not a user feature. A screenshot of the region cards
           says the jaw is wrong; only the metric table says WHICH jaw metric,
           by how far, and whether the ideal or the spread is at fault. -->
      <button class="btn gho" id="q-diagnostics">Copy diagnostics</button>
      <button class="btn pri" id="q-card-download">Score card PNG</button>
      <button class="btn gho" id="q-save-face">Save to library</button>
      <button class="btn gho" id="q-again">New photo</button>
    </div>`;

  // Stagger index for the drop, so the cards arrive in reading order rather
  // than all at once.
  [...el.cards.children].forEach((c, i) => (c as HTMLElement).style.setProperty("--i", String(i)));

  wireEditing();

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
  document.getElementById("q-video-download")!.onclick = () => void downloadVideo(r, "breakdown");
  document.getElementById("q-verdict-download")!.onclick = () => void downloadVideo(r, "verdict");
  document.getElementById("q-rundown-download")!.onclick = () => void downloadRundown(r);

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
        ? `Adds about ${seconds.toFixed(1)}s of voiceover — find roughly that much extra footage.`
        : "Read out verbatim just before the call to action.";
    };
    noteField.addEventListener("input", update);
    update();
  }
  document.getElementById("q-diagnostics")!.onclick = async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const label = (document.getElementById("q-rundown-name") as HTMLInputElement | null)?.value.trim() ?? "";
    const copied = await copyDiagnostics(r, label);
    // Says which of the two things happened. "Copied" over a clipboard write
    // that silently failed is the one outcome that wastes somebody's scan.
    button.textContent = copied ? "Copied — paste it back" : "Copy from the box";
    window.setTimeout(() => (button.textContent = "Copy diagnostics"), 2600);
  };
  document.getElementById("q-card-download")!.onclick = () => void downloadScoreCard(r);
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
// to 0.0–9.9, and refills the bar under a region score so the edit stays
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
      const v = Math.max(0, Math.min(9.9, parseFloat(n.textContent ?? "") || 0));
      n.textContent = v.toFixed(1);
      const bar = n.parentElement?.querySelector<HTMLElement>(".q-bar i");
      if (bar) bar.style.width = `${Math.max(2, Math.min(100, v * 10))}%`;
      if (n.classList.contains("q-score-num")) {
        const pct = aggregateScoreToPercentile(v);
        const rank = el.cards.querySelector<HTMLElement>(".q-rank");
        if (rank) rank.textContent = rankShort(pct);
      }
    });
  }
}

function editedExportScores(r: Report): { overall: number; percentile: number; regions: Array<{ name: string; score: number }> } {
  const overall = parseFloat(el.cards.querySelector<HTMLElement>(".q-score-num")?.textContent ?? "") || r.overall;
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

// Two cuts of the same scan. The breakdown explains the product; the verdict
// travels further. Which one is being built only changes the renderer and the
// button label — the footage, the landmarks and the scores are identical, so
// the two files can never tell a different story about one face.
async function downloadVideo(r: Report, variant: QuickVariant): Promise<void> {
  if (!last) return;
  const id = variant === "verdict" ? "q-verdict-download" : "q-video-download";
  const idle = variant === "verdict" ? "Verdict MP4" : "Breakdown MP4";
  const btn = document.getElementById(id) as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Building video…";
  }
  try {
    const outcome = await downloadQuickVideo(
      last.photo,
      last.lm,
      r.sex,
      editedExportScores(r),
      (progress) => {
        if (btn) btn.textContent = `Building · ${Math.round(progress * 100)}%`;
      },
      variant,
    );
    // A dismissed share sheet is a "no", not a save: saying "downloaded" then
    // would send somebody looking through their camera roll for a file that is
    // not there.
    if (outcome === "cancelled") {
      if (btn) btn.textContent = "Not saved — tap to retry";
    } else {
      if (btn) btn.textContent = outcome === "shared" ? "Sent to your share sheet" : "MP4 downloaded";
      track("quick-video-downloaded");
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
async function downloadScoreCard(r: Report): Promise<void> {
  if (!last) return;
  const btn = document.getElementById("q-card-download") as HTMLButtonElement | null;
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
    const previousOverall = typed ?? beforeScan?.report.overall;
    renderScoreCard(canvas, last.photo, last.lm, {
      report: r,
      caption: caption || undefined,
      previousOverall,
    });
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("The card would not encode.");
    const outcome = await saveFile(blob, `truemax-card-${Date.now()}.png`);
    if (btn) {
      btn.textContent =
        outcome === "cancelled"
          ? "Not saved — tap to retry"
          : outcome === "shared"
            ? "Sent to your share sheet"
            : "Card downloaded";
    }
    if (outcome !== "cancelled") track("quick-card-downloaded");
  } catch (error) {
    console.error(error);
    if (btn) btn.textContent = "Card unavailable here";
  } finally {
    if (btn) {
      window.setTimeout(() => {
        btn.disabled = false;
        btn.textContent = "Score card PNG";
      }, 2200);
    }
  }
}

// The long cut: a full walk down the face, narrated, about a minute.
//
// Unlike the other two this one talks to the network — speech synthesis needs a
// key the browser must never hold — so it is the only export that can be
// degraded rather than simply working. It never fails for that reason though:
// no session, no quota or a refused key all produce a silent rundown with its
// sound effects intact, and the button says so. A finished composite is worth
// far more than a strict guarantee about its audio.
async function downloadRundown(r: Report): Promise<void> {
  if (!last) return;
  const btn = document.getElementById("q-rundown-download") as HTMLButtonElement | null;
  const field = document.getElementById("q-rundown-name") as HTMLInputElement | null;
  const name = (field?.value ?? "").trim();
  const note = (document.getElementById("q-rundown-note") as HTMLTextAreaElement | null)?.value.trim() || undefined;
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

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Starting…";
  }
  try {
    // The token is what gets past the staff gate on /api/tts. Absent for a
    // signed-out operator, which is not an error here — it means no voice.
    const accessToken = (await currentAccessToken()) ?? undefined;
    const result = await downloadRundownVideo(last.photo, last.lm, r, {
      name,
      note,
      accessToken,
      onProgress: (progress, stage) => {
        if (btn) btn.textContent = `${stage} · ${Math.round(progress * 100)}%`;
      },
    });
    if (result.outcome === "cancelled") {
      if (btn) btn.textContent = "Not saved — tap to retry";
    } else {
      // Say when it came out silent. An operator who does not notice until the
      // edit has wasted the whole render, and the fix is usually just signing
      // in — so the message has to name the cause, not just the symptom.
      if (btn) {
        btn.textContent = result.narrated
          ? result.outcome === "shared"
            ? "Sent to your share sheet"
            : "Rundown downloaded"
          : "Downloaded — no voiceover";
      }
      track("quick-rundown-downloaded");
    }
  } catch (error) {
    console.error(error);
    // A blocked capture is not a failure of the exporter, it is the exporter
    // refusing to publish a number it cannot stand behind. Say which.
    if (btn) {
      btn.textContent =
        error instanceof RundownBlocked ? "Capture too tilted for a rundown" : "Rundown unavailable here";
    }
  } finally {
    if (btn) {
      window.setTimeout(() => {
        btn.disabled = false;
        btn.textContent = "Rundown MP4";
      }, 2600);
    }
  }
}

// Offered after a reel is built rather than as a fourth button up front: the
// producer needs footage the person has to go and choose, so the moment they
// have just watched their own analysis render is the moment the ask lands.
// Inserted once; a new scan re-renders the card and clears it naturally.
function offerProducer(r: Report): void {
  if (!last || document.getElementById("q-produce")) return;
  const actions = el.cards.querySelector(".q-actions");
  if (!actions) return;
  const bar = document.createElement("div");
  bar.className = "q-produce-offer";
  bar.innerHTML = `<span>Would you like to make a TikTok out of it? Before clips, your analysis, after clips — one video.</span>
    <button class="btn pri" id="q-produce">Make a TikTok →</button>`;
  actions.insertAdjacentElement("afterend", bar);
  (bar.querySelector("#q-produce") as HTMLButtonElement).onclick = () => {
    if (!last) return;
    // A Reel Creator run holds the before scan, so the producer can bracket the
    // footage with both measurements instead of putting one in the middle. The
    // current scan is always the LATER one here — reel mode only reaches the
    // results screen on the after photo — so the stored scan is the opening.
    openProducer(
      beforeScan
        ? {
            photo: beforeScan.photo,
            landmarks: beforeScan.lm,
            sex: r.sex,
            scores: editedExportScores(beforeScan.report),
            after: { photo: last.photo, landmarks: last.lm, scores: editedExportScores(r) },
          }
        : { photo: last.photo, landmarks: last.lm, sex: r.sex, scores: editedExportScores(r) },
    );
  };
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
    await saveFile(await (await fetch(url)).blob(), `truemax-scan-${Date.now()}.png`);
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
    ? `<b>${before.toFixed(1)} → ${after.toFixed(1)} is a wide jump.</b> Past about three points the
       generator tends to hand back a different face rather than the same one improved, and the
       comment section spots that instantly. These numbers steer the prompt; the scan decides.`
    : `These numbers steer the prompt — the generator has never seen our percentile tables, so the
       scan may land a point either side. The pair is built to keep one face throughout.`;
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

el.aiForm.onsubmit = (event) => {
  event.preventDefault();
  const name = (document.getElementById("q-ai-name") as HTMLInputElement).value.trim();
  const desc = (document.getElementById("q-ai-desc") as HTMLTextAreaElement).value.trim();
  if (!name || !desc) return;
  // Generation is a server capability and this deployment may not have it. Say
  // which, in the same shape as every other unconfigured service in the
  // product, rather than spinning on a request that cannot succeed.
  el.aiMsg.classList.add("err");
  el.aiMsg.textContent =
    "Image generation is not configured on this deployment yet — the character is saved, but the preview pair has to be generated outside the app for now.";
  saveAiCharacter({ name, sex: aiSex, description: desc });
};

// The library the operator was promised: describe somebody once, film them
// again next week. Local for now, because a character is a prompt and a name —
// there is nothing here worth a round trip until the generator is wired up.
interface AiCharacter {
  name: string;
  sex: Sex;
  description: string;
}

const AI_CHARACTERS_KEY = "truemax.aiCharacters";

function saveAiCharacter(character: AiCharacter): void {
  try {
    const raw = JSON.parse(localStorage.getItem(AI_CHARACTERS_KEY) ?? "[]") as AiCharacter[];
    const next = [character, ...raw.filter((c) => c.name !== character.name)].slice(0, 24);
    localStorage.setItem(AI_CHARACTERS_KEY, JSON.stringify(next));
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
