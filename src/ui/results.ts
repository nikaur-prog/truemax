import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { aggregateScoreToPercentile, phi, REGION_NAMES } from "../engine/scoring.js";
import type { RegionId, RegionScore, Report, ScoredMetric, Sex } from "../engine/types.js";
import type { ScanDelta } from "../engine/history.js";
import type { SidePoints } from "../engine/sideMetrics.js";
import { SIDE_POINTS } from "../engine/sideMetrics.js";
import { hasHistory, openHistory } from "./historyView.js";
import { regionMatches } from "../engine/celebs.js";
import { curveLegend, curveSVG } from "./curve.js";
import { REGION_LANDMARKS, zoomFor } from "./regions.js";
import { drawCalm, transitionRegion } from "./overlay.js";
import { animateMeasurement, transitionMeasurement } from "./measureOverlay.js";
import type { OverlayFade } from "./measureOverlay.js";
import { animateSideMeasurement, hasSideOverlay } from "./sideMeasureOverlay.js";
import { renderShareCard, shareCard } from "./shareCard.js";
import { deltaReadingCopy, overviewCaveat, fmt, leverFor, lockedCopy, percentileLine, rankShort, rarityText, regionSummary, topPctText } from "./templates.js";
import { stopTypewriter, typewrite } from "./typewriter.js";
import { chosenGoals, goalBoost, goalsTouching, isQuiet, loadProfile, skinConcernLabels } from "../engine/goals.js";
import { openQuiz } from "./goalsQuiz.js";
import { EVIDENCE_LABEL, recsFor } from "../engine/recommendations.js";
import { startScanCreditCheckout } from "../engine/entitlement.js";
import { scanPrice } from "../engine/scanPricing.js";
import { REFERENCE_N, statedPct } from "../engine/precision.js";
import { RELIABLE_MIN, reliabilityOf } from "../engine/reliability.js";
import { track } from "../engine/track.js";
import type { Depth } from "../engine/depth.js";
import { GOALS } from "../engine/goals.js";
import { ANALYSIS_MODES, basicScores, loadAnalysisMode, loadVerdictTone, saveAnalysisMode, verdictFor, verdictForPercentile } from "../engine/analysisMode.js";
import { askVerdictTone } from "./tonePrompt.js";
import { scaleTrigger, showScalePrimer, wireScaleNote } from "./scaleNote.js";
// Aliased: this module already has a rarityLine for a REGION row, which says a
// different thing ("across the jaw") than the headline one.
import { rarityLine as scaleRarityLine, rarityShort } from "../engine/rarity.js";
import type { AnalysisMode } from "../engine/analysisMode.js";
import { buildMaxContext } from "../engine/maxContext.js";
import { maxCharacterMarkup } from "./maxCharacter.js";
import type { MaxMood } from "./maxCharacter.js";
import { readAllHistory } from "../engine/history.js";
import { renderScoreStrip } from "./scoreStrip.js";
import { mountMaxPet, unmountMaxPet } from "./maxPet.js";
import { openMaxChat } from "./maxChat.js";
import { ceilingCtaMarkup, paintCeilingCta } from "./ceilingCta.js";

interface Ctx {
  report: Report;
  delta: ScanDelta | null;
  landmarks: NormalizedLandmark[];
  photoW: number;
  photoH: number;
  analysis: HTMLElement;
  zoomable: HTMLElement;
  overlay: HTMLCanvasElement;
  onNewPhoto: () => void;
  // Opens the plan chooser. Absent on a build with no billing configured, in
  // which case the upgrade button simply is not rendered rather than dead.
  onUpgrade?: () => void;
  onContinue?: () => void;
  onSideProfile?: () => void;
  onSexChange?: (sex: Sex) => void;
  // The side half of a merged report, so it can be looked at. It was computed,
  // merged into the total and then unreachable — renderSideResults existed and
  // nothing called it, so a quarter of the score had no screen.
  sideReport?: Report;
  sidePhoto?: HTMLCanvasElement;
  // The thirteen verified points, in the side photo's own pixel space, so the
  // Side tab can draw them where they were actually placed. Without these the
  // tab fell back to drawing the FRONT mesh at FRONT coordinates over the side
  // photo — a dense cloud in the wrong place that read exactly like "my points
  // jumped somewhere else after I confirmed them".
  sidePoints?: SidePoints;
  onRedoSide?: () => void;
  // How far off level the front capture was, in degrees. The pose is corrected
  // before measurement, but the correction has residual error and the jaw and
  // chin take most of it — so beyond a few degrees the Basic grid says so
  // rather than presenting a dragged-down number with full confidence.
  offAxisDeg?: number;
}

let ctx: Ctx | null = null;

export function renderResults(c: Ctx): void {
  ctx = c;
  // The curve is taught before the first number is ever shown. Fire-and-forget
  // rather than awaited: the panel behind it renders as normal and the primer
  // covers it, so a storage failure or a dismissed dialog can never leave
  // somebody staring at an empty results screen.
  void showScalePrimer(c.report.sex);
  wireScaleNote(() => ctx?.report.sex ?? "male");
  wireMaxAsk();
  // A previous report may have been left on its side photograph. main.ts has
  // already painted the new front capture; reset the cached state so this scan
  // cannot restore the previous person's canvas or stale quality chips.
  shownPhoto = "front";
  frontPhoto = null;
  frontQualityHTML = document.getElementById("quality-chips")?.innerHTML ?? "";
  // The score under the photograph, for the phone layout where the analysis
  // column starts below the fold. Rendered here rather than inside showOverall
  // because it belongs to the SCAN, not to the tab: switching to Proportions
  // must not take the headline number off the screen.
  renderScoreStrip(c.report);

  // Plan holders get Max himself, peeking from the edge of the screen with
  // this scan's numbers in hand. Everybody else gets the card (askMaxCard),
  // and under-18s get neither — the standing rule for every Max surface.
  if (maxAccess && adultUser) {
    const cc = chatContext();
    if (cc) mountMaxPet(cc);
  } else {
    unmountMaxPet();
  }
  // A new scan starts from the calm whole-face state. Without this the first
  // tab change after re-scanning would animate out of the PREVIOUS photo's
  // region, which is a transition from somewhere the user never was.
  transition?.cancel();
  transition = null;
  shownRegion = null;
  const tabs = document.createElement("div");
  tabs.className = "rtabs";

  // The Side tab is gone from this row: it is not a ninth region, it is the
  // other half of the scan, and burying it among eight regions made a quarter
  // of the score and fifteen measurements read as a footnote. It is now the
  // toggle under the photograph.
  const toggle = document.getElementById("view-toggle");
  if (toggle) {
    toggle.classList.toggle("hidden", !c.sideReport);
    for (const b of toggle.querySelectorAll<HTMLButtonElement>(".vt-btn")) {
      b.onclick = () => select(b.dataset.view === "side" ? "side" : "overall");
    }
  }

  c.analysis.innerHTML = "";
  c.analysis.appendChild(tabs);
  const body = document.createElement("div");
  body.id = "body";
  c.analysis.appendChild(body);
  tabView = "front";
  buildTabs("front");
  select("overall");
}

// Which half of the scan the tab row is currently describing.
let tabView: "front" | "side" = "front";

// The tab row belongs to the view, not to the report.
//
// It used to be built once, from the front regions, and stayed that way when
// you switched to the profile — so the side had eight tabs across the top that
// all took you back to the front photograph, and its own fifteen measurements
// were stacked into one scrolling body underneath. The profile has regions of
// its own; they should be reachable the same way the front's are.
function buildTabs(view: "front" | "side"): void {
  if (!ctx) return;
  const tabs = ctx.analysis.querySelector<HTMLElement>(".rtabs");
  if (!tabs) return;
  tabs.innerHTML = "";
  const mk = (label: string, id: string) => {
    const b = document.createElement("button");
    b.className = "rtab";
    b.textContent = label;
    b.dataset.id = id;
    b.onclick = () => select(id);
    tabs.appendChild(b);
  };
  if (view === "side" && ctx.sideReport) {
    mk("Profile", "side");
    for (const r of ctx.sideReport.regions) {
      if (r.metrics.length) mk(REGION_NAMES[r.region], `side:${r.region}`);
    }
    return;
  }
  mk(maxAccess && adultUser ? "Max’s analysis" : "Overall", "overall");
  for (const r of ctx.report.regions) mk(REGION_NAMES[r.region], r.region);
  mk("Plan →", "improve");
}

// Overall, front and side side by side, so the merge is legible: two views went
// in and one number came out, and you can see which one pulled which way.
//
// Only drawn once both views are in. On a front-only report the front card
// would be a copy of the overall card and the side card would be empty, which
// is three boxes to say what one already said.
function viewCards(r: Report): string {
  if (!r.views) return "";
  const cards: Array<[string, number, number]> = [
    ["OVERALL", r.overall, r.overallPercentile],
    ["FRONT", r.views.front.score, r.views.front.percentile],
    ["SIDE", r.views.side.score, r.views.side.percentile],
  ];
  return `<div class="viewcards">${cards
    .map(([label, score, pct]) => {
      const tone = score >= 6.5 ? "hi" : score >= 4.5 ? "mid" : "lo";
      return `<div class="viewcard${label === "OVERALL" ? " lead" : ""}">
        <span class="vc-label">${label}</span>
        <span class="vc-rank">${rankShort(pct)}</span>
        <b class="vc-score ${tone}"><span data-count="${score}" data-decimals="2">0.00</span><small>/10</small></b>
      </div>`;
    })
    .join("")}</div>`;
}

function select(id: string): void {
  if (!ctx) return;
  stopTypewriter();
  const onSide = id === "side" || id.startsWith("side:");
  // Swap the tab row before marking one selected, or the mark lands on buttons
  // that are about to be thrown away.
  const view = onSide ? "side" : "front";
  if (view !== tabView) {
    tabView = view;
    buildTabs(view);
  }
  for (const b of ctx.analysis.querySelectorAll<HTMLButtonElement>(".rtab")) {
    b.classList.toggle("sel", b.dataset.id === id);
  }
  // The photo pane follows the tab: the side numbers next to the front
  // photograph would be describing a picture that is not on screen.
  showPhoto(onSide ? "side" : "front");
  // Keep the view toggle in step, however the view was reached — a region tab,
  // the Plan, or the toggle itself.
  for (const b of document.querySelectorAll<HTMLButtonElement>("#view-toggle .vt-btn")) {
    b.classList.toggle("on", (b.dataset.view === "side") === onSide);
  }
  if (id === "overall") showOverall();
  else if (id === "improve") showImprove();
  else if (id === "side") showSide();
  else if (onSide) showSideRegion(id.slice(5) as RegionId);
  else showRegion(id as RegionId);
}

// Which region the overlay is currently lit for, so a transition knows what it
// is coming FROM. Null means the calm whole-face state.
let shownRegion: RegionId | null = null;
let transition: { cancel(): void } | null = null;

function setZoom(region: RegionId | null): void {
  if (!ctx) return;
  // A fast tab-to-tab click must not leave two animations fighting over the
  // same canvas; the newer one wins outright.
  transition?.cancel();
  transition = null;

  if (region) {
    const z = zoomFor(region, ctx.landmarks);
    ctx.zoomable.style.transformOrigin = `${z.originX}% ${z.originY}%`;
    ctx.zoomable.style.transform = `scale(${z.scale})`;
    // The same point, handed to the shrunk layout as a crop.
    //
    // Once the pane collapses to a 96px strip the canvas is cropped by
    // object-fit, and that crop was pinned to "center 34%" — the upper third,
    // chosen so the strip showed a face rather than hair. Fixed, though, so it
    // showed the FOREHEAD whatever region was selected: tap Eyes, tap Jaw, tap
    // Chin, same forehead. The transform above still ran underneath it and was
    // simply not what you were looking at.
    //
    // Only read while shrunk (see the custom properties in style.css), so the
    // full-size pane keeps its centred framing and goes on being driven by the
    // transform alone.
    ctx.zoomable.style.setProperty("--crop-x", `${z.originX}%`);
    ctx.zoomable.style.setProperty("--crop-y", `${z.originY}%`);
  } else {
    ctx.zoomable.style.transform = "none";
    // Back to the framing that shows a whole face in a strip.
    ctx.zoomable.style.removeProperty("--crop-x");
    ctx.zoomable.style.removeProperty("--crop-y");
  }

  const from = shownRegion ? REGION_LANDMARKS[shownRegion] : undefined;
  const to = region ? REGION_LANDMARKS[region] : undefined;
  shownRegion = region;

  // Nothing to animate between on the very first paint of the calm state.
  if (!from && !to) {
    drawCalm(ctx.overlay, ctx.landmarks, ctx.photoW, ctx.photoH);
    return;
  }
  transition = transitionRegion(ctx.overlay, ctx.landmarks, ctx.photoW, ctx.photoH, from, to);
}

function body(): HTMLElement {
  return document.getElementById("body")!;
}

// Swap the photo pane between the two captures. Both were taken; only one was
// ever shown.
let shownPhoto: "front" | "side" = "front";
let frontQualityHTML = "";
function showPhoto(which: "front" | "side"): void {
  if (!ctx || which === shownPhoto) return;
  const canvas = document.getElementById("photo-canvas") as HTMLCanvasElement | null;
  const cap = document.getElementById("capRight");
  const label = document.querySelector(".photo-caption span");
  const quality = document.getElementById("quality-chips");
  if (!canvas) return;

  if (which === "side" && ctx.sidePhoto) {
    frontPhoto = frontPhoto ?? cloneCanvas(canvas);
    paint(canvas, ctx.sidePhoto);
    ctx.overlay.getContext("2d")?.clearRect(0, 0, ctx.overlay.width, ctx.overlay.height);
    if (label) label.textContent = "SIDE";
    if (cap) cap.textContent = "POINTS CHECKED";
    if (quality) {
      quality.innerHTML = `<span class="qchip">Profile capture</span><span class="qchip">13 landmarks checked by you</span>`;
    }
    shownPhoto = "side";
  } else if (which === "front" && frontPhoto) {
    paint(canvas, frontPhoto);
    drawCalm(ctx.overlay, ctx.landmarks, ctx.photoW, ctx.photoH);
    if (label) label.textContent = "FRONT";
    if (cap) cap.textContent = "ANALYZED";
    if (quality) quality.innerHTML = frontQualityHTML;
    shownPhoto = "front";
  }
}
let frontPhoto: HTMLCanvasElement | null = null;
function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  c.getContext("2d")!.drawImage(src, 0, 0);
  return c;
}
function paint(dst: HTMLCanvasElement, src: HTMLCanvasElement): void {
  dst.width = src.width;
  dst.height = src.height;
  const g = dst.getContext("2d")!;
  g.clearRect(0, 0, dst.width, dst.height);
  g.drawImage(src, 0, 0);
}

// The side view, inside the tabbed report rather than as a separate screen.
function showSide(): void {
  if (!ctx?.sideReport) return;
  calmSide();
  // The depth toggle applies to the profile too. Somebody who chose "one line"
  // for the front did not choose "fifteen measurements" for the side; the
  // preference is about them, not about which photograph is on screen.
  const mode = loadAnalysisMode();
  if (mode !== "full") {
    showSideShallow(mode, ctx.sideReport);
    return;
  }
  renderSideInto(body(), ctx.sideReport);
  wireSideMeasurementTaps(ctx.sideReport);
}

// Verdict and Basic for the profile, mirroring the front's shallow modes. Same
// ladder, same grid markup, side numbers — presentation only, nothing here
// computes a score.
function showSideShallow(mode: AnalysisMode, report: Report): void {
  const inner = mode === "verdict" ? sideVerdictHTML(report) : sideBasicHTML(report);
  body().innerHTML = `<div class="reveal">
    ${inner}
    ${modeSwitcher(mode)}
    ${sideNav()}
  </div>`;
  wireModeSwitcher(showSide);
  wireSideNav();
  const lead = body().querySelector<HTMLElement>(".basic-n");
  if (lead) {
    const target = Number(lead.dataset.count);
    if (Number.isFinite(target)) countUp(lead, target, 0, 60);
  }
}

function sideVerdictHTML(report: Report): string {
  const v = verdictForPercentile(report.overallPercentile, report.sex, loadVerdictTone() ?? "blunt");
  return `<div class="verdict ${v.tone}">
    <span class="verdict-label">SIDE PROFILE VERDICT</span>
    <b class="verdict-word">${v.word}</b>
    <p class="verdict-line">${v.line}</p>
  </div>`;
}

function sideBasicHTML(report: Report): string {
  const regions = report.regions.filter((r) => r.metrics.length);
  const measured = regions.reduce((n, r) => n + r.metrics.length, 0);
  const lead = statedPct(report.overallPercentile);
  return `<div class="basic">
    <div class="basic-lead">
      <span class="klabel">SIDE PROFILE ${scaleTrigger()}</span>
      <b><span class="basic-n" data-count="${lead}" data-decimals="0">${lead}</span><small>/100</small></b>
      <em class="basic-rarity">${scaleRarityLine(lead)}</em>
    </div>
    <div class="basic-grid">
      ${regions
        .map(
          (r) => `<div class="basic-cell">
        <span>${REGION_NAMES[r.region].toUpperCase()}</span>
        <b>${statedPct(r.percentile)}</b>
        <i style="width:${statedPct(r.percentile)}%"></i>
        <em>${rarityShort(r.percentile)}</em>
      </div>`,
        )
        .join("")}
    </div>
    <p class="basic-note">Percentiles against the ${report.sex} reference set, measured from the profile alone. The full mode shows the ${measured} measurements these come from.</p>
  </div>`;
}

// One region of the profile, reached from the side-specific tab row. Same shape
// as a front region tab — measurements, comparisons, population position — with
// no zoom, because the side view has no landmark mesh to re-light.
function showSideRegion(id: RegionId): void {
  if (!ctx?.sideReport) return;
  const report = ctx.sideReport;
  const r = report.regions.find((x) => x.region === id);
  if (!r) return select("side");
  calmSide();

  body().innerHTML = `
    <div class="reveal">
      ${sideRegionDeck(r, report)}
      <div class="panel"><h4>${REGION_NAMES[id].toUpperCase()} · IN PROFILE</h4>${curveSVG(r.percentile, `region:${id}`, report.sex, true)}
        ${curveLegend()}
        <p class="rarity">${rarityLine(r)}</p></div>
    </div>`;

  revealBars();
  wireSideMeasurementTaps(report);
}

// The resting state of any side tab: no zoom, no front mesh, just the thirteen
// points where they were verified.
function calmSide(): void {
  if (!ctx) return;
  // Deliberately NOT setZoom(null): that draws the front mesh (ctx.landmarks,
  // at front photoW/photoH) onto the overlay, and over the side photograph that
  // lands as a dense cloud of points nowhere near the face.
  transition?.cancel();
  transition = null;
  shownRegion = null;
  ctx.zoomable.style.transform = "none";
  drawSidePoints();
}

function revealBars(): void {
  setTimeout(
    () =>
      document
        .querySelectorAll<HTMLElement>(".rangebar i")
        .forEach((i) => (i.style.left = `${i.dataset.l}%`)),
    120,
  );
}

// Hover a side measurement row → draw that measurement's real construction on
// the profile photo, the same credibility gesture the front regions have. The
// calm state is the thirteen verified points; leaving a row returns to them.
let sideActive: string | null = null;
let sidePinned: string | null = null;
let sideFade: OverlayFade | null = null;
function wireSideMeasurementTaps(report: Report): void {
  if (!ctx?.sidePoints || !ctx.sidePhoto) return;
  const pts = ctx.sidePoints;
  const w = ctx.sidePhoto.width;
  const h = ctx.sidePhoto.height;
  const metrics = report.regions.flatMap((r) => r.metrics);
  sideActive = null;
  sidePinned = null;
  sideFade?.cancel();
  sideFade = null;

  const hints = Array.from(document.querySelectorAll<HTMLElement>(".side-tap-hint"));
  const setHints = (name: string | null, pinned: boolean) => {
    for (const hint of hints) {
      hint.classList.toggle("on", !!name);
      hint.innerHTML = name
        ? `<i>◱</i>Drawing <b>${name}</b>${pinned ? " (click again to release)" : ""}`
        : `<i>◱</i>Hover a measurement to draw it on your profile`;
    }
  };

  const show = (id: string | null) => {
    if (!ctx || id === sideActive) return;
    sideActive = id;
    const metric = id ? metrics.find((m) => m.def.id === id) : null;
    for (const other of document.querySelectorAll(".metric[data-side-metric]")) {
      other.classList.toggle("active", (other as HTMLElement).dataset.sideMetric === id);
    }
    setHints(metric?.def.name ?? null, sidePinned === id && !!id);
    sideFade?.cancel();
    if (metric) {
      sideFade = animateSideMeasurement(ctx.overlay, pts, w, h, metric);
    } else {
      drawSidePoints();
    }
  };

  for (const row of document.querySelectorAll<HTMLElement>(".metric[data-side-metric]")) {
    const id = row.dataset.sideMetric!;
    if (!hasSideOverlay(id)) continue;
    row.onpointerenter = (e) => {
      if (e.pointerType === "touch") return;
      show(id);
    };
    row.onpointerleave = (e) => {
      if (e.pointerType === "touch") return;
      show(sidePinned);
    };
    row.onclick = () => {
      sidePinned = sidePinned === id ? null : id;
      show(sidePinned ?? id);
      const m = metrics.find((x) => x.def.id === id);
      setHints(m?.def.name ?? null, sidePinned === id);
    };
  }
}

// The verified side points on the overlay, sized to the side photo so pixel
// coordinates line up. Static (no animation) — this is the resting state of the
// Side tab, not the reveal.
function drawSidePoints(): void {
  if (!ctx) return;
  const overlay = ctx.overlay;
  const src = ctx.sidePhoto;
  const pts = ctx.sidePoints;
  const g = overlay.getContext("2d");
  if (!g) return;
  if (!src || !pts) {
    g.clearRect(0, 0, overlay.width, overlay.height);
    return;
  }
  overlay.width = src.width;
  overlay.height = src.height;
  g.clearRect(0, 0, src.width, src.height);
  const r = Math.max(3, src.width / 150);
  for (const p of Object.values(pts)) {
    g.beginPath();
    g.arc(p.x, p.y, r, 0, Math.PI * 2);
    g.fillStyle = "rgba(255,255,255,0.9)";
    g.fill();
    g.lineWidth = Math.max(1, r * 0.3);
    g.strokeStyle = "rgba(10,20,17,0.7)";
    g.stroke();
  }
}

function deltaChip(delta: number, label: string): string {
  const cls = delta > 0.05 ? "up" : delta < -0.05 ? "down" : "flat";
  const sign = delta > 0 ? "+" : "";
  return `<span class="delta-chip ${cls}">${sign}${delta.toFixed(1)} ${label}</span>`;
}

// ---------------- overall ----------------
function showOverall(): void {
  if (!ctx) return;
  const { report: r, delta } = ctx;
  setZoom(null);
  // Verdict and Basic are whole-screen answers, not sections of the full one.
  // Someone who picked "one line" and then has to scroll past the population
  // curve to reach it did not get what they asked for.
  const mode = loadAnalysisMode();
  if (mode !== "full") {
    showShallow(mode);
    return;
  }
  // Two chips when there is a running average: "vs last scan" answers whether
  // it moved since Tuesday, "vs average" answers where the face usually lands —
  // the steadier of the two against a noisy instrument.
  const deltaHTML = delta
    ? deltaChip(delta.overall, delta.daysAgo === 0 ? "vs last scan" : `vs ${delta.daysAgo}d ago`) +
      (delta.vsAverage != null
        ? deltaChip(delta.vsAverage, `vs your average of ${delta.averageOf}`)
        : "")
    : "";
  // Every score is now measured from both views — the flow requires the profile
  // before it will analyse anything. The flag stays because a report restored
  // from history may predate that.
  const merged = Number.isFinite(r.zScores["view:side"]);

  body().innerHTML = `
    <div class="reveal overview-reveal">
      ${maxAccess && adultUser ? maxAnalysisHTML(r, delta) : ""}
      <div class="score-head">
        <div><div class="klabel">${merged ? "OVERALL · FRONT + SIDE" : "OVERALL · FRONT ONLY"}
            · <button type="button" class="refswitch" id="ref-switch"
              title="Score against the other reference population">VS ${r.sex === "male" ? "MEN" : "WOMEN"} ⇄</button></div>
          <div class="big"><span id="cnt" data-count="${r.overall}" data-decimals="1">0.0</span><small> /10</small></div></div>
        <div class="chipcol">
          <span class="chip big-chip">${percentileLine(r.overallPercentile, r.sex)}</span>
          ${deltaHTML}
        </div>
      </div>
      <div class="ovw">
      <p class="ego">${overviewCaveat()}</p>
      ${delta ? `<div class="delta-read ${delta.reading}">${deltaReadingCopy(delta)}</div>` : ""}
      ${viewCards(r)}
      ${
        merged
          ? `<p class="viewnote done">Projection, chin and jaw angle can only be seen in profile. The front view carries 75% of the overall number and the side 25%. The side is capped because thirteen points placed by hand is the one input you can get wrong by mis-dragging.</p>`
          : ctx.onSideProfile
            ? `<p class="viewnote">Measured from the front only. <button class="linkish" id="side-nudge">Add a side profile</button> to include chin projection, jaw angle and facial convexity.</p>`
            : ""
      }
      </div>
      <div class="pillars">${(Object.entries(r.pillars) as [string, number][])
        .map(
          ([p, s]) => `
        <div class="pillar"><b data-count="${s}" data-decimals="1">0.0</b><span>${p.toUpperCase()}</span>
        <div class="pbar"><i data-w="${s * 10}"></i></div></div>`,
        )
        .join("")}
      </div>
      <div class="panel"><h4>POPULATION POSITION</h4>${curveSVG(r.overallPercentile, "overall", r.sex, false, { score: r.overall, rank: rankShort(r.overallPercentile) })}
        ${curveLegend()}
        <p class="rarity">Roughly <b>${rarityText(r.overallPercentile)}</b> ${r.sex} faces share this overall measurement profile.</p></div>
      ${
        // Until the profile is in, adding it IS the next step — so it is the
        // primary button. A scan is not finished at one view, and burying that
        // behind a ghost button next to "Share card" said the opposite.
        !merged && ctx.onSideProfile
          ? `<div class="navrow"><button class="btn gho" id="btn-plan">See your plan</button>
               <button class="btn pri" id="btn-side">Add side profile →</button></div>
             <div class="navrow"><button class="btn gho" id="btn-new">Start over</button>
               <button class="btn gho" id="btn-share">Share card</button></div>`
          : `<div class="navrow"><button class="btn gho" id="btn-plan">See your plan</button>
               ${ctx.onContinue ? `<button class="btn pri result-next" id="btn-continue">Next · Build my pathway →</button>` : ""}</div>
             <div class="navrow"><button class="btn gho" id="btn-new">New photo</button>
               <button class="btn gho" id="btn-share">Share card</button></div>`
      }
      ${modeSwitcher("full")}
      ${hasHistory() ? `<button class="hist-entry" id="btn-history">View all your scans →</button>` : ""}
    </div>`;

  wireModeSwitcher();
  const overview = body().querySelector<HTMLElement>(".overview-reveal");
  if (overview) animateOverview(overview);
  document.getElementById("btn-history")?.addEventListener("click", () => openHistory());
  // Correcting the reference population where its effect is visible. Every
  // percentile on this screen comes from it, and it moves the overall score by
  // a median of 0.7 points, so it cannot be a choice you can only revisit by
  // starting over.
  const refBtn = document.getElementById("ref-switch");
  if (refBtn) refBtn.onclick = () => ctx?.onSexChange?.(r.sex === "male" ? "female" : "male");
  document.getElementById("btn-new")!.onclick = () => ctx?.onNewPhoto();
  document.getElementById("btn-plan")!.onclick = () => select("improve");
  const continueBtn = document.getElementById("btn-continue");
  if (continueBtn) continueBtn.onclick = () => ctx?.onContinue?.();
  const sideBtn = document.getElementById("btn-side");
  if (sideBtn) sideBtn.onclick = () => ctx?.onSideProfile?.();
  const nudge = document.getElementById("side-nudge");
  if (nudge) nudge.onclick = () => ctx?.onSideProfile?.();
  document.getElementById("btn-share")!.onclick = async () => {
    if (!ctx) return;
    const photo = document.getElementById("photo-canvas") as HTMLCanvasElement;
    const card = await renderShareCard(ctx.report, photo);
    await shareCard(card, ctx.report.overall);
  };
}

// Side-profile results: same measurement language, its own report, no photo
// zoom (the side view has no landmark mesh to re-light).
// The side profile, rendered into the tab body.
//
// Was `renderSideResults`, a full-screen takeover that nothing ever called: the
// profile was captured, verified, scored, merged into the total, and then had
// no screen. Someone whose score was dragged down by the side view could not
// see which measurement did it.
function renderSideInto(host: HTMLElement, report: Report): void {
  const regions = report.regions.filter((r) => r.metrics.length);
  const measured = regions.reduce((n, r) => n + r.metrics.length, 0);

  host.innerHTML = `
    <div class="reveal">
      <div class="score-head">
        <div><div class="klabel">SIDE PROFILE · 25% OF THE TOTAL</div>
          <div class="big">${report.overall.toFixed(1)}<small> /10</small></div></div>
        <div class="chipcol"><span class="chip">${topPctText(report.overallPercentile)}</span></div>
      </div>
      ${provenance(measured)}
      ${implausibleBanner(report)}
      <div class="panel"><h4>POPULATION POSITION</h4>${curveSVG(report.overallPercentile, "overall", report.sex, false, { score: report.overall, rank: rankShort(report.overallPercentile) })}
        ${curveLegend()}
        <p class="rarity">Roughly <b>${rarityText(report.overallPercentile)}</b> ${report.sex} profiles measure this way.</p></div>
      ${regions.map((r) => sideRegionDeck(r, report)).join("")}
      ${modeSwitcher("full")}
      ${sideNav()}
    </div>`;

  revealBars();
  wireModeSwitcher(showSide);
  wireSideNav();
}

// Where the profile's numbers came from, said in three figures.
//
// This is the one block on the report that has no front-view equivalent, and it
// exists because the two halves are NOT the same kind of measurement. The front
// is 478 points the detector placed and nobody checked. The profile is thirteen
// points a person dragged into position by hand — which is both why it can
// measure things the front cannot, and why it is capped at a quarter of the
// total. Saying that in a paragraph made it read as a disclaimer; as three
// numbers it reads as what it is, which is the method.
function provenance(measured: number): string {
  return `<div class="sideprov">
    <div><b>13</b><span>POINTS · PLACED BY HAND</span></div>
    <div><b>${measured}</b><span>MEASUREMENTS · NO FRONT EQUIVALENT</span></div>
    <div><b>25%</b><span>CAP ON THE OVERALL SCORE</span></div>
  </div>`;
}

// The profile's own version of the actions under the front's Overall tab. It
// had none: the only way on from here was the view toggle, and the only way to
// fix a mis-dragged point was a link buried mid-paragraph.
//
// Same shape as the front row, because the destinations are the same shape —
// but every action is the profile's. "New photo" becomes two, because on this
// half of the scan there are two quite different things wrong you might be
// trying to fix, and one of them is much cheaper: the photograph is usually
// fine and it is the points that missed.
function sideNav(): string {
  const redo = ctx?.onRedoSide
    ? `<button class="btn gho" id="sn-redo">Re-verify the points</button>`
    : "";
  const retake = ctx?.onSideProfile
    ? `<button class="btn gho" id="sn-retake">Retake profile</button>`
    : "";
  return `<div class="navrow">${redo}
      <button class="btn pri" id="sn-plan">See your plan</button></div>
    <div class="navrow">${retake}
      <button class="btn gho" id="sn-share">Share card</button></div>
    ${hasHistory() ? `<button class="hist-entry" id="sn-history">View all your scans →</button>` : ""}`;
}

function wireSideNav(): void {
  const on = (id: string, fn: () => void) => {
    const b = document.getElementById(id);
    if (b) b.onclick = fn;
  };
  on("sn-redo", () => ctx?.onRedoSide?.());
  on("imp-redo", () => ctx?.onRedoSide?.());
  on("sn-retake", () => ctx?.onSideProfile?.());
  on("sn-plan", () => select("improve"));
  on("sn-history", () => openHistory());
  on("sn-share", async () => {
    if (!ctx) return;
    // photo-canvas is showing the PROFILE while this tab is open, so the card
    // that goes out is the profile with the merged score on it — not the front
    // photograph relabelled.
    const photo = document.getElementById("photo-canvas") as HTMLCanvasElement;
    const card = await renderShareCard(ctx.report, photo);
    await shareCard(card, ctx.report.overall);
  });
}

// One profile region: its measurements beside its comparisons. Shared by the
// profile overview, which stacks every region, and by the per-region side tabs,
// which show one — so the two can never drift apart in what a side region looks
// like or in which measurements are drawable.
function sideRegionDeck(r: RegionScore, report: Report): string {
  // Same comparison card the front regions carry, and wrapped for the same
  // reason: a reference lookup must never be able to blank the measurements it
  // sits beside.
  let matches: ReturnType<typeof regionMatches> = [];
  try {
    matches = regionMatches(r.region, r.metrics, report.sex);
  } catch (err) {
    console.error("celebrity match failed", err);
  }
  return `<div class="deck">
    <div class="dcard">
      <h3>${REGION_NAMES[r.region]} · ${r.score.toFixed(1)}<em>SIDE</em></h3>
      ${r.metrics
        .map(
          (m, i) => `<div class="metric${hasSideOverlay(m.def.id) ? " tappable" : ""}${m.implausible ? " implausible" : ""}" data-side-metric="${m.def.id}" style="animation-delay:${60 + i * 60}ms">
        <div class="mrow"><b>${m.def.name}</b><span>${fmt(m)}${
          m.implausible
            ? `<span class="mscore mscore-skip">not scored</span>`
            : `<span class="mscore">${m.score.toFixed(1)}</span>`
        }</span></div>
        ${
          m.implausible
            ? `<p class="mimplausible">No head measures this. Re-check ${pointLabels(m)} and this will score.</p>`
            : `<div class="rangebar">${idealWindow(m, report.sex)}<i data-l="${m.markerPct}"></i></div>`
        }</div>`,
        )
        .join("")}
      ${
        r.metrics.some((mm) => hasSideOverlay(mm.def.id))
          ? `<button class="tap-hint side-tap-hint"><i>◱</i>Hover a measurement to draw it on your profile</button>`
          : ""
      }
    </div>
    <div class="dcard">
      <h3>Notable comparisons<em>REFERENCE</em></h3>
      ${celebCard(matches)}
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Measurements that are shown but do not count.
//
// reliability.ts scores every metric on how much of its variance is real
// signal rather than photo-to-photo noise, and scoring multiplies each weight
// by that number — so a metric at 0.00 moves nothing. Ten of them are in that
// state, including fWHR, which is the single most talked-about number in this
// corner of the internet.
//
// The file has always said those are "displayed, flagged as indicative". The
// display was real; the flag was never built, so for months the app showed a
// fWHR percentile in the same type, with the same bar, as a measurement that
// actually moved the score. On a product whose entire pitch is showing the
// working, silently mixing decorative numbers into real ones is the worst
// available bug. This is that promised flag.
// ---------------------------------------------------------------------------
function isIndicative(m: ScoredMetric): boolean {
  return reliabilityOf(m.def.id) < RELIABLE_MIN;
}

// One sentence per region rather than a tooltip per row, because "not scored"
// on its own raises a question the person then has to go looking for.
function indicativeNote(metrics: ScoredMetric[]): string {
  const skipped = metrics.filter(isIndicative);
  if (!skipped.length) return "";
  const names = skipped.map((m) => m.def.name.toLowerCase());
  const list = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `<p class="indnote">${
    names.length === 1 ? `${list} is measured but not scored` : `${list} are measured but not scored`
  }. We tested each measurement across many photos of the same people, and ${
    names.length === 1 ? "this one moves" : "these move"
  } as much between two photos of one face as between two different faces. So ${
    names.length === 1 ? "it is shown" : "they are shown"
  } for interest and given no weight. Showing you the number and hiding that would be the dishonest option.</p>`;
}

function indicativeTag(m: ScoredMetric): string {
  if (!isIndicative(m)) return "";
  return `<span class="indtag" title="Measured, but it varies as much between two photos of one face as it does between people — so it is shown and not scored.">not scored</span>`;
}

// Told at the top of the profile, not left to be discovered halfway down a
// measurement list. An excluded measurement is the one case where the fix is
// free and takes ten seconds, so the offer to re-verify goes with it.
function implausibleBanner(report: Report): string {
  const bad = report.regions.flatMap((r) => r.metrics).filter((m) => m.implausible);
  if (!bad.length) return "";
  const points = [...new Set(bad.flatMap((m) => m.def.points ?? []))]
    .map((id) => SIDE_POINTS.find((p) => p.id === id)?.label.toLowerCase())
    .filter(Boolean);
  const redo = ctx?.onRedoSide
    ? ` <button class="linkish" id="imp-redo">Re-check the points</button>`
    : "";
  return `<div class="impbanner">
    <b>${bad.length} measurement${bad.length === 1 ? "" : "s"} left out of your score</b>
    <p>${bad.map((m) => m.def.name).join(", ")} came back outside what a human head can measure, which means a landmark is in the wrong place rather than your profile being unusual. ${
      points.length ? `Worth checking: ${points.join(", ")}.` : ""
    } Nothing here counted against you.${redo}</p>
  </div>`;
}

// The landmarks behind an implausible measurement, in the words the verify
// screen used when the person placed them. "Re-check the jaw corner" is a
// thing somebody can act on; "ramusMandible out of range" is not.
function pointLabels(m: ScoredMetric): string {
  const ids = m.def.points ?? [];
  const names = ids
    .map((id) => SIDE_POINTS.find((p) => p.id === id)?.label.toLowerCase())
    .filter(Boolean) as string[];
  if (!names.length) return "the points on this measurement";
  if (names.length === 1) return `the ${names[0]}`;
  return `the ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// One renderer for the comparison card, so the front regions and the profile
// cannot drift apart in either wording or restraint.
function celebCard(matches: ReturnType<typeof regionMatches>): string {
  if (!matches.length) {
    return `<p class="footnote" style="margin-top:2px">No match shown here: matches are only offered on measurements where you land at or above average, and this region has none. That restraint is the point: a flattering comparison you did not earn would make every other number worth less.</p>`;
  }
  // No sigma column. "Δ 0.03σ" is the distance between two z-scores, which is
  // the correct way to pick these matches and a meaningless thing to show
  // someone: nobody reads it, and the few who try will misread it as a score.
  // The claim the card makes is "your jaw measures like his", and the metric
  // name under the name is the whole of that claim.
  return matches
    .map(
      (m) => `<div class="celeb"><div class="ava">${m.name[0]}</div>
        <div class="nm">${m.name}<span>${m.metricName}</span></div></div>`,
    )
    .join("");
}

// ---------------------------------------------------------------------------
// Max's analysis: the overview, in his voice, for accounts that hold him.
//
// Every sentence is composed from numbers the engine already computed — best
// region, weakest fixable lever, the delta against the last scan — never
// generated. A model call per scan would cost money on every result and could
// invent a figure; a template over real numbers is instant, free, and can
// only say true things. The model stays in the chat, where the follow-up
// questions live.
//
// The pose varies per scan: derived from the report so the same scan always
// shows the same Max, but the next scan shows a different one. A character
// who strikes the same pose every time is a logo.
// ---------------------------------------------------------------------------
const ANALYSIS_POSES: Array<{ mood: MaxMood; waving?: boolean }> = [
  { mood: "happy", waving: true },
  { mood: "excited" },
  { mood: "thinking" },
  { mood: "happy" },
];

function maxAnalysisHTML(r: Report, delta: ScanDelta | null): string {
  const pose = ANALYSIS_POSES[Math.abs(Math.round(r.overall * 10) + r.metrics.length) % ANALYSIS_POSES.length];

  const regions = [...r.regions].sort((a, b) => b.percentile - a.percentile);
  const best = regions[0];
  const fixables = r.metrics
    .filter((m) => m.def.fixability >= 0.3)
    .sort((a, b) => a.zEff - b.zEff);
  const weakest = fixables[0];

  // Phrased so it survives a plural region name: "Eyes is carrying you" is
  // the kind of line that reads generated, and this one must not.
  const good = best
    ? `Best thing on the scan: ${REGION_NAMES[best.region].toLowerCase()}, top ${Math.max(1, 100 - Math.round(best.percentile))}% of the reference set.`
    : "";
  const improve = weakest
    ? `The one I would attack first: ${weakest.def.name.toLowerCase()} (${fmt(weakest)}). ${leverFor(weakest).title} is the lever, and it moves without surgery.`
    : "";
  const tracking = delta
    ? deltaReadingCopy(delta)
    : "First scan on record. The next one is where this gets interesting — one scan is a score, two is a direction.";

  return `<div class="maxan">
    <div class="maxan-face">${maxCharacterMarkup(pose)}</div>
    <div class="maxan-body">
      <span class="klabel">MAX'S READ</span>
      <p><b>${good}</b> ${improve}</p>
      <p class="maxan-track">${tracking}</p>
      <p class="maxan-invite">Want different products in the plan, or a different target? Tell me and we will rebuild it together.</p>
      <!-- Looks like the thing it starts, rather than describing it.
           "Tap me in the corner" asked the reader to find a separate control
           and trust that it was worth finding; a box with a cursor in it needs
           no instructions. It is a BUTTON wearing a text field: typing here
           would strand a half-written question in a panel that re-renders on
           every tab change, so the first press hands off to the real chat
           input with the question still unstarted. -->
      ${
        maxAccess && adultUser
          ? `<button type="button" class="maxan-ask" data-max-ask>
        <span>Ask Max about your scan…</span>
        <b>Send</b>
      </button>`
          : ""
      }
    </div>
  </div>`;
}

// The second way into the chat, the first being Max himself.
//
// Delegated and bound once for the life of the page: the analysis panel is
// rebuilt on every tab and depth change, so wiring this per render would stack
// a listener each time somebody looked at their jaw.
let maxAskBound = false;

function wireMaxAsk(): void {
  if (maxAskBound) return;
  maxAskBound = true;
  document.addEventListener("click", (event) => {
    const hit = (event.target as HTMLElement | null)?.closest?.("[data-max-ask]");
    if (!hit) return;
    const cc = chatContext();
    if (cc) openMaxChat(cc);
  });
}

function animateOverview(root: HTMLElement): void {
  const items: HTMLElement[] = [];
  const add = (node: Element | null) => {
    if (node instanceof HTMLElement && !items.includes(node)) items.push(node);
  };
  add(root.querySelector(".score-head"));
  root.querySelectorAll<HTMLElement>(".ovw > *").forEach(add);
  root.querySelectorAll<HTMLElement>(".pillars > *").forEach(add);
  add(root.querySelector(":scope > .panel"));
  root.querySelectorAll<HTMLElement>(":scope > .navrow").forEach(add);
  add(root.querySelector(":scope > .hist-entry"));

  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  items.forEach((item, index) => {
    const delay = reduced ? 0 : 40 + index * 68;
    item.classList.add("overview-step");
    item.style.setProperty("--overview-delay", `${delay}ms`);

    for (const number of item.querySelectorAll<HTMLElement>("[data-count]")) {
      const target = Number(number.dataset.count);
      const decimals = Number(number.dataset.decimals ?? "1");
      if (Number.isFinite(target)) countUp(number, target, decimals, delay);
    }
    for (const bar of item.querySelectorAll<HTMLElement>(".pbar i")) {
      const finish = () => {
        if (bar.isConnected) bar.style.width = `${bar.dataset.w}%`;
      };
      if (reduced) finish();
      else setTimeout(finish, delay + 190);
    }
  });
}

function countUp(el: HTMLElement, target: number, decimals: number, delay: number): void {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const finish = () => {
    el.textContent = target.toFixed(decimals);
  };
  if (reduced) {
    finish();
    return;
  }

  const duration = 720;
  setTimeout(() => {
    const start = performance.now();
    const step = (now: number) => {
      if (!el.isConnected) return;
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = (target * eased).toFixed(decimals);
      if (progress < 1) requestAnimationFrame(step);
      else finish();
    };
    requestAnimationFrame(step);
  }, delay);
}

// ---------------- region ----------------
// A real, unreadable version of the panel behind the wall. Built from this
// person's actual metric names and scores rather than lorem, so the blur is
// showing them their own analysis rather than a decorative placeholder — the
// count of rows is true, and that is the honest part of the pitch.
function regionPreviewHTML(r: RegionScore, id: RegionId): string {
  return `<div class="deck"><div class="dcard">
    <h3>${REGION_NAMES[id]} · ${r.score.toFixed(1)}<em>MEASURED</em></h3>
    ${r.metrics
      .map(
        (m) => `<div class="metric">
          <div class="mrow"><b>${m.def.name}</b><span>${fmt(m)}<span class="mscore">${m.score.toFixed(1)}</span></span></div>
        </div>`,
      )
      .join("")}
  </div></div>`;
}

function showRegion(id: RegionId): void {
  if (!ctx) return;
  const r = ctx.report.regions.find((x) => x.region === id)!;
  setZoom(id);

  // The region tabs ARE the in-depth analysis — every individual measurement,
  // what it read, and what it did to the score. Free accounts past their
  // allowance see the shape of it behind a blur rather than an empty page,
  // because the amount of work in there is the thing being sold and hiding it
  // entirely sells nothing.
  if (depth === "rating") {
    body().innerHTML = `<div class="reveal">${locked(regionPreviewHTML(r, id))}</div>`;
    wireUnlock();
    return;
  }

  // Wrapped because this is the one call in the render path that reaches into
  // a separate dataset, and it runs BEFORE the panel's innerHTML is assigned —
  // so anything it throws leaves the whole analysis pane blank rather than
  // just dropping the celebrity card. A comparison feature must never be able
  // to take out the report it sits beside.
  let matches: ReturnType<typeof regionMatches> = [];
  try {
    matches = regionMatches(id, r.metrics, ctx.report.sex);
  } catch (err) {
    console.error("celebrity match failed", err);
  }
  const matchCard = celebCard(matches);

  body().innerHTML = `
    <div class="reveal">
      <div class="dots" id="dots"><i class="on"></i><i></i></div>
      <div class="deck" id="deck">
        <div class="dcard">
          <h3>${REGION_NAMES[id]} · ${r.score.toFixed(1)}<em>MEASURED</em></h3>
          ${r.metrics
            .map(
              (m, i) => `<div class="metric tappable${isIndicative(m) ? " indicative" : ""}" data-metric="${m.def.id}" style="animation-delay:${80 + i * 70}ms">
            <div class="mrow"><b>${m.def.name}${indicativeTag(m)}</b><span>${fmt(m)}<span class="mscore">${m.score.toFixed(1)}</span></span></div>
            <div class="rangebar">${idealWindow(m, ctx!.report.sex)}<i data-l="${m.markerPct}"></i></div></div>`,
            )
            .join("")}
          ${indicativeNote(r.metrics)}
          ${
            // The overlay is the credibility feature and it was invisible: a
            // 9px glyph at 55% opacity is not an affordance. Say it in words.
            r.metrics.length
              ? `<button class="tap-hint" id="tap-hint"><i>◱</i>Hover a measurement to draw it on your face</button>`
              : ""
          }
          <div class="typebox" id="tw"></div>
        </div>
        <div class="dcard">
          <h3>Notable comparisons<em>REFERENCE</em></h3>
          ${matchCard}
          <p class="footnote">Reference set grows with every analyzed face. Matches are on specific metrics where you genuinely align.</p>
        </div>
      </div>
      <div class="panel"><h4>${REGION_NAMES[id].toUpperCase()} POSITION</h4>${curveSVG(r.percentile, `region:${id}`, ctx!.report.sex, true)}
        ${curveLegend()}
        <p class="rarity">${rarityLine(r)}</p></div>
    </div>`;

  setTimeout(
    () =>
      document
        .querySelectorAll<HTMLElement>(".rangebar i")
        .forEach((i) => (i.style.left = `${i.dataset.l}%`)),
    120,
  );
  typewrite(document.getElementById("tw")!, regionSummary(r, ctx.report.sex));
  wireMeasurementTaps(r, id);

  const deck = document.getElementById("deck")!;
  const dots = document.getElementById("dots")!;
  deck.onscroll = () => {
    const on = deck.scrollLeft > deck.clientWidth / 2 ? 1 : 0;
    dots.querySelectorAll("i").forEach((x, j) => x.classList.toggle("on", j === on));
  };
}

// Ideal window on the gradient bar, drawn in the same population-percentile
// space as the marker so "inside the window" always means "in the ideal band".
function idealWindow(m: ScoredMetric, sex: Sex): string {
  const d = m.def.dist[sex];
  const lo = phi((m.idealRange[0] - d.mean) / d.sd) * 100;
  const hi = phi((m.idealRange[1] - d.mean) / d.sd) * 100;
  return `<div class="ideal" style="left:${lo.toFixed(1)}%;width:${Math.max(4, hi - lo).toFixed(1)}%"></div>`;
}

function rarityLine(r: RegionScore): string {
  return r.percentile >= 50
    ? `Roughly <b>${rarityText(r.percentile)}</b> faces measure this well across the ${REGION_NAMES[r.region].toLowerCase()}.`
    : `About <b>${Math.round(100 - r.percentile)}%</b> of faces score higher here, and the drill-down above shows exactly why.`;
}

// Hovering a measurement row draws that exact measurement on the face. A number
// in a table is a claim; the same number drawn across the cheekbones is
// evidence — this is the credibility wedge made visible.
//
// It was a click, and a click is the wrong gesture for it. Reading a column of
// measurements is a scanning motion, and making someone commit a tap to each
// one — then another tap to undo it — turns "show me" into a chore, so most
// people pressed it once and never again. On hover the overlay simply follows
// your eye down the list.
//
// Click still works and still pins, for two reasons that are not the same: a
// touch screen has no hover at all, and on a mouse you sometimes want a
// measurement to STAY drawn while you look away at the photo.
let activeMetric: string | null = null; // hovered or pinned: what is drawn
let pinnedMetric: string | null = null; // survives pointerleave
let fade: OverlayFade | null = null;

const HINT_IDLE = `<i>◱</i>Hover a measurement to draw it on your face`;

function wireMeasurementTaps(r: RegionScore, region: RegionId): void {
  // Switching tabs re-renders the rows but used to leave this pointing at the
  // previous region's metric, so the first interaction after coming back
  // toggled the overlay OFF instead of on.
  activeMetric = null;
  pinnedMetric = null;
  fade?.cancel();
  fade = null;
  const hint = document.getElementById("tap-hint");
  const rows: HTMLElement[] = [];

  const setHint = (metric: ScoredMetric | null, pinned: boolean) => {
    if (!hint) return;
    hint.classList.toggle("on", !!metric);
    hint.innerHTML = metric
      ? `<i>◱</i>Drawing <b>${metric.def.name}</b>${pinned ? " (click again to release)" : ""}`
      : HINT_IDLE;
  };

  // Every change of what is drawn goes through here, so the cross-fade cannot
  // be skipped by one path and applied by another.
  const show = (id: string | null) => {
    if (!ctx || id === activeMetric) return;
    activeMetric = id;
    const metric = id ? r.metrics.find((m) => m.def.id === id) : null;
    for (const other of document.querySelectorAll(".metric")) {
      other.classList.toggle("active", (other as HTMLElement).dataset.metric === id);
    }
    setHint(metric ?? null, pinnedMetric === id && !!id);
    fade?.cancel();

    // A merged report puts the side metrics in their anatomical region, so the
    // Jaw tab lists gonial angle and ramus:mandible next to the front ones.
    // Those are measured from the thirteen profile points, which have no
    // position in the front photograph — so hovering them used to light a
    // generic cluster of jaw landmarks and print the number next to it, which
    // shows nothing and explains nothing.
    //
    // They have a real construction, it is just on the other photo. So the pane
    // switches to the profile and draws the actual angle there, the same as the
    // Side tab does. The measurement is the thing being sold; showing it on the
    // wrong face was worse than not showing it.
    const onSide =
      metric && hasSideOverlay(metric.def.id) && ctx.sidePoints && ctx.sidePhoto;
    if (onSide && ctx.sidePhoto && ctx.sidePoints) {
      showPhoto("side");
      fade = animateSideMeasurement(
        ctx.overlay,
        ctx.sidePoints,
        ctx.sidePhoto.width,
        ctx.sidePhoto.height,
        metric,
      );
      return;
    }
    showPhoto("front");

    // Arriving at a measurement DRAWS IT ON — the lines extend along their own
    // paths, which is the thing worth watching. Leaving it cross-fades back to
    // the calm region instead, because a region outline has no natural
    // direction to grow along and animating it would just be motion for its
    // own sake.
    fade = metric
      ? animateMeasurement(ctx.overlay, ctx.landmarks, ctx.photoW, ctx.photoH, metric)
      : transitionMeasurement(ctx.overlay, (target) => {
          if (!ctx) return;
          drawCalm(target, ctx.landmarks, ctx.photoW, ctx.photoH, REGION_LANDMARKS[region]);
        });
    shownRegion = region;
  };

  for (const row of document.querySelectorAll<HTMLElement>(".metric[data-metric]")) {
    const id = row.dataset.metric!;
    if (!r.metrics.some((m) => m.def.id === id)) continue;
    rows.push(row);

    // Mouse only. A touch "hover" fires on tap and would draw and then
    // immediately pin on the same press.
    row.onpointerenter = (e) => {
      if (e.pointerType === "touch") return;
      show(id);
    };
    row.onpointerleave = (e) => {
      if (e.pointerType === "touch") return;
      show(pinnedMetric);
    };
    row.onclick = () => {
      pinnedMetric = pinnedMetric === id ? null : id;
      show(pinnedMetric ?? id);
      // `show` returns early when the drawing is already correct, which it
      // usually is here — the row is under the cursor. The hint still has to
      // change, because pinning is a state the drawing cannot express.
      setHint(r.metrics.find((m) => m.def.id === id) ?? null, pinnedMetric === id);
    };
  }

  // The hint is the affordance, so it has to do the thing it describes:
  // demonstrate on the first measurement, and release whatever is pinned.
  if (hint && rows.length) {
    hint.onclick = () => (rows.find((x) => x.dataset.metric === (pinnedMetric ?? activeMetric)) ?? rows[0]).click();
  }
}

// ---------------- improvements ----------------
function showImprove(): void {
  if (!ctx) return;
  track("plan-opened");
  const { report: r, delta } = ctx;
  setZoom(null);
  const profile = loadProfile();

  // The plan is where someone's answers have to actually bite. Regions they
  // asked us to leave alone are dropped from the WRITTEN plan — their scores
  // are still on every other tab, untouched — and the goals they picked pull
  // their own levers to the front.
  const fixables = r.metrics
    .filter((m) => m.def.fixability >= 0.2 && m.zEff < 0.4)
    .filter((m) => !isQuiet(m.def.region, profile))
    .sort((a, b) => a.zEff - goalBoost(a.def.id, profile) - (b.zEff - goalBoost(b.def.id, profile)))
    .slice(0, 4);

  const unmeasured = chosenGoals(profile).filter((g) => !g.measurable);
  const quietNote = profile.quiet.length
    ? `<p class="q-foot" style="margin:0 2px 14px">Your plan skips ${profile.quiet
        .map((q) => REGION_NAMES[q].toLowerCase())
        .join(", ")} because you asked it to. Every one of those measurements is still on its own tab. Nothing was hidden or softened.</p>`
    : "";

  const progress = delta
    ? `<div class="panel"><h4>SINCE YOUR LAST SCAN${delta.daysAgo ? ` · ${delta.daysAgo}D AGO` : ""}</h4>
        ${progressCopy(delta)}
        ${delta.regions
          .filter((x) => Math.abs(x.delta) > 0.05)
          .map(
            (x) => `<div class="prog-row"><span>${REGION_NAMES[x.region]}</span>
            <span class="d ${x.delta > 0 ? "up" : "down"}">${x.delta > 0 ? "+" : ""}${x.delta.toFixed(1)}</span></div>`,
          )
          .join("") || `<div class="prog-row"><span>All regions</span><span class="d flat">within capture variance</span></div>`}
      </div>`
    : "";

  // Whether this account is past its free allowance — decided up front because
  // it changes what goes INTO the plan body, not just what covers it.
  const gated = depth === "rating";

  // The percentile translation sits beside the ceiling everywhere the ceiling
  // appears. On a PSL-shaped scale a 7 reads as "a bit above average" to
  // anyone who has not internalised the curve, when it is actually rarer than
  // one face in twenty — the percentage is the number that lands.
  const potPct = rankShort(aggregateScoreToPercentile(r.potential));
  const planBody = `<div class="pot"><div class="n">${r.overall.toFixed(1)}</div><div class="arr">→</div>
        <div class="n p">${r.potential.toFixed(1)}</div><span class="pot-pct">${potPct}</span>
        <p>Potential recomputed from your fixable metrics only. Habits, composition and grooming, with no surgery anywhere.</p></div>
      ${goalHead(profile)}
      ${quietNote}
      ${progress}
      ${fixables
        .map((m) => {
          const lever = leverFor(m);
          const why = goalsTouching(m.def.id, profile);
          const muted = !profile.advice[lever.channel];
          // Three states, and the order matters. A muted channel wins over the
          // paywall: someone who asked us to leave diet alone must not be sold
          // diet advice, and telling them "upgrade to hear it" would be doing
          // exactly that.
          const copy = muted
            ? lever.neutral(m, r.sex)
            : maxAccess
              ? lever.body(m, r.sex)
              : lockedCopy(m, r.sex);
          const locked = !muted && !maxAccess;
          return `<div class="imp${locked ? " locked" : ""}"><b>${lever.title}<em>${REGION_NAMES[m.def.region].toUpperCase()} · ${m.score.toFixed(1)} · ${lever.tag}</em></b>
          <p>${copy}</p>
          ${why.length ? `<span class="because">Because you chose ${why.map((g) => g.label.toLowerCase()).join(" + ")}</span>` : ""}
          <span class="why">MOVES ${m.def.pillar.toUpperCase()} →</span></div>`;
        })
        .join("")}
      ${unmeasured
        .map(
          (g) => `<div class="imp"><b>${g.label}<em>NOT MEASURED · YOUR GOAL</em></b>
        <p>${g.blurb}. Nothing in a 478-point face mesh reads this, so TrueMax will never hand you a number for it or claim your score moved because of it. It's on your list because you put it there.</p>
        <span class="because">Because you chose ${g.label.toLowerCase()}</span></div>`,
        )
        .join("")}
      ${recsHTML(profile)}
      ${maxAccess || gated ? "" : upsell()}`;

  // Past the free allowance, the plan is the sell — and the sell leads with the
  // one number that keeps people here: the ceiling. The potential is stated
  // plainly on the card, not blurred, because it is a real measurement (the
  // engine recomputes the score from the fixable metrics alone) and a stated
  // ceiling is a reason to subscribe where a blurred one is a taunt. What sits
  // behind the blur is the pathway TO it — every step already written, from
  // this person's own measurements, which is why the structure shows through:
  // the volume of finished work is the product.
  body().innerHTML = `
    <div class="reveal">
      ${askMaxCard()}
      ${gated
        ? `<div class="lockwrap">
            <div class="lockblur" aria-hidden="true" inert>${planBody}</div>
            <div class="lockcard lockcard-ceiling">
              <span class="lockcard-eyebrow">YOUR CEILING</span>
              <h4>Our system reckons your potential is a good deal higher.</h4>
              ${ceilingCtaMarkup({ overall: r.overall, potential: r.potential, photo: frontPhoto })}
              <p>The route between those two numbers is already written below, step by step, from your own measurements. Unlock it to read it.</p>
              <div class="navrow"><button class="btn pri" id="btn-unlock">See my full pathway · 7 days free</button></div>
              <button class="linkish lock-single" id="btn-single-scan">Or buy just this one scan for ${scanPrice()}</button>
            </div>
          </div>`
        : planBody}
      <div class="navrow"><button class="btn gho" id="btn-back">Back to results</button>
        <button class="btn pri" id="btn-again">Scan another face</button></div>
    </div>`;
  wireUnlock();
  wireAskMax();
  // The canvases exist only once the card is in the document, and they are
  // painted from the cached front capture rather than re-read from the live
  // canvas, which by now may be showing the side profile.
  paintCeilingCta(body(), frontPhoto);

  document.getElementById("btn-back")!.onclick = () => select("overall");
  document.getElementById("btn-again")!.onclick = () => ctx?.onNewPhoto();
  const upgrade = document.getElementById("btn-upgrade");
  if (upgrade) upgrade.onclick = () => ctx?.onUpgrade?.();
  const edit = document.getElementById("goal-edit");
  if (edit) edit.onclick = () => openQuiz(() => showImprove(), "all");

  // First time someone reaches their plan, ask what to leave alone — the
  // moment prose is about to be written, and the first moment they have the
  // numbers in front of them to answer with.
  if (!profile.postDone && !gated) openQuiz(() => showImprove(), "post");
}

// ---------------------------------------------------------------------------
// Verdict and Basic.
//
// Both render from the SAME report the full mode renders from. Neither computes
// anything — see engine/analysisMode.ts. The depth switch changes how much is
// said, never what is true.
// ---------------------------------------------------------------------------
function showShallow(mode: AnalysisMode): void {
  if (!ctx) return;
  const r = ctx.report;
  const inner = mode === "verdict" ? verdictHTML() : basicHTML();

  body().innerHTML = `<div class="reveal">
    ${inner}
    ${modeSwitcher(mode)}
    <div class="navrow">
      <button class="btn gho" id="btn-new">New photo</button>
      <button class="btn pri" id="btn-share">Share card</button>
    </div>
    ${hasHistory() ? `<button class="hist-entry" id="btn-history">View all your scans →</button>` : ""}
  </div>`;

  wireModeSwitcher();
  // The headline counts up here too. It used to render a literal "0" and wait
  // for an animation that only ever ran in full mode, so Basic — now the
  // default depth — showed every user a score of zero.
  const lead = body().querySelector<HTMLElement>(".basic-n");
  if (lead) {
    const target = Number(lead.dataset.count);
    if (Number.isFinite(target)) countUp(lead, target, 0, 60);
  }
  document.getElementById("btn-new")!.onclick = () => ctx?.onNewPhoto();
  document.getElementById("btn-history")?.addEventListener("click", () => openHistory());
  document.getElementById("btn-share")!.onclick = async () => {
    if (!ctx) return;
    const photo = document.getElementById("photo-canvas") as HTMLCanvasElement;
    const card = await renderShareCard(r, photo);
    await shareCard(card, r.overall);
  };
}

function verdictHTML(): string {
  const v = verdictFor(ctx!.report, loadVerdictTone() ?? "blunt");
  return `<div class="verdict ${v.tone}">
    <span class="verdict-label">VERDICT</span>
    <b class="verdict-word">${v.word}</b>
    <p class="verdict-line">${v.line}</p>
  </div>`;
}

function basicHTML(): string {
  const scores = basicScores(ctx!.report);
  const [lead, ...rest] = scores;
  return `<div class="basic">
    <div class="basic-lead">
      <span class="klabel">OVERALL ${scaleTrigger()}</span>
      <b><span class="basic-n" data-count="${lead.value}" data-decimals="0">${lead.value}</span><small>/100</small></b>
      <em class="basic-rarity">${scaleRarityLine(lead.value)}</em>
    </div>
    <div class="basic-grid">
      ${rest
        .map(
          (s) => `<div class="basic-cell">
        <span>${s.label.toUpperCase()}</span>
        <b>${s.value}</b>
        <i style="width:${s.value}%"></i>
        <em>${rarityShort(s.value)}</em>
      </div>`,
        )
        .join("")}
    </div>
    <p class="basic-note">Every number here is a percentile: where you sit against the reference population, not a mark out of a hundred. The full mode shows the ${ctx!.report.metrics.length} measurements these come from.</p>
    <p class="basic-note">Stated to the nearest 5, and that is deliberate. The reference set is about ${REFERENCE_N} people per sex, which can place you in a band but cannot tell 43 from 44. Anyone quoting you a decimal place off a sample this size is making it up.</p>
    ${poseCaveat()}
  </div>`;
}

// The honesty note under the Basic grid when the capture was visibly off
// level. The engine corrects pose before measuring, but the correction is not
// perfect and the residual lands hardest on the jaw and chin: a tucked or
// tilted head genuinely narrows the measured jaw : cheek ratio and folds the
// gonial region. Basic mode's whole job is a number with no context, so a
// number taken from a tilted photo owes the reader this one sentence. The
// SCORE is untouched — modes present, they never recompute.
function poseCaveat(): string {
  const off = ctx?.offAxisDeg ?? 0;
  if (off < 6) return "";
  return `<p class="basic-note pose-warn">This capture was ${off.toFixed(0)}° off level. Jaw and chin are the numbers a tilted head drags first, so before trusting a low one there, retake with the camera at eye level and your head straight.</p>`;
}

// Present on every depth, including the full one, so changing your mind is
// never a trip into settings.
function modeSwitcher(current: AnalysisMode): string {
  return `<div class="modeswitch" role="group" aria-label="How much detail to show">
    ${ANALYSIS_MODES.map(
      (m) => `<button type="button" class="ms-btn${m.id === current ? " on" : ""}" data-mode="${m.id}">
        <b>${m.label}</b><span>${m.blurb}</span>
      </button>`,
    ).join("")}
  </div>`;
}

function wireModeSwitcher(rerender: () => void = showOverall): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>(".ms-btn")) {
    b.onclick = async () => {
      const mode = b.dataset.mode as AnalysisMode;
      // The question belongs to the mode, not to the place it was chosen. A
      // person who picked full analysis in the quiz and switches here months
      // later has still never been asked.
      if (mode === "verdict" && loadVerdictTone() === null) await askVerdictTone();
      saveAnalysisMode(mode);
      rerender();
    };
  }
}

// Whether this account has Max. Module state rather than a Ctx field because it
// arrives LATE: the entitlement is a network read, and blocking the results
// screen on it would hold a finished analysis hostage to a round trip. So the
// plan renders locked, and unlocks in place if the read comes back positive.
//
// Defaulting to false is the safe direction — a failed read shows the paywall
// rather than giving the paid product away, and the person can retry.
let maxAccess = false;

// Whether the signed-in person is an adult. Defaults to FALSE, which is the
// only safe direction: every Max surface on this screen is 18+, and an age we
// could not read must behave like an age that is too young.
let adultUser = false;

export function setAdult(value: boolean): void {
  if (value === adultUser) return;
  adultUser = value;
  syncMaxSurfaces();
}

// What this account can currently see. Defaults to "rating" — the safe
// direction, same reasoning as maxAccess: a failed entitlement read shows a
// wall to a paying customer, who can retry, rather than handing the paid
// product to everyone during an outage.
let depth: Depth = "rating";
let scansLeft = 0;

export function setMaxAccess(value: boolean): void {
  if (value === maxAccess) return;
  maxAccess = value;
  syncMaxSurfaces();
}

// Both flags arrive from network reads AFTER the screen is usually up — the
// entitlement and the profile are round trips, and a finished analysis is not
// held hostage to either. So every surface that keys on them has to be
// re-checked when one lands, not only at render time. Missing one is exactly
// the bug this fixes: a plan holder whose entitlement resolved a second after
// renderResults got the tab named "Overall" and no pet at all, because the
// mount decision had already been taken with the flag still false.
function syncMaxSurfaces(): void {
  if (!ctx) return;
  if (maxAccess && adultUser) {
    const cc = chatContext();
    if (cc) mountMaxPet(cc);
  } else {
    unmountMaxPet();
  }
  // The tab label, renamed in place. Only in the front tab row — the side
  // row has no overall tab to rename.
  if (tabView === "front") {
    const tab = ctx.analysis.querySelector<HTMLButtonElement>('.rtab[data-id="overall"]');
    if (tab) tab.textContent = maxAccess && adultUser ? "Max’s analysis" : "Overall";
  }
  // Re-render the open tab if it is one whose content keys on the flags: the
  // overview carries Max's analysis, the plan carries the CTA card and the
  // upsell. Region tabs are left alone to preserve scroll position.
  const open = ctx.analysis.querySelector<HTMLButtonElement>(".rtab.sel");
  if (open?.dataset.id === "improve") showImprove();
  else if (open?.dataset.id === "overall") showOverall();
}

// Arrives late, like maxAccess, because the entitlement is a network read and
// blocking a finished analysis on a round trip would hold the result hostage.
// The screen renders locked and unlocks in place.
export function setDepth(next: Depth, remainingFreeScans = 0): void {
  scansLeft = remainingFreeScans;
  if (next === depth) return;
  depth = next;
  const open = ctx?.analysis.querySelector<HTMLButtonElement>(".rtab.sel");
  if (open) select(open.dataset.id || "overall");
}

// Wraps in-depth content in a blur with an unlock card over it.
//
// Blurring rather than removing, deliberately, and only HERE — not over the
// score. The number and the ranking are free forever, because "we show the
// actual math" cannot be true on a screen that hides the math. What is behind
// this is the breakdown: which measurement produced that number, and how far it
// could move. Showing its shape while withholding its content is honest about
// what is being sold — the volume of work is the product, and it is real.
//
// The blurred layer is inert: pointer-events off, aria-hidden, and not
// focusable, so nothing behind the wall is reachable by keyboard or a screen
// reader. A paywall you can tab through is not a paywall.
function locked(content: string): string {
  const left = scansLeft > 0
    ? `<p class="lockcard-note">${scansLeft} free in-depth ${scansLeft === 1 ? "scan" : "scans"} left on this account.</p>`
    : "";
  return `<div class="lockwrap">
    <div class="lockblur" aria-hidden="true" inert>${content}</div>
    <div class="lockcard">
      <span class="lockcard-eyebrow">IN-DEPTH ANALYSIS</span>
      <h4>Every measurement behind your score</h4>
      <p>Your score and your ranking are free on every plan, and always will be. This is the part underneath: all thirty-one measurements, what each one did to the number, and how far it can actually move.</p>
      ${left}
      <div class="navrow"><button class="btn pri" id="btn-unlock">Unlock in-depth · 7 days free</button></div>
      <button class="linkish lock-single" id="btn-single-scan">Just this once, buy one scan for ${scanPrice()}</button>
    </div>
  </div>`;
}

function wireUnlock(): void {
  document.getElementById("btn-unlock")?.addEventListener("click", () => ctx?.onUpgrade?.());
  // The non-subscription road through the same gate. One price per person, two
  // prices on the label, and the server decides which applies — the client
  // never picks its own price.
  const single = document.getElementById("btn-single-scan") as HTMLButtonElement | null;
  single?.addEventListener("click", async () => {
    track("single-scan-started");
    single.disabled = true;
    single.textContent = "Opening secure Checkout…";
    const result = await startScanCreditCheckout();
    if (!result.ok) {
      single.disabled = false;
      single.textContent = result.message || "Single scans are not available yet.";
    }
  });
}

// What replaces the recommendations for a free or Starter account.
//
// It names what is behind the wall rather than teasing it. A blurred list of
// real product names with a lock over it is the pattern every competitor uses,
// and it is a worse experience than a straight sentence: it invites you to
// squint at something you cannot read, and it implies the value is in the
// secrecy rather than in the work.
// ---------------------------------------------------------------------------
// The way in to the chat.
//
// Sits at the top of the plan, because that is where somebody has just read
// four paragraphs about their own face and has a question. A separate tab in
// the row above would have been tidier and would have been opened by nobody:
// the question exists at the moment the answer is being read, not before.
//
// Only for accounts that hold Max. Rendering it locked would put a chat window
// behind a blur, which is a worse advertisement than the written plan already
// sitting under one.
// ---------------------------------------------------------------------------
// The lines he offers when somebody lingers on him. Rotated in order rather
// than picked at random, so a person who hovers three times hears three
// different things instead of the same one twice.
const ASK_LINES = [
  "I can help you.",
  "Let's turn this into a plan.",
  "Let's start attacking your goals.",
  "What does your dream glow up look like?",
  "What are you trying to achieve this year?",
];
let askLine = 0;

function askMaxCard(): string {
  // 18+ only, in any form: this is the standing rule for every Max surface.
  if (!adultUser) return "";
  // Plan holders do not get an advertisement — they get Max himself, peeking
  // from the edge of the screen (see maxPet.ts). The card is for the person
  // who has not bought yet: the character IS the pitch.
  if (maxAccess) return "";
  return `<button type="button" class="askmax askmax-cta" id="btn-askmax">
    <span class="askmax-bubble" id="askmax-bubble" aria-hidden="true"></span>
    <span class="askmax-face">${maxCharacterMarkup({ mood: "happy" })}</span>
    <span class="askmax-copy">
      <b>Meet Max, your personal coach</b>
      <small>Part of the Max plan. He reads your numbers and turns them into your plan.</small>
    </span>
    <span class="askmax-go" aria-hidden="true">→</span>
  </button>`;
}

function wireAskMax(): void {
  const button = document.getElementById("btn-askmax");
  if (!button || !ctx) return;
  const bubble = document.getElementById("askmax-bubble");
  const svg = button.querySelector<SVGSVGElement>(".mx-svg");

  const speak = (): void => {
    if (!bubble || !svg) return;
    bubble.textContent = ASK_LINES[askLine++ % ASK_LINES.length];
    bubble.classList.add("show");
    // A happy little wave with the line, and the mouth moves while the bubble
    // is up — he is saying it, not captioned by it.
    const arm = svg.querySelector(".mx-arm");
    arm?.classList.remove("waving");
    void (arm as SVGGElement | null)?.getBBox?.();
    arm?.classList.add("waving");
    svg.classList.add("speaking");
    window.setTimeout(() => {
      svg.classList.remove("speaking");
      bubble.classList.remove("show");
    }, 2400);
  };

  // Fine pointers get the wave on hover. Touch has no hover, so the first tap
  // speaks and the second goes to the offer — the same two beats, one gesture
  // apart.
  let spokeAt = 0;
  if (window.matchMedia("(pointer: fine)").matches) {
    button.addEventListener("pointerenter", speak);
  }
  button.onclick = () => {
    if (!ctx) return;
    if (!window.matchMedia("(pointer: fine)").matches && Date.now() - spokeAt > 2600) {
      spokeAt = Date.now();
      speak();
      return;
    }
    track("offer-shown");
    ctx.onUpgrade?.();
  };
}

// The chat context for THIS scan, built once per call so the pet and any
// future surface agree about what Max can see.
function chatContext() {
  if (!ctx) return null;
  return buildMaxContext({
    report: ctx.report,
    tone: loadVerdictTone() ?? "kind",
    scans: readAllHistory().length,
    potential: maxAccess ? ctx.report.potential : undefined,
    movement: ctx.delta ? deltaReadingCopy(ctx.delta) : undefined,
  });
}

function upsell(): string {
  return `<div class="recs upsell">
    <h4>WHAT MAX ADDS</h4>
    <p class="recs-note">Your measurements, your scores, your ranking and your progress over time are yours on every plan, and always will be. What Max adds is the part that takes work to get right: the specific routine for your face, not a generic list.</p>
    <ul class="upsell-list">
      <li><b>The method, not just the target.</b> The overview above says what to improve. Max writes how — for your face, in order, shaped by what you said you want.</li>
      <li><b>Follow-up that reads your numbers.</b> Max checks whether what you are doing actually moved a measurement, says so either way, and rebuilds the plan when eight weeks of a routine has moved nothing.</li>
      <li><b>Your wishlist, kept honest.</b> Max keeps the list of what you are using, edits it with you, and is allowed to tell you something on it is not earning its place.</li>
    </ul>
    <p class="recs-note">Nothing in Max is a prescription, a supplement or a procedure, and it never will be. A pharmacist or doctor knows your situation and we don't.</p>
    <div class="navrow"><button class="btn pri" id="btn-upgrade">See Max · 7 days free</button></div>
  </div>`;
}

// Recommendations: what to actually do, drawn only from things sold over a
// counter and things that are simply true about food. Ordered by how well the
// evidence holds up, because "strong" and "no good evidence" both appear here
// and the person deserves to see which is which before they spend anything.
function recsHTML(p: ReturnType<typeof loadProfile>): string {
  // A goal whose regions are all off-limits stays off-limits here too
  const quietGoals = new Set(
    GOALS.filter((g) => g.regions.length && g.regions.every((r) => isQuiet(r, p))).map((g) => g.id),
  );
  const recs = recsFor(p, quietGoals);
  if (!recs.length) return "";

  const order: Record<string, number> = { strong: 0, moderate: 1, limited: 2, none: 3 };
  recs.sort((a, b) => order[a.evidence] - order[b.evidence]);

  // Grouped, because a flat list of thirty cards is a wall. Within each group
  // the best-evidenced thing comes first, so the cheapest and most certain
  // options are what someone reads before anything they could spend money on.
  const GROUPS: Array<[string, string, string]> = [
    ["topical", "APPLY", "Over-the-counter only. Availability and permitted strengths differ by country, and a pharmacist will know what's on the shelf where you are."],
    ["food", "EAT", "Facts about food, not a diet. No targets, no counting, nothing to buy."],
    ["habit", "DO", "Free, and mostly the things that compound."],
    ["professional", "ASK SOMEONE", "The things worth paying a person for rather than guessing at."],
  ];

  const sections = GROUPS.map(([g, label, blurb]) => {
    const items = recs.filter((r) => r.group === g);
    if (!items.length) return "";
    return `<div class="rec-group">
      <h5>${label}</h5>
      <p class="rec-group-note">${blurb}</p>
      ${items
        .map(
          (r) => `<div class="rec ev-${r.evidence}">
        <b>${r.title}<em>${EVIDENCE_LABEL[r.evidence].toUpperCase()}</em></b>
        <span class="rec-what">${r.what}</span>
        <p>${r.detail}</p>
        ${r.caution ? `<span class="rec-caution">${r.caution}</span>` : ""}
      </div>`,
        )
        .join("")}
    </div>`;
  }).join("");

  return `<div class="recs">
    <h4>WORTH TRYING</h4>
    <p class="recs-note">Nothing here instructs you to use a prescription, supplement or at-home procedure. Over-the-counter items follow label directions; professional cards only explain options a qualified clinician may discuss after assessment. It isn't medical advice and none of it is required. Where evidence is weak, it says so.</p>
    ${sections}
  </div>`;
}

function goalHead(p: ReturnType<typeof loadProfile>): string {
  const goals = chosenGoals(p);
  if (!p.preDone && !p.postDone) return "";
  return `<div class="goal-head">
    <h4>YOUR PLAN</h4>
    ${p.endGoal ? `<div class="endgoal">“${p.endGoal}”</div>` : ""}
    <div class="goal-tags">
      ${goals.length
        ? goals.map((g) => `<span class="goal-tag">${g.label}</span>`).join("")
        : `<span class="goal-tag mut">No goals set, showing your weakest fixable numbers</span>`}
      ${skinConcernLabels(p)
        .map((l) => `<span class="goal-tag alt">${l}</span>`)
        .join("")}
      ${p.quiet.length ? `<span class="goal-tag mut">${p.quiet.length} topic${p.quiet.length > 1 ? "s" : ""} off-limits</span>` : ""}
    </div>
    ${
      skinConcernLabels(p).length
        ? `<p class="goal-declared">You told us this, the scan didn't. It measures how evenly your face reflects light, which cannot tell one skin condition from another.</p>`
        : ""
    }
    <button class="goal-edit" id="goal-edit">Edit your goals</button>
  </div>`;
}

function progressCopy(d: ScanDelta): string {
  if (d.overall > 0.15)
    return `<p class="rarity">Up <b>+${d.overall.toFixed(1)}</b> overall. The numbers moved, so whatever you're doing, keep doing it.</p>`;
  if (d.overall < -0.15)
    return `<p class="rarity">Down <b>${d.overall.toFixed(1)}</b> overall. Before reading into it: lighting, expression and angle explain most small drops, so recapture in the same conditions first.</p>`;
  return `<p class="rarity">Overall is <b>flat</b> (${d.overall >= 0 ? "+" : ""}${d.overall.toFixed(1)}), which is within capture variance. Structural change shows up over weeks, not days.</p>`;
}
