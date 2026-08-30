import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { REGION_NAMES, phi } from "../engine/scoring.js";
import { directionFor, distFor } from "../engine/metrics.js";
import { statedPct } from "../engine/precision.js";
import { CELEB_MATCH_MIN_PCT, regionMatches } from "../engine/celebs.js";
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
import { metricRead } from "../engine/metricReads.js";

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
// The pending photograph swap, and the render it belongs to.
//
// The swap is deferred 150ms so the stage can dip through black, and the
// timeout captured the metric, the view and the zoom. Untracked, a second
// showAt inside that window — arrow-key autorepeat fires every ~30-50ms, and a
// swipe-back or a double-tap on next/prev do it just as easily — let the older
// callback land AFTER the newer one, painting the previous measurement's
// photograph and drawing under the new metric's header. Cancelled on every new
// render and on close, and version-guarded so a timer that somehow survives
// still refuses to paint over a render it does not belong to.
let swapTimer: number | null = null;
let generation = 0;
// Where focus came from, so closing puts a keyboard user back on their row
// rather than at the top of the document.
let opener: HTMLElement | null = null;

export function isMetricDetailOpen(): boolean {
  return active !== null;
}

export function closeMetricDetail(): void {
  fade?.cancel();
  fade = null;
  if (swapTimer !== null) window.clearTimeout(swapTimer);
  swapTimer = null;
  generation++;
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
    closeMetricDetail();
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
  browTilt:
    "Measured inner-end to outer-end on the mesh, which sits lower at the outer end than the brow's visible tail — so this number runs about 12° below the same measurement taken to the brow peak. Comparisons within TrueMax hold; the raw figure is not comparable to one quoted elsewhere.",
  jawFrontalAngle:
    "Constructed differently from the same-named angle in other tools, which read about 26° apart on the same face. Comparisons within TrueMax hold; the raw figure is not comparable to one quoted elsewhere.",
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
  const avg = `${group} average <b>${noNegZero(d.mean.toFixed(dec))}${unit}</b> ± ${d.sd.toFixed(dec)}`;
  const dir = directionFor(m.def, sex);
  if (dir === "band") {
    return `${avg} · ideal <b>${m.idealRange[0].toFixed(dec)}–${m.idealRange[1].toFixed(dec)}${unit}</b>`;
  }
  const edge = dir === "lower" ? m.idealRange[1] : m.idealRange[0];
  return `${avg} · ${dir === "lower" ? "lower is better, from" : "higher is better, from"} <b>${edge.toFixed(dec)}${unit}</b>`;
}

function positionLine(m: ScoredMetric, sex: Sex): string {
  const group = sex === "male" ? "men" : "women";
  if (m.conformance >= 0.999) {
    return `Inside the ideal band — this feature is not holding the face back at all.`;
  }
  // statedPct, like the chip beside it. Math.round put the same number on the
  // screen twice at two precisions — "Bottom 45%" over "closer to the ideal
  // than 43% of men" — and the finer of the two is a resolution a ~110-face
  // reference set cannot support in the first place.
  return `Closer to the ideal than <b>${statedPct(m.percentile)}%</b> of ${group}.`;
}

function overviewHTML(m: ScoredMetric, sex: Sex): string {
  const indicative = reliabilityOf(m.def.id) < RELIABLE_MIN;
  // A flagged reading gets NO standing sentence. It used to print "closer to
  // the ideal than N% of men" — a percentile computed from the very value the
  // line underneath calls a misplaced point — so the card asserted a population
  // position and then denied the measurement in the next breath.
  // The read only exists when the value leans at least half an sd off the
  // average AND the metric's construction is settled — metricRead returns null
  // otherwise, and null renders as nothing rather than as filler.
  const read = m.implausible ? null : metricRead(m, sex);
  return `
    <p class="mdx-trait">It measures ${metricTrait(m.def.id)}.</p>
    <p class="mdx-norm">${normLine(m, sex)}</p>
    ${constructionCaveat(m.def.id)
      ? `<p class="mdx-caveat">${constructionCaveat(m.def.id)}</p>`
      : ""}
    ${read ? `<p class="mdx-read"><b>On your face:</b> ${read}.</p>` : ""}
    ${m.implausible ? "" : `<p class="mdx-pos">${positionLine(m, sex)}</p>`}
    ${m.implausible
      ? `<p class="mdx-flag">This reading fell outside the range a face occupies, so it is treated as a misplaced point rather than a measurement. It has no population position and it moves nothing — the landmarks behind it need re-checking.</p>`
      : ""}
    ${indicative && !m.implausible
      ? `<p class="mdx-flag soft">Shown, not scored: across many photos of the same people this one moves as much between two photos of one face as between two different faces, so it carries no weight.</p>`
      : ""}`;
}

function celebsHTML(m: ScoredMetric, region: RegionId, sex: Sex): string {
  // An impossible reading is not a measurement, so it cannot be matched
  // against one. The matcher would happily oblige — its only test is
  // percentile >= 40, and an out-of-bounds value still carries a percentile —
  // so the gate has to be here.
  if (m.implausible) {
    return `<p class="mdx-none">No comparison is offered on a reading this far outside anatomical range: it describes where a point landed, not the face. Re-check the landmarks and it will match on the corrected value.</p>`;
  }
  // The matcher's eligibility rule, applied to exactly this metric, so a match
  // is "your X measures like theirs" and nothing vaguer.
  const matches = regionMatches(region, [m], sex);
  if (matches.length) {
    return matches
      .map(
        (c) => `<div class="mdx-celeb"><span class="mdx-ava">${c.name[0]}</span>
          <span class="mdx-celeb-nm">${c.name}<small>${c.metricName}</small></span></div>`,
      )
      .join("");
  }
  // The two reasons are genuinely different and the copy has to match the
  // code. CELEB_MATCH_MIN_PCT is the matcher's real threshold — the previous
  // wording said "at or above average", which is a different number and put a
  // "Bottom 45%" chip next to a tab full of matches. And the second branch is
  // reached when no reference face carries this metric AT ALL (every profile
  // metric, today), not because a distance check rejected them — the matcher
  // has no proximity cap.
  return m.percentile < CELEB_MATCH_MIN_PCT
    ? `<p class="mdx-none">Comparisons are only offered where you place in the top ${100 - CELEB_MATCH_MIN_PCT}% on the measurement, and this one sits below that. A flattering comparison you did not earn would make every other number here worth less.</p>`
    : `<p class="mdx-none">No reference face in the set carries this measurement yet, so there is nothing to compare against. The set grows with every analyzed face.</p>`;
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
  // A render supersedes any swap still pending from the last one.
  if (swapTimer !== null) window.clearTimeout(swapTimer);
  swapTimer = null;
  const mine = ++generation;

  // NO STAGE IS NOT NO CARD. This used to `return` before writing a single
  // word, so a report whose front capture is unavailable — a documented state,
  // not a hypothetical — opened a permanently blank sheet. The numbers do not
  // need a photograph; only the drawing does.
  if (!view) {
    active.querySelector<HTMLElement>(".mdx-stage")!.classList.add("mdx-nostage");
  } else {
    active.querySelector<HTMLElement>(".mdx-stage")!.classList.remove("mdx-nostage");
  }

  // Header
  active.querySelector(".mdx-count")!.textContent = `${index + 1} / ${opts.metrics.length}`;
  active.querySelector(".mdx-title")!.textContent = m.def.name;
  const shownRegion = m.def.region ?? opts.region;
  active.querySelector(".mdx-eyebrow")!.textContent =
    [
      opts.deckLabel?.toUpperCase(),
      REGION_NAMES[shownRegion]?.toUpperCase() ?? shownRegion.toUpperCase(),
      view === "side" ? "PROFILE" : "FRONT",
    ]
      .filter(Boolean)
      .join(" · ");

  // Stage: pan the camera. Swapping photographs cannot pan, so that one case
  // dips through black instead — a cut, not a glitch.
  const zoomEl = active.querySelector<HTMLElement>(".mdx-zoom")!;
  if (view) {
    const spec = stageZoom(m, view);
    if (view !== shownStage) {
      const stage = active.querySelector<HTMLElement>(".mdx-stage")!;
      stage.classList.add("swap");
      swapTimer = window.setTimeout(() => {
        swapTimer = null;
        // The guard that makes the cancel above belt-and-braces rather than
        // load-bearing: a timer from a superseded render refuses to paint.
        if (mine !== generation || !active) return;
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
  }

  // Readout + tabs, re-entering with a small rise so the change reads.
  const info = active.querySelector<HTMLElement>(".mdx-info")!;
  info.classList.remove("enter");
  void info.offsetWidth;
  info.classList.add("enter");
  info.querySelector(".mdx-value")!.textContent = fmt(m);
  info.querySelector(".mdx-score")!.textContent = m.implausible ? "—" : m.score.toFixed(1);
  info.querySelector(".mdx-rank")!.textContent = m.implausible ? "re-check" : rankShort(m.percentile);
  // No population bar for an impossible reading — its marker sits at phi(z) of
  // a value that is not a face, pinned to one end and presented as a position.
  // The side deck already suppresses exactly this on its rows.
  info.querySelector<HTMLElement>(".mdx-barhost")!.innerHTML = m.implausible ? "" : barHTML(m, opts.sex);
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
  body.innerHTML =
    tab === "overview" ? overviewHTML(m, opts.sex) : celebsHTML(m, m.def.region ?? opts.region, opts.sex);
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
        <p class="mdx-decknote"></p>
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
