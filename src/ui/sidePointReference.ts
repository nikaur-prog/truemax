import { SIDE_EAR_GUIDANCE, SIDE_POINTS, type SidePointId } from "../engine/sideMetrics.js";
import { drawGuideCrop, drawGuideWhole, earGuideCompanion, playGuideZoom } from "./sideGuidePhoto.js";

/** One guide for the walkthrough and all-points review. Never changes scan data. */
export function openPointReference(
  image: HTMLImageElement, id: SidePointId, faceDir: number, doc = document,
): () => void {
  const point = SIDE_POINTS.find((entry) => entry.id === id)!;
  const companion = earGuideCompanion(id);
  const other = SIDE_POINTS.find((entry) => entry.id === companion);
  const origin = doc.activeElement as HTMLElement | null;
  const overlay = doc.createElement("div");
  overlay.className = "sref-overlay refcrop-full";
  overlay.innerHTML = `<section class="refcrop-fullcard" role="dialog" aria-modal="true" aria-label="${point.label} placement guide">
    <header><h2>${point.label}</h2><button type="button" class="refcrop-dismiss" aria-label="Close placement guide">×</button></header>
    <div class="refcrop-stage"><canvas role="img" aria-label="${point.label} marked on a synthetic example"></canvas></div>
    <p class="refcrop-load-error" role="status" hidden>The example photo could not load. Close this guide and try again. Do not guess from a blank image.</p>
    ${other ? `<p class="refcrop-legend"><span><i class="refcrop-key active"></i>Green: ${point.label}</span><span><i class="refcrop-key"></i>White: ${other.label}</span></p>` : ""}
    <p class="refcrop-instruction">${id === "condylion" || id === "tragion" ? SIDE_EAR_GUIDANCE[id] : point.hint + ". Match this feature on your own face, not the example's proportions."}</p>
    <div class="refcrop-controls"><button type="button" class="btn gho" data-view="whole">Whole face</button><button type="button" class="btn gho" data-view="close">Close-up</button><button type="button" class="btn pri" data-view="zoom">Show location</button></div>
  </section>`;
  doc.body.appendChild(overlay);
  const canvas = overlay.querySelector("canvas")!;
  const size = Math.max(180, Math.min(540, window.innerWidth - 64, window.innerHeight * 0.5));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  // max-width may reduce the image on a phone. Retain its intrinsic square
  // ratio instead of stretching its height independently of the width.
  canvas.style.height = "auto";
  const controls = [...overlay.querySelectorAll<HTMLButtonElement>("[data-view]")];
  let stop: (() => void) | null = null;
  let closed = false;
  const ready = () => image.complete && image.naturalWidth > 0;
  const render = (view: string) => {
    if (closed || !ready()) return;
    stop?.();
    stop = null;
    if (view === "whole") drawGuideWhole(canvas, image, id, faceDir);
    else if (view === "zoom") stop = playGuideZoom(canvas, image, id, faceDir, { durationMs: 1300, holdMs: 350 });
    else drawGuideCrop(canvas, image, id, faceDir, size);
    for (const control of controls) control.setAttribute("aria-pressed", String(control.dataset.view === view));
  };
  const loaded = () => {
    if (closed) return;
    for (const control of controls) control.disabled = !ready();
    const error = overlay.querySelector<HTMLElement>(".refcrop-load-error")!;
    error.hidden = ready();
    canvas.hidden = !ready();
    if (ready()) render(companion ? "close" : "whole");
  };
  for (const control of controls) {
    control.disabled = !ready();
    control.onclick = () => render(control.dataset.view!);
  }
  if (image.complete) loaded();
  else {
    image.addEventListener("load", loaded);
    image.addEventListener("error", loaded);
  }
  const close = () => {
    if (closed) return;
    closed = true;
    stop?.();
    image.removeEventListener("load", loaded);
    image.removeEventListener("error", loaded);
    doc.removeEventListener("keydown", onKey, true);
    overlay.remove();
    if (origin?.isConnected) origin.focus();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    } else if (event.key === "Tab") {
      const buttons = [...overlay.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };
  doc.addEventListener("keydown", onKey, true);
  overlay.querySelector<HTMLButtonElement>(".refcrop-dismiss")!.onclick = close;
  overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
  overlay.querySelector<HTMLButtonElement>(".refcrop-dismiss")!.focus();
  return close;
}
