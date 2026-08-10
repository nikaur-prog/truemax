import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { initLandmarker, isReady, setRunningMode } from "./engine/landmarker.ts";
import { detectStable } from "./engine/consensus.ts";
import { assessQuality } from "./engine/quality.ts";
import type { QualityCheck } from "./engine/quality.ts";
import { analyze } from "./engine/scoring.ts";
import { POSE_CALIBRATION, buildGeometry } from "./engine/geometry.ts";
import { extractShape, shapeSubset } from "./engine/shape.ts";
import { compareAndStore } from "./engine/history.ts";
import { toCelebEntry } from "./engine/celebs.ts";
import { readOrientation } from "./engine/exif.ts";
import type { Report, Sex } from "./engine/types.ts";
import { drawLandmarksAnimated, drawCalm } from "./ui/overlay.ts";
import { renderResults } from "./ui/results.ts";
import { mergeReports } from "./engine/scoring.ts";
import { openSideCapture, close as closeSide } from "./ui/sideFlow.ts";
import { isSupported, permissionGranted, startCamera } from "./ui/camera.ts";
import { mountDemoReel } from "./ui/demoReel.ts";
import { mountFaceOutline } from "./ui/faceOutline.ts";
import type { CameraHandle } from "./ui/camera.ts";
import type { FrameCheck } from "./engine/captureGuide.ts";
import { detectSex } from "./engine/shape.ts";
import { estimateGaze } from "./engine/gaze.ts";
import { openQuiz } from "./ui/goalsQuiz.ts";
import { analyzeSkin } from "./engine/skin.ts";
import { REGION_LANDMARKS } from "./ui/regions.ts";

const MAX_IMAGE_DIM = 1280;

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

// The reference population is always inferred from face shape. Asking people
// to classify themselves before a scan added a decision in front of the only
// thing that matters (taking the photo), and the shape model is the thing
// actually doing the work either way.
let selectedSex: Sex = "male";

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
  const report = analyze(res.faceLandmarks[0], w, h, sex);
  return {
    faceFound: true,
    overall: report.overall,
    potential: report.potential,
    yaw: quality.yawDeg,
    pitch: quality.pitchDeg,
    smile: quality.smileScore,
    gaze: estimateGaze(res.faceLandmarks[0]),
    skin: analyzeSkin(c, res.faceLandmarks[0], w, h),
    // Group shots are the main contaminant in scraped photo sets: the
    // detector locks onto whichever face it finds, which may not be the
    // subject. A face filling little of the frame is the tell.
    faceWidthFrac: quality.faceWidthFrac,
    entry: JSON.parse(toCelebEntry(report, "x")),
    zScores: report.zScores,
    shape: extractShape(buildGeometry(res.faceLandmarks[0], w, h)),
    pillars: report.pillars,
    // Per-region score plus the centroid of that region's landmarks, so the
    // demo reel can point a callout at the actual spot on the face
    regions: report.regions.map((r) => {
      const ids = REGION_LANDMARKS[r.region];
      const lm = res.faceLandmarks[0];
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

// The idealized silhouette is a framing guide for the camera, not landing art
let outline: ReturnType<typeof mountFaceOutline> | null = null;
function showGuide(sex: Sex): void {
  outline = outline ?? mountFaceOutline(el.outlineCanvas, sex);
  outline.morphTo(sex);
}

document.getElementById("q-open")!.addEventListener("click", () => openQuiz(() => {}, "pre"));

initLandmarker()
  .then(() => {
    el.engineStatus.textContent = "ENGINE READY — 478-POINT MODEL LOADED";
    el.engineStatus.classList.add("ready");
  })
  .catch((err) => {
    console.error(err);
    el.engineStatus.textContent = "ENGINE FAILED TO LOAD — REFRESH TO RETRY";
    el.engineStatus.classList.add("error");
  });

el.fileInput.addEventListener("change", () => {
  const file = el.fileInput.files?.[0];
  if (file) handleFile(file);
});
el.btnUpload.addEventListener("click", () => el.fileInput.click());
el.ovalFrame.addEventListener("dragover", (e) => {
  e.preventDefault();
  el.ovalFrame.classList.add("dragover");
});
el.ovalFrame.addEventListener("dragleave", () => el.ovalFrame.classList.remove("dragover"));
el.ovalFrame.addEventListener("drop", (e) => {
  e.preventDefault();
  el.ovalFrame.classList.remove("dragover");
  const file = (e as DragEvent).dataTransfer?.files?.[0];
  if (file) handleFile(file);
});

// ---- camera ----
let cam: CameraHandle | null = null;
let lastCheck: FrameCheck | null = null;

async function openCamera(): Promise<void> {
  if (!isSupported()) {
    el.camHintDetail.textContent = "This browser can't open a camera — upload a photo instead.";
    return;
  }
  const desktop = !matchMedia("(pointer: coarse)").matches;
  el.camHintTitle.textContent = "Allow camera access";
  el.camHintDetail.textContent = desktop
    ? "Your browser will ask at the top of the window — choose Allow"
    : "Tap Allow when your browser asks";
  try {
    cam = await startCamera({
      video: el.camVideo,
      guideCanvas: el.camGuide,
      onCheck: (c) => {
        lastCheck = c;
        el.camHintTitle.textContent = c.hint;
        el.camHintDetail.textContent = c.detail;
        el.camHint.classList.toggle("ready", c.ready);
        el.camHint.classList.toggle("red", c.status === "red");
        el.camHint.classList.toggle("amber", c.status === "amber");
        el.camLamp.className = `lamp ${c.status === "green" ? "green" : c.status}`;
        el.camLampFill.className = c.status === "green" ? "green" : c.status;
        el.camLampFill.style.width = `${Math.round((c.status === "green" ? 1 : c.progress) * 100)}%`;
        el.ovalFrame.classList.toggle("ready", c.ready);
        el.ovalFrame.classList.toggle("tracking", c.gates.face);
        el.btnCamera.disabled = !c.ready;
      },
      onSex: (sex) => showGuide(sex),
    });
    el.ovalFrame.classList.add("live");
    el.stage.classList.add("live-cam");
    // Headline and hints collapse so the preview can take the space — the
    // camera becomes the subject the moment it is granted.
    el.upload.classList.add("camera-live");
    // Starts on the male silhouette and morphs once the shape vote settles —
    // waiting for the vote would leave the frame empty at the exact moment
    // someone needs help positioning.
    showGuide("male");
    el.camLight.classList.remove("hidden");
    el.btnCancel.classList.remove("hidden");
    el.btnCamera.textContent = "Capture";
    el.btnCamera.disabled = true;
  } catch {
    el.camHintTitle.textContent = "Camera unavailable";
    el.camHintDetail.textContent = "Permission was denied — you can still upload a photo.";
  }
}

// Tear the live preview down and put the landing screen back exactly as it
// was, celebrity reel and all. Shared by capture and cancel so the two can
// never drift apart and leave the page half in camera mode.
async function closeCamera(): Promise<void> {
  cam?.stop();
  cam = null;
  lastCheck = null;
  el.ovalFrame.classList.remove("live", "ready", "tracking");
  el.stage.classList.remove("live-cam");
  el.upload.classList.remove("camera-live");
  el.camLight.classList.add("hidden");
  el.btnCancel.classList.add("hidden");
  el.btnCamera.textContent = "Use camera";
  el.btnCamera.disabled = false;
  el.camHintTitle.textContent = "Take a photo, or upload one";
  el.camHintDetail.textContent = "The camera preview will guide your framing";
  el.camHint.classList.remove("ready", "red", "amber");
  await setRunningMode("IMAGE");
}

el.btnCamera.addEventListener("click", async () => {
  if (!cam) {
    await openCamera();
    return;
  }
  if (!lastCheck?.ready) return;
  const shot = cam.capture();
  await closeCamera();
  if (shot) await handleCanvas(shot);
});

el.btnCancel.addEventListener("click", async () => {
  await closeCamera();
});

// Returning visitors who already granted access get a live preview with no
// second prompt — the guidance starts working before they ask for it.
permissionGranted().then((granted) => {
  if (granted) openCamera();
});

function resetToUpload(): void {
  el.main.classList.add("hidden");
  el.upload.classList.remove("hidden");
  el.zoomable.style.transform = "none";
  el.analysis.innerHTML = "";
  el.qualityChips.innerHTML = "";
  el.fileInput.value = "";
}

const SCAN_STAGES = [
  "Detecting facial landmarks",
  "Normalizing to interpupillary scale",
  "Measuring 31 proportions",
  "Checking bilateral symmetry",
  "Comparing against population",
  "Composing report",
];

async function handleFile(file: File): Promise<void> {
  if (!isReady()) {
    el.engineStatus.textContent = "ENGINE STILL LOADING — ONE MOMENT";
    return;
  }
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

  // The reference population is picked by shape, then stated — an unexplained
  // switch would look like a guess. Resolved before the side step, because the
  // side metrics are scored against the same norms.
  const guess = detectSex(extractShape(buildGeometry(landmarks, width, height)));
  selectedSex = guess?.sex ?? "male";
  pending = {
    landmarks,
    width,
    height,
    quality,
    autoNote: guess ? `Scored against ${guess.sex} norms (auto-detected)` : "",
  };

  // Straight to the profile. A scan is two photographs, and showing a score
  // after the first one taught people the second was optional garnish — the
  // opposite of true, since chin projection, jaw angle and facial convexity
  // have no front-view equivalent at all.
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

// Both photographs are in. One analysis, one reveal, one score.
async function runFullAnalysis(sideReport: Report): Promise<void> {
  if (!pending) return;
  const { landmarks, width, height, quality, autoNote } = pending;
  el.main.classList.remove("hidden");
  el.frame.classList.add("scanning");
  el.capRight.textContent = "SCANNING";
  el.analysis.innerHTML = "";
  await nextFrame();
  const reveal = drawLandmarksAnimated(el.overlayCanvas, landmarks, width, height);

  // Staged status lines, ~360ms each
  await new Promise<void>((done) => {
    let s = 0;
    const step = () => {
      if (s < SCAN_STAGES.length) {
        el.status.innerHTML = `<b>${SCAN_STAGES[s]}</b> …`;
        el.barFill.style.width = `${((s + 1) / SCAN_STAGES.length) * 100}%`;
        s++;
        setTimeout(step, 360);
      } else done();
    };
    setTimeout(step, 200);
  });
  await reveal.done;

  const front = analyze(landmarks, width, height, selectedSex);
  const report = mergeReports(front, sideReport);
  const delta = compareAndStore(report);

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
    onSideProfile: () => startSide(),
  };
  renderResults(ctxArgs);

  exposeDev(report, landmarks, quality);
}

function startSide(): void {
  el.main.classList.add("hidden");
  openSideCapture({
    sex: selectedSex,
    // There is no "back to results" any more, because there are no results yet.
    // The only way out of this step is forward, or starting over.
    onBack: () => resetToUpload(),
    onDone: async (sideReport) => {
      closeSide();
      (window as unknown as Record<string, unknown>).__truemaxSide = sideReport;
      await runFullAnalysis(sideReport);
    },
  });
}

function renderQualityChips(q: QualityCheck, autoNote = ""): void {
  const chips = q.issues.map((i) => `<span class="qchip warn">${i}</span>`);
  if (autoNote) chips.push(`<span class="qchip">${autoNote}</span>`);
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
