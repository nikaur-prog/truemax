import { initLandmarker, detect, isReady } from "./engine/landmarker.ts";
import { assessQuality } from "./engine/quality.ts";
import { analyze } from "./engine/scoring.ts";
import { compareAndStore } from "./engine/history.ts";
import { toCelebEntry } from "./engine/celebs.ts";
import type { Report, Sex } from "./engine/types.ts";
import { drawLandmarksAnimated, drawCalm } from "./ui/overlay.ts";
import { renderResults, renderSideResults } from "./ui/results.ts";
import { toggleMute } from "./ui/audio.ts";
import { openSideCapture, close as closeSide } from "./ui/sideFlow.ts";

const MAX_IMAGE_DIM = 1280;

const el = {
  engineStatus: document.getElementById("engine-status")!,
  upload: document.getElementById("v-upload")!,
  main: document.getElementById("v-main")!,
  fileInput: document.getElementById("file-input") as HTMLInputElement,
  drop: document.getElementById("drop")!,
  frame: document.getElementById("frame")!,
  zoomable: document.getElementById("zoomable")!,
  photoCanvas: document.getElementById("photo-canvas") as HTMLCanvasElement,
  overlayCanvas: document.getElementById("overlay-canvas") as HTMLCanvasElement,
  capRight: document.getElementById("capRight")!,
  status: document.getElementById("status")!,
  barFill: document.getElementById("barFill")!,
  qualityChips: document.getElementById("quality-chips")!,
  analysis: document.getElementById("analysis")!,
  mute: document.getElementById("mute")!,
};

let selectedSex: Sex = "male";

for (const btn of document.querySelectorAll<HTMLButtonElement>(".sex-option")) {
  btn.addEventListener("click", () => {
    selectedSex = btn.dataset.sex as Sex;
    for (const b of document.querySelectorAll<HTMLButtonElement>(".sex-option")) {
      b.classList.toggle("selected", b === btn);
      b.setAttribute("aria-checked", String(b === btn));
    }
  });
}

el.mute.addEventListener("click", () => {
  el.mute.textContent = toggleMute() ? "🔇" : "🔊";
});

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
el.drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  el.drop.classList.add("dragover");
});
el.drop.addEventListener("dragleave", () => el.drop.classList.remove("dragover"));
el.drop.addEventListener("drop", (e) => {
  e.preventDefault();
  el.drop.classList.remove("dragover");
  const file = (e as DragEvent).dataTransfer?.files?.[0];
  if (file && file.type.startsWith("image/")) handleFile(file);
});

function resetToUpload(): void {
  el.main.classList.add("hidden");
  el.upload.classList.remove("hidden");
  el.mute.classList.add("hidden");
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
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.round(image.naturalWidth * scale);
  const height = Math.round(image.naturalHeight * scale);
  el.photoCanvas.width = width;
  el.photoCanvas.height = height;
  el.photoCanvas.getContext("2d")!.drawImage(image, 0, 0, width, height);

  el.upload.classList.add("hidden");
  el.main.classList.remove("hidden");
  el.mute.classList.remove("hidden");
  el.frame.classList.add("scanning");
  el.capRight.textContent = "SCANNING";
  el.analysis.innerHTML = "";
  el.qualityChips.innerHTML = "";
  await nextFrame();

  // Real math (milliseconds) happens inside the theatre beat (~2.2s)
  const result = detect(el.photoCanvas);
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

  const report = analyze(landmarks, width, height, selectedSex);
  const delta = compareAndStore(report);

  el.frame.classList.remove("scanning");
  el.capRight.textContent = "ANALYZED";
  el.status.textContent = "";
  el.barFill.style.width = "0";
  drawCalm(el.overlayCanvas, landmarks, width, height);
  renderQualityChips(quality.issues);

  renderResults({
    report,
    delta,
    landmarks,
    photoW: width,
    photoH: height,
    analysis: el.analysis,
    zoomable: el.zoomable,
    overlay: el.overlayCanvas,
    onNewPhoto: resetToUpload,
    onSideProfile: () => startSide(report),
  });

  exposeDev(report, landmarks, quality);
}

function startSide(frontReport: Report): void {
  el.main.classList.add("hidden");
  openSideCapture({
    sex: frontReport.sex,
    onBack: () => el.main.classList.remove("hidden"),
    onDone: (sideReport) => {
      closeSide();
      el.main.classList.remove("hidden");
      renderSideResults(sideReport, () => startSide(frontReport));
      (window as unknown as Record<string, unknown>).__truemaxSide = sideReport;
    },
  });
}

function renderQualityChips(issues: string[]): void {
  el.qualityChips.innerHTML = issues.length
    ? issues.map((i) => `<span class="qchip warn">${i}</span>`).join("")
    : `<span class="qchip">Capture quality: good</span>`;
}

function exposeDev(report: Report, landmarks: unknown, quality: unknown): void {
  (window as unknown as Record<string, unknown>).__truemax = {
    report,
    landmarks,
    quality,
    // Console helper for building the celebrity DB from real scans:
    // copy(window.__truemax.celebEntry("Name")) → paste into src/engine/celebs.ts
    celebEntry: (name: string) => toCelebEntry(report, name),
  };
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

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}
