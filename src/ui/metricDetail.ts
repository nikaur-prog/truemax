import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { REGION_NAMES, phi } from "../engine/scoring.js";
import { distFor } from "../engine/metrics.js";
import { regionMatches } from "../engine/celebs.js";
import { RELIABLE_MIN, reliabilityOf } from "../engine/reliability.js";
import type { RegionId, ScoredMetric, Sex } from "../engine/types.js";
import type { SidePoints } from "../engine/sideMetrics.js";
import { animateMeasurement, measurementBounds } from "./measureOverlay.js";
import type { OverlayFade } from "./measureOverlay.js";
import { animateSideMeasurement, hasSideOverlay, sideMeasurementBounds } from "./sideMeasureOverlay.js";
import { applyZoom, zoomToBounds } from "./zoomTransform.js";
import type { ZoomSpec } from "./zoomTransform.js";
import { zoomFor } from "./regions.js";
import { fmt, metricTrait, rankShort } from "./templates.js";

// ---------------------------------------------------------------------------
// One measurement, opened.
//
// The rows were always the index, never the article: forty measurements each
// reduced to a name, a number and a bar, with the actual evidence — the line
// drawn across the face — living only in a hover that a phone does not have.
// Tapping a row now opens the measurement itself: the photograph zoomed to
// that exact feature with the construction drawn on it, what the number means,
// where it sits against the norm, and which reference faces measure the same.
//
// Navigation is the point of the design. Prev/next walks the region's
// measurements and the camera PANS from feature to feature — one interpolated
// translate+scale move (see zoomTransform.ts) while the departing figure
// dissolves and the next draws on. That glide is what the deck of static rows
// could never do, and it is the difference between a table and an instrument.
//
// What is deliberately absent: any "simulate" tab. Showing someone their own
// face with a different measurement means generating a face, and a generated
// face presented as a preview of yourself is a promise the engine cannot keep.
// Everything on this card is a measurement with a receipt attached.
// ---------------------------------------------------------------------------

export interface MetricDetailOpts {
  region: RegionId;
  /** The measured metrics of the deck being browsed, in display order. */
  metrics: ScoredMetric[];
  index: number;
  sex: Sex;
  landmarks: NormalizedLandmark[] | null;
  frontPhoto: HTMLCanvasElement | null;
  sidePhoto: HTMLCanvasElement | null;
  sidePoints: SidePoints | null;
}

/** Which photograph a metric's construction lives on, given what we hold. */
export function stageViewFor(
  m: ScoredMetric,
  hasSide: boolean,
  hasFront: boolean,
): "side" | "front" | null {
  // A side metric is drawn on the profile when the profile is here; without it
  // the front stage still shows WHERE the number lives via the region fallback,
  // which is what the main pane does too.
  if (hasSideOverlay(m.def.id) && hasSide) return "side";
  return hasFront ? "front" : hasSide ? "side" : null;
}

/** Step through the deck without wrapping — a counter that wraps lies. */
export function stepIndex(index: number, delta: number, total: number): number {
  return Math.min(total - 1, Math.max(0, index + delta));
}

let active: HTMLElement | null = null;
let fade: OverlayFade | null = null;
let opts: MetricDetailOpts | null = null;
let index = 0;
let tab: "overview" | "celebs" = "overview";
let shownStage: "side" | "front" | null = null;

export function isMetricDetailOpen(): boolean {
  return active !== null;
}

export function closeMetricDetail(): void {
  fade?.cancel();
  fade = null;
  active?.remove();
  active = null;
  opts = null;
  shownStage = null;
  document.removeEventListener("keydown", onKey);
}

function onKey(ev: KeyboardEvent): void {
  if (ev.key === "Escape") closeMetricDetail();
  else if (ev.key === "ArrowRight") step(1);
  else if (ev.key === "ArrowLeft") step(-1);
}

function step(delta: number): void {
  if (!opts) return;
  const next = stepIndex(index, delta, opts.metrics.length);
  if (next !== index) showAt(next);
}

// --- content ---------------------------------------------------------------

function normLine(m: ScoredMetric, sex: Sex): string {
  const d = distFor(m.def, sex);
  const dec = m.def.decimals;
  const unit = m.def.unit || "";
  const group = sex === "male" ? "Male" : "Female";
  return `${group} average <b>${d.mean.toFixed(dec)}${unit}</b> ± ${d.sd.toFixed(dec)} · ideal <b>${m.idealRange[0].toFixed(dec)}–${m.idealRange[1].toFixed(dec)}${unit}</b>`;
}

function positionLine(m: ScoredMetric, sex: Sex): string {
  const group = sex === "male" ? "men" : "women";
  if (m.conformance >= 0.999) {
    return `Inside the ideal band — this feature is not holding the face back at all.`;
  }
  return `Closer to the ideal than <b>${Math.round(m.percentile)}%</b> of ${group}.`;
}

function overviewHTML(m: ScoredMetric, sex: Sex): string {
  const indicative = reliabilityOf(m.def.id) < RELIABLE_MIN;
  return `
    <p class="mdx-trait">It measures ${metricTrait(m.def.id)}.</p>
    <p class="mdx-norm">${normLine(m, sex)}</p>
    <p class="mdx-pos">${positionLine(m, sex)}</p>
    ${m.implausible
      ? `<p class="mdx-flag">This reading fell outside the range a face occupies, so it is treated as a misplaced point rather than a measurement — it moves nothing.</p>`
      : ""}
    ${indicative && !m.implausible
      ? `<p class="mdx-flag soft">Shown, not scored: across many photos of the same people this one moves as much between two photos of one face as between two different faces, so it carries no weight.</p>`
      : ""}`;
}

function celebsHTML(m: ScoredMetric, region: RegionId, sex: Sex): string {
  // The matcher's own eligibility rule — at or above average only — applied to
  // exactly this metric, so a match here is "your X measures like theirs" and
  // nothing vaguer.
  const matches = regionMatches(region, [m], sex);
  if (matches.length) {
    return matches
      .map(
        (c) => `<div class="mdx-celeb"><span class="mdx-ava">${c.name[0]}</span>
          <span class="mdx-celeb-nm">${c.name}<small>${c.metricName}</small></span></div>`,
      )
      .join("");
  }
  return m.percentile < 40
    ? `<p class="mdx-none">Matches are only offered on measurements where you land at or above average, and this one sits below it. That restraint is the point — a flattering comparison you did not earn would make every other number worth less.</p>`
    : `<p class="mdx-none">No reference face carries this measurement close enough to yours to claim honestly. The set grows with every analyzed face.</p>`;
}

function barHTML(m: ScoredMetric, sex: Sex): string {
  const d = distFor(m.def, sex);
  const lo = phi((m.idealRange[0] - d.mean) / d.sd) * 100;
  const hi = phi((m.idealRange[1] - d.mean) / d.sd) * 100;
  return `<div class="rangebar mdx-bar">
    <div class="ideal" style="left:${lo.toFixed(1)}%;width:${Math.max(4, hi - lo).toFixed(1)}%"></div>
    <i style="left:${m.markerPct}%"></i>
  </div>`;
}

// --- the stage -------------------------------------------------------------

function stageZoom(m: ScoredMetric, view: "side" | "front"): ZoomSpec {
  if (!opts) return { scale: 1, originX: 50, originY: 50 };
  if (view === "side" && opts.sidePoints && opts.sidePhoto) {
    const b = sideMeasurementBounds(m, opts.sidePoints, opts.sidePhoto.width, opts.sidePhoto.height);
    if (b) return zoomToBounds(b, { fill: 0.6, min: 1.3, max: 2.6 });
    return { scale: 1.25, originX: 50, originY: 50 };
  }
  if (opts.landmarks) {
    const b = measurementBounds(m, opts.landmarks);
    if (b) return zoomToBounds(b, { fill: 0.6, min: 1.35, max: 2.8 });
    const z = zoomFor(opts.region, opts.landmarks);
    return { scale: z.scale, originX: z.originX, originY: z.originY };
  }
  return { scale: 1.15, originX: 50, originY: 50 };
}

function paintStage(view: "side" | "front"): void {
  if (!active || !opts) return;
  const zoom = active.querySelector<HTMLElement>(".mdx-zoom")!;
  const photo = active.querySelector<HTMLCanvasElement>(".mdx-photo")!;
  const src = view === "side" ? opts.sidePhoto : opts.frontPhoto;
  if (!src) return;
  photo.width = src.width;
  photo.height = src.height;
  photo.getContext("2d")!.drawImage(src, 0, 0);
  zoom.style.aspectRatio = `${src.width} / ${src.height}`;
  const overlay = active.querySelector<HTMLCanvasElement>(".mdx-overlay-canvas")!;
  overlay.width = src.width;
  overlay.height = src.height;
  shownStage = view;
}

function drawMetric(m: ScoredMetric, view: "side" | "front"): void {
  if (!active || !opts) return;
  const overlay = active.querySelector<HTMLCanvasElement>(".mdx-overlay-canvas")!;
  fade?.cancel();
  if (view === "side" && opts.sidePoints && opts.sidePhoto) {
    fade = animateSideMeasurement(overlay, opts.sidePoints, opts.sidePhoto.width, opts.sidePhoto.height, m);
  } else if (opts.landmarks && opts.frontPhoto) {
    fade = animateMeasurement(overlay, opts.landmarks, opts.frontPhoto.width, opts.frontPhoto.height, m);
  }
}

// --- render ----------------------------------------------------------------

function showAt(next: number): void {
  if (!active || !opts) return;
  index = next;
  const m = opts.metrics[index];
  const view = stageViewFor(m, !!(opts.sidePhoto && opts.sidePoints), !!(opts.frontPhoto && opts.landmarks));
  if (!view) return;

  // Header
  active.querySelector(".mdx-count")!.textContent = `${index + 1} / ${opts.metrics.length}`;
  active.querySelector(".mdx-title")!.textContent = m.def.name;
  active.querySelector(".mdx-eyebrow")!.textContent =
    `${REGION_NAMES[opts.region].toUpperCase()} · ${view === "side" ? "PROFILE" : "FRONT"}`;

  // Stage: pan the camera. Swapping photographs cannot pan, so that one case
  // dips through black instead — a cut, not a glitch.
  const zoomEl = active.querySelector<HTMLElement>(".mdx-zoom")!;
  const spec = stageZoom(m, view);
  if (view !== shownStage) {
    const stage = active.querySelector<HTMLElement>(".mdx-stage")!;
    stage.classList.add("swap");
    window.setTimeout(() => {
      paintStage(view);
      zoomEl.style.transition = "none";
      applyZoom(zoomEl, spec);
      drawMetric(m, view);
      // Reflow so the no-transition zoom lands before transitions resume.
      void zoomEl.offsetWidth;
      zoomEl.style.transition = "";
      stage.classList.remove("swap");
    }, 150);
  } else {
    applyZoom(zoomEl, spec);
    drawMetric(m, view);
  }

  // Readout + tabs, re-entering with a small rise so the change reads.
  const info = active.querySelector<HTMLElement>(".mdx-info")!;
  info.classList.remove("enter");
  void info.offsetWidth;
  info.classList.add("enter");
  info.querySelector(".mdx-value")!.textContent = fmt(m);
  info.querySelector(".mdx-score")!.textContent = m.implausible ? "—" : m.score.toFixed(1);
  info.querySelector(".mdx-rank")!.textContent = m.implausible ? "re-check" : rankShort(m.percentile);
  info.querySelector<HTMLElement>(".mdx-barhost")!.innerHTML = barHTML(m, opts.sex);
  renderTab();

  const prev = active.querySelector<HTMLButtonElement>(".mdx-prev")!;
  const nextB = active.querySelector<HTMLButtonElement>(".mdx-next")!;
  prev.disabled = index === 0;
  nextB.disabled = index === opts.metrics.length - 1;
}

function renderTab(): void {
  if (!active || !opts) return;
  const m = opts.metrics[index];
  for (const b of active.querySelectorAll<HTMLButtonElement>(".mdx-tab")) {
    b.classList.toggle("on", b.dataset.tab === tab);
  }
  const body = active.querySelector<HTMLElement>(".mdx-tabbody")!;
  body.innerHTML = tab === "overview" ? overviewHTML(m, opts.sex) : celebsHTML(m, opts.region, opts.sex);
}

export function openMetricDetail(o: MetricDetailOpts): void {
  if (!o.metrics.length) return;
  closeMetricDetail();
  opts = o;
  index = Math.min(o.metrics.length - 1, Math.max(0, o.index));
  tab = "overview";
  shownStage = null;

  const wrap = document.createElement("div");
  active = wrap;
  wrap.className = "mdx-overlay";
  wrap.innerHTML = `<div class="mdx-card" role="dialog" aria-modal="true" aria-label="Measurement detail">
    <header class="mdx-head">
      <div><span class="mdx-eyebrow"></span><h3 class="mdx-title"></h3></div>
      <span class="mdx-count"></span>
      <button class="mdx-close" aria-label="Close">✕</button>
    </header>
    <div class="mdx-grid">
      <div class="mdx-stage">
        <div class="mdx-zoom">
          <canvas class="mdx-photo"></canvas>
          <canvas class="mdx-overlay-canvas"></canvas>
        </div>
        <button class="mdx-step mdx-prev" aria-label="Previous measurement">‹</button>
        <button class="mdx-step mdx-next" aria-label="Next measurement">›</button>
      </div>
      <div class="mdx-info">
        <div class="mdx-readout">
          <b class="mdx-value"></b>
          <span class="mdx-chip mdx-score"></span>
          <span class="mdx-chip mdx-rank"></span>
        </div>
        <div class="mdx-barhost"></div>
        <nav class="mdx-tabs">
          <button class="mdx-tab" data-tab="overview">Overview</button>
          <button class="mdx-tab" data-tab="celebs">Celebrities</button>
        </nav>
        <div class="mdx-tabbody"></div>
      </div>
    </div>
  </div>`;

  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) closeMetricDetail();
  });
  wrap.querySelector(".mdx-close")!.addEventListener("click", closeMetricDetail);
  wrap.querySelector(".mdx-prev")!.addEventListener("click", () => step(-1));
  wrap.querySelector(".mdx-next")!.addEventListener("click", () => step(1));
  for (const b of wrap.querySelectorAll<HTMLButtonElement>(".mdx-tab")) {
    b.onclick = () => {
      tab = b.dataset.tab as typeof tab;
      renderTab();
    };
  }

  // Swipe between measurements — the stage is the natural surface for it.
  const stage = wrap.querySelector<HTMLElement>(".mdx-stage")!;
  let downX: number | null = null;
  stage.addEventListener("pointerdown", (e) => (downX = e.clientX));
  stage.addEventListener("pointerup", (e) => {
    if (downX === null) return;
    const dx = e.clientX - downX;
    downX = null;
    if (Math.abs(dx) > 44) step(dx < 0 ? 1 : -1);
  });

  document.addEventListener("keydown", onKey);
  document.body.appendChild(wrap);

  // First paint: land the stage without a transition, then let showAt animate.
  const m = opts.metrics[index];
  const view = stageViewFor(m, !!(o.sidePhoto && o.sidePoints), !!(o.frontPhoto && o.landmarks));
  if (view) {
    paintStage(view);
    const zoomEl = wrap.querySelector<HTMLElement>(".mdx-zoom")!;
    zoomEl.style.transition = "none";
    applyZoom(zoomEl, stageZoom(m, view));
    void zoomEl.offsetWidth;
    zoomEl.style.transition = "";
  }
  showAt(index);
  wrap.querySelector<HTMLButtonElement>(".mdx-close")!.focus();
}
