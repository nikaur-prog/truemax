import { countUp } from "./countUp.js";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { copyDiagnostics } from "./diagnostics.js";
import type { DiagnosticsCapture } from "./diagnostics.js";
import { aggregateScoreToPercentile, phi, REGION_NAMES, regionIsScored } from "../engine/scoring.js";
import type { PillarId, RegionId, RegionScore, Report, ScoredMetric, Sex } from "../engine/types.js";
import type { ScanDelta } from "../engine/history.js";
import type { SidePoints } from "../engine/sideMetrics.js";
import { SIDE_POINTS } from "../engine/sideMetrics.js";
import { distFor } from "../engine/metrics.js";
import { hasHistory, openHistory } from "./historyView.js";
import { regionMatches } from "../engine/celebs.js";
import { curveLegend, curveSVG } from "./curve.js";
import { REGION_LANDMARKS, zoomFor } from "./regions.js";
import { regionIconMarkup } from "./regionIcons.js";
import { scoreTone } from "./scoreTone.js";
import { resetTapPreview, wireTapPreview } from "./tapPreview.js";
import { drawCalm, transitionRegion } from "./overlay.js";
import { animateMeasurement, measurementBounds, transitionMeasurement } from "./measureOverlay.js";
import type { OverlayFade } from "./measureOverlay.js";
import { animateSideMeasurement, hasSideOverlay, sideMeasurementBounds } from "./sideMeasureOverlay.js";
import { closeMetricDetail, isMetricDetailOpen, openMetricDetail } from "./metricDetail.js";
import { PILLAR_BLURB, pillarDeck } from "./pillarDeck.js";
import { mountProtocolCard } from "./protocolCard.js";
import { commitProtocol, offerProtocol, protocolFor, readProtocols, writeProtocols } from "../engine/protocol.js";
import { IDENTITY_ZOOM, applyZoom, zoomToBounds } from "./zoomTransform.js";
import type { ZoomSpec } from "./zoomTransform.js";
import { renderShareCard, shareCard } from "./shareCard.js";
import type { CeilingInput } from "./ceilingCta.js";
import { coachRead, deltaReadingCopy, overviewCaveat, fmt, wasMeasured, leverFor, lockedCopy, percentileLine, rankShort, populationLine, rarityText, regionSummary, scoreHigherText, topPctText } from "./templates.js";
import { nutritionPlanHTML } from "./nutritionPlan.js";
import { macroPanelHTML, wireMacroPanel } from "./macroPanel.js";
import { stopTypewriter, typewrite } from "./typewriter.js";
import { chosenGoals, goalBoost, goalsTouching, isQuiet, loadProfile, skinConcernLabels } from "../engine/goals.js";
import { openQuiz } from "./goalsQuiz.js";
import { EVIDENCE_LABEL, RECS, buyGuideFor, recsFor, productSearchUrl } from "../engine/recommendations.js";
import type { Rec } from "../engine/recommendations.js";
import { loadVoiceCredits, startScanCreditCheckout, startVoiceCreditCheckout } from "../engine/entitlement.js";
import { scanPrice } from "../engine/scanPricing.js";
import { RELIABLE_MIN, reliabilityOf } from "../engine/reliability.js";
import { track } from "../engine/track.js";
import type { Depth } from "../engine/depth.js";
import { GOALS } from "../engine/goals.js";
import { showScalePrimer, wireScaleNote } from "./scaleNote.js";
// The verdict VIEW is gone; the verdict TONE is not — it still sets how Max
// speaks, which is a voice setting rather than a depth one.
import { DEFAULT_VERDICT_TONE, loadVerdictTone } from "../engine/analysisMode.js";
import { buildMaxContext } from "../engine/maxContext.js";
import { maxCharacterMarkup } from "./maxCharacter.js";
import type { MaxMood } from "./maxCharacter.js";
import { ownScans, readAllHistory } from "../engine/history.js";
import { renderScoreStrip } from "./scoreStrip.js";
import { armMaxPetReveal, mountMaxPet, unmountMaxPet } from "./maxPet.js";
import { openMaxChat } from "./maxChat.js";
import { ceilingCtaMarkup, paintCeilingCta } from "./ceilingCta.js";
import { openSelfScoreDialog, selfScoreSent } from "./selfScore.js";
import { SIDE_TAIL_LIMIT_PCT } from "../engine/precision.js";

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
  // Present when this scan is of somebody other than the account holder. The
  // results screen mostly renders the same either way — the numbers are the
  // numbers — but every line that speaks to the OWNER about THEIR progress
  // has to know, because a guest's delta is deliberately null and null also
  // means "your first scan".
  subjectName?: string;
  // The account holder's first name, for Coach Max's greeting on their own
  // scans. Absent when signed out or the profile has not loaded; the greeting
  // simply drops the name rather than inventing one.
  selfName?: string;
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
  /**
   * The clean front capture. The authoritative source for every "front" paint
   * of the photo pane — the pane itself is mutable state that may be holding
   * the side photograph, and cloning it to remember "the front" is how a
   * profile got itself labelled FRONT · ANALYZED in production.
   */
  frontPhoto?: HTMLCanvasElement;
  // The thirteen verified points, in the side photo's own pixel space, so the
  // Side tab can draw them where they were actually placed. Without these the
  // tab fell back to drawing the FRONT mesh at FRONT coordinates over the side
  // photo — a dense cloud in the wrong place that read exactly like "my points
  // jumped somewhere else after I confirmed them".
  sidePoints?: SidePoints;
  /**
   * Whether a human stood behind those thirteen points.
   *
   * Only ever explicitly false: somebody took the automatic placement, was
   * asked whether it looked right, said no, was offered the walkthrough and
   * declined. Undefined on a restored scan that predates the question, which
   * is why every test on this is `=== false` rather than a truthiness check.
   */
  sideVerified?: boolean;
  onRedoSide?: () => void;
  // The front half's equivalent: open the landmark editor over the front
  // photograph. Absent when there is nothing to edit against — a restored
  // scan with no landmark cloud in memory.
  onEditFront?: () => void;
  // Pose, expression and date of the capture, for the diagnostics dump. Two
  // dumps of the same person are only comparable if the conditions travel
  // with them; see diagnostics.ts.
  capture?: DiagnosticsCapture;
  // How far off level the front capture was, in degrees. The pose is corrected
  // before measurement, but the correction has residual error and the jaw and
  // chin take most of it — so beyond a few degrees the Basic grid says so
  // rather than presenting a dragged-down number with full confidence.
  offAxisDeg?: number;
  /**
   * A past scan reopened from its archive rather than freshly measured.
   * Renders the same interactive report — hover the measurements, walk the
   * regions — with the coaching stripped: Max reads the PRESENT and the plan
   * is built from the CURRENT scan, so neither may speak over a record.
   * Observations and numbers only, exactly as they were scored.
   */
  archived?: boolean;
  /** ISO date of the archived scan, for its label. */
  archivedDate?: string;
}

let ctx: Ctx | null = null;

// Whether the screen is showing observations only — a guest's scan or a
// recalled one. Every coaching surface (Max's read, the pet, the plan, the
// check-ins, the pathway) gates on this: a guest gets the science without the
// owner's coach talking to them, and a recalled scan is a record, not a
// session. The numbers render identically either way.
function observationsOnly(): boolean {
  return Boolean(ctx?.subjectName || ctx?.archived);
}

// A guest's name is typed by whoever is holding the phone, so it is escaped
// wherever it is printed. Local to this module for the same reason the other
// small helpers here are: one function is cheaper than the import.
const escapeHTML = (v: string): string =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderResults(c: Ctx): void {
  ctx = c;
  // The curve is taught before the first number is ever shown. Fire-and-forget
  // rather than awaited: the panel behind it renders as normal and the primer
  // covers it, so a storage failure or a dismissed dialog can never leave
  // somebody staring at an empty results screen.
  void showScalePrimer(c.report.sex);
  wireScaleNote(() => ctx?.report.sex ?? "male");
  wireMaxAsk();
  wireRecTracking();
  // A previous report may have been left on its side photograph. main.ts has
  // already painted the new front capture; reset the cached state so this scan
  // cannot restore the previous person's canvas or stale quality chips.
  shownPhoto = "front";
  frontPhoto = c.frontPhoto ?? null;
  // And PAINT it, unconditionally. The pane may be holding whatever the flow
  // that led here last drew — the side-adjust screen leaves the profile on it
  // — and resetting shownPhoto to "front" without repainting is exactly the
  // label/image disagreement this fixes.
  const pane = document.getElementById("photo-canvas") as HTMLCanvasElement | null;
  if (pane && frontPhoto) paint(pane, frontPhoto);
  frontQualityHTML = document.getElementById("quality-chips")?.innerHTML ?? "";
  // The score under the photograph, for the phone layout where the analysis
  // column starts below the fold. Rendered here rather than inside showOverall
  // because it belongs to the SCAN, not to the tab: switching to Proportions
  // must not take the headline number off the screen.
  renderScoreStrip(c.report);

  // Plan holders get Max himself, peeking from the edge of the screen with
  // this scan's numbers in hand. Everybody else gets the card (askMaxCard),
  // and under-18s get neither — the standing rule for every Max surface.
  // A guest's scan and a recalled one get no Max at all: observations only.
  if (maxAccess && adultUser && !c.subjectName && !c.archived) {
    const cc = chatContext();
    if (cc) mountMaxPet(cc);
    // A scan that moved up gets a reaction from him, once he has peeked out.
    // The coach celebrating YOUR number is the one moment the character and
    // the product are the same thing — and only on a real rise: cheering a
    // flat rescan would teach people his excitement means nothing.
    if (cc && c.delta && c.delta.overall > 0.05) {
      window.setTimeout(() => {
        const pet = document.querySelector<HTMLElement>(".maxpet");
        if (pet) void import("./maxCharacter.js").then((m) => m.reactMax(pet, "cheer"));
      }, 1900);
    }
  } else {
    unmountMaxPet();
  }
  // A new scan starts from the calm whole-face state. Without this the first
  // tab change after re-scanning would animate out of the PREVIOUS photo's
  // region, which is a transition from somewhere the user never was.
  transition?.cancel();
  transition = null;
  shownRegion = null;
  // The tab row rides in a rail of its own. The rail is what sticks, and it
  // has to be a separate element: the tabs scroll sideways on a phone and
  // carry a right-edge fade to say so, and a fade painted on the scroller
  // itself would also fade the opaque background out from under the text
  // passing beneath a pinned row.
  const rail = document.createElement("div");
  rail.className = "rtabs-rail";
  const tabs = document.createElement("div");
  tabs.className = "rtabs";
  rail.appendChild(tabs);
  // A position indicator under the row.
  //
  // Ten tabs do not fit across a phone, so the row scrolls — and a right-edge
  // fade, which is what it had, is a thing you notice only once you already
  // know there is more. Everything past the third region was effectively
  // undiscoverable: somebody reading their eye scores had no way to learn that
  // Chin, Lips and Symmetry existed at all.
  //
  // A thumb whose width is the visible fraction and whose position is how far
  // along you are says both things at once — there is more, and this is where
  // you are in it — in two pixels of height. Hidden entirely when everything
  // already fits, because a full-width scrollbar under a row that cannot
  // scroll is furniture that lies.
  const track = document.createElement("div");
  track.className = "rtabs-track";
  track.setAttribute("aria-hidden", "true");
  track.innerHTML = `<i></i>`;
  rail.appendChild(track);
  mountTabScrollbar(tabs, track);

  // The Side tab is gone from this row: it is not a ninth region, it is the
  // other half of the scan, and burying it among eight regions made a quarter
  // of the score and fifteen measurements read as a footnote. It is now the
  // toggle under the photograph.
  const toggle = document.getElementById("view-toggle");
  if (toggle) {
    toggle.classList.toggle("hidden", !c.sideReport);
    for (const b of toggle.querySelectorAll<HTMLButtonElement>(".vt-btn")) {
      // The view is FORCED. select() keeps view-neutral tabs on whichever
      // side of the scan you were reading, which is right for tab clicks and
      // wrong for this control: pressing Front from Coach Max's read used to
      // recompute "still side" from tabView and change nothing.
      const view = b.dataset.view === "side" ? ("side" as const) : ("front" as const);
      b.onclick = () => select(view === "side" ? "side" : "overall", view);
    }
    if (c.sideReport) floatToggleWhenScrolledPast(toggle);
  }

  c.analysis.innerHTML = "";
  c.analysis.appendChild(rail);
  const body = document.createElement("div");
  body.id = "body";
  c.analysis.appendChild(body);
  placeQualityChips();
  tabView = "front";
  buildTabs("front");
  // The initial mount does not scroll: main.ts owns where the page sits when
  // the results arrive, and a second scroll from here would fight it.
  select("overall", undefined, { silent: true });
}

// Which half of the scan the tab row is currently describing.
let tabView: "front" | "side" = "front";

// ---------------------------------------------------------------------------
// Where the provenance chips live, which turns out to be a layout question
// rather than a copy one.
//
// On a phone the photo column pins to the top of the screen so the score stays
// visible while you read, and the chips — "scored against male norms",
// "pose-corrected · 12° off-axis" — were the last thing inside it. So four
// lines of small print about how the measurement was taken pinned themselves
// to a third of the screen and stayed there for the entire report. They are
// worth reading once. They are not worth a permanent seat.
//
// So on a phone they move out of the pinned column and into the top of the
// analysis, directly above the tab row, where they are read once and then
// scroll away like the rest of the small print. Desktop is untouched: there
// the photo column is a column, not a lid, and nothing it holds is in the way.
//
// The node is MOVED, never rebuilt. main.ts and this module both hold a
// reference to it from getElementById at load, and recreating it would strand
// both of them writing into a detached div.
// ---------------------------------------------------------------------------
const NARROW = "(max-width: 850px)";

function placeQualityChips(): void {
  const chips = document.getElementById("quality-chips");
  const analysis = ctx?.analysis ?? document.getElementById("analysis");
  const photo = document.querySelector<HTMLElement>(".pane-photo");
  if (!chips || !analysis || !photo) return;
  const rail = analysis.querySelector<HTMLElement>(".rtabs-rail");
  if (window.matchMedia(NARROW).matches) {
    if (rail && chips.parentElement !== analysis) analysis.insertBefore(chips, rail);
  } else if (chips.parentElement !== photo) {
    photo.appendChild(chips);
  }
}

// Crossing the breakpoint with a report already on screen has to move them
// back, or a desktop window narrowed to a phone width keeps its chips pinned
// and a phone rotated to landscape leaves them stranded in the analysis.
if (typeof window !== "undefined" && window.matchMedia) {
  window.matchMedia(NARROW).addEventListener?.("change", () => placeQualityChips());
}

/**
 * Keep the tab row's position indicator in step with its scroll.
 *
 * Reads on scroll and on resize, both passive, and writes two custom
 * properties rather than restyling — so a swipe costs one style recalculation
 * per frame on one element and nothing else on the page moves.
 */
function mountTabScrollbar(tabs: HTMLElement, track: HTMLElement): void {
  const sync = (): void => {
    const { scrollWidth, clientWidth, scrollLeft } = tabs;
    const overflow = scrollWidth - clientWidth;
    // A couple of pixels of slack: sub-pixel layout leaves a phantom 0.5px of
    // overflow on rows that visibly fit, and a scrollbar for half a pixel is
    // worse than none.
    if (overflow <= 2) {
      track.hidden = true;
      return;
    }
    track.hidden = false;
    const frac = clientWidth / scrollWidth;
    track.style.setProperty("--thumb-w", `${(frac * 100).toFixed(2)}%`);
    track.style.setProperty("--thumb-x", `${((scrollLeft / overflow) * (1 - frac) * 100).toFixed(2)}%`);
  };
  tabs.addEventListener("scroll", sync, { passive: true });
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(sync).observe(tabs);
  sync();
}

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
    // The glyph is decorative — it is aria-hidden inside its own markup — so
    // the label still carries the whole meaning for a screen reader, and the
    // icon is above it rather than beside it so a row of eleven stays narrow
    // enough to be worth scrolling.
    const icon = regionIconMarkup(id);
    if (icon) b.innerHTML = icon;
    const text = document.createElement("span");
    text.className = "rt-label";
    text.textContent = label;
    b.appendChild(text);
    b.dataset.id = id;
    b.onclick = () => select(id);
    tabs.appendChild(b);
  };
  // A guest's scan and a recalled one carry no coaching, so the row does not
  // promise any: the headline tab is a plain Overview and the Plan tab is
  // absent — the plan is built from the owner's CURRENT scan and goals, and
  // rendering it over somebody else's face or a weeks-old record would be
  // advice about the wrong thing.
  const plain = observationsOnly();
  const headline = !plain && maxAccess && adultUser ? "Coach Max’s read" : "Overview";
  if (view === "side" && ctx.sideReport) {
    mk("Profile", "side");
    for (const r of ctx.sideReport.regions) {
      if (r.metrics.length) mk(REGION_NAMES[r.region], `side:${r.region}`);
    }
    // These two are not front tabs that happen to be listed first. Max reads
    // the WHOLE scan — both views are in his context — and the plan is built
    // from every measurement in the report. Dropping them when the profile was
    // selected meant switching view silently took away the read and the plan,
    // and the only way back was to notice the front/side toggle under the
    // photograph and use it. They belong on both rows.
    mk(headline, "overall");
    if (!plain) mk("Plan →", "improve");
    return;
  }
  mk(headline, "overall");
  for (const r of ctx.report.regions) mk(REGION_NAMES[r.region], r.region);
  if (!plain) mk("Plan →", "improve");
}

// Overall, front and side side by side, so the merge is legible: two views went
// in and one number came out, and you can see which one pulled which way.
//
// Only drawn once both views are in. On a front-only report the front card
// would be a copy of the overall card and the side card would be empty, which
// is three boxes to say what one already said.
function viewCards(r: Report): string {
  if (!r.views) return "";
  // The fourth column is how far into a tail that card may name a band. The
  // profile gets a wider floor than the other two: thirteen points placed by
  // hand, on a metric set whose repeatability is still open, printed "Bottom
  // 1%" beside a 3.5 — the most precise-sounding claim in the product sitting
  // on its least established measurement. See SIDE_TAIL_LIMIT_PCT.
  const cards: Array<[string, number, number, number | undefined]> = [
    ["OVERALL", r.overall, r.overallPercentile, undefined],
    ["FRONT", r.views.front.score, r.views.front.percentile, undefined],
    ["SIDE", r.views.side.score, r.views.side.percentile, SIDE_TAIL_LIMIT_PCT],
  ];
  // One decimal, matching the headline and the pillars. Two decimals were an
  // attempt at precision the measurement cannot support — a single scan moves
  // by about 0.9 points between photographs — and they actively misled: three
  // cards reading 4.20, 4.20, 4.20 look like a stuck constant, where 4.2,
  // 4.2, 4.2 reads as three numbers that happen to agree.
  const same = new Set(cards.map(([, score]) => score.toFixed(1))).size === 1;
  return `<div class="viewcards">${cards
    .map(([label, score, pct, tailLimit]) => {
      const tone = scoreTone(score);
      return `<div class="viewcard${label === "OVERALL" ? " lead" : ""}">
        <span class="vc-label">${label}</span>
        <span class="vc-rank">${rankShort(pct, tailLimit)}</span>
        <b class="vc-score ${tone}"><span data-count="${score}" data-decimals="1">0.0</span><small>/10</small></b>
      </div>`;
    })
    .join("")}</div>${
    // When they genuinely coincide, say so. Silence there reads as a bug.
    same
      ? `<p class="viewnote same">Both views landed on the same number this time — the front and the profile agree.</p>`
      : ""
  }`;
}

// ---------------------------------------------------------------------------
// What to do next, once the numbers have been read.
//
// This was six identical link-blue boxes in a three-row grid, and the problem
// was not that they were ugly — it was that they were EQUAL. "Next · Build my
// pathway", which is the whole product, sat in the same treatment as "Copy
// diagnostics", which is a debugging affordance. A screen where every option
// looks the same asks the reader to do the ranking, and most of them will
// simply not bother.
//
// Three tiers instead:
//
//   lead      one action, filled, with an icon. The step the product wants.
//   support   the two or three things a person might reasonably do instead.
//   quiet     the utilities — correcting points, copying the dump — set small
//             and low-contrast, findable and never competing.
//
// Icons on all of them, because a row of words is read left to right and a row
// of marks is taken in at once, and these sit at the bottom of a long report
// where attention is thinnest.
// ---------------------------------------------------------------------------
const ACT_ICON: Record<string, string> = {
  plan: `<path d="M4 18.5 9 12l3.6 3.4L20 6.4"/><path d="M15.4 6H20v4.6"/>`,
  pathway: `<path d="M5 12h11"/><path d="m13 8 4 4-4 4"/><circle cx="19.4" cy="12" r="1.6"/>`,
  side: `<path d="M15.6 20.4v-3c0-1.1.6-1.7 1.7-1.9.8-.2 1.1-.7.7-1.4l-1.3-2.5c.3-4.1-1.9-6.9-5.5-6.9-3.4 0-5.9 2.5-5.9 6 0 2.2 1 3.7 2.4 4.8v4.9"/>`,
  photo: `<path d="M3.5 8.5h3.2l1.6-2.4h7.4l1.6 2.4h3.2v11H3.5Z"/><circle cx="12" cy="13.6" r="3.4"/>`,
  share: `<path d="M12 15.5V4.2"/><path d="m8.2 7.6 3.8-3.4 3.8 3.4"/><path d="M5 13.5v6.3h14v-6.3"/>`,
  points: `<circle cx="7" cy="8" r="1.8"/><circle cx="17.2" cy="12" r="1.8"/><circle cx="9" cy="17.4" r="1.8"/><path d="M8.6 8.7 15.6 11M15.9 13.4 10.4 16.4" stroke-dasharray="1.6 1.8"/>`,
  copy: `<rect x="9" y="9" width="11" height="11" rx="2.4"/><path d="M15 9V6.4a2 2 0 0 0-2-2H6.4a2 2 0 0 0-2 2V13a2 2 0 0 0 2 2H9"/>`,
  voice: `<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v2.6"/>`,
  gauge: `<path d="M4.5 18a8.5 8.5 0 1 1 15 0"/><path d="m12 14 3.4-4.6"/><circle cx="12" cy="14.5" r="1.4"/>`,
};

function actionButton(
  id: string,
  label: string,
  icon: keyof typeof ACT_ICON,
  tier: "lead" | "support" | "quiet",
  hidden = false,
): string {
  return `<button type="button" class="ract ract-${tier}" id="${id}"${hidden ? " hidden" : ""}>
    <svg class="ract-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ACT_ICON[icon]}</svg>
    <span>${label}</span>
  </button>`;
}

function resultActions(merged: boolean, ctx: Ctx): string {
  // Observations-only screens (a guest's scan, a recalled one) carry no
  // coaching actions: no plan, no pathway. The measurement actions stay.
  const plain = Boolean(ctx.subjectName || ctx.archived);
  // Until the profile is in, adding it IS the next step, so it takes the lead
  // slot. A scan is not finished at one view, and putting that in a ghost
  // button next to "Share card" said the opposite.
  const wantsSide = !merged && ctx.onSideProfile;
  const lead = wantsSide
    ? actionButton("btn-side", "Add side profile", "side", "lead")
    : !plain && ctx.onContinue
      ? actionButton("btn-continue", pathwayLabel(), "pathway", "lead")
      : "";
  const support = [
    // Hidden rather than dropped when the lead button already goes here: the
    // session read that decides that lands after this string is built.
    plain ? "" : actionButton("btn-plan", "See your plan", "plan", "support", pathway === "plan"),
    actionButton("btn-new", wantsSide ? "Start over" : "New photo", "photo", "support"),
    actionButton("btn-share", "Share card", "share", "support"),
    // The voiced analysis: this scan as the narrated video, Coach Max's
    // voice included. A $2.99 one-time purchase for any adult account —
    // every export is a real synthesis call, so every export is paid for.
    // The price rides on the button until the account holds a credit; the
    // wire-up below swaps the label the moment the balance says otherwise.
    // Not on a recalled scan: the stored photograph is a 320px thumbnail,
    // and $2.99 must never buy a soft render.
    adultUser && !ctx.archived ? actionButton("btn-voiced", "Voiced analysis · $2.99", "voice", "support") : "",
  ].join("");
  const quiet = [
    // The front counterpart of the profile's "Re-verify the points". The
    // frontal mesh is usually right, which is exactly why this is quiet: it is
    // here for the person who can SEE a point in the wrong place, and beneath
    // notice for everyone else.
    //
    // No separate "See a voiced example" button any more: the example IS the
    // shop window, so it opens from the voiced-analysis button itself, with
    // the purchase underneath it. Two buttons for one product made the row
    // longer and the flow harder to guess.
    ctx.onEditFront ? actionButton("btn-fedit", "Correct the points", "points", "quiet") : "",
    actionButton("btn-diag", "Copy diagnostics", "copy", "quiet"),
    // The calibration ear. Quiet on purpose: it is for the person who already
    // disagrees, not an invitation to doubt the number. Own live scans only —
    // a guest's face or a recalled record is not the owner's self-assessment.
    !plain && ctx.capture?.scanId
      ? actionButton(
          "btn-selfscore",
          selfScoreSent(ctx.capture.scanId) ? "Your score is recorded" : "Think we scored you wrong?",
          "gauge",
          "quiet",
        )
      : "",
  ].join("");

  return `<div class="ractions">
    ${lead}
    <div class="ract-row">${support}</div>
    <div class="ract-row ract-utils">${quiet}</div>
  </div>`;
}

/**
 * Put the reader back at the top of the report.
 *
 * Switching to Side, or to a region tab, replaces the whole right-hand column
 * under a scroll position that was correct for the column that just left. So
 * pressing Side from halfway down the front's measurement list dropped the
 * person into the middle of the side's list, past the heading, past the score,
 * past Coach Max's read — reported as "it auto-scrolls me down to the
 * ratings". Nothing was scrolling. Nothing was un-scrolling either, which is
 * the actual bug: this is the only place in the report that ever moves the
 * page, and until now it did not exist.
 *
 * The rail is the target rather than the photograph. It carries its own
 * scroll-margin under the sticky header, it is the top of the thing that
 * changed, and on a phone the photo column sits above it and stays reachable
 * with one flick up.
 */
function scrollReportToTop(): void {
  const rail = ctx?.analysis.querySelector<HTMLElement>(".rtabs-rail");
  if (!rail) return;
  // Already at or above the top of the report: a scroll here would drag
  // somebody who is reading the photograph downward, which is the opposite of
  // the complaint.
  if (rail.getBoundingClientRect().top >= 0) return;
  rail.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * `silent` marks a select that no person asked for: the initial mount, and the
 * repaint when a late entitlement read lands. Two behaviours hang off it, and
 * both would be wrong on a programmatic call.
 *
 * It must not SCROLL, because the page position belongs to whoever set it.
 * And it must not open the OFFER: the plan tab is walled, so a person pressing
 * it is asking to see the offer, while an entitlement read resolving under an
 * already-open plan tab is not — that one would fire a paywall at somebody who
 * pressed nothing.
 */
function select(id: string, forceView?: "front" | "side", opts: { silent?: boolean } = {}): void {
  if (!ctx) return;
  // The wall. Measurement is free and coaching is paid, so this is the single
  // door the plan is behind — the tab, the lead button, the support row and
  // "See my current plan" all arrive here, and gating the door rather than the
  // four handles is why there is nothing to keep in step.
  if (id === "improve" && depth !== "plan" && !opts.silent) {
    ctx.onUpgrade?.();
    return;
  }
  stopTypewriter();
  // Leaving Coach Max's read is the signal that the first read is over —
  // which is what arms the pet's entrance (ten seconds later, from the edge).
  // Arming is idempotent and a no-op when he is hidden or not mounted.
  if (id !== "overall") armMaxPetReveal();
  // Two tabs belong to neither view. Max reads the whole scan and the plan is
  // built from every measurement in it, so reaching either from the profile
  // row must not throw the row back to the front tabs — that would take away
  // the profile's own regions as the price of reading the summary, and leave
  // the person hunting for the toggle under the photograph to get back.
  // `forceView` is that toggle speaking: it names the view outright, because
  // inferring it from tabView is exactly what made pressing Front a no-op.
  const viewNeutral = id === "overall" || id === "improve";
  const onSide = id === "side" || id.startsWith("side:") || (viewNeutral && (forceView ?? tabView) === "side");
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
  // After the new panel exists, not before: scrolling to a rail that is about
  // to be re-measured under fresh content lands in the wrong place.
  if (!opts.silent) scrollReportToTop();
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

  // The view-neutral tabs (Coach Max's read, Plan) call this with null while
  // the PROFILE can be on the pane — and the calm state below is the front
  // mesh, drawn from front landmarks at front coordinates. Over the side
  // photograph that lands as a cloud of dots nowhere near the face. While the
  // profile is showing, the resting overlay is its thirteen verified points,
  // and the front zoom geometry has nothing to say.
  if (shownPhoto === "side") {
    shownRegion = null;
    applyZoom(ctx.zoomable, IDENTITY_ZOOM);
    ctx.zoomable.style.removeProperty("--crop-x");
    ctx.zoomable.style.removeProperty("--crop-y");
    drawSidePoints();
    return;
  }

  if (region) {
    const z = zoomFor(region, ctx.landmarks);
    // translate+scale rather than transform-origin+scale, because CSS tweens a
    // transform and applies a changed origin INSTANTLY — every region change
    // used to open with a sideways jump as the pivot teleported. One
    // interpolable transform glides. See zoomTransform.ts.
    applyZoom(ctx.zoomable, z);
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
    applyZoom(ctx.zoomable, IDENTITY_ZOOM);
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
    // No fallback clone of the pane here. It used to read `frontPhoto ??
    // cloneCanvas(canvas)`, which on any path that reached this point with the
    // profile already on the pane adopted the PROFILE as the front photograph —
    // permanently, for the rest of the report. Switching back to Front then
    // showed the side shot captioned FRONT, with the front mesh and the front
    // region zooms drawn over it. The caller owns the front capture (Ctx.
    // frontPhoto, from PendingFront.photo); if it is missing, Front is simply
    // unavailable, which is visibly broken rather than quietly wrong.
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
// Always the front capture handed in by the caller, never a copy of the shared
// pane. Deleting the clone-the-pane helper that used to back this is the point:
// there is no longer a way for the profile to become "the front photograph".
let frontPhoto: HTMLCanvasElement | null = null;
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
  renderSideInto(body(), ctx.sideReport);
  wireSideMeasurementTaps(ctx.sideReport);
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

  // No population curve or rarity line in the profile panel, deliberately.
  //
  // AGG_NORM holds quantile tables measured from FRONT-ONLY scans of the
  // reference set — there is not a single side entry in it, because side
  // landmarks are hand-placed and nobody has dragged thirteen points onto a
  // hundred reference faces. curveSVG("region:nose") therefore FOUND a table,
  // just the wrong one: it drew the front nose distribution and marked the
  // side nose percentile on it. Shape from one measurement set, dot from
  // another, which is why the density and the quartile ticks visibly
  // disagreed on screen. The rarity sentence underneath was the same claim in
  // words — "roughly 1 in N faces measure this well" out of a table that never
  // saw a profile.
  //
  // A fabricated chart is worse than no chart, so the panel says what it does
  // not know. It gets a curve back when there are measured side quantiles to
  // draw one from, and not before.
  body().innerHTML = `
    <div class="reveal">
      ${sideRegionDeck(r, report)}
      <div class="panel"><h4>${REGION_NAMES[id].toUpperCase()} · IN PROFILE</h4>
        <p class="side-nocurve">No population curve for profile measurements yet. The reference set was scanned front-on, so there is no measured distribution of profiles to place this against. The score above is real; the curve would be invented.</p></div>
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
// Tapping a pillar opens the measurements behind it.
//
// The regions still lead — they are the tabs, they carry the photograph, they
// are what the scan walked. This is the answer to "what IS Angularity", asked
// in the one place the word appears, and it is answered with the same card and
// the same measurements the region rows open rather than with a second screen
// of its own.
function wirePillarCards(report: Report): void {
  for (const card of document.querySelectorAll<HTMLElement>(".pillar.can-open")) {
    card.onclick = () => {
      if (!ctx) return;
      const pillar = card.dataset.pillar as PillarId | undefined;
      if (!pillar) return;
      openPillarSheet(report, pillar);
    };
  }
}

let pillarSheet: HTMLElement | null = null;

function closePillarSheet(): void {
  pillarSheet?.remove();
  pillarSheet = null;
  document.removeEventListener("keydown", onPillarKey);
}

function onPillarKey(ev: KeyboardEvent): void {
  // Scoped to the sheet: the detail card opens ON TOP of it and owns Escape
  // while it is up, so closing the card must not also close the list behind it.
  if (ev.key === "Escape" && !isMetricDetailOpen()) {
    ev.stopPropagation();
    closePillarSheet();
  }
}

/**
 * The pillar, opened as a list of the measurements that feed it.
 *
 * A list rather than a straight jump into the detail card, because the question
 * the four numbers raise is "what is this made of" and a list answers it in one
 * look. Each row still opens the detail card, at its own place in the deck, so
 * the walk through the measurements is the same walk the region rows give.
 */
function openPillarSheet(report: Report, pillar: PillarId): void {
  const deck = pillarDeck(report, pillar);
  if (!deck.length || !ctx) return;
  closePillarSheet();

  const sex = report.sex;
  const wrap = document.createElement("div");
  pillarSheet = wrap;
  wrap.className = "psx-overlay";
  wrap.innerHTML = `<div class="psx-card" role="dialog" aria-modal="true" aria-label="${pillar} measurements">
    <header class="psx-head">
      <div>
        <span class="psx-eyebrow">PILLAR</span>
        <h3 class="psx-title">${pillar}</h3>
      </div>
      <span class="psx-count">${deck.length} measured</span>
      <button class="psx-close" type="button" aria-label="Close">✕</button>
    </header>
    <div class="psx-body">
      <p class="psx-note">${PILLAR_BLURB[pillar]}</p>
      ${deck
        .map(
          (m, i) => `<div class="metric tappable${isIndicative(m) ? " indicative" : ""}${
            m.implausible ? " implausible" : ""
          }" data-pillar-row="${i}" style="animation-delay:${60 + i * 55}ms">
        <div class="mrow"><b>${m.def.name}${indicativeTag(m)}</b><span>${fmt(m)}<span class="mscore">${
          m.implausible ? "–" : m.score.toFixed(1)
        }</span></span></div>
        <div class="psx-where">${REGION_NAMES[m.def.region] ?? m.def.region}</div>
        ${
          // An impossible reading has no position to place, exactly as on the
          // side rows and in the detail card. The row still appears, because
          // dropping it would change how many measurements a pillar has from
          // one scan to the next with no account of why.
          m.implausible ? "" : `<div class="rangebar">${idealWindow(m, sex)}<i data-l="${m.markerPct}"></i></div>`
        }
      </div>`,
        )
        .join("")}
      <p class="psx-foot">Regions are the way through the report. This is the same set of measurements gathered a second way, by what they contribute to rather than where they sit.</p>
    </div>
  </div>`;

  let downOnBackdrop = false;
  wrap.addEventListener("pointerdown", (e) => {
    downOnBackdrop = e.target === wrap;
  });
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap && downOnBackdrop) closePillarSheet();
  });
  wrap.querySelector(".psx-close")!.addEventListener("click", closePillarSheet);

  for (const row of wrap.querySelectorAll<HTMLElement>("[data-pillar-row]")) {
    row.addEventListener("click", () => {
      if (!ctx) return;
      openMetricDetail({
        // The deck spans regions by definition, so the card takes each
        // measurement's own region from it. This is only the fallback.
        region: deck[0].def.region,
        deckLabel: pillar,
        deckNote: PILLAR_BLURB[pillar],
        metrics: deck,
        index: Number(row.dataset.pillarRow),
        sex,
        landmarks: ctx.landmarks,
        frontPhoto: frontPhoto,
        sidePhoto: ctx.sidePhoto ?? null,
        sidePoints: ctx.sidePoints ?? null,
      });
    });
  }

  document.body.appendChild(wrap);
  document.addEventListener("keydown", onPillarKey);
  wrap.querySelector<HTMLElement>(".psx-close")?.focus();
  // Same deferred paint the region list uses: the bars animate from zero to
  // their marker rather than appearing already placed.
  setTimeout(() => {
    for (const i of wrap.querySelectorAll<HTMLElement>(".rangebar i")) {
      i.style.left = `${i.dataset.l}%`;
    }
  }, 30);
}

let sideFade: OverlayFade | null = null;
function wireSideMeasurementTaps(report: Report): void {
  if (!ctx?.sidePoints || !ctx.sidePhoto) return;
  const pts = ctx.sidePoints;
  const w = ctx.sidePhoto.width;
  const h = ctx.sidePhoto.height;
  const metrics = report.regions.flatMap((r) => r.metrics);
  sideActive = null;
  sideFade?.cancel();
  sideFade = null;
  if (revert !== null) window.clearTimeout(revert);
  revert = null;

  const hints = Array.from(document.querySelectorAll<HTMLElement>(".side-tap-hint"));
  const setHints = (name: string | null) => {
    for (const hint of hints) {
      hint.classList.toggle("on", !!name);
      hint.innerHTML = name
        ? `<i>◱</i>Drawing <b>${name}</b>, tap to open`
        : `<i>◱</i>Hover to draw it on your profile · tap to open`;
    }
  };

  const openDetail = (metric: ScoredMetric) => {
    if (!ctx) return;
    const region = report.regions.find((x) => x.region === metric.def.region);
    if (!region) return;
    const deck = region.metrics.filter(wasMeasured);
    // Rows are wired for every metric with a recipe, but the deck holds only
    // the measured ones — so a row whose value is non-finite is not in it.
    // Math.max(0, -1) would open a DIFFERENT measurement under the tapped
    // row's name; opening nothing is the honest outcome.
    const at = deck.findIndex((m) => m.def.id === metric.def.id);
    if (at < 0) return;
    openMetricDetail({
      region: region.region,
      metrics: deck,
      index: at,
      sex: report.sex,
      landmarks: ctx.landmarks,
      frontPhoto: frontPhoto,
      sidePhoto: ctx.sidePhoto ?? null,
      sidePoints: ctx.sidePoints ?? null,
    });
  };

  const aimSide = (z: ZoomSpec) => {
    if (!ctx) return;
    applyZoom(ctx.zoomable, z);
    ctx.zoomable.style.setProperty("--crop-x", `${z.originX}%`);
    ctx.zoomable.style.setProperty("--crop-y", `${z.originY}%`);
  };

  const show = (id: string | null) => {
    if (!ctx || id === sideActive) return;
    sideActive = id;
    const metric = id ? metrics.find((m) => m.def.id === id) : null;
    for (const other of document.querySelectorAll(".metric[data-side-metric]")) {
      other.classList.toggle("active", (other as HTMLElement).dataset.sideMetric === id);
    }
    setHints(metric?.def.name ?? null);
    sideFade?.cancel();
    if (metric) {
      sideFade = animateSideMeasurement(ctx.overlay, pts, w, h, metric);
      const b = sideMeasurementBounds(metric, pts, w, h);
      aimSide(b ? zoomToBounds(b, { fill: 0.55, min: 1.15, max: 2.3 }) : IDENTITY_ZOOM);
    } else {
      drawSidePoints();
      aimSide(IDENTITY_ZOOM);
    }
  };

  // Same grace period as the front deck, for the same flicker.
  const disarm = () => {
    if (revert !== null) window.clearTimeout(revert);
    revert = null;
  };
  const arm = () => {
    disarm();
    revert = window.setTimeout(() => {
      revert = null;
      show(null);
    }, LEAVE_GRACE_MS);
  };

  // The side hint advertises "tap to open" and, unlike the front one, was
  // never wired — so the affordance did nothing on the deck where a phone has
  // no hover to fall back on.
  for (const hint of hints) {
    hint.onclick = () => {
      const m = metrics.find((x) => x.def.id === sideActive) ?? metrics.find((x) => hasSideOverlay(x.def.id));
      if (m) openDetail(m);
    };
  }

  resetTapPreview();
  for (const row of document.querySelectorAll<HTMLElement>(".metric[data-side-metric]")) {
    const id = row.dataset.sideMetric!;
    if (!hasSideOverlay(id)) continue;
    // On a phone the first press draws the measurement on the pinned profile
    // and the second opens it — see ui/tapPreview.ts. A mouse is unchanged.
    wireTapPreview(row, id, {
      preview: (which) => show(which),
      leave: arm,
      disarm,
      open: (which) => {
        const m = metrics.find((x) => x.def.id === which);
        if (m) openDetail(m);
      },
    });
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
      ${
        ctx.archived
          ? `<p class="ego">Recalled scan from ${ctx.archivedDate ? new Date(ctx.archivedDate).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "this device"}. Shown exactly as it was measured. Observations and numbers only.</p>`
          : ""
      }
      ${maxAccess && adultUser && !observationsOnly() ? maxAnalysisHTML(r, delta, "front", ctx.subjectName, ctx.selfName) : ""}
      <div class="score-head">
        <div><div class="klabel">${ctx.subjectName ? `${escapeHTML(ctx.subjectName.toUpperCase())} · ` : ""}${merged ? "OVERALL · FRONT + SIDE" : "OVERALL · FRONT ONLY"}
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
      <div class="pillars">${(Object.entries(r.pillars) as [PillarId, number][])
        .map(([p, s]) => {
          // A pillar with nothing measured behind it is not a button. It can
          // happen: a front-only scan whose regions mostly failed the
          // reliability bar leaves a pillar with an aggregate and an empty
          // deck, and a card that opens onto nothing is worse than a card that
          // does not offer.
          const open = pillarDeck(r, p).length > 0;
          const tag = open ? "button" : "div";
          const attrs = open ? ` type="button" class="pillar can-open" data-pillar="${p}"` : ` class="pillar"`;
          return `
        <${tag}${attrs}><b data-count="${s}" data-decimals="1">0.0</b><span>${p.toUpperCase()}</span>
        <div class="pbar"><i data-w="${s * 10}"></i></div></${tag}>`;
        })
        .join("")}
      </div>
      ${populationBlock(r)}
      ${resultActions(Boolean(merged), ctx)}
      ${modeSwitcher("full")}
      ${hasHistory() ? `<button class="hist-entry" id="btn-history">View all your scans →</button>` : ""}
    </div>`;

  wireModeSwitcher();
  const overview = body().querySelector<HTMLElement>(".overview-reveal");
  if (overview) animateOverview(overview);
  wirePillarCards(r);
  document.getElementById("btn-history")?.addEventListener("click", () => openHistory());
  // Correcting the reference population where its effect is visible. Every
  // percentile on this screen comes from it, and it moves the overall score by
  // a median of 0.7 points, so it cannot be a choice you can only revisit by
  // starting over.
  const refBtn = document.getElementById("ref-switch");
  if (refBtn) refBtn.onclick = () => ctx?.onSexChange?.(r.sex === "male" ? "female" : "male");
  // The whole scan as pasteable text, front and side together.
  //
  // It already existed on /quick and only there, which is front-only by design
  // — so the one number an external comparison needs most, the side, could not
  // be got out of the app at all without screenshotting eight region cards. The
  // merged report already carries both views' metrics, so this is the same dump
  // reaching the screen that has both.
  const diagBtn = document.getElementById("btn-diag") as HTMLButtonElement | null;
  if (diagBtn) {
    diagBtn.onclick = async () => {
      const copied = await copyDiagnostics(r, "", ctx?.capture);
      // Says which of the two things happened. "Copied" over a clipboard write
      // that silently failed is the one outcome that wastes somebody's scan.
      // Into the label, not the button: the button also holds an icon, and
      // textContent on the parent would delete it on the first press.
      const label = diagBtn.querySelector("span") ?? diagBtn;
      label.textContent = copied ? "Copied" : "Copy from the box";
      window.setTimeout(() => (label.textContent = "Copy diagnostics"), 2600);
    };
  }
  const selfScoreBtn = document.getElementById("btn-selfscore") as HTMLButtonElement | null;
  if (selfScoreBtn) {
    selfScoreBtn.onclick = () => {
      const scanId = ctx?.capture?.scanId;
      if (!ctx || !scanId || selfScoreSent(scanId)) return;
      openSelfScoreDialog({ scanId, ourScore: ctx.report.overall, sex: ctx.report.sex }, () => {
        const label = selfScoreBtn.querySelector("span") ?? selfScoreBtn;
        label.textContent = "Your score is recorded";
      });
    };
  }
  document.getElementById("btn-fedit")?.addEventListener("click", () => {
    // "Correct the points" corrects the points of the view being LOOKED AT.
    // The overall tab renders on both sides of the toggle, and on the side
    // view this button used to open the FRONT editor — the one set of points
    // the person was not looking at. The side's points are the thirteen they
    // placed by hand, so that is the editor this opens there.
    if (tabView === "side" && ctx?.onRedoSide) ctx.onRedoSide();
    else ctx?.onEditFront?.();
  });
  const newBtn = document.getElementById("btn-new")!;
  newBtn.onclick = () => {
    // Leaving the report throws away the screen somebody may have spent ten
    // minutes reading, and this button sits one slip below "See your plan".
    // A genuine press costs one extra tap; an accidental one costs nothing.
    if (window.confirm("Start over with a new photo? This report will close.")) ctx?.onNewPhoto();
  };
  document.getElementById("btn-plan")!.onclick = () => select("improve");
  const continueBtn = document.getElementById("btn-continue");
  if (continueBtn) continueBtn.onclick = () => goPathway();
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
  const voicedBtn = document.getElementById("btn-voiced") as HTMLButtonElement | null;
  if (voicedBtn) {
    // The pop-out first, purchase second. Clicking the button shows exactly
    // what the $2.99 buys — the example clip — with the buy underneath it, so
    // nobody lands on Stripe for a format they have not seen. An account that
    // already holds a credit paid for exactly this, so it skips the shop
    // window and renders.
    voicedBtn.onclick = () => {
      void loadVoiceCredits()
        .catch(() => 0)
        .then((balance) => {
          if (balance > 0) void downloadVoicedAnalysis(voicedBtn);
          else openVoicedExample(voicedBtn);
        });
    };
    // A credit already on the account takes the price off the button, so a
    // buyer coming back from Checkout sees "ready" rather than a second ask.
    void loadVoiceCredits()
      .then((balance) => {
        const label = voicedBtn.querySelector("span");
        if (balance > 0 && label) label.textContent = "Voiced analysis · ready";
      })
      .catch(() => undefined);
  }
  // The overview carries the real delta, so a protocol coming due here can be
  // judged against actual scan movement rather than against nothing. The
  // check-ins are the OWNER'S promises about their own face — never surfaced
  // over a guest's scan or a recalled record.
  if (!observationsOnly()) mountProtocolIfDue(ctx?.delta ?? null);
}

// The $2.99 gate in front of the render. No credit: straight to Checkout,
// where Stripe itself shows the price and asks for the card — a second
// confirm dialog here would be the same question twice. With a credit, the
// render starts immediately and the server spends the credit only after the
// audio actually comes back.
async function voicedAnalysisFlow(btn: HTMLButtonElement): Promise<void> {
  btn.disabled = true;
  let balance = 0;
  try {
    balance = await loadVoiceCredits();
  } catch {
    /* signed out or offline; the render path below reports it properly */
  }
  if (balance <= 0) {
    const label = btn.querySelector("span");
    if (label) label.textContent = "Opening checkout…";
    const result = await startVoiceCreditCheckout();
    if (!result.ok) {
      if (label) label.textContent = result.message || "Checkout unavailable";
      window.setTimeout(() => {
        if (label) label.textContent = "Voiced analysis · $2.99";
        btn.disabled = false;
      }, 2600);
    }
    // On ok the page is already navigating to Stripe; leave the button be.
    return;
  }
  btn.disabled = false;
  await downloadVoicedAnalysis(btn);
}

// The example pop-out: exactly what a voiced analysis looks and sounds like,
// before anybody pays for one. The clip is a demo scan of an AI-generated
// face and says so on screen.
//
// This IS the purchase flow now, not a separate shop window: the voiced
// analysis button opens it, and the buy sits underneath the clip. Watch what
// it is, then decide — one button outside, one decision inside.
function openVoicedExample(buyFrom?: HTMLButtonElement): void {
  document.getElementById("veg-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "veg-overlay";
  overlay.className = "veg-overlay";
  overlay.innerHTML = `
    <div class="veg-box" role="dialog" aria-label="Voiced analysis example">
      <div class="veg-head">
        <span class="klabel">VOICED ANALYSIS · EXAMPLE</span>
        <button type="button" class="veg-close" aria-label="Close">×</button>
      </div>
      <video src="/demo/voiced-example.mp4" controls autoplay playsinline></video>
      <p class="veg-note">A demo scan of an AI-generated face. Yours narrates your own numbers, in Coach Max's voice, ready to post.</p>
      ${buyFrom ? `<button type="button" class="btn pri veg-buy">Get yours · $2.99</button>` : ""}
    </div>`;
  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector(".veg-close")?.addEventListener("click", close);
  const buy = overlay.querySelector<HTMLButtonElement>(".veg-buy");
  if (buy && buyFrom) {
    buy.onclick = () => {
      close();
      // Progress and outcomes report on the row button, same as before —
      // the dialog is gone by the time Stripe or the renderer answers.
      void voicedAnalysisFlow(buyFrom);
    };
  }
  const video = overlay.querySelector("video");
  video?.addEventListener("error", () => {
    const note = overlay.querySelector<HTMLElement>(".veg-note");
    video.remove();
    if (note) note.textContent = "The example clip is still rendering. The format: your scan, every number narrated in Coach Max's voice, about forty seconds.";
  });
  document.body.appendChild(overlay);
}

// The narrated analysis render — the growth loop. Same rundown machinery the
// creator tools use; this is just the buyer's door to it, loaded on demand
// because the encoder stack has no business in the results bundle for the
// majority who never press the button. The credit is spent server-side in
// /api/tts, only after audio came back.
async function downloadVoicedAnalysis(btn: HTMLButtonElement): Promise<void> {
  if (!ctx || !frontPhoto) return;
  btn.disabled = true;
  const label = btn.querySelector("span");
  const say = (text: string) => {
    if (label) label.textContent = text;
  };
  const done = (text: string) => {
    say(text);
    window.setTimeout(() => {
      say("Voiced analysis");
      btn.disabled = false;
    }, 2600);
  };
  try {
    const [rundown, { currentAccessToken, currentUser }, { loadOnboardingProfile }, { METRICS }] = await Promise.all([
      import("./rundownExport.js"),
      import("../engine/auth.js"),
      import("../engine/onboarding.js"),
      import("../engine/metrics.js"),
    ]);
    const user = await currentUser().catch(() => null);
    const profile = user ? await loadOnboardingProfile(user).catch(() => null) : null;
    const name = ctx.subjectName || profile?.firstName || "This face";
    // Front metrics only: the narrated constructions are the front recipes,
    // and a merged report's side rows would be spoken over a photograph that
    // cannot draw them. The overall spoken is still the merged number — the
    // one the person sees on this screen.
    const frontIds = new Set(METRICS.map((m) => m.id));
    const report = { ...ctx.report, metrics: ctx.report.metrics.filter((m) => frontIds.has(m.def.id)) };
    const accessToken = (await currentAccessToken().catch(() => null)) ?? undefined;
    const result = await rundown.downloadRundownVideo(frontPhoto, ctx.landmarks, report, {
      name,
      accessToken,
      // The $2.99 product is the SHORT cut: trait-led, the number on screen,
      // about fifty seconds. The full read stays a creator tool.
      cut: "short",
      onProgress: (p, stage) => say(`${stage} · ${Math.round(p * 100)}%`),
    });
    const { outcomeMessage } = await import("./saveFile.js");
    if (result.outcome === "cancelled") {
      done("Not saved");
    } else if (!result.narrated) {
      // The one silent-failure worth naming: the render still shipped, but
      // without the voice — a credit hiccup or a network blip. The credit is
      // only spent when audio comes back, so nothing was paid for nothing.
      done("Saved: no voice (credit not used)");
    } else {
      done(outcomeMessage(result.outcome));
    }
  } catch (error) {
    // A capture the app itself would warn about must not be published with a
    // number on it — the same rule the creator tools enforce.
    const blocked = error instanceof Error && error.name === "RundownBlocked";
    done(blocked ? "Retake first, quality too low" : "Export failed");
    if (!blocked) console.error(error);
  }
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
        <div class="chipcol"><span class="chip">${topPctText(report.overallPercentile, SIDE_TAIL_LIMIT_PCT)}</span></div>
      </div>
      ${provenance(measured)}
      ${unverifiedBanner()}
      ${implausibleBanner(report)}
      ${maxAccess && adultUser && !observationsOnly() ? maxAnalysisHTML(report, null, "side", ctx?.subjectName, ctx?.selfName) : ""}
      <div class="panel"><h4>POPULATION POSITION</h4>${curveSVG(report.overallPercentile, "overall", report.sex, false, { score: report.overall, rank: rankShort(report.overallPercentile, SIDE_TAIL_LIMIT_PCT) })}
        ${curveLegend()}
        <p class="rarity">${populationLine(report.overallPercentile, report.sex, "profiles", SIDE_TAIL_LIMIT_PCT)}</p></div>
      ${regions.map((r) => sideRegionDeck(r, report)).join("")}
      ${modeSwitcher("full")}
      ${sideNav()}
    </div>`;

  revealBars();
  if (!observationsOnly()) mountProtocolIfDue(null);
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

// The profile's own version of the actions under the front's Overall tab.
//
// Same TREATMENT as the front row, not just the same destinations. This was
// four identical ghost buttons in two rows while the front had its tiered
// lead/support/quiet design — the profile read as the old app bolted onto the
// new one. Same actionButton markup, so the two rows can never drift apart in
// style again. Every action is still the profile's: "New photo" becomes two,
// because on this half of the scan there are two quite different things wrong
// you might be trying to fix, and one of them is much cheaper — the
// photograph is usually fine and it is the points that missed.
function sideNav(): string {
  const plain = observationsOnly();
  const lead = !plain && ctx?.onContinue
    ? actionButton("sn-continue", pathwayLabel(), "pathway", "lead")
    : "";
  const support = [
    plain ? "" : actionButton("sn-plan", "See your plan", "plan", "support", pathway === "plan"),
    ctx?.onSideProfile ? actionButton("sn-retake", "Retake profile", "photo", "support") : "",
    actionButton("sn-share", "Share card", "share", "support"),
  ].join("");
  const quiet = [
    ctx?.onRedoSide ? actionButton("sn-redo", "Re-verify the points", "points", "quiet") : "",
  ].join("");
  return `<div class="ractions">
    ${lead}
    <div class="ract-row">${support}</div>
    ${quiet ? `<div class="ract-row ract-utils">${quiet}</div>` : ""}
  </div>
  ${hasHistory() ? `<button class="hist-entry" id="sn-history">View all your scans →</button>` : ""}`;
}

function wireSideNav(): void {
  const on = (id: string, fn: () => void) => {
    const b = document.getElementById(id);
    if (b) b.onclick = fn;
  };
  on("sn-redo", () => ctx?.onRedoSide?.());
  on("imp-redo", () => ctx?.onRedoSide?.());
  on("unver-redo", () => ctx?.onRedoSide?.());
  on("sn-retake", () => ctx?.onSideProfile?.());
  on("sn-continue", () => goPathway());
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
      <h3>${regionHeadline(r, r.region)}<em>SIDE</em></h3>
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
          ? `<button class="tap-hint side-tap-hint"><i>◱</i>Hover to draw it on your profile · tap to open</button>`
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
  return `<span class="indtag" title="Measured, but it varies as much between two photos of one face as it does between people: so it is shown and not scored.">not scored</span>`;
}

// The same rule as isIndicative, one level up.
//
// isIndicative has flagged individual rows for months. What it could not catch
// is a region where EVERY row is flagged — because then the region header, the
// population curve and the rarity sentence are all built on the same noise the
// rows beneath them are disclaiming. The male nose is exactly that: nasalIndex
// 0.00, noseMouthRatio 0.11, noseIntercanthal 0.14, all under RELIABLE_MIN,
// weighted reliability 0.086.
//
// The engine has known since regionReliability landed. quick.ts, the staff
// page, has printed "indicative" over those cells since it shipped. This is
// the same question finally being asked on the report people actually read.
function regionHeadline(r: RegionScore, id: RegionId): string {
  return regionIsScored(r)
    ? `${REGION_NAMES[id]} · ${r.score.toFixed(1)}`
    : `${REGION_NAMES[id]} · <span class="rnotscored">not scored</span>`;
}

// A curve is a claim about where you sit among other people. It needs a
// measurement that holds still between two photographs of you, and this region
// does not have one — so the panel says that instead of drawing a distribution
// and putting a dot on it.
//
// The nose curve is also where this became visible rather than merely wrong.
// toleranceOf widens a metric's band as its reliability falls, the band branch
// of zEff puts everyone inside the band on one plateau, and with all three nose
// bands close to a full sigma wide, 24 of the 113 reference men land inside all
// three at once and tie at the identical aggregate. AGG_NORM's nose table is
// therefore one repeated number from the 75th percentile to the 100th, and a
// zero-width quantile gap is an infinite density — the spike on the chart.
function regionPositionPanel(r: RegionScore, id: RegionId, sex: Sex): string {
  if (!regionIsScored(r)) {
    return `<div class="panel"><h4>${REGION_NAMES[id].toUpperCase()} POSITION</h4>
      <p class="side-nocurve">No population curve for the ${REGION_NAMES[id].toLowerCase()}. Every measurement in this region moves about as much between two photographs of one face as it does between two different faces, so there is no stable position to plot. The readings above are real; a curve drawn from them would be a picture of the lighting.</p></div>`;
  }
  return `<div class="panel"><h4>${REGION_NAMES[id].toUpperCase()} POSITION</h4>${curveSVG(r.percentile, `region:${id}`, sex, true)}
    ${curveLegend()}
    <p class="rarity">${rarityLine(r)}</p></div>`;
}

// Told at the top of the profile, not left to be discovered halfway down a
// measurement list. An excluded measurement is the one case where the fix is
// free and takes ten seconds, so the offer to re-verify goes with it.
/**
 * The side profile was scored on points their own subject said were wrong.
 *
 * Reachable by exactly one route: take the automatic placement, answer "no"
 * when asked whether it looks right, then decline the walkthrough. It is scored
 * rather than refused, because somebody who will not spend thirty seconds on
 * thirteen rings will not spend them on a retake either and would simply leave
 * with nothing.
 *
 * But it cannot be printed as though it were the same object as a confirmed
 * placement. The five points behind the face are estimated from an average
 * head rather than found in the photo; a person who says they look wrong is
 * very likely right, and the number underneath is then measuring the estimate.
 * So the report says so, and offers the thirty seconds again.
 *
 * `=== false` on purpose. A scan restored from history predates this question
 * and carries undefined, which must read as "never asked" and not as "said no".
 */
function unverifiedBanner(): string {
  if (ctx?.sideVerified !== false) return "";
  const redo = ctx?.onRedoSide
    ? ` <button class="linkish" id="unver-redo">Place the points now</button>`
    : "";
  return `<div class="impbanner">
    <b>You told us these points were wrong</b>
    <p>This side score is measured from the automatic placement you said looked off, because
    you chose not to correct it. The five points behind the face, the jaw corner, the ear, the
    hinge and the neck point, are estimated from an average head rather than found in your
    photo, so a placement that looks wrong usually is. Treat this profile score as indicative
    until the points are placed.${redo}</p>
  </div>`;
}

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

// `scope` exists for one sentence. Everything else here composes from whichever
// Report it is handed, so the profile gets a genuine read of the profile's own
// regions and metrics for free — but the delta does not generalise. It tracks
// the OVERALL score, and printing "0.1 down against yesterday" under fifteen
// side measurements would attribute a whole-face movement to the jaw.
//
// So the profile says nothing about movement rather than something untrue. The
// front keeps the tracking line, where it is about the number directly above it.
// Mount the check-in into whichever read was just painted.
//
// Called after the innerHTML rather than folded into it, because the card owns
// its own click handlers and writes back to storage — building it as a string
// would mean re-wiring it by hand at both call sites and getting it wrong at
// one of them. Safe to call when there is no slot and safe to call twice: it
// returns null unless a slot exists and is empty.
let protocolCard: { destroy(): void } | null = null;
function mountProtocolIfDue(delta: ScanDelta | null): void {
  protocolCard?.destroy();
  protocolCard = null;
  const slot = document.querySelector<HTMLElement>("[data-protocol-slot]");
  if (!slot || slot.childElementCount) return;
  protocolCard = mountProtocolCard(slot, delta);
}

function maxAnalysisHTML(r: Report, delta: ScanDelta | null, scope: "front" | "side" = "front", guestName?: string, selfName?: string): string {
  const pose = ANALYSIS_POSES[Math.abs(Math.round(r.overall * 10) + r.metrics.length) % ANALYSIS_POSES.length];

  // Built in templates.ts, where the rest of the voice lives. It used to be
  // assembled here from "Best thing on the scan:" and "The one I would attack
  // first: ... is the LEVER, and it MOVES WITHOUT SURGERY" — two pieces of
  // jargon in one sentence, on the tab that is supposed to read as a coach
  // talking rather than a report printing.
  const read = coachRead(r, delta, {
    scope,
    ...(guestName ? { guestName } : {}),
    ...(selfName ? { selfName } : {}),
  });

  return `<div class="maxan">
    <div class="maxan-face">${maxCharacterMarkup(pose)}</div>
    <div class="maxan-body">
      <span class="klabel">COACH MAX'S READ</span>
      <p><b>${read.good}</b> ${read.work}</p>
      ${read.memory ? `<p class="maxan-track">${read.memory}</p>` : ""}
      <!-- The protocol check-in, when there is one. Empty most of the time by
           design: engine/protocol.ts returns nothing while a protocol is
           waiting on a date somebody gave, inside the gap between check-ins,
           or once it has been judged. -->
      <div class="protocard-slot" data-protocol-slot></div>
      <p class="maxan-invite">${read.invite}</p>
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

// One delegated listener for every "I'm going with this" on the page.
//
// Delegated rather than per-button because the plan re-renders on every tab
// change and goal edit, and re-wiring a dozen buttons each time is how one of
// them ends up dead.
function wireRecTracking(): void {
  document.addEventListener("click", (event) => {
    const hit = (event.target as HTMLElement | null)?.closest?.("[data-track-rec]");
    if (!(hit instanceof HTMLElement)) return;
    const recId = hit.dataset.trackRec;
    const rec = RECS.find((r) => r.id === recId);
    if (!rec) return;
    // The metric this was picked to move, so a rescan looks at the right
    // number. Best effort: the plan is goal-ordered rather than metric-keyed,
    // so an empty string is honest rather than a guess at the wrong metric.
    offerProtocol(rec, "");
    // Answer the decision immediately — they just pressed the button that IS
    // the yes. What follows depends on how the thing begins: a product gets
    // the "when will you have it" question, a diet or an instant job gets a
    // near check-back instead. commitProtocol is the one place that knows.
    const list = readProtocols();
    const made = list.find((p) => p.recId === rec.id);
    if (made) writeProtocols(list.map((p) => (p.id === made.id ? commitProtocol(p, Date.now()) : p)));
    hit.replaceWith(Object.assign(document.createElement("span"), {
      className: "rec-track rec-track-on",
      textContent: "On your list",
    }));
    mountProtocolIfDue(ctx?.delta ?? null);
  });
}

function wireMaxAsk(): void {
  if (maxAskBound) return;
  maxAskBound = true;
  document.addEventListener("click", (event) => {
    const hit = (event.target as HTMLElement | null)?.closest?.("[data-max-ask]");
    if (!hit) return;
    // The tier check belongs here as well as on the markup.
    //
    // Today the only `data-max-ask` element is rendered inside maxAnalysisHTML,
    // which is already behind `maxAccess && adultUser`, so this cannot fire for
    // anyone who should not reach it. But this is a DELEGATED listener bound
    // once to the document and never rebound, so it outlives every re-render
    // and would silently pick up any future element that reuses the attribute
    // from ungated markup. Every other Max surface in this file states the
    // condition where it acts; this one inherited it from its caller.
    //
    // The real boundary is the server, which answers 402 unless the tier is
    // max (api/max-chat.ts). This keeps the client from opening a panel that
    // is only going to be refused.
    if (!maxAccess || !adultUser || observationsOnly()) return;
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
      if (Number.isFinite(target)) countUp(number, target, { decimals, delay });
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


// ---------------- region ----------------
// A real, unreadable version of the panel behind the wall. Built from this
// person's actual metric names and scores rather than lorem, so the blur is
// showing them their own analysis rather than a decorative placeholder — the
// count of rows is true, and that is the honest part of the pitch.
function regionPreviewHTML(r: RegionScore, id: RegionId): string {
  return `<div class="deck"><div class="dcard">
    <h3>${regionHeadline(r, id)}<em>MEASURED</em></h3>
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
          <h3>${regionHeadline(r, id)}<em>MEASURED</em></h3>
          ${r.metrics
            .map(
              (m, i) => wasMeasured(m)
                ? `<div class="metric tappable${isIndicative(m) ? " indicative" : ""}" data-metric="${m.def.id}" style="animation-delay:${80 + i * 70}ms">
            <div class="mrow"><b>${m.def.name}${indicativeTag(m)}</b><span>${fmt(m)}<span class="mscore">${m.score.toFixed(1)}</span></span></div>
            <div class="rangebar">${idealWindow(m, ctx!.report.sex)}<i data-l="${m.markerPct}"></i></div></div>`
                // Not measured on this photograph. It keeps its row and says so,
                // rather than vanishing: the same region would otherwise show a
                // different number of measurements from one scan to the next with
                // no account of why. Not tappable and no range bar, because there
                // is no reading to draw or to place.
                : `<div class="metric unmeasured" data-unmeasured="${m.def.id}" style="animation-delay:${80 + i * 70}ms">
            <div class="mrow"><b>${m.def.name}</b><span>not measured</span></div>
            <p class="unmeasured-why">This photograph did not give a clear enough reading, so it is left out of the score rather than guessed at.</p></div>`,
            )
            .join("")}
          ${indicativeNote(r.metrics)}
          ${
            // The overlay is the credibility feature and it was invisible: a
            // 9px glyph at 55% opacity is not an affordance. Say it in words.
            r.metrics.length
              ? `<button class="tap-hint" id="tap-hint"><i>◱</i>Hover to draw it on your face · tap to open</button>`
              : ""
          }
          <div class="typebox" id="tw"></div>
        </div>
        <div class="dcard">
          <h3>Notable comparisons<em>REFERENCE</em></h3>
          ${matchCard}
          <p class="footnote">Reference set grows with every analysed face. Matches are on specific metrics where you genuinely align.</p>
        </div>
      </div>
      ${regionPositionPanel(r, id, ctx!.report.sex)}
    </div>`;

  setTimeout(
    () =>
      document
        .querySelectorAll<HTMLElement>(".rangebar i")
        .forEach((i) => (i.style.left = `${i.dataset.l}%`)),
    120,
  );
  // A guest's delta is deliberately null, so a guest scan cannot borrow the
  // owner's trend; they get the neutral opener with their own name.
  typewrite(document.getElementById("tw")!, regionSummary(r, ctx.report.sex, {
    name: ctx.subjectName || ctx.selfName,
    delta: ctx.delta?.regions.find((d) => d.region === r.region)?.delta ?? null,
  }));
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
  const d = distFor(m.def, sex);
  const lo = phi((m.idealRange[0] - d.mean) / d.sd) * 100;
  const hi = phi((m.idealRange[1] - d.mean) / d.sd) * 100;
  return `<div class="ideal" style="left:${lo.toFixed(1)}%;width:${Math.max(4, hi - lo).toFixed(1)}%"></div>`;
}

function rarityLine(r: RegionScore): string {
  return r.percentile >= 50
    ? `Roughly <b>${rarityText(r.percentile)}</b> faces measure this well across the ${REGION_NAMES[r.region].toLowerCase()}.`
    : `About <b>${scoreHigherText(r.percentile)}</b> of faces score higher here, and the drill-down above shows exactly why.`;
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
let activeMetric: string | null = null; // hovered: what is drawn
let fade: OverlayFade | null = null;
// Pending "go back to the calm outline", armed on leave and disarmed on the
// next enter. See the comment above the handlers for what it is defending.
let revert: number | null = null;
// One frame at 60Hz, rounded up. Long enough that the enter for the adjacent
// row always beats it, short enough that leaving the list entirely reads as
// immediate.
const LEAVE_GRACE_MS = 24;

const HINT_IDLE = `<i>◱</i>Hover to draw it on your face · tap to open`;

// The camera leans onto the measurement being looked at.
//
// The region zoom frames a neighbourhood; the measurement's own bounds frame
// the evidence. Only the transform moves — the overlay animation, the photo
// swap and the shrunk-strip crop are all driven elsewhere — so this composes
// with every path through show() and cannot double-run an animation. A null
// metric puts the camera back on the region.
function focusMeasurement(metric: ScoredMetric | null, region: RegionId, onSide: boolean): void {
  if (!ctx) return;
  // Once the pane collapses to a 96px strip the transform is not what you are
  // looking at — object-position is, driven by --crop-x/--crop-y (see the
  // shrunk rules in style.css). setZoom writes them; this has to as well, or
  // on a phone the camera "moves" while the strip keeps showing the region it
  // was last given. Same spec, both channels.
  const aim = (z: ZoomSpec) => {
    if (!ctx) return;
    applyZoom(ctx.zoomable, z);
    ctx.zoomable.style.setProperty("--crop-x", `${z.originX}%`);
    ctx.zoomable.style.setProperty("--crop-y", `${z.originY}%`);
  };
  if (metric && onSide && ctx.sidePoints && ctx.sidePhoto) {
    const b = sideMeasurementBounds(metric, ctx.sidePoints, ctx.sidePhoto.width, ctx.sidePhoto.height);
    aim(b ? zoomToBounds(b, { fill: 0.55, min: 1.15, max: 2.3 }) : IDENTITY_ZOOM);
    return;
  }
  if (metric) {
    const b = measurementBounds(metric, ctx.landmarks);
    if (b) {
      aim(zoomToBounds(b, { fill: 0.55, min: 1.25, max: 2.6 }));
      return;
    }
  }
  aim(zoomFor(region, ctx.landmarks));
}

function wireMeasurementTaps(r: RegionScore, region: RegionId): void {
  // Switching tabs re-renders the rows but used to leave this pointing at the
  // previous region's metric, so the first interaction after coming back
  // toggled the overlay OFF instead of on.
  activeMetric = null;
  fade?.cancel();
  fade = null;
  // A revert armed on the tab being left must not fire over the new one.
  if (revert !== null) window.clearTimeout(revert);
  revert = null;
  const hint = document.getElementById("tap-hint");
  const rows: HTMLElement[] = [];

  const setHint = (metric: ScoredMetric | null) => {
    if (!hint) return;
    hint.classList.toggle("on", !!metric);
    hint.innerHTML = metric
      ? `<i>◱</i>Drawing <b>${metric.def.name}</b>, tap to open`
      : HINT_IDLE;
  };

  // The deck the detail view walks: what is measured, in the order shown.
  const list = r.metrics.filter(wasMeasured);
  const openDetail = (id: string | null) => {
    if (!ctx || !list.length) return;
    const at = id ? list.findIndex((m) => m.def.id === id) : 0;
    openMetricDetail({
      region,
      metrics: list,
      index: Math.max(0, at),
      sex: ctx.report.sex,
      landmarks: ctx.landmarks,
      frontPhoto: frontPhoto,
      sidePhoto: ctx.sidePhoto ?? null,
      sidePoints: ctx.sidePoints ?? null,
    });
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
    setHint(metric ?? null);
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
      focusMeasurement(metric, region, true);
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
    focusMeasurement(metric ?? null, region, false);
    shownRegion = region;
  };

  // Leaving a row does NOT revert immediately, and that one change is the whole
  // fix for the flicker.
  //
  // Moving the cursor from one measurement to the next fires leave-A before
  // enter-B. Reverting on leave therefore meant every row-to-row move ran:
  // cancel the drawing, start a cross-fade back to the calm region outline,
  // cancel THAT one frame later, start the next drawing. Scanning down a list
  // of eight measurements did it eight times, and what you saw was the overlay
  // strobing between the calm face and a half-drawn line — never settling,
  // never arriving, and visibly slower to answer the row you were actually on
  // because it was busy undoing the row you had left.
  //
  // So a leave only ARMS the revert, and an enter disarms it. A→B goes straight
  // from A's drawing to B's, one cross-fade, starting on the first pointer
  // event over B. A→whitespace still reverts, one frame later, which nobody can
  // perceive as a delay.
  const disarm = () => {
    if (revert !== null) window.clearTimeout(revert);
    revert = null;
  };
  const arm = () => {
    disarm();
    revert = window.setTimeout(() => {
      revert = null;
      show(null);
    }, LEAVE_GRACE_MS);
  };

  resetTapPreview();
  for (const row of document.querySelectorAll<HTMLElement>(".metric[data-metric]")) {
    const id = row.dataset.metric!;
    if (!r.metrics.some((m) => m.def.id === id)) continue;
    rows.push(row);

    // A mouse draws on hover and opens on click. A phone, which has no hover,
    // arms on the first press and opens on the second — otherwise the drawing
    // appeared underneath a modal that had already covered it, and the best
    // thing on this screen was desktop-only. See ui/tapPreview.ts.
    wireTapPreview(row, id, {
      preview: show,
      leave: arm,
      disarm,
      open: openDetail,
    });
  }

  // The hint is the affordance, so it does the thing it describes.
  if (hint && rows.length) {
    hint.onclick = () => openDetail(activeMetric);
  }
}

// ---------------- improvements ----------------
// Ordinal words rather than "1 / 2 / 3": a numbered list reads as steps that
// must be done in sequence, and these are four things to work on at once with
// one of them mattering most.
const PRIORITY = ["FIRST PRIORITY", "SECOND PRIORITY", "DO THIS THIRD", "DO THIS FOURTH"];

function showImprove(): void {
  if (!ctx) return;
  // The plan is the OWNER'S plan, built from THEIR current scan and goals.
  // A guest's scan and a recalled record have no plan to show — the tab is
  // not rendered for them, and any stray path here lands on the overview.
  if (observationsOnly()) return select("overall");
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

  // Whether the plan is walled for this account — decided up front because it
  // changes what goes INTO the plan body, not just what covers it.
  //
  // The wall is at "plan" now rather than at "rating". Reaching this function
  // walled should be rare, since select() sends a person pressing Plan to the
  // offer instead; this covers the paths that arrive without a press, such as
  // an entitlement lapsing while the tab is already open.
  const gated = depth !== "plan";

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
        .map((m, i) => {
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
          // The list was already ranked, sorted by how far the metric sits
          // below its reference, weighted by the goals this person chose, but
          // nothing on screen said so, so four cards read as four equal
          // suggestions and the order looked arbitrary. Naming the rank turns
          // a list into a programme: it tells somebody what to do FIRST, which
          // is the only question a plan has to answer.
          return `<div class="imp${locked ? " locked" : ""}"><span class="imp-rank">${PRIORITY[i] ?? `PRIORITY ${i + 1}`}</span>
          <b>${lever.title}<em>${REGION_NAMES[m.def.region].toUpperCase()} · ${m.score.toFixed(1)} · ${lever.tag}</em></b>
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
      ${nutritionPlanHTML(r, { dietAdvice: profile.advice.diet, maxAccess, adult: adultUser })}
      ${macroPanelHTML({ sex: r.sex, dateOfBirth: birthDate, maxAccess, dietAdvice: profile.advice.diet })}
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

  // Only the live copy. A gated plan renders the same markup twice, once behind
  // the blur, and wiring the blurred one would put a working form inside a lock
  // and a second element sharing every id with the real one.
  const macros = gated
    ? null
    : body().querySelector<HTMLElement>(".panel.mac");
  if (macros) {
    wireMacroPanel(macros, {
      sex: r.sex,
      dateOfBirth: birthDate,
      maxAccess,
      dietAdvice: profile.advice.diet,
    });
  }

  document.getElementById("btn-back")!.onclick = () => select("overall");
  document.getElementById("btn-again")!.onclick = () => {
    if (window.confirm("Scan another face? This report will close.")) ctx?.onNewPhoto();
  };
  const upgrade = document.getElementById("btn-upgrade");
  if (upgrade) upgrade.onclick = () => ctx?.onUpgrade?.();
  const edit = document.getElementById("goal-edit");
  if (edit) edit.onclick = () => openQuiz(() => showImprove(), "all");

  // First time someone reaches their plan, ask what to leave alone — the
  // moment prose is about to be written, and the first moment they have the
  // numbers in front of them to answer with.
  if (!profile.postDone && !gated) openQuiz(() => showImprove(), "post");
}


// Where this face sits in the measured population. One definition, used by the
// Full view and — since a Max subscription is meant to include it — by Verdict
// and Basic too.
function populationBlock(r: Report): string {
  return `<div class="panel"><h4>POPULATION POSITION</h4>${curveSVG(r.overallPercentile, "overall", r.sex, false, { score: r.overall, rank: rankShort(r.overallPercentile) })}
    ${curveLegend()}
    <p class="rarity">${populationLine(r.overallPercentile, r.sex, "faces")}</p></div>`;
}




// Present on every depth, including the full one, so changing your mind is
// never a trip into settings.
// ---------------------------------------------------------------------------
// There is one view now, and it is the full one.
//
// Verdict and Basic were presentation depths a user picked for themselves, and
// they cut across the product rather than along it. Someone on Basic saw a
// single headline — and then tapped a region and landed in the full metric
// drill-down anyway, comparative numbers and all, because the depth setting
// never reached that screen. So the "simple" mode was simple exactly until the
// first tap, and then it was the complicated one with no context to arrive
// with. A setting that changes the first screen and not the second is not a
// simpler product, it is two products sharing a paywall.
//
// It also quietly hid what people were paying for: the default was Basic, and
// neither shallow view rendered Max's read or the population curve, so a Max
// subscriber's default screen was a tab labelled "Max's analysis" containing
// nothing from Max.
//
// The mode functions are gone. `analysisMode.ts` keeps verdictFor/basicScores
// because the share card and the reel still use those summaries — they are
// genuinely short formats, chosen by the surface rather than by a setting.
// ---------------------------------------------------------------------------
function modeSwitcher(_current?: unknown): string {
  return "";
}

function wireModeSwitcher(_rerender?: () => void): void {}

// Whether this account has Max. Module state rather than a Ctx field because it
// arrives LATE: the entitlement is a network read, and blocking the results
// screen on it would hold a finished analysis hostage to a round trip. So the
// plan renders locked, and unlocks in place if the read comes back positive.
//
// Defaulting to false is the safe direction — a failed read shows the paywall
// rather than giving the paid product away, and the person can retry.
let maxAccess = false;

// What the lead action under a finished scan should offer.
//
// "build" - nobody is signed in, so the pathway genuinely has to be set up:
// an account, the questions, a plan. "plan" - this account exists, so there is
// nothing to build and the button goes straight to the plan it already has.
//
// This is the fault the owner reported: the lead button said "Build my
// pathway" to everyone, and pressing it replayed the whole six-step quiz and
// then offered a trial - to people who had already answered it and were
// already paying. Signing in is what changes the offer, not the entitlement:
// the plan tab renders from the scan in front of them and their saved goals,
// so it has something to show whether or not they have ever bought anything.
//
// Defaults to "build", the safe direction. Offering to build a pathway to
// somebody who has one costs a tap; promising "your current plan" to a
// stranger who has no account is a promise the screen cannot keep.
export type PathwayState = "build" | "plan";
let pathway: PathwayState = "build";

// Whether the signed-in person is an adult. Defaults to FALSE, which is the
// only safe direction: every Max surface on this screen is 18+, and an age we
// could not read must behave like an age that is too young.
let adultUser = false;

export function setAdult(value: boolean): void {
  if (value === adultUser) return;
  adultUser = value;
  syncMaxSurfaces();
}

// The date of birth behind that flag, kept because the macro calculator's age
// gate reads a DATE rather than a boolean. Null until a profile loads, and null
// closes the gate: same direction as adultUser, for the same reason.
let birthDate: string | null = null;

/**
 * This scan's ceiling, for a surface outside the report that has earned the
 * right to show it.
 *
 * Exists so the offer screen can carry the before and after strip without
 * being handed the whole report, and so it CANNOT invent one: null until a
 * scan is in hand, and the photograph is the person's own capture.
 */
export function currentCeiling(): CeilingInput | null {
  if (!ctx || ctx.archived) return null;
  const r = ctx.report;
  if (!Number.isFinite(r.overall) || !Number.isFinite(r.potential)) return null;
  return { overall: r.overall, potential: r.potential, photo: frontPhoto };
}

export function setBirthDate(value: string | null): void {
  birthDate = value && value.trim() ? value.trim() : null;
}

// What this account can currently see. Defaults to "rating" — the safe
// direction, same reasoning as maxAccess: a failed entitlement read shows a
// wall to a paying customer, who can retry, rather than handing the paid
// product to everyone during an outage.
let depth: Depth = "rating";
let scansLeft = 0;

// Account changes are a harder boundary than a new photograph. Late profile
// or entitlement reads may still resolve, so dropping the result context keeps
// those callbacks from repainting another identity's screen. The next result
// starts locked until its own reads complete.
export function clearResultsIdentityState(): void {
  // The detail view holds a COPY of the photograph and the landmarks it was
  // opened with, so leaving it up across an identity change or a new scan
  // would leave the previous person's face on screen over the next person's
  // report. Everything else with that property — the gate, the dashboard, the
  // history panel, Max's chat — is already torn down on this path; this was
  // the one new surface that was not.
  //
  // The pillar list is torn down for the weaker version of the same reason: it
  // holds no photograph, but it does hold one report's measurements, and it is
  // the thing the detail card was opened FROM.
  closeMetricDetail();
  closePillarSheet();
  // The macro panel's age gate keys off this, and a stale date across an
  // account change is exactly the kind of thing that opens an 18+ surface to
  // the wrong person. The body itself is stored under the account's own key,
  // so it does not need clearing; the date does.
  birthDate = null;
  ctx = null;
  maxAccess = false;
  adultUser = false;
  pathway = "build";
  depth = "rating";
  scansLeft = 0;
  unmountMaxPet();
}

export function setMaxAccess(value: boolean): void {
  if (value === maxAccess) return;
  maxAccess = value;
  syncMaxSurfaces();
}

// Arrives late, like maxAccess: knowing whether anyone is signed in is a
// session read, and a finished analysis does not wait on one. The row is
// already on screen by the time this lands, so the label is patched in place
// rather than repainting the tab under the reader's thumb. The click handler
// reads the live value, so the button can never act on a stale label.
export function setPathwayState(next: PathwayState): void {
  if (next === pathway) return;
  pathway = next;
  paintPathwayLabels();
  // "See your plan" in the support row goes to the same tab as the lead
  // button now does, and two buttons for one destination is how the row got
  // confusing in the first place. Drop the duplicate rather than render it.
  for (const id of ["btn-plan", "sn-plan"]) {
    const b = document.getElementById(id);
    if (b) b.hidden = next === "plan";
  }
}

function pathwayLabel(): string {
  // Being signed in is not the same as having a plan. `pathway` only knows
  // whether there is an account, so on its own it put "See my current plan" in
  // front of free accounts that have never had one — a label that promises
  // something the press cannot deliver, which is exactly the kind of small lie
  // that makes the offer behind it feel like a trick rather than an offer.
  // "Build my pathway" is true for them, and the offer is what building it
  // costs.
  return pathway === "plan" && depth === "plan" ? "See my current plan" : "Build my pathway";
}

/** The one writer for the lead button's words, shared by both late reads. */
function paintPathwayLabels(): void {
  for (const id of ["btn-continue", "sn-continue"]) {
    const span = document.getElementById(id)?.querySelector("span");
    if (span) span.textContent = pathwayLabel();
  }
}

// Read at click time, never captured at render time. The label is painted
// before the session read returns, so a handler that closed over the value it
// was rendered with would send an account holder back through the quiz.
function goPathway(): void {
  if (pathway === "plan") select("improve");
  else ctx?.onContinue?.();
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
  if (maxAccess && adultUser && !observationsOnly()) {
    const cc = chatContext();
    if (cc) mountMaxPet(cc);
  } else {
    unmountMaxPet();
  }
  // The tab label, renamed in place. Only in the front tab row — the side
  // row has no overall tab to rename.
  if (tabView === "front") {
    const tab = ctx.analysis.querySelector<HTMLButtonElement>('.rtab[data-id="overall"]');
    if (tab) tab.textContent = maxAccess && adultUser && !observationsOnly() ? "Coach Max’s read" : "Overview";
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
  // The label reads both `pathway` and `depth`, so whichever of the two late
  // reads lands second has to repaint it. This one used not to, which left a
  // Max account whose entitlement resolved after its session still being
  // offered "Build my pathway" for a plan it had already paid for.
  paintPathwayLabels();
  const open = ctx?.analysis.querySelector<HTMLButtonElement>(".rtab.sel");
  // Re-selects the tab already open, to repaint it now that the entitlement
  // is known. Nobody pressed anything, so nothing may move: a late network
  // read is not allowed to yank the page out from under someone mid-sentence.
  if (open) select(open.dataset.id || "overall", undefined, { silent: true });
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
  // The DEPTH wall, over the region tabs. Distinct from the plan wall in
  // showImprove, and the difference is the one-off scan credit: a credit buys
  // exactly one full-depth scan, so it opens this door and it has never opened
  // that one. Offering it under the plan card would take money without moving
  // the thing in front of the reader, which is why the two cards say different
  // things rather than sharing a template.
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
  // The non-subscription road through the DEPTH gate. Rendered by the depth
  // lock card only — the plan card does not offer it, because a credit cannot
  // reach the plan tier. The query is null-safe, so wiring it unconditionally
  // is correct for both.
  // One price per person, two prices on the label, and the server decides
  // which applies — the client never picks its own price.
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
      <b>Meet Coach Max</b>
      <small>Part of the Max plan. He reads your numbers and talks you through what to do about them.</small>
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
    tone: loadVerdictTone() ?? DEFAULT_VERDICT_TONE,
    scans: ownScans(readAllHistory()).length,
    potential: maxAccess ? ctx.report.potential : undefined,
    movement: ctx.delta ? deltaReadingCopy(ctx.delta) : undefined,
  });
}

function upsell(): string {
  return `<div class="recs upsell">
    <h4>WHAT MAX ADDS</h4>
    <p class="recs-note">Your measurements, your scores, your ranking and your progress over time are yours on every plan, and always will be. What Coach Max adds is the part that takes work to get right: the specific routine for your face, not a generic list.</p>
    <ul class="upsell-list">
      <li><b>The method, not just the target.</b> The overview above says what to improve. Max writes how, for your face, in order, shaped by what you said you want.</li>
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
    ["topical", "APPLY", "Nothing here is a prescription from us. Availability and permitted strengths differ by country: what is on a shelf in one place is behind the counter or prescription-only in another, and the pharmacist where you are is the one who knows which. Each entry says what we know."],
    ["food", "EAT", "Facts about food, not a diet. No targets, no counting, nothing to buy."],
    ["habit", "DO", "Free, and mostly the things that compound."],
    ["professional", "ASK SOMEONE", "The things worth paying a person for rather than guessing at."],
  ];


// What to buy, named.
//
// This replaced a bare "Find it on Google" link, which was the point at which
// the plan stopped being a plan. Searching "salicylic acid 2%" returns
// chemistry, opinion pieces and forty bottles at four strengths, and the
// person who most needed the recommendation is the one least able to pick from
// that. Category first, then the number that has to be on the label, then
// something that exists on a shelf, then which shelf.
//
// The search link stays underneath, and it stays a search rather than a
// merchant: the example is an example, not the answer, and there is no
// affiliate anywhere in this.
/**
 * The line that replaces a shelf and a strength for somebody under eighteen.
 *
 * Named rather than silent. A blank space where the buying guide was reads as
 * a bug, and a minor who has just been told a medicine exists and then given
 * no route is going to find a worse route on their own. This says what the
 * thing is for and who has to be involved before it starts.
 */
function guardianBlock(r: Rec): string {
  if (!r.guardian || adultUser) return "";
  return `<div class="rec-guardian">
    <span class="rec-guardian-h">BEFORE THIS ONE</span>
    <p>This is a medicine rather than a cosmetic, and the label on it was
      written for adults. Show this card to a parent or guardian, and ask a
      pharmacist whether it suits you and at what strength. That is not a
      formality: the right answer for a fifteen-year-old and a thirty-year-old
      genuinely differ, and a pharmacist will tell you for free.</p>
  </div>`;
}

function buyBlock(r: Rec): string {
  // No shelf and no strength for a minor. Over the counter is not the same as
  // suitable for a child, and a buying guide is an instruction to go and get
  // it. guardianBlock takes this slot instead.
  if (r.guardian && !adultUser) return "";
  const guide = buyGuideFor(r);
  if (!guide) return "";
  const url = productSearchUrl(r);
  return `<div class="rec-buy">
    <span class="rec-buy-h">WHAT TO BUY</span>
    <b class="rec-buy-cat">${guide.category}</b>
    <span class="rec-buy-strength">${guide.strength}</span>
    <p class="rec-buy-eg">${guide.example}</p>
    <p class="rec-buy-where"><i aria-hidden="true">◎</i>${guide.where}</p>
    ${
      url
        ? `<a class="rec-find" href="${url}" target="_blank" rel="noopener noreferrer">Compare what is sold near you <span aria-hidden="true">↗</span></a>`
        : ""
    }
  </div>`;
}

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
        ${guardianBlock(r)}
        ${buyBlock(r)}
        ${recTrackHTML(r)}
      </div>`,
        )
        .join("")}
    </div>`;
  }).join("");

// "I'm going with this" — the entry point to the protocol clock.
//
// Deliberately on the recommendation itself rather than in a separate tracker
// screen. The moment somebody decides to try a thing is the moment they are
// reading about it, and asking them to go and log it somewhere else afterwards
// is how a tracker ends up empty.
//
// It also states the timeline up front. Somebody who knows going in that a
// retinoid needs twelve weeks is somebody who does not quit at week three, and
// it is the honest thing to put next to a purchase.
function recTrackHTML(r: { id: string; weeksToJudge?: number; guardian?: true }): string {
  // No commitment clock on a medicine for a minor. "I'm going with this"
  // starts a protocol Max then follows up on, which turns a card somebody was
  // reading into a course they have started.
  if (r.guardian && !adultUser) return "";
  const already = protocolFor(r.id);
  const weeks = Math.max(4, r.weeksToJudge ?? 4);
  if (already && already.status !== "offered") {
    const label = already.status === "declined"
      ? "Not for you"
      : already.status === "judged"
        ? "Done and dusted"
        : already.startedAt
          ? "Running, Max is tracking it"
          : "On your list";
    return `<span class="rec-track rec-track-on">${label}</span>`;
  }
  return `<button type="button" class="rec-track" data-track-rec="${r.id}">
    I'm going with this<em>${weeks} weeks to know</em>
  </button>`;
}

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

// Keep the Front/Side toggle reachable once the photograph has scrolled away.
//
// The toggle lives in the photo pane. On a phone the panes stack, so reading
// the analysis scrolls the photograph — and the toggle with it — entirely out
// of the viewport. The side profile is a quarter of the overall score and
// fifteen of the measurements; making somebody scroll back up to reach it is
// how a quarter of the product goes unread.
//
// position:sticky cannot solve this. Sticky pins an element inside its
// SCROLLING ANCESTOR, and here that ancestor is the pane that leaves the
// screen, so the toggle would leave with it exactly as it does now.
//
// So the toggle detaches instead, and an anchor left behind in the flow reports
// when that should happen. Observing the anchor rather than the toggle is the
// part that matters: a floating element is position:fixed, which means it is
// always in the viewport, which means it would immediately report itself
// visible and un-float — a loop that flickers once per frame.
let toggleObserver: IntersectionObserver | null = null;

function floatToggleWhenScrolledPast(toggle: HTMLElement): void {
  const anchor = document.getElementById("view-toggle-anchor");
  if (!anchor || typeof IntersectionObserver === "undefined") return;
  // Results re-render on every mode switch; without this each one would add
  // another observer on the same anchor.
  toggleObserver?.disconnect();
  toggleObserver = new IntersectionObserver(
    ([entry]) => toggle.classList.toggle("floating", !entry.isIntersecting),
    // A negative top margin so it floats slightly BEFORE the anchor is fully
    // gone, rather than at the exact frame it vanishes — a control that appears
    // the instant its predecessor disappears reads as a swap rather than a jump.
    { rootMargin: "-8px 0px 0px 0px", threshold: 0 },
  );
  toggleObserver.observe(anchor);
}
