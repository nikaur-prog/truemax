import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { initLandmarker, isReady, setRunningMode } from "./engine/landmarker.ts";
import { detectStable } from "./engine/consensus.ts";
import { assessQuality } from "./engine/quality.ts";
import { analyze } from "./engine/scoring.ts";
import { buildGeometry } from "./engine/geometry.ts";
import { detectSex, extractShape } from "./engine/shape.ts";
import { REGION_NAMES } from "./engine/scoring.ts";
import { isSupported, permissionGranted, startCamera } from "./ui/camera.ts";
import type { CameraHandle } from "./ui/camera.ts";
import { curveSVG } from "./ui/curve.ts";
import { rankShort, rarityText } from "./ui/templates.ts";
import type { Report, Sex } from "./engine/types.ts";

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
};

let cam: CameraHandle | null = null;
let ready = false;

initLandmarker()
  .then(() => {
    el.engine.textContent = "ENGINE READY";
    el.engine.classList.add("ready");
    // Same courtesy as the main app: someone who already granted the camera
    // gets a live preview without being asked twice.
    permissionGranted().then((ok) => {
      if (ok) void openCamera();
    });
  })
  .catch(() => {
    el.engine.textContent = "ENGINE FAILED TO LOAD — REFRESH";
    el.engine.classList.add("error");
  });

async function openCamera(): Promise<void> {
  if (cam || !isSupported()) return;
  el.frame.classList.add("live");
  try {
    cam = await startCamera({
      video: el.video,
      guideCanvas: el.guide,
      onCheck: (c) => {
        ready = c.ready;
        el.hintTitle.textContent = c.hint;
        el.hintDetail.textContent = c.detail;
        el.hint.classList.toggle("ready", c.ready);
        el.lampFill.className = c.status === "green" ? "green" : c.status;
        el.lampFill.style.width = `${Math.round((c.status === "green" ? 1 : c.progress) * 100)}%`;
        el.shoot.disabled = !c.ready;
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

el.shoot.onclick = async () => {
  if (!cam) {
    await openCamera();
    return;
  }
  if (!ready) return;
  const shot = cam.capture();
  stopCamera();
  if (shot) await run(shot);
};

el.pick.onclick = () => el.file.click();
el.file.onchange = async () => {
  const f = el.file.files?.[0];
  el.file.value = "";
  if (!f) return;
  stopCamera();
  const img = await loadImage(f);
  const s = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * s);
  c.height = Math.round(img.naturalHeight * s);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  await run(c);
};

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
  // Same shape-model vote the main app uses, rather than asking up front: on a
  // page built for filming, a demographic question standing between someone and
  // their score is the one interaction guaranteed to end up in the clip.
  //
  // But the vote is wrong sometimes, and here it is wrong in public. Testing
  // this page on a bearded man in glasses, the model returned female and the
  // card printed WOMEN next to his face — while scoring him against the female
  // reference, which is not a cosmetic error: every percentile on the page
  // comes from that population. So the label is shown, and it is a button.
  const lm = det.faceLandmarks[0];
  last = { lm, w: src.width, h: src.height, photo: src };
  const guess = detectSex(extractShape(buildGeometry(lm, src.width, src.height)));
  show(guess?.sex ?? "male");
}

// The last analysed photo, kept so switching reference population re-scores it
// rather than making someone shoot again.
let last: { lm: NormalizedLandmark[]; w: number; h: number; photo: HTMLCanvasElement } | null = null;

function show(sex: Sex): void {
  if (!last) return;
  render(analyze(last.lm, last.w, last.h, sex), last.photo);
}

function render(r: Report, photo: HTMLCanvasElement): void {
  el.capture.classList.add("hidden");
  el.result.classList.remove("hidden");

  const regions = [...r.regions].sort((a, b) => b.score - a.score);
  const best = regions[0];
  const worst = regions[regions.length - 1];

  el.result.innerHTML = `
    <div class="q-hero">
      <img class="q-shot" alt="" src="${photo.toDataURL("image/jpeg", 0.86)}" />
      <div class="q-headline">
        <button class="q-klabel q-switch" id="q-sex" type="button"
          title="Switch the reference population">FRONT ONLY · VS ${r.sex === "male" ? "MEN" : "WOMEN"} ⇄</button>
        <b class="q-score">${r.overall.toFixed(2)}<small>/10</small></b>
        <span class="q-rank">${rankShort(r.overallPercentile)} · about ${rarityText(r.overallPercentile)}</span>
      </div>
    </div>

    <div class="q-grid">
      ${regions
        .map(
          (g) => `<div class="q-cell">
            <span>${REGION_NAMES[g.region]}</span>
            <b>${g.score.toFixed(1)}</b>
            <div class="q-bar"><i style="width:${Math.max(2, Math.min(100, g.score * 10))}%"></i></div>
          </div>`,
        )
        .join("")}
    </div>

    <div class="q-note">
      <b>${REGION_NAMES[best.region]}</b> carries it at ${best.score.toFixed(1)};
      <b>${REGION_NAMES[worst.region]}</b> is the drag at ${worst.score.toFixed(1)}.
      Potential ${r.potential.toFixed(1)} without changing your skeleton.
    </div>

    <div class="q-curve">${curveSVG(r.overallPercentile, "overall", r.sex, false, {
      score: r.overall,
      rank: rankShort(r.overallPercentile),
    })}</div>

    <p class="q-foot">
      Front view only — chin projection, jaw angle and facial convexity are not in this number.
      Two photos of one face differ by about 1.3 points, so treat one scan as one reading.
    </p>

    <div class="q-actions"><button class="btn pri" id="q-again">Scan again</button></div>`;

  document.getElementById("q-sex")!.onclick = () => show(r.sex === "male" ? "female" : "male");
  document.getElementById("q-again")!.onclick = () => {
    el.result.classList.add("hidden");
    el.capture.classList.remove("hidden");
    el.shoot.textContent = "Use camera";
    el.shoot.disabled = false;
    void openCamera();
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
