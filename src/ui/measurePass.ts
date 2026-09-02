import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { RegionId, Report, ScoredMetric } from "../engine/types.js";
import type { SidePoints } from "../engine/sideMetrics.js";
import { regionIsScored } from "../engine/scoring.js";
import { RELIABLE_MIN, reliabilityOf } from "../engine/reliability.js";
import { hasOverlay, drawMeasurement } from "./measureOverlay.js";
import { hasSideOverlay, drawSideMeasurement } from "./sideMeasureOverlay.js";
import { applyZoom, IDENTITY_ZOOM } from "./zoomTransform.js";
import { prefersReducedMotion } from "./countUp.js";

// ---------------------------------------------------------------------------
// The measure pass: the scan, showing its work.
//
// What this replaces was eight sentences on a timer over a photograph that
// never changed. The sentences were true — those stages do run — but nothing
// on screen was evidence of any of them, and the number that arrived at the
// end had no visible parentage. That is the whole credibility problem of this
// product in one screen: a stranger is told a figure about their own face and
// given no reason at all to believe it was measured rather than guessed.
//
// So the pass walks the face region by region and DRAWS the measurement that
// carries each region, using the same recipes the report uses on tap. The
// camera pushes in on the construction and the line arrives along its own
// path. Deliberately NO numbers: while the face is being read, the lines are
// the show, and the report is where values belong. Nothing here is decorative
// geometry — every figure is the actual span or angle taken off the actual
// landmarks of the photograph in the frame.
//
// Two rules this must never break.
//
//  1. THE REPORT IS COMPUTED FIRST. The pass reads finished ScoredMetrics. It
//     is not allowed to invent a plausible-looking number to animate and then
//     quietly reconcile with the truth, which is what a pass built on a timer
//     rather than on a report would inevitably become.
//
//  2. IT SHOWS ONLY WHAT THE REPORT WOULD SHOW. A region the report refuses to
//     score, or a metric below RELIABLE_MIN, is skipped entirely. Lighting up
//     a beautiful animated construction for a measurement whose own reliability
//     is 0.00 would be the single most convincing lie in the app.
// ---------------------------------------------------------------------------

/** One beat of the pass: one region, one measurement, on one photograph. */
export interface PassStep {
  view: "front" | "side";
  region: RegionId;
  /** What the narration calls this region, in plain words. */
  label: string;
  metric: ScoredMetric;
}

// Order of travel over the face. Roughly top to bottom, because a camera that
// wanders (eyes, chin, cheekbones, lips) reads as a slideshow, and one that
// descends reads as an examination. Symmetry and proportions come last on the
// front: they are whole-face readings and land better after the parts.
const FRONT_ORDER: RegionId[] = [
  "eyes",
  "midface",
  "nose",
  "lips",
  "jaw",
  "chin",
  "symmetry",
  "proportions",
];

// The side has fewer regions with measurable constructions, and the ones it has
// are the reason the profile is taken at all, so they lead.
const SIDE_ORDER: RegionId[] = ["chin", "jaw", "nose", "lips", "proportions"];

const LABELS: Record<RegionId, string> = {
  eyes: "Eye area",
  midface: "Cheekbones",
  nose: "Nose",
  lips: "Lips",
  jaw: "Jawline",
  chin: "Chin",
  symmetry: "Symmetry",
  proportions: "Proportions",
};

/**
 * Every measurement a region can honestly show, best first.
 *
 * Ordered by effective weight — the metric's own weight times how reproducibly
 * it measures the same face twice. That is deliberately the same quantity the
 * scoring code uses to decide how much a metric counts toward the region's
 * number, so the first measurement shown IS the one doing the most work behind
 * the score, and everything after it is shown in the order it matters.
 *
 * Every honest measurement a region has, not a single speaker. Which of them
 * actually reach the screen is the cap's business, below; this function's job
 * is to say what the region COULD show and in what order of importance.
 *
 * The honesty rules are unchanged: implausible readings, undrawable
 * constructions and anything under RELIABLE_MIN never appear at any length.
 */
function speakersFor(
  metrics: ScoredMetric[],
  drawable: (id: string) => boolean,
): ScoredMetric[] {
  return metrics
    .filter((m) => !m.implausible && drawable(m.def.id) && reliabilityOf(m.def.id) >= RELIABLE_MIN)
    .sort((a, b) => b.def.weight * reliabilityOf(b.def.id) - a.def.weight * reliabilityOf(a.def.id));
}

/**
 * How many measurements the pass features, by default.
 *
 * This was uncapped, on the reasoning that the screen exists to show the work
 * so it should show all of it. Watched end to end that is around thirty beats
 * at 520ms each, plus the open and the close: roughly eighteen seconds of
 * loading screen. Long enough that the person stops reading the lines and
 * starts waiting for them to stop, which is the opposite of the intended
 * effect — and a competitor doing the same job in five seconds does not read
 * as having measured less, it reads as being quicker at it.
 *
 * Nine, and the honest way to shorten a pass is to cut the number of beats
 * rather than the length of each one. Halving ARRIVE and HOLD would make every
 * line feel skipped; showing fewer lines at the same dwell reads as decisive.
 * The measurements that do not get a beat are not hidden — every one of them
 * is in the report a moment later, drawable on tap.
 */
const DEFAULT_MAX_STEPS = 9;

export interface PlanOptions {
  /**
   * Hard cap on beats. Defaults to DEFAULT_MAX_STEPS. The video harnesses set
   * their own, because a thirty-second film has a different budget from a
   * loading screen.
   */
  maxSteps?: number;
}

/**
 * Build the running order.
 *
 * Pure, and the only part of this file worth testing: the runner below is rAF
 * and canvas, but WHICH measurements get shown is a claim about the face and
 * has to hold every time.
 */
export function buildPassPlan(
  front: Report,
  side: Report | null,
  opts: PlanOptions = {},
): PassStep[] {
  const max = opts.maxSteps ?? DEFAULT_MAX_STEPS;
  const out: PassStep[] = [];

  const collect = (
    report: Report,
    order: RegionId[],
    view: "front" | "side",
    drawable: (id: string) => boolean,
  ) => {
    for (const id of order) {
      const region = report.regions.find((r) => r.region === id);
      if (!region || !regionIsScored(region)) continue;
      for (const metric of speakersFor(region.metrics, drawable)) {
        out.push({ view, region: id, label: LABELS[id], metric });
      }
    }
  };

  collect(front, FRONT_ORDER, "front", hasOverlay);
  const frontCount = out.length;
  if (side) collect(side, SIDE_ORDER, "side", hasSideOverlay);

  if (out.length <= max) return out;

  // Over the cap, and how it is trimmed decides what the scan LOOKS like it
  // measured.
  //
  // The old rule gave the side everything it asked for and handed the front
  // the remainder, which was harmless while the pass was uncapped and is not
  // now: a real profile offers five to eight drawable measurements, so at a
  // cap of nine the front would be left with one beat. The front carries 75%
  // of the overall score. It gets roughly two thirds of the pass, and the side
  // keeps a third, which is the same proportion the scoring uses.
  const sideSteps = out.slice(frontCount);
  // A third to the side, but never at the cost of the front's last beat, and
  // never any at a cap of one — a single-beat pass belongs to the front, which
  // carries 75% of the score.
  //
  // Both halves used to carry a Math.max(1, ...) floor, which meant the cap was
  // not a cap: `{ maxSteps: 1 }` against one front and one side measurement
  // returned two beats. Production passes nine so it never showed, but an
  // exported option that quietly returns more than it was asked for is a
  // contract the video harnesses rely on.
  const sideWanted = Math.min(sideSteps.length, Math.max(1, Math.round(max / 3)));
  const sideKeep = Math.min(sideWanted, Math.max(0, max - 1));
  const frontKeep = max - sideKeep;
  return [
    ...breadthFirst(out.slice(0, frontCount), frontKeep),
    ...breadthFirst(sideSteps, sideKeep),
  ];
}

/**
 * Take `cap` steps by walking the regions in rounds: every region's best
 * measurement first, then every region's second, and so on.
 *
 * Slicing the head off the list instead would have spent a nine-beat pass on
 * four eye measurements and two cheekbone ones, and never reached the jaw or
 * the chin — the two regions people actually arrive asking about. Rounds keep
 * the pass travelling over the whole face, which is what makes it read as an
 * examination rather than as a close inspection of one feature.
 *
 * The result is returned in the ORIGINAL order, so the camera still descends
 * the face top to bottom. Only the membership is chosen here, never the
 * running order.
 */
function breadthFirst(steps: PassStep[], cap: number): PassStep[] {
  if (steps.length <= cap) return steps;
  const byRegion = new Map<string, PassStep[]>();
  for (const step of steps) {
    // Keyed by view as well as region: the front jaw and the side jaw are two
    // different sets of measurements on two different photographs.
    const key = `${step.view}:${step.region}`;
    const list = byRegion.get(key);
    if (list) list.push(step);
    else byRegion.set(key, [step]);
  }
  const lists = [...byRegion.values()];
  const deepest = Math.max(...lists.map((l) => l.length));
  const keep = new Set<PassStep>();
  for (let round = 0; round < deepest && keep.size < cap; round++) {
    for (const list of lists) {
      if (round >= list.length) continue;
      keep.add(list[round]);
      if (keep.size >= cap) break;
    }
  }
  return steps.filter((step) => keep.has(step));
}

// ---------------------------------------------------------------------------
// The runner.
// ---------------------------------------------------------------------------

/**
 * Milliseconds a beat spends drawing its construction on.
 *
 * Tightened from 340/220/120 when the plan went from one measurement per
 * region to all of them: thirty-odd beats at the old pacing is over twenty
 * seconds of holds, and each individual line needs less dwell when the next
 * one is also worth watching. The pass is still longer overall — that is the
 * point — but each beat is brisker.
 */
const ARRIVE_MS = 300;
/** …and then holding it, so there is time to actually look at the line. */
const HOLD_MS = 150;
/**
 * The breath between constructions. The camera used to push in on every
 * point here, and the loading screen spent most of its runtime travelling:
 * eight zooms in ten seconds reads as the picture lurching, not as
 * measuring. The camera now HOLDS one wide framing for the whole pass — the
 * constructions do the moving — and each beat just takes a short breath
 * before the next line draws. (The hover on the report keeps its zoom: there
 * the person chose the point, so the camera going to it is an answer.)
 */
const BREATH_MS = 70;
/**
 * Opening beat: the mesh landing, before any single measurement is featured.
 * Matches REVEAL_MS in overlay.ts, which is what actually runs during it when
 * a caller passes `open` — the bar is drawn against this number, so a mismatch
 * shows up as a bar that finishes early and then sits there.
 */
const OPEN_MS = 1400;
/** Closing beat: both views merged into one number. */
const CLOSE_MS = 760;

export interface PassHost {
  /** The photo pane that carries the camera move. */
  zoomable: HTMLElement;
  photoCanvas: HTMLCanvasElement;
  overlayCanvas: HTMLCanvasElement;
  /** The narration line under the photograph. */
  status: HTMLElement;
  /** The progress bar's fill. */
  barFill: HTMLElement;
  /** The FRONT / SIDE word in the caption. */
  capLeft: HTMLElement | null;
  /**
   * The photo frame, marked `measuring` while individual constructions are
   * being featured. It carries the frame's inner light and, more importantly,
   * stands the roving sweep line down: once the camera is pushed in on one
   * measurement, a second line travelling over it is just motion.
   */
  frame?: HTMLElement;
}

export interface PassSources {
  front: {
    photo: HTMLCanvasElement;
    landmarks: NormalizedLandmark[];
    width: number;
    height: number;
  };
  side: {
    photo: HTMLCanvasElement;
    points: SidePoints;
    width: number;
    height: number;
  } | null;
}

export interface PassRun {
  done: Promise<void>;
  cancel(): void;
}

/**
 * How long the whole pass will take, so a caller can budget around it.
 *
 * Must account for the camera pre-roll as well as the draw and the hold: the
 * progress bar is a function of this number, and leaving the pre-roll out is
 * how a bar reaches 100% while three beats are still to come and then sits
 * there — which reads as the app having hung on the last one.
 */
export function passDurationMs(plan: PassStep[]): number {
  return OPEN_MS + plan.length * (BREATH_MS + ARRIVE_MS + HOLD_MS) + CLOSE_MS;
}

const sleep = (ms: number, signal: { cancelled: boolean }): Promise<void> =>
  new Promise((r) => {
    const t = window.setTimeout(r, ms);
    // Cancellation resolves rather than rejects. Every await in the runner is
    // followed by a cancellation check, and a rejected sleep would need a
    // try/catch around each one to say the same thing.
    const poll = window.setInterval(() => {
      if (signal.cancelled) {
        window.clearTimeout(t);
        window.clearInterval(poll);
        r();
      }
    }, 60);
    window.setTimeout(() => window.clearInterval(poll), ms + 80);
  });

export interface PassOptions {
  /**
   * Fires as each beat begins, so a caller can play a tick without this module
   * knowing anything about sound.
   */
  onStep?: (step: PassStep, index: number) => void;
  /**
   * The opening beat, when the caller is already running one.
   *
   * main.ts reveals the landmark mesh over the front photograph before any
   * measurement is featured, and that reveal owns the overlay canvas while it
   * runs. Handing it in here rather than racing it means the pass waits for the
   * mesh to finish landing instead of clearing it out from underneath — and the
   * open is then exactly as long as the reveal actually is, rather than a
   * constant somebody has to remember to keep in sync with it.
   */
  open?: Promise<void>;
  /**
   * Which photograph the frame is ALREADY showing, so the pass does not repaint
   * (and blank) a canvas the caller has just set up.
   */
  startPainted?: "front" | "side";
  /** Progress already shown by the authentication handoff. */
  progressStart?: number;
}

/** Run the pass. */
export function runMeasurePass(
  host: PassHost,
  sources: PassSources,
  plan: PassStep[],
  opts: PassOptions = {},
): PassRun {
  const signal = { cancelled: false };
  const total = passDurationMs(plan);
  const progressStart = Math.max(0, Math.min(0.9, opts.progressStart ?? 0));
  let raf = 0;

  // The bar is a plain function of elapsed time against the pass's own known
  // duration. It was previously driven by a stage clock that had to be kept in
  // sync with the text by hand; here the two cannot disagree because the text
  // is driven by the same await chain that decides when the pass is over.
  const t0 = performance.now();
  const tick = (now: number) => {
    if (signal.cancelled) return;
    const p = Math.min(1, (now - t0) / total);
    const eased = 1 - Math.pow(1 - p, 1.6);
    host.barFill.style.width = `${((progressStart + (1 - progressStart) * eased) * 100).toFixed(2)}%`;
    if (p < 1) raf = requestAnimationFrame(tick);
  };
  host.barFill.classList.add("driven");
  raf = requestAnimationFrame(tick);

  const say = (title: string, detail: string) => {
    host.status.classList.add("swapping");
    window.setTimeout(() => {
      if (signal.cancelled) return;
      host.status.innerHTML = detail
        ? `<b>${title}</b> <span class="mp-detail">${detail}</span>`
        : `<b>${title}</b> <span class="scan-ellipsis"><i>.</i><i>.</i><i>.</i></span>`;
      host.status.classList.remove("swapping");
    }, 120);
  };

  // Paint whichever photograph this beat is about. Only when it changes: a
  // canvas resize reallocates the backing buffer, and doing it every beat threw
  // away the previous frame mid-camera-move, which is the flicker this screen
  // was accused of.
  let painted: "front" | "side" | null = opts.startPainted ?? null;
  const paint = (view: "front" | "side"): void => {
    if (painted === view) return;
    const src = view === "side" ? sources.side : sources.front;
    if (!src) return;
    painted = view;
    host.photoCanvas.width = src.width;
    host.photoCanvas.height = src.height;
    host.photoCanvas.getContext("2d")!.drawImage(src.photo, 0, 0);
    host.overlayCanvas.width = src.width;
    host.overlayCanvas.height = src.height;
    host.overlayCanvas.getContext("2d")!.clearRect(0, 0, src.width, src.height);
    if (host.capLeft) host.capLeft.textContent = view === "side" ? "SIDE" : "FRONT";
  };

  // The view change crosses rather than cuts, and the camera returns to rest
  // WHILE the pane is invisible — so the next beat's push-in starts from wide
  // instead of yanking across the face from wherever the last one ended.
  const crossTo = async (view: "front" | "side"): Promise<void> => {
    if (painted === view) return;
    host.zoomable.classList.add("viewfade");
    await sleep(170, signal);
    if (signal.cancelled) return;
    applyZoom(host.zoomable, IDENTITY_ZOOM);
    paint(view);
    host.zoomable.classList.remove("viewfade");
    await sleep(120, signal);
  };

  const drawStep = (step: PassStep, progress: number): void => {
    if (step.view === "side") {
      const s = sources.side;
      if (!s) return;
      drawSideMeasurement(host.overlayCanvas, s.points, s.width, s.height, step.metric, progress, { labels: false });
    } else {
      const f = sources.front;
      drawMeasurement(host.overlayCanvas, f.landmarks, f.width, f.height, step.metric, progress, { labels: false });
    }
  };

  // Draw the construction on over ARRIVE_MS. Resolves when it is whole; the
  // caller then holds it. Cancelling stops the loop and leaves whatever was on
  // the canvas, which the results screen immediately overpaints anyway.
  const arrive = (step: PassStep): Promise<void> =>
    new Promise((resolve) => {
      let start = 0;
      const frame = (now: number) => {
        if (signal.cancelled) {
          resolve();
          return;
        }
        if (!start) start = now;
        const t = Math.min(1, (now - start) / ARRIVE_MS);
        drawStep(step, t);
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });

  const run = async (): Promise<void> => {
    // Reduced motion gets the same information without the camera: the plan is
    // still walked and every measurement is still drawn, just landed whole
    // rather than animated, and the whole thing runs short.
    const reduced = prefersReducedMotion();

    paint("front");
    say("Reading the face", "");
    // The caller's opening animation, if it has one, decides how long the open
    // is. Raced against the constant so a reveal that somehow never resolves
    // cannot strand the whole scan on its first beat.
    if (opts.open && !reduced) {
      await Promise.race([opts.open, sleep(OPEN_MS * 2, signal)]);
    } else {
      await sleep(reduced ? 260 : OPEN_MS, signal);
    }
    if (signal.cancelled) return;

    host.frame?.classList.add("measuring");
    // The whole pass — frame, narration, bar — must be on screen when it
    // begins. On a laptop the un-capped column used to leave the status line
    // below the fold, running the show to an audience that could not see it.
    host.frame?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    for (let i = 0; i < plan.length; i++) {
      const step = plan[i];
      if (signal.cancelled) return;
      await crossTo(step.view);
      if (signal.cancelled) return;
      opts.onStep?.(step, i);
      // Region plus the measurement's name — no values. The values were here
      // once and were cut on purpose: while the face is being read the
      // construction is the show, and numbers flashing past is noise wearing
      // a lab coat. The report is where the numbers live. The NAME earns its
      // place now that a region runs several beats: the same label four times
      // over four different constructions read as the screen being stuck.
      say(step.label, step.metric.def.name);
      if (!reduced) {
        // No camera move — see BREATH_MS. The face stays put; the lines come
        // to it.
        await sleep(BREATH_MS, signal);
        if (signal.cancelled) return;
        await arrive(step);
        if (signal.cancelled) return;
        await sleep(HOLD_MS, signal);
      } else {
        drawStep(step, 1);
        await sleep(200, signal);
      }
    }
    if (signal.cancelled) return;

    // Back to the front photograph and out to the whole face for the last beat.
    // The number about to arrive is about all of it, and ending on a close-up
    // of somebody's chin would say otherwise. Crossing back also leaves the
    // pane showing the FRONT — which the results screen assumes, and which the
    // old stage table achieved only by having "Merging both views" tagged as a
    // front stage.
    host.frame?.classList.remove("measuring");
    await crossTo("front");
    if (signal.cancelled) return;
    applyZoom(host.zoomable, IDENTITY_ZOOM);
    say(sources.side ? "Merging both views" : "Comparing against population", "");
    await sleep(reduced ? 240 : CLOSE_MS, signal);
  };

  const done = run().finally(() => {
    cancelAnimationFrame(raf);
  });

  return {
    done,
    cancel: () => {
      signal.cancelled = true;
      host.frame?.classList.remove("measuring");
      cancelAnimationFrame(raf);
    },
  };
}
