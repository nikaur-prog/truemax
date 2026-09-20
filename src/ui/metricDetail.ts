import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { REGION_NAMES, phi } from "../engine/scoring.js";
import { directionFor, distFor } from "../engine/metrics.js";
import { CELEBS, CELEB_MATCH_MIN_PCT, regionMatches } from "../engine/celebs.js";
import { RELIABLE_MIN, reliabilityOf } from "../engine/reliability.js";
import type { RegionId, RegionScore, ScoredMetric, Sex } from "../engine/types.js";
import type { SidePoints } from "../engine/sideMetrics.js";
import { animateMeasurement, measurementBounds, prefersReducedOverlayMotion } from "./measureOverlay.js";
import type { OverlayFade } from "./measureOverlay.js";
import { animateSideMeasurement, hasSideOverlay, sideMeasurementBounds } from "./sideMeasureOverlay.js";
import { applyZoom, zoomToBounds } from "./zoomTransform.js";
import type { ZoomSpec } from "./zoomTransform.js";
import { zoomFor } from "./regions.js";
import { fmt, metricTrait, wasMeasured } from "./templates.js";
import { metricRead } from "../engine/metricReads.js";
import { metricFit, metricModelScoreLabel } from "./metricFit.js";
import { celebrityPortraitFigure, celebrityPortraitCredits, installCelebrityPortraitFallback, PORTRAIT_DISCLOSURE } from "./celebrityPortrait.js";
import { createStagePaint } from "./stagePaint.js";
import { rasterSizeFor, sidePointsForRaster } from "./interactiveRaster.js";

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
// Navigation is the point of the design. Prev/next walks the report's
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
  /**
   * The region the deck was opened FROM, used only where a metric of its own
   * cannot say. Every per-measurement label, zoom and comparison is taken from
   * that measurement's own `def.region` instead, because a deck no longer has
   * to come from one region: tapping a pillar opens the measurements that
   * build it, and those are spread across the face by definition.
   */
  region: RegionId;
  /**
   * Prefix for the eyebrow, naming what the deck IS when it is not a region.
   * "HARMONY" over "MIDFACE · FRONT", so the card says which grouping you
   * opened and which part of the face you are looking at.
   */
  deckLabel?: string;
  /**
   * One line about the DECK, held above the readout while you step through it.
   * A pillar needs this and a region does not: "Jaw" is self-explanatory and
   * "Dimorphism" is a word people will read as a compliment unless it is told
   * plainly what it measures.
   */
  deckNote?: string;
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
  // A photograph of the other view cannot substantiate this construction.
  // Keep the reading and navigation available, but explain the missing view.
  if (m.def.view === "side" || hasSideOverlay(m.def.id)) return hasSide ? "side" : null;
  return hasFront ? "front" : null;
}

/** Step through the deck without wrapping — a counter that wraps lies. */
export function stepIndex(index: number, delta: number, total: number): number {
  return Math.max(0, Math.min(total - 1, Math.max(0, index + delta)));
}

/** Region headings organize a report, but must not be navigation dead ends. */
export function measurementDeck(
  regions: readonly Pick<RegionScore, "metrics">[],
  view: "all" | "side" = "all",
): ScoredMetric[] {
  const seen = new Set<string>();
  return regions.flatMap(region => region.metrics).filter(metric => {
    if (!wasMeasured(metric) || seen.has(metric.def.id)) return false;
    if (view === "side" && metric.def.view !== "side" && !hasSideOverlay(metric.def.id)) return false;
    seen.add(metric.def.id);
    // Finite excluded/indicative readings remain inspectable with their flags.
    return true;
  });
}

let active: HTMLElement | null = null;
let fade: OverlayFade | null = null;
let opts: MetricDetailOpts | null = null;
let index = 0;
let tab: "overview" | "celebs" = "overview";
let shownStage: "side" | "front" | null = null;
let stagePaint: ReturnType<typeof createStagePaint> | null = null;
// Where focus came from, so closing puts a keyboard user back on their row
// rather than at the top of the document.
let opener: HTMLElement | null = null;

export function isMetricDetailOpen(): boolean {
  return active !== null;
}

export function closeMetricDetail(): void {
  fade?.cancel();
  fade = null;
  stagePaint?.cancel();
  stagePaint = null;
  active?.remove();
  active = null;
  opts = null;
  shownStage = null;
  document.removeEventListener("keydown", onKey);
  document.body.classList.remove("mdx-open");
  // Restore focus only if it is still ours to move — if something else has
  // taken it since, stealing it back would be the ruder bug.
  const back = opener;
  opener = null;
  if (back?.isConnected && (document.activeElement === document.body || document.activeElement === null)) {
    back.focus();
  }
}

function onKey(ev: KeyboardEvent): void {
  if (ev.key === "Escape") {
    ev.preventDefault();
    closeMetricDetail();
  } else if (ev.key === "Tab" && active) {
    const controls = [...active.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], summary, [tabindex='0']")]
      .filter(control => {
        const closedDetails = control.closest("details:not([open])");
        return control.getClientRects().length > 0 && (!closedDetails || closedDetails.querySelector("summary") === control);
      });
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (ev.shiftKey && document.activeElement === first && last) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last && first) {
      ev.preventDefault();
      first.focus();
    }
  } else if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
    // Without this each press both steps the deck AND scrolls the report
    // behind the dialog, so the page the reader comes back to has moved.
    ev.preventDefault();
    step(ev.key === "ArrowRight" ? 1 : -1);
  }
}

function step(delta: number): void {
  if (!opts) return;
  const next = stepIndex(index, delta, opts.metrics.length);
  if (next !== index) showAt(next);
}

// --- content ---------------------------------------------------------------

// `idealRange` is documented as the DISPLAY range for the bar, and for the
// monotone directions one of its edges is cosmetic: a "lower is better" metric
// gets a low edge of mean − 1.5sd purely so the green stripe has somewhere to
// start. Printing that edge as an ideal invents a floor the scoring does not
// have — below it you keep scoring better, not worse. So only a band metric
// gets a two-sided ideal quoted; the others are told the truth about their
// direction and given the one edge that is real.
// Metrics whose printed NUMBER is not comparable to anything outside this app.
//
// Both are recorded in docs/SCORING_VALIDATION.md as construction mismatches
// rather than data problems, and both were found by comparing the same face
// against a second product: browTilt reads about 11.9 degrees below it because
// we measure to the brow TAIL where the comparison measures to the PEAK, and
// jawFrontalAngle reads about 26 degrees off for a similar reason.
//
// The ranking they produce is still meaningful — every face is measured the
// same way, so who is above whom does not change. What is NOT meaningful is
// the absolute figure, and printing "Male average -4.9°" next to it makes an
// anatomical claim we cannot support: a brow that slopes DOWN five degrees
// from the inner end to the outer is not what a typical face does, it is what
// our two landmarks do. Saying so is cheaper than being asked.
const CONSTRUCTION_CAVEAT: Record<string, string> = {
  gonialAngle:
    "Measured between the visible jaw corner, the surface point used for the jaw hinge, and the chin bottom. This is a photographic surface angle, not the skeletal gonial angle measured on an X-ray. Its current scoring reference is borrowed from skeletal measurements and has not been validated for these surface points. Point placement and head turn can change the reading.",
  browTilt:
    "This uses the mesh's inner and outer brow points. An angle measured to the brow peak uses a different endpoint, so the numbers are not directly comparable. Check which points each tool uses before interpreting a difference.",
  jawFrontalAngle:
    "This front-view angle uses the chin bottom and the two jaw corners. Other tools may use a different jaw-angle construction, so a difference in the raw number is not necessarily a placement error.",
};

export function constructionCaveat(id: string): string | null {
  return CONSTRUCTION_CAVEAT[id] ?? null;
}

function normLine(m: ScoredMetric, sex: Sex): string {
  const d = distFor(m.def, sex);
  const dec = m.def.decimals;
  const unit = m.def.unit || "";
  const group = sex === "male" ? "Male" : "Female";
  // toFixed on a mean that sits a hair under zero prints "-0.0", which reads
  // as a typo rather than as a number.
  const noNegZero = (s: string) => (/^-0(\.0+)?$/.test(s) ? s.slice(1) : s);
  const avg = `${group} reference mean <b>${noNegZero(d.mean.toFixed(dec))}${unit}</b> · SD ${d.sd.toFixed(dec)}`;
  const dir = directionFor(m.def, sex);
  if (dir === "band") {
    return `${avg} · model band <b>${m.idealRange[0].toFixed(dec)}–${m.idealRange[1].toFixed(dec)}${unit}</b>`;
  }
  const edge = dir === "lower" ? m.idealRange[1] : m.idealRange[0];
  return `${avg} · the model favours ${dir} values, with a display threshold of <b>${edge.toFixed(dec)}${unit}</b>. This is not a personal target.`;
}

function positionLine(m: ScoredMetric, sex: Sex): string {
  const fit = metricFit(m, sex);
  return `${fit.label}. This describes agreement with TrueMax's current reference, not overall attractiveness. A reading outside the reference does not, by itself, mean something needs changing.`;
}

export function overviewHTML(m: ScoredMetric, sex: Sex): string {
  const indicative = reliabilityOf(m.def.id) < RELIABLE_MIN;
  // A flagged reading gets NO standing sentence. It used to print "closer to
  // the ideal than N% of men" — a percentile computed from the very value the
  // line underneath calls a misplaced point — so the card asserted a population
  // position and then denied the measurement in the next breath.
  // The read only exists when the value leans at least half an sd off the
  // average AND the metric's construction is settled — metricRead returns null
  // otherwise, and null renders as nothing rather than as filler.
  const read = m.implausible || indicative ? null : metricRead(m, sex);
  return `
    <p class="mdx-trait">It measures ${metricTrait(m.def.id)}.</p>
    <p class="mdx-norm">${normLine(m, sex)}</p>
    ${m.def.view === "side" || hasSideOverlay(m.def.id)
      ? `<p class="mdx-caveat">This profile reference is provisional. Photo angle and point placement affect the reading.</p>`
      : ""}
    ${constructionCaveat(m.def.id)
      ? `<p class="mdx-caveat">${constructionCaveat(m.def.id)}</p>`
      : ""}
    ${read ? `<p class="mdx-read"><b>On your face:</b> ${read}.</p>` : ""}
    ${m.implausible || indicative ? "" : `<p class="mdx-pos">${positionLine(m, sex)}</p>`}
    ${m.implausible
      ? `<p class="mdx-flag">${Number.isFinite(m.value) ? "This value did not pass the measurement checks. Review the photo and the points used for it." : "This measurement is unavailable because a required point or part of the geometry could not be read."} It is excluded from the score; this is not a negative result about your face.</p>`
      : ""}
    ${indicative && !m.implausible
      ? `<p class="mdx-flag soft">Indicative only: this measurement has low repeatability across photos. ${reliabilityOf(m.def.id) === 0 ? "It has no weight in the overall score." : "Its contribution is reduced by the reliability weighting."} Do not read it as a reliable strength or weakness.</p>`
      : ""}`;
}

export function celebsHTML(m: ScoredMetric, region: RegionId, sex: Sex): string {
  // An impossible reading is not a measurement, so it cannot be matched
  // against one. The matcher would happily oblige — its only test is
  // percentile >= 40, and an out-of-bounds value still carries a percentile —
  // so the gate has to be here.
  if (m.implausible || reliabilityOf(m.def.id) < RELIABLE_MIN) {
    return `<p class="mdx-none">There isn't a reliable measurement here to compare. Review the photo and landmarks first.</p>`;
  }
  // The matcher's eligibility rule, applied to exactly this metric, so a match
  // is "your X measures like theirs" and nothing vaguer.
  const matches = regionMatches(region, [m], sex);
  if (matches.length) {
    return `<p class="portrait-disclosure">${PORTRAIT_DISCLOSURE}</p>` + matches
      .map(
        (c) => {
          const value = CELEBS.find(entry => entry.name === c.name && entry.sex === sex)?.metrics[m.def.id];
          const reference = Number.isFinite(value) ? fmt({ ...m, value: value! }) : "Not available";
          return `<div class="mdx-celeb">${celebrityPortraitFigure(c.name)}
            <span class="mdx-celeb-nm">${c.name}<small>${c.metricName}</small>
              <span class="mdx-celeb-values">Reference <b>${reference}</b><br>Your reading <b>${fmt(m)}</b></span>
            </span></div>`;
        },
      )
      .join("") + celebrityPortraitCredits(matches.map(c => c.name));
  }
  // The two reasons are genuinely different and the copy has to match the
  // code. CELEB_MATCH_MIN_PCT is the matcher's real threshold — the previous
  // wording said "at or above average", which is a different number and put a
  // "Bottom 45%" chip next to a tab full of matches. And the second branch is
  // reached when no reference face carries this metric AT ALL (every profile
  // metric, today), not because a distance check rejected them — the matcher
  // has no proximity cap.
  return m.percentile < CELEB_MATCH_MIN_PCT
    ? `<p class="mdx-none">This comparison feature currently covers the top ${100 - CELEB_MATCH_MIN_PCT}% of model standings, so it doesn't offer a match for this reading. That is a limit of the feature, not a judgment about your face.</p>`
    : `<p class="mdx-none">The reference set doesn't include this measurement yet, so no comparison is available.</p>`;
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
    const z = zoomFor(m.def.region ?? opts.region, opts.landmarks);
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
  zoom.style.aspectRatio = `${src.width} / ${src.height}`;
  const size = rasterSizeFor(photo, src.width, src.height);
  if (photo.width !== size.width) photo.width = size.width;
  if (photo.height !== size.height) photo.height = size.height;
  photo.getContext("2d")!.drawImage(src, 0, 0, size.width, size.height);
  const overlay = active.querySelector<HTMLCanvasElement>(".mdx-overlay-canvas")!;
  if (overlay.width !== size.width) overlay.width = size.width;
  if (overlay.height !== size.height) overlay.height = size.height;
  shownStage = view;
}

function drawMetric(m: ScoredMetric, view: "side" | "front"): void {
  if (!active || !opts) return;
  const overlay = active.querySelector<HTMLCanvasElement>(".mdx-overlay-canvas")!;
  fade?.cancel();
  if (view === "side" && opts.sidePoints && opts.sidePhoto) {
    const size = rasterSizeFor(overlay, opts.sidePhoto.width, opts.sidePhoto.height);
    const points = sidePointsForRaster(opts.sidePoints, opts.sidePhoto.width, opts.sidePhoto.height, size.width, size.height);
    fade = animateSideMeasurement(overlay, points, size.width, size.height, m);
  } else if (opts.landmarks && opts.frontPhoto) {
    const size = rasterSizeFor(overlay, opts.frontPhoto.width, opts.frontPhoto.height);
    fade = animateMeasurement(overlay, opts.landmarks, size.width, size.height, m);
  }
}

// --- render ----------------------------------------------------------------

function showAt(next: number): void {
  if (!active || !opts) return;
  index = next;
  const m = opts.metrics[index];
  const view = stageViewFor(m, !!(opts.sidePhoto && opts.sidePoints), !!(opts.frontPhoto && opts.landmarks));
  // Cancel the old drawing immediately, including during a deferred photo
  // swap. The swap owner also restores opacity on rapid reversals.
  stagePaint?.cancel();
  fade?.cancel();
  fade = null;

  // NO STAGE IS NOT NO CARD. This used to `return` before writing a single
  // word, so a report whose front capture is unavailable — a documented state,
  // not a hypothetical — opened a permanently blank sheet. The numbers do not
  // need a photograph; only the drawing does.
  if (!view) {
    active.querySelector<HTMLElement>(".mdx-stage")!.classList.add("mdx-nostage");
  } else {
    active.querySelector<HTMLElement>(".mdx-stage")!.classList.remove("mdx-nostage");
  }
  const unavailablePhoto = active.querySelector<HTMLElement>(".mdx-unavailable")!;
  unavailablePhoto.hidden = !!view;
  unavailablePhoto.textContent = `The ${m.def.view === "side" || hasSideOverlay(m.def.id) ? "side" : "front"} photo for this measurement isn't available in this saved report. You can still read the measurement and move to the next one.`;

  // Header
  active.querySelector(".mdx-count")!.textContent = `${index + 1} / ${opts.metrics.length}`;
  active.querySelector(".mdx-title")!.textContent = m.def.name;
  const shownRegion = m.def.region ?? opts.region;
  active.querySelector(".mdx-eyebrow")!.textContent =
    [
      opts.deckLabel?.toUpperCase(),
      REGION_NAMES[shownRegion]?.toUpperCase() ?? shownRegion.toUpperCase(),
      m.def.view === "side" || hasSideOverlay(m.def.id) ? "PROFILE" : "FRONT",
    ]
      .filter(Boolean)
      .join(" · ");

  // Stage: pan the camera. Swapping photographs cannot pan, so that one case
  // dips through black instead — a cut, not a glitch.
  const zoomEl = active.querySelector<HTMLElement>(".mdx-zoom")!;
  if (view) {
    const spec = stageZoom(m, view);
    if (view !== shownStage) {
      stagePaint?.run(() => {
        if (!active) return;
        paintStage(view);
        zoomEl.style.transition = "none";
        applyZoom(zoomEl, spec);
        drawMetric(m, view);
        // Reflow so the no-transition zoom lands before transitions resume.
        void zoomEl.offsetWidth;
        zoomEl.style.transition = "";
      }, prefersReducedOverlayMotion() ? 0 : 150);
    } else {
      applyZoom(zoomEl, spec);
      drawMetric(m, view);
    }
  }

  // The camera carries the transition. Keep text immediately readable rather
  // than forcing synchronous layout to restart every child's entrance.
  const info = active.querySelector<HTMLElement>(".mdx-info")!;
  info.querySelector(".mdx-value")!.textContent = fmt(m);
  const indicative = reliabilityOf(m.def.id) < RELIABLE_MIN;
  const unavailable = !!m.implausible || indicative;
  const fit = metricFit(m, opts.sex);
  const stage = active.querySelector<HTMLElement>(".mdx-stage")!;
  stage.classList.remove("tone-hi", "tone-mid", "tone-lo");
  stage.dataset.fit = fit.state;
  const fitChip = info.querySelector<HTMLElement>(".mdx-fit")!;
  fitChip.textContent = fit.label;
  fitChip.dataset.fit = fit.state;
  const score = info.querySelector<HTMLElement>(".mdx-score")!;
  score.textContent = metricModelScoreLabel(m);
  const scoreNote = info.querySelector<HTMLElement>(".mdx-modelscore small")!;
  scoreNote.hidden = score.textContent === "Not scored";
  scoreNote.textContent = "Used in TrueMax's combined scoring. This is not a percentage of reference fit or a validated population rank.";
  // No population bar for an impossible reading — its marker sits at phi(z) of
  // a value that is not a face, pinned to one end and presented as a position.
  // The side deck already suppresses exactly this on its rows.
  info.querySelector<HTMLElement>(".mdx-barhost")!.innerHTML = unavailable ? "" : barHTML(m, opts.sex);
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
    b.setAttribute("aria-pressed", String(b.dataset.tab === tab));
  }
  const body = active.querySelector<HTMLElement>(".mdx-tabbody")!;
  body.innerHTML =
    tab === "overview" ? overviewHTML(m, opts.sex) : celebsHTML(m, m.def.region ?? opts.region, opts.sex);
}

export function openMetricDetail(o: MetricDetailOpts): void {
  if (!o.metrics.length) return;
  installCelebrityPortraitFallback();
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
      <div><span class="mdx-eyebrow"></span><h3 class="mdx-title" aria-live="polite"></h3></div>
      <span class="mdx-count"></span>
      <button class="mdx-close" aria-label="Close">✕</button>
    </header>
    <div class="mdx-grid">
      <div class="mdx-stage">
        <p class="mdx-unavailable" role="status" hidden></p>
        <div class="mdx-zoom">
          <canvas class="mdx-photo"></canvas>
          <canvas class="mdx-overlay-canvas"></canvas>
        </div>
        <button class="mdx-step mdx-prev" aria-label="Previous measurement">‹</button>
        <button class="mdx-step mdx-next" aria-label="Next measurement">›</button>
      </div>
      <div class="mdx-info">
        <p class="mdx-decknote"></p>
        <div class="mdx-readout">
          <b class="mdx-value"></b>
          <span class="mdx-chip mdx-fit"></span>
        </div>
        <p class="mdx-modelscore"><span class="mdx-score"></span><small></small></p>
        <div class="mdx-barhost"></div>
        <nav class="mdx-tabs">
          <button class="mdx-tab" data-tab="overview">Overview</button>
          <button class="mdx-tab" data-tab="celebs">Celebrities</button>
        </nav>
        <div class="mdx-tabbody"></div>
      </div>
    </div>
  </div>`;

  // Dismiss on the backdrop only when the gesture BEGAN there. A click fires
  // on the common ancestor of its down and up targets, so a swipe that starts
  // on the stage and releases past the card's edge — easy on a phone, and the
  // narrower the card the easier — was landing as a backdrop click and closing
  // the card mid-gesture.
  let downOnBackdrop = false;
  wrap.addEventListener("pointerdown", (e) => {
    downOnBackdrop = e.target === wrap;
  });
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap && downOnBackdrop) closeMetricDetail();
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
  stagePaint = createStagePaint((hidden) => stage.classList.toggle("swap", hidden));
  let downX: number | null = null;
  stage.addEventListener("pointerdown", (e) => (downX = e.clientX));
  stage.addEventListener("pointerup", (e) => {
    if (downX === null) return;
    const dx = e.clientX - downX;
    downX = null;
    if (Math.abs(dx) > 44) step(dx < 0 ? 1 : -1);
  });

  const note = wrap.querySelector<HTMLElement>(".mdx-decknote")!;
  note.textContent = o.deckNote ?? "";
  note.hidden = !o.deckNote;

  document.addEventListener("keydown", onKey);
  // The report behind a fixed dialog must not scroll under it.
  document.body.classList.add("mdx-open");
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
