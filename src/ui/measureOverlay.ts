import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { LM } from "../engine/geometry.js";
import type { ScoredMetric } from "../engine/types.js";

// ---------------------------------------------------------------------------
// Measurement overlays: draw the actual measurement on the face.
//
// This is the credibility feature. A number in a table is a claim; the same
// number drawn across the cheekbones is evidence. Everything here is rendered
// in IMAGE space from the raw landmarks, so what the user sees is literally
// where the engine measured.
// ---------------------------------------------------------------------------

// The line is coloured by what it MEASURED, not by house style.
//
// It was monochrome white, and the comment defending that said the
// teal-and-orange it replaced "read as two systems fighting". That was right
// about two colours fighting each other and it is not an argument for white:
// one saturated hue on a darkened ground is still one instrument, and it beats
// white because skin is already white-ish. A white line competes with
// highlights, teeth and eye whites; a green one does not compete with anything
// in a face.
//
// Three bands, wide enough that nobody reads a hue as a decimal. The exact
// cut points do not matter much — what matters is that the same reading always
// gets the same colour, so the hue is information rather than decoration.
const BAND_LOW = "#F2604A";
const BAND_MID = "#F0B24A";
const BAND_HIGH = "#2BE08C";
// The fallback, for the surfaces that draw a construction with no score behind
// it: the landmark reference, the side seeder, the tutorial. Those are not
// readings and must not wear a verdict's colour.
const ACCENT = "#FFFFFF";

/**
 * The band a score sits in.
 *
 * Deliberately coarse. Reliability is not consulted here because the report
 * already refuses to draw an unreliable metric at all (see RELIABLE_MIN in
 * measurePass) — a line that reaches this function has already earned the
 * right to be on screen, and dimming it again would be saying the same caveat
 * twice in two languages.
 */
export function bandColour(score: number): string {
  if (!Number.isFinite(score)) return ACCENT;
  if (score < 4.5) return BAND_LOW;
  if (score < 6.5) return BAND_MID;
  return BAND_HIGH;
}

// The reference line inside a construction: the same hue at half strength, so
// the pair still reads as one instrument taking one reading.
function referenceOf(colour: string): string {
  return colour === ACCENT ? "rgba(255,255,255,0.5)" : `${colour}80`;
}
const WARM = "rgba(255,255,255,0.5)";

type Seg =
  | { kind: "span"; a: number | Pt2; b: number | Pt2; label?: string; color?: string }
  | { kind: "angle"; v: number | Pt2; a: number | Pt2; b: number | Pt2; label?: string }
  | { kind: "rule"; y: number | Pt2; label?: string; color?: string }
  | { kind: "axis"; x: number | Pt2 };

interface Pt2 {
  x: number;
  y: number;
}

// Per-metric drawing recipe. Numbers are landmark indices; the renderer
// resolves them against the raw landmark list.
const RECIPES: Record<string, (m: ScoredMetric) => Seg[]> = {
  fwhr: (m) => [
    { kind: "span", a: LM.ZYGION_R, b: LM.ZYGION_L, label: `${m.value.toFixed(2)}×` },
    { kind: "span", a: mid(LM.EYE_R_TOP, LM.EYE_L_TOP), b: LM.LIP_TOP, color: WARM },
  ],
  jawCheekRatio: (m) => [
    { kind: "span", a: LM.ZYGION_R, b: LM.ZYGION_L, color: WARM },
    { kind: "span", a: LM.GONION_R, b: LM.GONION_L, label: `${m.value.toFixed(3)}` },
  ],
  gonialProxy: (m) => [
    { kind: "angle", v: LM.GONION_R, a: LM.JAW_MID_R, b: LM.MENTON, label: `${m.value.toFixed(1)}°` },
    { kind: "angle", v: LM.GONION_L, a: LM.JAW_MID_L, b: LM.MENTON },
  ],
  jawFrontalAngle: (m) => [
    { kind: "angle", v: LM.MENTON, a: LM.GONION_R, b: LM.GONION_L, label: `${m.value.toFixed(1)}°` },
  ],
  canthalTilt: (m) => [
    { kind: "span", a: LM.EYE_R_INNER, b: LM.EYE_R_OUTER, label: `avg ${m.value.toFixed(1)}°` },
    { kind: "span", a: LM.EYE_L_INNER, b: LM.EYE_L_OUTER },
  ],
  browTilt: (m) => [
    { kind: "span", a: LM.BROW_R_MEDIAL, b: LM.BROW_R_LATERAL, label: `${m.value.toFixed(1)}°` },
    { kind: "span", a: LM.BROW_L_MEDIAL, b: LM.BROW_L_LATERAL },
  ],
  browPosition: (m) => [
    { kind: "span", a: LM.BROW_R_MID, b: LM.IRIS_R, label: `${m.value.toFixed(3)}` },
    { kind: "span", a: LM.BROW_L_MID, b: LM.IRIS_L },
  ],
  eyeAspectRatio: (m) => [
    { kind: "span", a: LM.EYE_R_TOP, b: LM.EYE_R_BOTTOM, label: `${m.value.toFixed(2)}` },
    { kind: "span", a: LM.EYE_R_OUTER, b: LM.EYE_R_INNER, color: WARM },
  ],
  eyeSeparationRatio: (m) => [
    { kind: "span", a: LM.IRIS_R, b: LM.IRIS_L, label: `${m.value.toFixed(3)}` },
    { kind: "span", a: LM.ZYGION_R, b: LM.ZYGION_L, color: WARM },
  ],
  intercanthalEyeWidth: (m) => [
    { kind: "span", a: LM.EYE_R_INNER, b: LM.EYE_L_INNER, label: `${m.value.toFixed(2)}×` },
    { kind: "span", a: LM.EYE_R_OUTER, b: LM.EYE_R_INNER, color: WARM },
  ],
  fifthsEyeRatio: (m) => [
    { kind: "span", a: LM.EYE_R_OUTER, b: LM.EYE_R_INNER, label: `${m.value.toFixed(3)}` },
    { kind: "span", a: LM.ZYGION_R, b: LM.ZYGION_L, color: WARM },
  ],
  noseMouthRatio: (m) => [
    { kind: "span", a: 98, b: 327, label: `${m.value.toFixed(2)}×` },
    { kind: "span", a: LM.MOUTH_R, b: LM.MOUTH_L, color: WARM },
  ],
  noseIntercanthal: (m) => [
    { kind: "span", a: 98, b: 327, label: `${m.value.toFixed(2)}×` },
    { kind: "span", a: LM.EYE_R_INNER, b: LM.EYE_L_INNER, color: WARM },
  ],
  nasalIndex: (m) => [
    { kind: "span", a: 98, b: 327, label: `${m.value.toFixed(2)}` },
    { kind: "span", a: LM.NASION, b: LM.SUBNASALE, color: WARM },
  ],
  mouthIPD: (m) => [
    { kind: "span", a: LM.MOUTH_R, b: LM.MOUTH_L, label: `${m.value.toFixed(2)}×` },
    { kind: "span", a: LM.IRIS_R, b: LM.IRIS_L, color: WARM },
  ],
  lipRatio: (m) => [
    { kind: "span", a: LM.LIP_TOP, b: LM.LIP_UPPER_INNER, color: WARM },
    { kind: "span", a: LM.LIP_LOWER_INNER, b: LM.LIP_BOTTOM, label: `${m.value.toFixed(2)}×` },
  ],
  lipHeightLowerThird: (m) => [
    { kind: "span", a: LM.LIP_TOP, b: LM.LIP_BOTTOM, label: `${m.value.toFixed(1)}%` },
    { kind: "span", a: LM.SUBNASALE, b: LM.MENTON, color: WARM },
  ],
  mouthCornerTilt: (m) => [
    { kind: "span", a: LM.MOUTH_R, b: LM.MOUTH_L, label: `${m.value.toFixed(1)}°` },
  ],
  philtrumChinRatio: (m) => [
    { kind: "span", a: LM.SUBNASALE, b: LM.LIP_TOP, color: WARM },
    { kind: "span", a: LM.LIP_LOWER_INNER, b: LM.MENTON, label: `${m.value.toFixed(2)}×` },
  ],
  chinHeightRatio: (m) => [
    { kind: "span", a: LM.LIP_LOWER_INNER, b: LM.MENTON, label: `${m.value.toFixed(2)}` },
    { kind: "span", a: LM.SUBNASALE, b: LM.MENTON, color: WARM },
  ],
  chinWidthRatio: (m) => [
    { kind: "span", a: LM.CHIN_SIDE_R, b: LM.CHIN_SIDE_L, label: `${m.value.toFixed(2)}` },
    { kind: "span", a: LM.GONION_R, b: LM.GONION_L, color: WARM },
  ],
  lowerFacePct: (m) => [
    { kind: "span", a: LM.SUBNASALE, b: LM.MENTON, label: `${m.value.toFixed(1)}%` },
    { kind: "span", a: LM.GLABELLA, b: LM.MENTON, color: WARM },
  ],
  topThirdEst: (m) => [
    { kind: "span", a: LM.FOREHEAD_TOP, b: LM.GLABELLA, label: `${m.value.toFixed(1)}%` },
    { kind: "span", a: LM.FOREHEAD_TOP, b: LM.MENTON, color: WARM },
  ],
  middleLowerBalance: (m) => [
    { kind: "span", a: LM.GLABELLA, b: LM.SUBNASALE, label: `${m.value.toFixed(2)}×` },
    { kind: "span", a: LM.SUBNASALE, b: LM.MENTON, color: WARM },
  ],
  facialIndex: (m) => [
    { kind: "span", a: LM.FOREHEAD_TOP, b: LM.MENTON, label: `${m.value.toFixed(2)}` },
    { kind: "span", a: LM.ZYGION_R, b: LM.ZYGION_L, color: WARM },
  ],
  midfaceRatio: (m) => [
    { kind: "span", a: LM.IRIS_R, b: LM.IRIS_L, label: `${m.value.toFixed(2)}` },
    { kind: "span", a: mid(LM.IRIS_R, LM.IRIS_L), b: LM.LIP_TOP, color: WARM },
  ],
  cheekboneHeight: (m) => [
    { kind: "rule", y: LM.ZYGION_R, label: `${m.value.toFixed(2)}` },
    { kind: "span", a: mid(LM.IRIS_R, LM.IRIS_L), b: LM.MENTON, color: WARM },
  ],
  midlineDeviation: (m) => [
    { kind: "axis", x: mid(LM.IRIS_R, LM.IRIS_L) },
    { kind: "span", a: LM.NOSE_TIP, b: LM.MENTON, label: `${m.value.toFixed(1)}%` },
  ],
  eyeMouthParallel: (m) => [
    { kind: "span", a: LM.IRIS_R, b: LM.IRIS_L, color: WARM },
    { kind: "span", a: LM.MOUTH_R, b: LM.MOUTH_L, label: `${m.value.toFixed(1)}°` },
  ],
  canthalAsymmetry: (m) => [
    { kind: "span", a: LM.EYE_R_INNER, b: LM.EYE_R_OUTER, label: `${m.value.toFixed(1)}°` },
    { kind: "span", a: LM.EYE_L_INNER, b: LM.EYE_L_OUTER, color: WARM },
  ],
  mirrorDeviation: (m) => [
    { kind: "axis", x: mid(LM.IRIS_R, LM.IRIS_L) },
    { kind: "span", a: LM.ZYGION_R, b: LM.ZYGION_L, label: `${m.value.toFixed(1)}%` },
  ],
};

// Marker for "midpoint of these two landmarks", resolved at draw time
function mid(a: number, b: number): Pt2 {
  return { x: -1 - a, y: -1 - b } as Pt2;
}
const isMidMarker = (p: Pt2) => p.x < 0 && p.y < 0;

export function hasOverlay(metricId: string): boolean {
  return metricId in RECIPES;
}

/**
 * The box, in NORMALIZED coordinates, that a metric's overlay actually touches.
 *
 * The rundown crops to a band of the face chosen by region — eyes, jaw, chin —
 * and then composites this overlay through the same rectangle. Those are two
 * independent guesses at the same question and they disagreed: a chin-width
 * span runs the full width of the jaw, the chin band crops to nine tenths of
 * the face width, and the measurement ran off the right edge of the frame with
 * its label outside the picture. A viewer sees a line leaving the screen, which
 * reads as a bug in the measurement rather than in the framing.
 *
 * So the crop asks the overlay where it is going to draw instead of assuming.
 * Returns undefined when the metric has no recipe — the fallback lights a
 * region's landmarks, which are inside the band by construction.
 */
export function measurementBounds(
  metric: ScoredMetric,
  landmarks: NormalizedLandmark[],
): { x0: number; y0: number; x1: number; y1: number } | undefined {
  const recipe = RECIPES[metric.def.id];
  if (!recipe) return undefined;
  // Resolved in normalized space (width and height of 1), which is the same
  // resolution the renderer does at photo scale — mid-markers included, since a
  // midpoint of two off-frame points can itself be off frame.
  const P = (ref: number | Pt2): Pt2 => {
    if (typeof ref === "number") {
      const l = landmarks[ref];
      return l ? { x: l.x, y: l.y } : { x: 0.5, y: 0.5 };
    }
    if (isMidMarker(ref)) {
      const a = P(-1 - ref.x);
      const b = P(-1 - ref.y);
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    return ref;
  };

  let x0 = 1;
  let y0 = 1;
  let x1 = 0;
  let y1 = 0;
  let any = false;
  const add = (p: Pt2) => {
    any = true;
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  };
  for (const seg of recipe(metric)) {
    if (seg.kind === "span") {
      add(P(seg.a));
      add(P(seg.b));
    } else if (seg.kind === "angle") {
      add(P(seg.v));
      add(P(seg.a));
      add(P(seg.b));
    } else if (seg.kind === "rule") {
      // A horizontal rule spans the frame; only its height constrains the crop.
      const p = P(seg.y);
      add({ x: x1 === 0 ? p.x : x1, y: p.y });
      add({ x: x0 === 1 ? p.x : x0, y: p.y });
    } else {
      add(P(seg.x));
    }
  }
  return any ? { x0, y0, x1, y1 } : undefined;
}

// Every measurement row is tappable, so every row has to draw something. Most
// have a bespoke recipe above; the rest — chiefly the side-profile metrics,
// whose points live in a different image entirely — fall back to lighting the
// landmarks their region is measured from, with the value called out.
//
// This is deliberately honest about being less specific: it shows WHERE the
// number comes from without pretending to draw a span it cannot locate in this
// photograph. A row that did nothing when tapped would be worse.
const REGION_FALLBACK: Record<string, number[]> = {
  eyes: [33, 133, 159, 145, 362, 263, 386, 374],
  midface: [234, 454, 116, 345, 50, 280],
  jaw: [58, 288, 172, 397, 136, 365, 152],
  chin: [152, 148, 377, 17, 18, 200],
  nose: [1, 4, 6, 168, 98, 327],
  lips: [61, 291, 0, 13, 14, 17],
  proportions: [10, 9, 2, 152, 234, 454],
  symmetry: [10, 168, 1, 152, 33, 263],
};

// Cross-fade from whatever is currently drawn to a new measurement.
//
// Hovering down a list of measurements snapped from one set of lines to the
// next, which reads as flicker rather than as the overlay following you. This
// renders both states offscreen and dissolves between them.
//
// It is a cross-fade rather than a draw-on animation because the lines are the
// evidence: growing or scaling them into place would mean showing geometry
// that is briefly WRONG, on the one feature whose whole job is to prove the
// number is real. Opacity is the only property that can change here without
// lying.
export interface OverlayFade {
  cancel(): void;
}

const FADE_MS = 170;

export function transitionMeasurement(
  canvas: HTMLCanvasElement,
  paintNext: (target: HTMLCanvasElement) => void,
): OverlayFade {
  const w = canvas.width || 1;
  const h = canvas.height || 1;

  const from = document.createElement("canvas");
  from.width = w;
  from.height = h;
  if (canvas.width && canvas.height) from.getContext("2d")!.drawImage(canvas, 0, 0);

  const to = document.createElement("canvas");
  to.width = w;
  to.height = h;
  paintNext(to);

  const ctx = canvas.getContext("2d")!;
  let raf = 0;
  let start = 0;
  const frame = (now: number) => {
    if (!start) start = now;
    const t = Math.min(1, (now - start) / FADE_MS);
    const e = 1 - Math.pow(1 - t, 3);
    // The canvas may have been resized by whatever painted `to`; match it back
    // so both layers land on the same grid.
    if (canvas.width !== to.width || canvas.height !== to.height) {
      canvas.width = to.width;
      canvas.height = to.height;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1 - e;
    ctx.drawImage(from, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = e;
    ctx.drawImage(to, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
    if (t < 1) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return { cancel: () => cancelAnimationFrame(raf) };
}

// `progress` draws the measurement partway: 0 is nothing, 1 is the finished
// figure. Each segment extends ALONG ITS OWN PATH, and the segments start in
// sequence rather than together.
//
// I argued against animating this at first, on the grounds that the lines are
// the evidence and animating them would mean showing geometry that is briefly
// wrong. That is true of growing or scaling a figure into place — and it is not
// true of this. A line drawn from its start point toward its end is a SUBSET of
// the true line at every frame: incomplete, never misplaced. Ticks and labels
// only appear once their segment has finished arriving, so nothing is ever
// annotated before it is real.
export function drawMeasurement(
  canvas: HTMLCanvasElement,
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
  metric: ScoredMetric,
  progress = 1,
  /**
   * Whether the value chips are drawn. The report keeps them — a tapped row is
   * a question about a number. The scan's measure pass turns them off: while
   * the face is being read, the construction itself is the show, and eight
   * numbers flashing past in ten seconds is noise pretending to be data.
   */
  opts: {
    labels?: boolean;
    /**
     * Stroke weight multiplier. 1 is the report's hairline; the video
     * renderer passes ~1.35 so the line survives a platform re-encode and
     * bright skin — the compression pass eats exactly the width the report's
     * screen never loses. Presence still comes from the bloom, so the heavier
     * line keeps the instrument look rather than turning into a marker pen.
     */
    weight?: number;
  } = {},
): boolean {
  // Only resize when the size actually changed. Assigning to canvas.width or
  // canvas.height reallocates the whole backing buffer and resets the context,
  // and this function runs on every animation frame — so doing it
  // unconditionally forced ~25 full buffer reallocations per hover, which was
  // the entire source of the lag when moving between measurements. clearRect
  // does the per-frame wipe; the resize only has to happen once.
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, width, height);

  const recipe = RECIPES[metric.def.id];
  if (!recipe) {
    drawRegionFallback(ctx, landmarks, width, height, metric);
    return true;
  }

  const P = (ref: number | Pt2): Pt2 => {
    if (typeof ref === "number") {
      const l = landmarks[ref];
      return { x: l.x * width, y: l.y * height };
    }
    if (isMidMarker(ref)) {
      const a = P(-1 - ref.x);
      const b = P(-1 - ref.y);
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    return ref;
  };

  // Thinner than it was: the premium stroke gets its presence from the bloom
  // pass in strokePremium, not from width.
  const lw = Math.max(1.2, width / 520) * (opts.weight ?? 1);
  const fs = Math.max(9, width / 62);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const segs = recipe(metric);
  // Each segment gets its own slice of the timeline, overlapping so the figure
  // reads as one gesture rather than a queue.
  const share = 1 / Math.max(1, segs.length);
  const at = (i: number) => {
    if (progress >= 1) return 1;
    const start = i * share * STAGGER;
    const span = 1 - start;
    return Math.max(0, Math.min(1, (progress - start) / (span || 1)));
  };
  const ease = (t: number) => 1 - Math.pow(1 - t, 3);
  const lerp = (a: Pt2, b: Pt2, t: number): Pt2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

  // One colour for the whole construction, taken from the reading it is a
  // picture of. The recipes still name WARM for their reference lines, which is
  // resolved here to the same hue at half strength rather than to a fixed
  // white — so a construction is one instrument in one colour, never a
  // coloured line with a white one beside it.
  const band = bandColour(metric.score);
  for (const [segIndex, seg] of segs.entries()) {
    const u = ease(at(segIndex));
    if (u <= 0) continue;
    // Annotations wait until their own line has fully arrived.
    const done = u >= 0.999;
    const named = ("color" in seg && seg.color) || null;
    const color = named === WARM ? referenceOf(band) : named || band;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lw;

    if (seg.kind === "span") {
      const a = P(seg.a);
      const bFull = P(seg.b);
      const b = lerp(a, bFull, u);
      line(ctx, a, b);
      // No terminal nodes. A span used to end on a dot at each end, and the
      // dots are what made it read as a measurement with handles rather than
      // as one stroke: the line's own end IS the terminus, and marking it
      // again says the same thing twice while adding the two brightest points
      // in the construction.
      //
      // The dots stay where they are the thing being manipulated — the
      // landmark review and the front edit, which draw their own and are not
      // this renderer.
      if (seg.label && done && opts.labels !== false) {
        // Sit the label just past the line's end so the face stays visible
        const dx = bFull.x - a.x, dy = bFull.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        label(ctx, seg.label, { x: bFull.x + (dx / len) * fs * 1.6, y: bFull.y + (dy / len) * fs * 1.6 }, fs, color);
      }
    } else if (seg.kind === "angle") {
      const v = P(seg.v);
      const a = P(seg.a);
      const b = P(seg.b);
      // The legs run out from the vertex ONE AT A TIME, then the arc sweeps
      // between them.
      //
      // They used to share a single `u`, so both grew together and the angle
      // appeared as a finished V. Two elements drawn on one beat is a diagram
      // being switched on; drawn on two it is an angle being constructed, and
      // the second leg arriving against a stationary first is what makes the
      // arc between them read as a measurement rather than a decoration. The
      // reference channels never draw two parts of a figure simultaneously.
      //
      // Overlapped rather than strictly queued — the second starts before the
      // first has landed — so this is still one gesture at speed.
      const phase = anglePhases(u);
      line(ctx, v, lerp(v, a, phase.legA));
      if (phase.legB > 0) line(ctx, v, lerp(v, b, phase.legB));
      if (phase.arc > 0) arc(ctx, v, a, b, width, phase.arc);
      if (seg.label && done && opts.labels !== false) label(ctx, seg.label, angleLabelAt(v, a, b, width, fs), fs, color);
    } else if (seg.kind === "rule") {
      // A rule spans the frame, so it opens from the middle outward.
      const p = P(seg.y);
      const half = (width / 2) * u;
      line(ctx, { x: width / 2 - half, y: p.y }, { x: width / 2 + half, y: p.y });
      if (seg.label && done && opts.labels !== false) label(ctx, seg.label, { x: width * 0.5, y: p.y }, fs, color);
    } else {
      const p = P(seg.x);
      const half = (height / 2) * u;
      ctx.setLineDash([lw * 2, lw * 3.4]);
      auxLine(ctx, { x: p.x, y: height / 2 - half }, { x: p.x, y: height / 2 + half });
      ctx.setLineDash([]);
    }
  }
  ctx.shadowBlur = 0;
  return true;
}

/**
 * The premium stroke: a crisp hairline laid over its own soft bloom.
 *
 * One opaque line with ruler whiskers read as a school diagram; a thin,
 * slightly translucent core floating on a wide faint halo of its own colour
 * reads as light — an instrument, not a marker pen. Two passes over the same
 * path: the halo carries no shadow, the core carries a whisper of dark
 * shadow so it survives bright skin.
 */
function strokePremium(ctx: CanvasRenderingContext2D, trace: () => void): void {
  const w0 = ctx.lineWidth;
  const a0 = ctx.globalAlpha;
  ctx.save();
  // The halo. Wider and brighter than it was (3x at 0.16 -> 4.5x at 0.26),
  // which is only affordable now that the ground beneath it is darkened: over
  // a full-brightness photograph the same values washed the face out, which is
  // why they were set so low in the first place.
  ctx.shadowColor = "transparent";
  ctx.globalAlpha = a0 * 0.26;
  ctx.lineWidth = w0 * 4.5;
  ctx.beginPath();
  trace();
  ctx.stroke();
  // The core, genuinely hairline now. The old floor of 0.9 was what stopped it
  // getting thin on a large canvas, and thin is where the sharpness comes
  // from: a line reads as an instrument when it is fine and bright, and as a
  // marker pen when it is thick and bright. 0.6 is still above the half-pixel
  // at which a stroke starts to alias into grey on a 1x display.
  ctx.globalAlpha = a0;
  ctx.lineWidth = Math.max(0.6, w0 * 0.55);
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = 2.5;
  ctx.beginPath();
  trace();
  ctx.stroke();
  ctx.restore();
}

function line(ctx: CanvasRenderingContext2D, a: Pt2, b: Pt2): void {
  strokePremium(ctx, () => {
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  });
}

/** A faint auxiliary line — guides and verticals, never the measurement itself. */
function auxLine(ctx: CanvasRenderingContext2D, a: Pt2, b: Pt2): void {
  ctx.save();
  ctx.shadowColor = "transparent";
  ctx.globalAlpha *= 0.35;
  ctx.lineWidth = Math.max(0.9, ctx.lineWidth * 0.8);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

// `u` sweeps the arc from its first leg toward its second.
/**
 * How big the angle's arc should be, in pixels.
 *
 * It was a flat `width * 0.045` — about thirteen pixels against legs two
 * hundred long, which on a phone is a hook you have to go looking for. The arc
 * is the element that says "this is an ANGLE" rather than two lines that happen
 * to meet, so it is the last thing that should be the least visible.
 *
 * Scaled to the SHORTER leg so it stays in proportion on a figure of any size,
 * and bounded so a very long leg cannot swallow the face and a very short one
 * cannot vanish.
 */
export function arcRadius(
  v: Pt2,
  a: Pt2,
  b: Pt2,
  width: number,
): number {
  const legs = Math.min(Math.hypot(a.x - v.x, a.y - v.y), Math.hypot(b.x - v.x, b.y - v.y));
  return Math.max(width * 0.05, Math.min(width * 0.14, legs * 0.3));
}

/**
 * Where an angle's value chip goes: outside the vertex, along the bisector
 * pointing AWAY from the figure.
 *
 * It used to sit exactly on the vertex, which is where the arc is, so the one
 * element that identifies the figure as an angle was covered by the number at
 * the precise moment both were on screen. Only visible by rendering it — the
 * geometry tests all passed.
 *
 * Away from the legs rather than between them, because between them is the
 * face. On a jaw angle the legs run up from the chin, so this drops the chip
 * below the chin and into empty frame; on a gonial angle it sits back toward
 * the ear. label() still clamps the result inside the canvas.
 */
export function angleLabelAt(v: Pt2, a: Pt2, b: Pt2, width: number, fs: number): Pt2 {
  const unit = (p: Pt2) => {
    const d = Math.hypot(p.x - v.x, p.y - v.y) || 1;
    return { x: (p.x - v.x) / d, y: (p.y - v.y) / d };
  };
  const ua = unit(a);
  const ub = unit(b);
  let bx = ua.x + ub.x;
  let by = ua.y + ub.y;
  const len = Math.hypot(bx, by);
  // Legs pointing exactly opposite each other have no bisector — a straight
  // line is not an angle to label, but it must not produce NaN either.
  if (len < 1e-6) return { x: v.x, y: v.y + arcRadius(v, a, b, width) + fs };
  bx /= len;
  by /= len;
  const out = arcRadius(v, a, b, width) + fs * 1.25;
  return { x: v.x - bx * out, y: v.y - by * out };
}

/**
 * The signed sweep from bearing `a1` to bearing `a2`, the short way round —
 * so an angle figure always marks the INTERIOR angle between its two legs.
 *
 * The previous version sorted the two bearings and swept low to high, which is
 * the interior angle only while the pair does not straddle the atan2
 * discontinuity at ±π. A gonial angle on one side of the face does straddle it,
 * and there the arc looped the wrong way around the vertex and out through its
 * own leg. It survived because the arc was thirteen pixels wide; drawing it at a
 * readable size made it obvious immediately.
 *
 * Always at most half a turn, so the result is never the reflex angle.
 */
export function interiorSweep(a1: number, a2: number): number {
  let d = a2 - a1;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function arc(ctx: CanvasRenderingContext2D, v: Pt2, a: Pt2, b: Pt2, width: number, u = 1): void {
  const r = arcRadius(v, a, b, width);
  const a1 = Math.atan2(a.y - v.y, a.x - v.x);
  const a2 = Math.atan2(b.y - v.y, b.x - v.x);
  // Always the INTERIOR angle: sweep from the first leg to the second the
  // short way round.
  //
  // It used to sort the two bearings and sweep lo→hi, which is only the
  // interior angle when the pair does not straddle the atan2 discontinuity at
  // ±π. When it does — and a gonial angle on one side of the face does — it
  // drew the reflex angle instead: an arc looping the wrong way around the
  // vertex and out through its own leg. Invisible for as long as the radius was
  // thirteen pixels, obvious the moment the arc was drawn at a readable size.
  const d = interiorSweep(a1, a2);
  const t = Math.max(0, Math.min(1, u));
  strokePremium(ctx, () => ctx.arc(v.x, v.y, r, a1, a1 + d * t, d < 0));
}

// How much of the timeline is spent staggering segment starts, as opposed to
// all of them running together. 0 = simultaneous, 1 = strictly sequential.
/**
 * How far each part of an angle figure has been drawn, at overall progress `u`.
 *
 * The first leg, then the second, then the arc between them — overlapped, not
 * queued. Both legs used to share `u` and grow together, which draws a finished
 * V rather than an angle being constructed; the second leg arriving against a
 * stationary first is what makes the arc read as a measurement being taken. The
 * reference channels never draw two parts of one figure simultaneously.
 *
 * Its own function so the ordering is testable without a canvas, and so a later
 * tweak to the constants cannot quietly reorder the construction.
 */
export function anglePhases(u: number): { legA: number; legB: number; arc: number } {
  const unit = (n: number) => Math.max(0, Math.min(1, n));
  return {
    legA: unit(u / 0.55),
    legB: unit((u - 0.30) / 0.55),
    arc: unit((u - 0.72) / 0.28),
  };
}

const STAGGER = 0.45;

// Draw a measurement on, over `DRAW_MS`. Returns a handle so a fast hover down
// the list can cancel the previous one instead of leaving two rAF loops
// fighting over the same canvas.
const DRAW_MS = 220;

export function animateMeasurement(
  canvas: HTMLCanvasElement,
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
  metric: ScoredMetric,
): OverlayFade {
  // Whatever is on the canvas RIGHT NOW — the previous measurement, or the
  // calm region outline — fades out underneath while the new figure draws on.
  //
  // Without this, moving from measurement A to measurement B blanked the
  // overlay on B's first frame and rebuilt from nothing, so walking a list
  // read as strobe-off, draw, strobe-off, draw. A departing figure dissolving
  // under an arriving one is a single continuous gesture, and it is also still
  // honest: the old lines only ever lose opacity, never move, so no geometry
  // is shown anywhere it was not measured.
  const from = snapshotIfMatching(canvas, width, height);
  let raf = 0;
  let start = 0;
  const frame = (now: number) => {
    if (!start) start = now;
    const t = Math.min(1, (now - start) / DRAW_MS);
    drawMeasurement(canvas, landmarks, width, height, metric, t);
    compositeDeparting(canvas, from, t);
    if (t < 1) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return { cancel: () => cancelAnimationFrame(raf) };
}

// The previous overlay content, captured only when the canvas is already at
// the target size — a first draw, or a resize, has nothing worth fading from.
export function snapshotIfMatching(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): HTMLCanvasElement | null {
  if (canvas.width !== width || canvas.height !== height || !width || !height) return null;
  const from = document.createElement("canvas");
  from.width = width;
  from.height = height;
  from.getContext("2d")!.drawImage(canvas, 0, 0);
  return from;
}

// Gone by 45% of the draw, so the new figure finishes on a clean field.
export function compositeDeparting(
  canvas: HTMLCanvasElement,
  from: HTMLCanvasElement | null,
  t: number,
): void {
  if (!from) return;
  const alpha = Math.max(0, 1 - t / 0.45);
  if (alpha <= 0) return;
  const g = canvas.getContext("2d")!;
  g.globalAlpha = alpha;
  g.drawImage(from, 0, 0);
  g.globalAlpha = 1;
}

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  at: Pt2,
  fs: number,
  color: string,
): void {
  ctx.font = `600 ${fs}px Inter Variable, Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width + fs * 0.7;
  const h = fs * 1.55;
  // Clamped inside the canvas. A span that reaches the edge of the photograph
  // put its pill PAST the edge — the pill is drawn at the span's end — and a
  // half-pill reading "vg 3.0°" shipped in a real export. The pill slides
  // inward instead; the line it belongs to still touches the true endpoint,
  // which is what anchors it.
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const x = Math.max(w / 2 + 2, Math.min(cw - w / 2 - 2, at.x));
  const y = Math.max(h / 2 + 2, Math.min(ch - h / 2 - 2, at.y));
  ctx.shadowBlur = 6;
  ctx.fillStyle = "rgba(16,17,19,0.82)";
  roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}


// Light the region a metric is measured from, and call out its value. Used for
// every metric with no bespoke span — notably the side-profile ones, whose
// thirteen points were placed on a different photograph and have no position
// in this one.
function drawRegionFallback(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
  metric: ScoredMetric,
): void {
  const ids = (REGION_FALLBACK[metric.def.region] ?? []).filter((i) => landmarks[i]);
  if (!ids.length) return;

  let cx = 0;
  let cy = 0;
  for (const i of ids) {
    cx += landmarks[i].x * width;
    cy += landmarks[i].y * height;
  }
  cx /= ids.length;
  cy /= ids.length;

  const r = Math.max(3, width / 150);
  const band = bandColour(metric.score);
  ctx.save();
  ctx.shadowColor = band;
  ctx.shadowBlur = width / 90;
  ctx.fillStyle = band;
  for (const i of ids) {
    ctx.beginPath();
    ctx.arc(landmarks[i].x * width, landmarks[i].y * height, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const dec = metric.def.decimals ?? 2;
  label(
    ctx,
    `${metric.value.toFixed(dec)}${metric.def.unit ?? ""}`,
    { x: cx, y: cy },
    Math.max(11, width / 34),
    ACCENT,
  );
}
