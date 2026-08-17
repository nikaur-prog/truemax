import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { initLandmarker, isReady, setRunningMode } from "./engine/landmarker.js";
import { detectStable } from "./engine/consensus.js";
import { assessQuality } from "./engine/quality.js";
import { analyze } from "./engine/scoring.js";
import { aggregateScoreToPercentile } from "./engine/scoring.js";
import { REGION_NAMES } from "./engine/scoring.js";
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
import { currentAccessToken } from "./engine/auth.js";
import { openProducer } from "./ui/quickProducer.js";
import { canShareFiles, saveFile } from "./ui/saveFile.js";

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
function withSex(next: () => void): void {
  if (storedSex()) {
    next();
    return;
  }
  openSexChooser((sex) => {
    storeSex(sex);
    paintSilhouette();
    next();
  });
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
  track("quick-scan-done");
  show(storedSex() ?? "male", true);
}

// The last analysed photo, kept so switching reference population re-scores it
// rather than making someone shoot again.
let last: { lm: NormalizedLandmark[]; w: number; h: number; photo: HTMLCanvasElement } | null = null;

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

    <div class="q-hero">
      <div class="q-headline">
        <button class="q-klabel q-switch" id="q-sex" type="button"
          title="Switch the reference population">VS ${r.sex === "male" ? "MEN" : "WOMEN"} ⇄</button>
        <div class="q-score"><span class="q-num q-score-num" data-target="${r.overall.toFixed(1)}"
          contenteditable="true" inputmode="decimal" spellcheck="false">0.0</span><small>/10</small></div>
        <span class="q-rank">${rankShort(r.overallPercentile)}</span>
      </div>
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
          (g) => `<div class="q-cell">
            <span>${REGION_NAMES[g.region]}</span>
            ${num(g.score)}
            <div class="q-bar"><i data-w="${Math.max(2, Math.min(100, g.score * 10))}" style="width:0%"></i></div>
          </div>`,
        )
        .join("")}
    </div>

    <!-- The rundown opens on "How attractive is X?", so it cannot be built
         without a name. Asked for here rather than in a prompt() at click time:
         a modal that appears after you have committed to a sixty-second render
         is a modal you dismiss by accident. -->
    <div class="q-namerow">
      <input id="q-rundown-name" class="q-input" type="text" maxlength="48"
             placeholder="Name for the rundown — e.g. LeBron James" autocomplete="off" />
    </div>

    <div class="q-actions">
      <button class="btn pri" id="q-download">${canShareFiles("image/png") ? "Save image" : "Download image"}</button>
      <button class="btn pri" id="q-video-download">Breakdown MP4</button>
      <button class="btn pri" id="q-verdict-download">Verdict MP4</button>
      <button class="btn pri" id="q-rundown-download">Rundown MP4</button>
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
    openProducer({ photo: last.photo, landmarks: last.lm, sex: r.sex, scores: editedExportScores(r) });
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
