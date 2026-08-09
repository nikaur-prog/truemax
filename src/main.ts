import { initLandmarker, detect, isReady } from "./engine/landmarker.ts";
import { assessQuality } from "./engine/quality.ts";
import type { QualityCheck } from "./engine/quality.ts";
import { drawLandmarksAnimated } from "./ui/overlay.ts";

type Sex = "male" | "female";

const MAX_IMAGE_DIM = 1280;

const el = {
  engineStatus: document.getElementById("engine-status")!,
  screenCapture: document.getElementById("screen-capture")!,
  screenDetect: document.getElementById("screen-detect")!,
  fileInput: document.getElementById("file-input") as HTMLInputElement,
  uploadZone: document.getElementById("upload-zone")!,
  photoCanvas: document.getElementById("photo-canvas") as HTMLCanvasElement,
  overlayCanvas: document.getElementById("overlay-canvas") as HTMLCanvasElement,
  detectStatus: document.getElementById("detect-status")!,
  qualityReport: document.getElementById("quality-report")!,
  btnReset: document.getElementById("btn-reset")!,
};

let selectedSex: Sex = "male";

// ---- Sex picker ----
for (const btn of document.querySelectorAll<HTMLButtonElement>(".sex-option")) {
  btn.addEventListener("click", () => {
    selectedSex = btn.dataset.sex as Sex;
    for (const b of document.querySelectorAll<HTMLButtonElement>(".sex-option")) {
      b.classList.toggle("selected", b === btn);
      b.setAttribute("aria-checked", String(b === btn));
    }
  });
}

// ---- Engine init ----
initLandmarker()
  .then(() => {
    el.engineStatus.textContent = "Engine ready — 478-point landmark model loaded";
    el.engineStatus.classList.add("ready");
  })
  .catch((err) => {
    console.error(err);
    el.engineStatus.textContent = "Failed to load the analysis engine — refresh to retry";
    el.engineStatus.classList.add("error");
  });

// ---- Upload handling ----
el.fileInput.addEventListener("change", () => {
  const file = el.fileInput.files?.[0];
  if (file) handleFile(file);
});

el.uploadZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  el.uploadZone.classList.add("dragover");
});
el.uploadZone.addEventListener("dragleave", () => el.uploadZone.classList.remove("dragover"));
el.uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  el.uploadZone.classList.remove("dragover");
  const file = e.dataTransfer?.files?.[0];
  if (file && file.type.startsWith("image/")) handleFile(file);
});

el.btnReset.addEventListener("click", () => {
  el.screenDetect.classList.add("hidden");
  el.screenCapture.classList.remove("hidden");
  el.qualityReport.classList.add("hidden");
  el.btnReset.classList.add("hidden");
  el.fileInput.value = "";
});

async function handleFile(file: File): Promise<void> {
  if (!isReady()) {
    el.engineStatus.textContent = "Engine still loading — one moment…";
    return;
  }

  const image = await loadImage(file);

  // Downscale to a fixed working size: keeps detection fast AND deterministic
  // for a given photo regardless of the display device.
  const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.round(image.naturalWidth * scale);
  const height = Math.round(image.naturalHeight * scale);

  el.photoCanvas.width = width;
  el.photoCanvas.height = height;
  el.photoCanvas.getContext("2d")!.drawImage(image, 0, 0, width, height);

  el.screenCapture.classList.add("hidden");
  el.screenDetect.classList.remove("hidden");
  el.detectStatus.textContent = "Detecting landmarks…";
  el.qualityReport.classList.add("hidden");
  el.btnReset.classList.add("hidden");

  // Let the browser paint the photo before running detection
  await nextFrame();

  const result = detect(el.photoCanvas);
  const quality = assessQuality(result);

  if (!quality.faceFound) {
    el.overlayCanvas.getContext("2d")?.clearRect(0, 0, el.overlayCanvas.width, el.overlayCanvas.height);
    el.detectStatus.innerHTML = `<span class="fail">No face detected.</span> Try a clearer, front-facing photo.`;
    el.btnReset.classList.remove("hidden");
    return;
  }

  const landmarks = result.faceLandmarks[0];
  el.detectStatus.textContent = "Mapping 478 landmarks…";

  const overlay = drawLandmarksAnimated(el.overlayCanvas, landmarks, width, height);
  await overlay.done;

  el.detectStatus.innerHTML = quality.pass
    ? `<span class="ok">478 landmarks locked.</span> Photo is frontal and analysis-ready.`
    : `<span class="fail">Landmarks placed, but this photo won't produce accurate measurements.</span>`;

  renderQualityReport(quality);
  el.btnReset.classList.remove("hidden");

  // Downstream scoring will consume these; expose for dev inspection.
  (window as unknown as Record<string, unknown>).__truemax = {
    sex: selectedSex,
    landmarks,
    quality,
  };
}

function renderQualityReport(q: QualityCheck): void {
  const row = (label: string, value: string, pass: boolean) =>
    `<div class="quality-row"><span class="label">${label}</span><span class="value ${pass ? "pass" : "warn"}">${value}</span></div>`;

  const yawOk = Math.abs(q.yawDeg) <= 12;
  const pitchOk = Math.abs(q.pitchDeg) <= 12;

  el.qualityReport.innerHTML = [
    row("Head yaw", `${q.yawDeg.toFixed(1)}°`, yawOk),
    row("Head pitch", `${q.pitchDeg.toFixed(1)}°`, pitchOk),
    row("Head roll", `${q.rollDeg.toFixed(1)}°`, true),
    row("Face size in frame", `${Math.round(q.faceWidthFrac * 100)}% of width`, q.largeEnough),
    q.issues.length
      ? `<div class="quality-verdict warn">${q.issues.join(" · ")} — you can proceed, but measurements may be off.</div>`
      : `<div class="quality-verdict">All checks passed — measurements will be reliable.</div>`,
  ].join("");
  el.qualityReport.classList.remove("hidden");
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
