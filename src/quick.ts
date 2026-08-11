import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { initLandmarker, isReady, setRunningMode } from "./engine/landmarker.ts";
import { detectStable } from "./engine/consensus.ts";
import { assessQuality } from "./engine/quality.ts";
import { analyze } from "./engine/scoring.ts";
import { REGION_NAMES } from "./engine/scoring.ts";
import { isSupported, startCamera } from "./ui/camera.ts";
import type { CameraHandle } from "./ui/camera.ts";
import { rankShort } from "./ui/templates.ts";
import { storeSex, storedSex } from "./engine/sexPref.ts";
import { drawLandmarksAnimated } from "./ui/overlay.ts";
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
  stage: document.getElementById("q-stage")!,
  shot: document.getElementById("q-shot") as HTMLCanvasElement,
  dots: document.getElementById("q-dots") as HTMLCanvasElement,
  cards: document.getElementById("q-cards")!,
};

// Stage timings. Long enough to read on camera, short enough that nobody
// reaches for the skip they do not have.
const SWEEP_MS = 2500; // two passes of the scan line
const DOTS_HOLD_MS = 550; // beat after the dots land, before the photo moves

let cam: CameraHandle | null = null;
let ready = false;

initLandmarker()
  .then(() => {
    el.engine.textContent = "ENGINE READY";
    el.engine.classList.add("ready");
    // The camera opens only on an explicit "Use camera" click. This page is
    // built to be filmed, so a creator needs to start the preview on cue rather
    // than have it spring open the moment the page loads. Matches the main app,
    // which also no longer auto-opens.
  })
  .catch(() => {
    el.engine.textContent = "ENGINE FAILED TO LOAD · REFRESH";
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
  // No demographic question in front of the score — on a page built for
  // filming, that is the one interaction guaranteed to end up in the clip. The
  // stored choice is used if there is one, and the label on the card is a
  // button either way, so correcting it costs one tap and re-scores instantly.
  //
  // What is NOT used here is the shape model's guess. It classified a bearded
  // man as female while testing this page, and at 58.8% on held-out faces
  // against a 54.1% base rate that is not an unlucky case — see sexPref.ts.
  const lm = det.faceLandmarks[0];
  last = { lm, w: src.width, h: src.height, photo: src };
  show(storedSex() ?? "male", true);
}

// The last analysed photo, kept so switching reference population re-scores it
// rather than making someone shoot again.
let last: { lm: NormalizedLandmark[]; w: number; h: number; photo: HTMLCanvasElement } | null = null;

function show(sex: Sex, animate = false): void {
  if (!last) return;
  storeSex(sex);
  render(analyze(last.lm, last.w, last.h, sex), last.photo, animate);
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

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function render(r: Report, photo: HTMLCanvasElement, animate = false): void {
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
  el.cards.innerHTML = `
    <div class="q-hero">
      <div class="q-headline">
        <button class="q-klabel q-switch" id="q-sex" type="button"
          title="Switch the reference population">VS ${r.sex === "male" ? "MEN" : "WOMEN"} ⇄</button>
        <div class="q-score"><span class="q-num q-score-num" data-target="${r.overall.toFixed(1)}"
          contenteditable="true" inputmode="decimal" spellcheck="false">0.0</span><small>/10</small></div>
        <span class="q-rank">${rankShort(r.overallPercentile)}</span>
      </div>
    </div>

    <div class="q-grid">
      ${regions
        .map(
          (g) => `<div class="q-cell">
            <span>${REGION_NAMES[g.region]}</span>
            ${num(g.score)}
            <div class="q-bar"><i data-w="${Math.max(2, Math.min(100, g.score * 10))}" style="width:0%"></i></div>
          </div>`,
        )
        .join("")}
    </div>

    <div class="q-actions">
      <button class="btn pri" id="q-download">Download</button>
      <button class="btn gho" id="q-again">New photo</button>
    </div>`;

  // Stagger index for the drop, so the cards arrive in reading order rather
  // than all at once.
  [...el.cards.children].forEach((c, i) => (c as HTMLElement).style.setProperty("--i", String(i)));

  wireEditing();

  if (animate) void playSequence(r, photo);
  else {
    el.stage.classList.add("open");
    settleNumbers(false);
  }

  document.getElementById("q-sex")!.onclick = () => show(r.sex === "male" ? "female" : "male");
  document.getElementById("q-download")!.onclick = () => void downloadCard();
  document.getElementById("q-again")!.onclick = () => {
    // Reset the stage, or the next scan starts already open with last scan's
    // landmarks still painted over the new photo.
    el.stage.classList.remove("open", "scanning");
    el.dots.getContext("2d")?.clearRect(0, 0, el.dots.width, el.dots.height);
    el.result.classList.add("hidden");
    el.capture.classList.remove("hidden");
    el.shoot.textContent = "Use camera";
    el.shoot.disabled = false;
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
    });
  }
}

// Download the card as a PNG. The stage is the whole reveal (photo + cards), so
// a screenshot of it is the shareable image. The motion is captured by screen
// recording; this is the still, for a thumbnail or a static post.
async function downloadCard(): Promise<void> {
  const btn = document.getElementById("q-download") as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Rendering…";
  }
  try {
    const { toPng } = await import("html-to-image");
    const bg = getComputedStyle(document.body).backgroundColor || "#f4f3ee";
    const url = await toPng(el.stage, { pixelRatio: 2, backgroundColor: bg, cacheBust: true });
    const a = document.createElement("a");
    a.href = url;
    a.download = `truemax-scan-${Date.now()}.png`;
    a.click();
  } catch {
    if (btn) btn.textContent = "Couldn't render";
  } finally {
    if (btn && btn.textContent !== "Couldn't render") {
      btn.disabled = false;
      btn.textContent = "Download";
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
