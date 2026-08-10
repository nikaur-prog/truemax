import { analyzeSide } from "../engine/scoring.ts";
import type { Report, Sex } from "../engine/types.ts";
import type { SidePoints } from "../engine/sideMetrics.ts";
import { mountVerifier, seedFromSilhouette } from "./sideVerify.ts";
import type { VerifyHandle } from "./sideVerify.ts";

// Side-profile capture flow: upload → auto-seeded landmarks → user verifies
// by dragging → live-recomputed side report.

const MAX_DIM = 1000;

interface SideCtx {
  sex: Sex;
  onDone: (report: Report, points: SidePoints, faceDir: number) => void;
  onBack: () => void;
}

let verifier: VerifyHandle | null = null;

const el = () => ({
  section: document.getElementById("v-side")!,
  canvas: document.getElementById("side-canvas") as HTMLCanvasElement,
  lines: document.getElementById("side-lines") as unknown as SVGSVGElement,
  layer: document.getElementById("side-verify")!,
  cap: document.getElementById("side-cap")!,
  drop: document.getElementById("side-drop")!,
  input: document.getElementById("side-input") as HTMLInputElement,
  actions: document.getElementById("side-actions")!,
});

export function openSideCapture(ctx: SideCtx): void {
  const e = el();
  e.section.classList.remove("hidden");
  e.cap.textContent = "AWAITING PHOTO";
  e.drop.classList.remove("hidden");
  e.actions.innerHTML = `<button class="btn gho" id="side-back">Skip — keep my front-only score</button>`;
  document.getElementById("side-back")!.onclick = () => {
    close();
    ctx.onBack();
  };

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

export function close(): void {
  verifier?.destroy();
  verifier = null;
  el().section.classList.add("hidden");
}

async function load(file: File, ctx: SideCtx): Promise<void> {
  const e = el();
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  e.canvas.width = w;
  e.canvas.height = h;
  e.canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);

  e.drop.classList.add("hidden");
  e.cap.textContent = "VERIFY LANDMARKS";

  const seed = seedFromSilhouette(e.canvas);
  verifier?.destroy();
  verifier = mountVerifier(e.layer, e.canvas, seed, (pts) => drawGuides(e.lines, pts, w, h));
  drawGuides(e.lines, seed.points, w, h);

  e.actions.innerHTML = `
    <button class="btn gho" id="side-back">Skip</button>
    <button class="btn pri" id="side-go">Merge into my score</button>`;
  document.getElementById("side-back")!.onclick = () => {
    close();
    ctx.onBack();
  };
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
