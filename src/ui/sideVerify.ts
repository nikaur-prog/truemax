import type { Pt } from "../engine/geometry.js";
import { SIDE_POINTS } from "../engine/sideMetrics.js";
import type { SidePointId, SidePoints } from "../engine/sideMetrics.js";
import { detect } from "../engine/landmarker.js";
import { cloneSidePoints } from "../engine/sideFeedbackPayload.js";
import type { SideSeedMethod } from "../engine/sideFeedbackPayload.js";
import type { SideSilhouetteCheck } from "../engine/photoEligibility.js";

// Drag-to-verify landmark editor for the side profile. MediaPipe's visible-side
// mesh is the primary seed; a background-independent silhouette estimate is a
// fallback only when no mesh survives. The user confirms either one.

export interface VerifyHandle {
  points: SidePoints;
  faceDir: number; // +1 subject faces image-right, -1 image-left
  setEditable(editable: boolean): void;
  reset(points: SidePoints): void;
  /**
   * Walk the thirteen points one at a time instead of presenting all of them.
   *
   * Thirteen simultaneous rings on a bad seed reads as a wall of work, and in
   * the first live test people simply declined to start it. One highlighted
   * point with a name, a hint and a count reads as a step — and the mechanic
   * changes with it: while guided, a tap ANYWHERE on the photo places the
   * current point there (drag to fine-tune), so nobody has to first catch a
   * mis-seeded dot that may be nowhere near where it belongs.
   *
   * onStep fires on entry and every navigation; onFinish when the last point
   * is accepted. endGuided drops back to free editing at any time.
   */
  startGuided(onStep: (index: number, total: number) => void, onFinish: () => void): void;
  guidedNext(): void;
  guidedBack(): void;
  guidedCurrent(): { label: string; hint: string };
  endGuided(): void;
  destroy(): void;
}

export interface SideSeed {
  points: SidePoints;
  faceDir: number;
  method: SideSeedMethod;
  // 0-1. The fraction of the thirteen points that landed on the head rather
  // than in the room behind it. Exposed so the verifier can say "check these"
  // loudly when the seed is a guess and quietly when it is not, instead of
  // presenting every seed with the same false confidence.
  confidence: number;
}

// ---------------------------------------------------------------------------
// Seeding the thirteen points.
//
// The first version of this scattered points onto the wall behind the subject,
// and it did so for two separate reasons that are worth naming, because both
// are easy to write again.
//
// ONE: it decided which way the face pointed by comparing pixel mass in the
// left half of the FRAME against the right half. What that measures is where
// the person is standing, not which way they are looking. Someone standing
// left of centre and facing left was read as facing right, and every point
// went to the opposite side of the picture.
//
// TWO: it found the profile edge by scanning inward from the frame border for
// the first "skin-coloured" pixel, using fixed RGB thresholds — r > 70, r > g,
// r - b > 12. A beige wall passes that. So the scan stopped on the first column
// it touched and the edge came back as the frame border. Warm indoor lighting
// makes almost any wall qualify.
//
// The replacement never asks whether a pixel looks like skin. It asks whether a
// pixel looks like the BACKGROUND, which is a question the image itself can
// answer: sample the top corners, which in a portrait are background by
// construction, and call anything far from that colour foreground. That has the
// side benefit of being independent of skin tone, which the old test was not —
// a fixed r - b > 12 threshold is a statement about complexion.
// ---------------------------------------------------------------------------

// Downsampled working resolution. The silhouette is a shape, not a texture.
const TRACE_W = 200;

interface Mask {
  fg: Uint8Array;
  w: number;
  h: number;
}

interface SilhouetteGeometry {
  mask: Mask;
  top: number;
  chin: number;
  headH: number;
  faceDir: number;
  rowSpan: (y: number) => [number, number] | null;
  wanderLeft: number;
  wanderRight: number;
}

// Foreground mask by distance from a background colour model built from the
// top corners of the frame.
function foregroundMask(canvas: HTMLCanvasElement): Mask {
  const w = TRACE_W;
  const h = Math.max(8, Math.round((canvas.height / canvas.width) * TRACE_W));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const cx = c.getContext("2d", { willReadFrequently: true })!;
  cx.drawImage(canvas, 0, 0, w, h);
  const d = cx.getImageData(0, 0, w, h).data;

  // Background samples: the top-left and top-right corner blocks. A head fills
  // the middle of a portrait and the shoulders fill the bottom, so the top
  // corners are the only two regions that are background in essentially every
  // framing. Kept as two separate models rather than one average, because a
  // window on one side and a wall on the other are genuinely two backgrounds
  // and averaging them describes neither.
  const corner = (x0: number, y0: number) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y0 + Math.round(h * 0.14); y++) {
      for (let x = x0; x < x0 + Math.round(w * 0.16); x++) {
        const i = (y * w + x) * 4;
        r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
      }
    }
    return n ? [r / n, g / n, b / n] : [0, 0, 0];
  };
  const bgs = [corner(0, 0), corner(w - Math.round(w * 0.16), 0)];

  // Spread of the background itself, so a busy background raises the bar
  // rather than turning every pixel into foreground.
  let spread = 0;
  let sn = 0;
  for (let y = 0; y < Math.round(h * 0.14); y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let best = Infinity;
      for (const bg of bgs) {
        best = Math.min(best, Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]));
      }
      spread += best;
      sn++;
    }
  }
  const thresh = Math.max(34, (spread / Math.max(1, sn)) * 2.4);

  const fg = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    let best = Infinity;
    for (const bg of bgs) {
      best = Math.min(best, Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]));
    }
    fg[p] = best > thresh ? 1 : 0;
  }
  return { fg, w, h };
}

// Anchors for the NINE front points, as fractions of HEAD height. The original
// table was in FRAME fractions, which only lands correctly when the head happens
// to fill the frame from 16% to 86% and puts every point somewhere else
// otherwise. Insets — how far in from the silhouette edge a point sits — are in
// head heights too.
//
// The four back points are no longer here. They are not on the silhouette and
// they are not where an inset from it puts them; they come from the template
// below, through placeBackPoints().
const ANCHORS: Array<[SidePointId, number, number]> = [
  ["trichion", 0.0, 0.0],
  ["glabella", 0.20, 0.0],
  ["nasion", 0.31, 0.02],
  ["pronasale", 0.50, -0.01],
  ["subnasale", 0.58, 0.03],
  ["labialeSuperius", 0.65, 0.03],
  ["labialeInferius", 0.79, 0.03],
  ["pogonion", 0.94, 0.02],
  ["menton", 1.0, 0.05],
];

// No usable silhouette: lay the same anchors over a head box occupying the
// middle of the frame, facing right. Wrong in detail, but on the face.
function centredSeed(w: number, h: number): { points: SidePoints; faceDir: number } {
  const headH = h * 0.7;
  const top = h * 0.13;
  const edge = w * 0.66;
  const points = {} as SidePoints;
  for (const [id, f, inset] of ANCHORS) {
    points[id] = { x: edge - inset * headH, y: top + f * headH };
  }
  const frame = headFrame(points);
  if (frame) placeBackPoints(points, frame, headWidthFrom(headH * 0.7, frame.vlen));
  return { points, faceDir: 1 };
}

// ---------------------------------------------------------------------------
// Preferred path: real landmarks.
//
// The side capture now requires at least 55 degrees of detected yaw (or a
// detector loss after a clear turn), and MediaPipe can occasionally hold a
// face into that range. So
// a good proportion of side photographs still carry a full mesh, and when they
// do, tracing a silhouette against the background instead is throwing away the
// better measurement for the worse one.
//
// Every point below is a named landmark rather than a fraction of head height,
// so the seed lands on the anatomy instead of near it. The paired ones — ear,
// jaw corner — are chosen by depth: MediaPipe's z is smaller toward the camera,
// so the near side of the head is the one with the smaller z, which is the side
// actually visible in a profile.
// ---------------------------------------------------------------------------
function seedFromLandmarks(
  canvas: HTMLCanvasElement,
): { points: SidePoints; faceDir: number } | null {
  let lm;
  try {
    lm = detect(canvas)?.faceLandmarks?.[0];
  } catch {
    return null;
  }
  if (!lm || lm.length < 468) return null;

  // A true profile produces a narrow mesh, but its named visible-side points
  // still stay attached to the head. The old width cutoff threw that geometry
  // away precisely on true profiles and traced the room background instead;
  // busy walls then received landmark dots. Use the on-head mesh whenever it
  // exists and let the template/sanity pass replace individual weak points.

  const w = canvas.width;
  const h = canvas.height;
  const P = (i: number): Pt => ({ x: lm[i].x * w, y: lm[i].y * h });

  // Which way the face points. The centroid guess — nose tip versus the mesh's
  // own centre — flips on exactly the photographs this screen exists for: on a
  // hard profile MediaPipe hallucinates the far side of the face, and those
  // invented points can drag the centroid past the nose. That flip is what put
  // a tester's thirteen dots on the empty side of the frame, mirrored around
  // his face. The silhouette's facing comes from actual shape (nose
  // protrusion, edge character) and does not have that failure, so when a
  // usable mask exists its verdict wins and the centroid is only the fallback
  // for photographs with no traceable outline.
  let cx = 0;
  for (const p of lm) cx += p.x / lm.length;
  const centroidDir = lm[1].x >= cx ? 1 : -1;
  const faceDir = silhouetteGeometry(canvas)?.faceDir ?? centroidDir;

  // Near side of the head, by depth.
  const near = (a: number, b: number) => ((lm[a].z ?? 0) <= (lm[b].z ?? 0) ? a : b);
  const tragionId = near(234, 454);
  const gonionId = near(172, 397);
  const condylionId = near(127, 356);

  const menton = P(152);

  const points: SidePoints = {
    trichion: P(10),
    glabella: P(9),
    nasion: P(168),
    pronasale: P(1),
    subnasale: P(2),
    labialeSuperius: P(0),
    labialeInferius: P(17),
    pogonion: P(175),
    menton,
    // Overwritten immediately below. Kept in the literal so the object is a
    // complete SidePoints and a missed point would be a type error, not a
    // silent undefined that only shows up as a NaN in a jaw angle.
    gonion: P(gonionId),
    condylion: P(condylionId),
    cervicale: menton,
    tragion: P(tragionId),
  };

  // Head width from the oval point rather than the anatomy it is near. The mesh
  // lands 234/454 at a consistent fraction of the way from the nose tip to the
  // true ear canal — measured on a hand-corrected profile — and that fraction is
  // a ratio of two depths, so it survives the yaw compression that scales both
  // distances together. Everything behind the face is then placed from the
  // template, in the head's own axes.
  const f = headFrame(points);
  if (f) {
    const uOval = Math.abs(alongU(f, points.tragion.x, points.tragion.y) - f.uNose);
    placeBackPoints(points, f, headWidthFrom(uOval / OVAL_DEPTH_FRACTION, f.vlen));
  }
  return { points, faceDir };
}

// Where MediaPipe's widest face-oval landmark sits between the nose tip and the
// ear canal, along the head's facing axis. Measured on set F: 0.607.
const OVAL_DEPTH_FRACTION = 0.607;

// ---------------------------------------------------------------------------
// The shape template, and the sanity pass that uses it.
//
// Measured, not invented: these are the mean positions across hand-corrected
// profiles (tools note in docs/SIDE_FIXTURES.md), expressed in a frame the
// seeder can always rebuild — fx runs from the nose tip (0) toward the back of
// the head in head-widths, fy from the hairline (0) to the chin (1) in head
// heights.
//
// Refitted from sets E and F, the two collected AFTER the .vpoint offset bug was
// fixed. The four earlier sets carried a documented rightward bias of 0.13-0.20
// head-widths and are no longer part of the fit. E and F agree closely enough to
// trust across two quite different poses — gonion at -0.898 and -0.896
// head-widths, condylion fy at 0.364 and 0.377 — and they disagree with the old
// numbers in exactly the direction the bias predicts.
//
// What this is FOR is the failure that keeps happening. Both seed paths can put
// a single point somewhere absurd — a mesh landmark drifting onto the cheek, a
// silhouette trace catching a door frame — and the two real examples were a lip
// point 2.27 head-widths behind the ear and a neck point off the bottom of the
// picture. A lone dot at the frame edge is easy to miss in the verifier, and it
// then feeds a real measurement.
//
// So after seeding, the template is fitted to the points that agree with each
// other and any point that disagrees violently is moved to where the template
// says it belongs. The fit is Theil-Sen (median of pairwise slopes) precisely
// because the thing being defended against is outliers: a least-squares fit
// would be dragged by the very point it is meant to catch.
// ---------------------------------------------------------------------------
// The frame is the HEAD's own axes, not the image's. fu runs from the nose tip
// (0) straight back to the ear canal (-1); fv runs from the hairline (0) down
// the face axis, with the chin bottom just under 1. Both are perpendicular to
// each other and both rotate with the head.
//
// That last part is the fix. The first version of this table was in image x and
// y, which silently assumes the head is upright, and the moment someone shot a
// profile lying back the ear and jaw corner rotated out from under it — the ear
// came out a fifth of a head-width wrong on a photo where every front point was
// right. In the head's own axes the same three fixtures agree three to four
// times more closely: the ear's vertical spread across them falls from 0.164 to
// 0.037.
// Exported so the reference diagram can be DRAWN from it rather than drawn by
// hand. Three hand-authored attempts at this head all came out subtly wrong —
// too narrow, wrong ear depth, a bite out of the skull — because a head is
// mostly proportions and those are exactly what eyeballing gets wrong. These
// numbers are measured from real profiles and are the same ones the seeder
// places points with, so a diagram built from them cannot disagree with the
// thing it is teaching.
export const TEMPLATE: Record<SidePointId, [number, number]> = {
  trichion: [-0.159, 0.0],
  glabella: [-0.111, 0.194],
  nasion: [-0.136, 0.292],
  pronasale: [0.0, 0.508],
  subnasale: [-0.101, 0.575],
  labialeSuperius: [-0.062, 0.651],
  labialeInferius: [-0.096, 0.789],
  pogonion: [-0.159, 0.942],
  menton: [-0.305, 0.988],
  gonion: [-0.940, 0.810],
  // CORRECTED from the fitted 0.297, which put this 26mm ABOVE the ear notch —
  // up on the temple rather than on the jaw.
  //
  // The fixtures really did measure 0.297, and they were placed by a person
  // reading the label. The label said "Jaw top", and the top of the visible jaw
  // region is the temple, so that is where it went. It has since been renamed
  // to "Jaw hinge" for exactly this reason.
  //
  // Why the fitted number loses to anatomy here: the condyle is the knuckle the
  // jaw pivots on, and it sits immediately in front of the ear canal at about
  // the canal's own height. It cannot be 26mm up the side of the skull, because
  // there is no jaw there. Held against tragion at 0.435, this sits 3mm above
  // and 0.073 head-widths (~1cm) forward, which is where the joint is.
  //
  // What it was costing: ramus : mandible is condylion->gonion over
  // gonion->menton, so a condylion 26mm too high lengthens the top arm and
  // nothing else. This template — our own average head — scored 1.034 against a
  // plausible bound of 0.35-0.95, meaning the Confirm guard rejected the
  // reference profile the seeder is built from, and therefore very nearly every
  // real face put through it. At the corrected height the same template scores
  // 0.79, inside one sd of the 0.72 norm. sideTemplate.test.ts now holds this.
  condylion: [-0.927, 0.420],
  cervicale: [-0.678, 0.969],
  tragion: [-1.0, 0.435],
};

function silhouetteGeometry(canvas: HTMLCanvasElement): SilhouetteGeometry | null {
  const m = foregroundMask(canvas);
  const at = (x: number, y: number) => m.fg[y * m.w + x] === 1;
  const rowSpan = (y: number): [number, number] | null => {
    let a = -1;
    let b = -1;
    for (let x = 0; x < m.w; x++) if (at(x, y)) { a = x; break; }
    for (let x = m.w - 1; x >= 0; x--) if (at(x, y)) { b = x; break; }
    return a < 0 || b < a ? null : [a, b];
  };

  let top = -1;
  for (let y = 0; y < m.h; y++) {
    const span = rowSpan(y);
    if (span && span[1] - span[0] > m.w * 0.06) { top = y; break; }
  }
  if (top < 0) return null;

  let narrow = Infinity;
  let chin = m.h - 1;
  for (let y = top; y < m.h; y++) {
    const span = rowSpan(y);
    if (!span) continue;
    const width = span[1] - span[0];
    if (y < top + (m.h - top) * 0.55) narrow = Math.min(narrow, width);
    else if (width > narrow * 1.5) { chin = y; break; }
  }
  const headH = chin - top;
  if (!(headH > m.h * 0.15)) return null;

  const wander = (side: "l" | "r"): number => {
    let prev = -1;
    let sum = 0;
    let n = 0;
    for (let y = top + Math.round(headH * 0.25); y < top + Math.round(headH * 0.95); y++) {
      const span = rowSpan(y);
      if (!span) continue;
      const edge = side === "l" ? span[0] : span[1];
      if (prev >= 0) { sum += Math.abs(edge - prev); n++; }
      prev = edge;
    }
    return n ? sum / n : 0;
  };
  const wanderLeft = wander("l");
  const wanderRight = wander("r");

  // Second facing vote: protrusion. In the nose band — roughly 40-60% of head
  // height — one edge sticks out past that side's own typical position, and it
  // is the side the face points. This survives the case that breaks wander:
  // hair, a hood edge, or a busy background making the BACK edge the jagged
  // one. Each side is compared to its own median so a head that simply sits
  // off-centre in frame does not vote.
  const edges = { l: [] as number[], r: [] as number[] };
  for (let y = top; y < chin; y++) {
    const span = rowSpan(y);
    if (!span) continue;
    edges.l.push(span[0]);
    edges.r.push(span[1]);
  }
  const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
  const mL = median(edges.l);
  const mR = median(edges.r);
  let protrusion = 0; // >0 face points right, <0 left
  for (let y = top + Math.round(headH * 0.38); y < top + Math.round(headH * 0.62); y++) {
    const span = rowSpan(y);
    if (!span) continue;
    protrusion += Math.max(0, span[1] - mR) - Math.max(0, mL - span[0]);
  }
  // The protrusion vote wins when it is decisive — a clear nose is the least
  // ambiguous shape a profile has. Wander is the tiebreak for soft cases.
  const faceDir = Math.abs(protrusion) > headH * 0.5
    ? (protrusion > 0 ? 1 : -1)
    : (wanderRight >= wanderLeft ? 1 : -1);

  return {
    mask: m,
    top,
    chin,
    headH,
    faceDir,
    rowSpan,
    wanderLeft,
    wanderRight,
  };
}

// When a true profile makes the frontal face detector disappear, validate the
// actual silhouette instead of treating detector failure as proof of a good
// profile. This is conservative by design: a busy background can make the
// answer inconclusive, in which case the guided camera is the safe fallback.
export function assessSideSilhouette(canvas: HTMLCanvasElement): SideSilhouetteCheck {
  const g = silhouetteGeometry(canvas);
  if (!g) {
    return { usable: false, reason: "no-head", headHeightFrac: 0, headWidthFrac: 0, nasalRelief: 0 };
  }
  const { mask: m, top, chin, headH, faceDir, rowSpan, wanderLeft, wanderRight } = g;
  const edgeAt = (f: number): number | null => {
    const span = rowSpan(Math.max(0, Math.min(m.h - 1, Math.round(top + headH * f))));
    return span ? (faceDir === 1 ? span[1] : span[0]) : null;
  };
  let x0 = m.w;
  let x1 = 0;
  for (let y = top; y <= chin; y++) {
    const span = rowSpan(y);
    if (!span) continue;
    x0 = Math.min(x0, span[0]);
    x1 = Math.max(x1, span[1]);
  }
  const headHeightFrac = headH / m.h;
  const headWidthFrac = Math.max(0, x1 - x0) / m.w;
  const nose = edgeAt(0.5);
  const bridge = edgeAt(0.33);
  const upperLip = edgeAt(0.66);
  const nasalRelief = nose == null || bridge == null || upperLip == null
    ? 0
    : faceDir * (nose - (bridge + upperLip) / 2) / Math.max(1, headH);
  const cropped = top <= m.h * 0.02 || chin >= m.h * 0.985 || x0 <= 0 || x1 >= m.w - 1;
  const asymmetric = Math.max(wanderLeft, wanderRight) >= Math.max(0.45, Math.min(wanderLeft, wanderRight) * 1.18);
  const profileLike = nasalRelief >= 0.035 && asymmetric;
  const reason: SideSilhouetteCheck["reason"] = cropped
    ? "cropped"
    : headHeightFrac < 0.38 || headWidthFrac < 0.2
      ? "too-small"
      : profileLike
        ? null
        : "not-profile";
  return { usable: reason === null, reason, headHeightFrac, headWidthFrac, nasalRelief: +nasalRelief.toFixed(4) };
}

// Where pogonion sits on the head axis. The axis is defined by it, so this is
// what converts the measured trichion-to-pogonion length back into a full
// hairline-to-chin head height.
const POGONION_V = TEMPLATE.pogonion[1];

interface HeadFrame {
  ox: number; oy: number; // origin: the hairline
  ux: number; uy: number; // unit vector, pointing the way the face looks
  vx: number; vy: number; // unit vector, hairline down to chin
  uNose: number; // the nose tip's u coordinate, which is where fu = 0
  vlen: number; // hairline to chin bottom, in pixels, along the axis
}

// The head's own axes, built from three points the detector places well.
//
// The axis runs trichion → POGONION rather than trichion → menton, which is the
// obvious choice and the wrong one: menton is the point that projects forward
// under yaw, it is one of the points being corrected here, and using it would
// tilt the whole frame by the size of the error being fixed. Pogonion is a
// midline point the mesh lands within 0.03 head-widths of.
function headFrame(p: SidePoints): HeadFrame | null {
  const dx = p.pogonion.x - p.trichion.x;
  const dy = p.pogonion.y - p.trichion.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 1)) return null;
  const vx = dx / len;
  const vy = dy / len;
  // Perpendicular, flipped if it came out pointing away from the nose, so the
  // caller never has to hand in a facing direction and cannot get its sign
  // wrong. That sign has been wrong here before.
  let ux = vy;
  let uy = -vx;
  const uNose = (p.pronasale.x - p.trichion.x) * ux + (p.pronasale.y - p.trichion.y) * uy;
  if (uNose < 0) {
    ux = -ux;
    uy = -uy;
  }
  return {
    ox: p.trichion.x, oy: p.trichion.y,
    ux, uy, vx, vy,
    uNose: Math.abs(uNose),
    vlen: len / POGONION_V,
  };
}

// A point's coordinate along the facing axis, measured from the hairline.
function alongU(f: HeadFrame, x: number, y: number): number {
  return (x - f.ox) * f.ux + (y - f.oy) * f.uy;
}

// ---------------------------------------------------------------------------
// The four points behind the face, plus menton's x.
//
// Neither seed path can find these by looking. The mesh has landmarks near them
// and they are the WRONG landmarks: 234/454 is the widest point of the face
// oval, which sits on the sideburn at about eye level, not in the ear canal, and
// 127/356 is higher still on the temple. Measured against a hand-corrected set
// the seeded ear came out 0.34 head-widths too far forward and 0.25 head-heights
// too high, every time, and the jaw and neck followed it. The silhouette path
// has the opposite problem: the ear and the jaw corner are not ON the outline at
// all, so an inset from the edge was only ever a guess.
//
// Wrong in a fixed direction is the useful kind of wrong. These five sit at
// stable places in the head's own frame — the two clean fixtures put gonion at
// -0.898 and -0.896 head-widths — so they are placed from the template instead
// of measured, and the user drags any that miss.
//
// menton is in the list because the chin's lowest point projects forward under
// yaw — it was 0.15 head-widths ahead of where it belongs — and because the head
// axis is taken from pogonion, so replacing menton outright cannot feed back
// into the frame that placed it.
// ---------------------------------------------------------------------------
const BACK_POINTS: SidePointId[] = ["menton", "gonion", "condylion", "cervicale", "tragion"];

function placeBackPoints(points: SidePoints, f: HeadFrame, headW: number): void {
  for (const id of BACK_POINTS) {
    const u = f.uNose + TEMPLATE[id][0] * headW;
    const v = TEMPLATE[id][1] * f.vlen;
    points[id] = {
      x: f.ox + f.ux * u + f.vx * v,
      y: f.oy + f.uy * u + f.vy * v,
    };
  }
}

// Head width — nose tip back to ear canal — from a rough estimate of it. Both
// callers have something that scales with head width and neither has the width
// itself, and both estimators can degenerate: a near-frontal mesh puts the oval
// point almost on top of the nose, and a silhouette trace can catch a wall.
//
// This used to CLAMP to [0.3, 1.1] x head height, described as deliberately
// wide bounds that catch a broken measurement without arguing with a real face.
// The first half was true and the second half was the bug. 0.3 is not a wide
// bound, it is a head that does not exist — nothing has a nose-to-ear depth
// three tenths of its hairline-to-chin height — so a degenerate estimate was
// not caught by the floor, it was RESHAPED into a confidently wrong head and
// passed on as a measurement.
//
// It surfaces on ramus : mandible, because the template places gonion and
// menton 0.635 head-widths apart along the facing axis and condylion almost
// directly above gonion. Squash the width and the mandibular body shortens
// while the ramus does not, so the ratio climbs: 0.79 at a real head, 1.07 at
// half width, 1.50 at the old floor. That is what refused three correctly
// placed profiles in a row, each time naming the points the operator had put in
// exactly the right places.
//
// So an estimate outside the range real heads occupy is now DISCARDED for the
// population figure rather than dragged to an edge. Falling back says "this
// could not be measured, use the average"; clamping says "this measured 0.3",
// which is a claim about a face rather than about a failed estimator. Every
// point placed from it is one the review screen asks the operator to check
// anyway, so a sane average is the right thing to hand them.
const HEAD_DEPTH_OVER_HEIGHT = 0.73; // ~13.5cm nose-to-ear over ~18.5cm hairline-to-chin
const HEAD_DEPTH_MIN = 0.62;
const HEAD_DEPTH_MAX = 0.88;

// Exported so the range it can produce can be asserted directly. The bug this
// replaces was invisible to a test that scored one head, because the fault was
// not in that head — it was in how far from it the seeder was allowed to wander.
export function headWidthFrom(estimate: number, headH: number): number {
  const ratio = estimate / headH;
  if (!Number.isFinite(ratio) || ratio < HEAD_DEPTH_MIN || ratio > HEAD_DEPTH_MAX) {
    return headH * HEAD_DEPTH_OVER_HEIGHT;
  }
  return estimate;
}

function median(a: number[]): number {
  const b = [...a].sort((x, y) => x - y);
  const n = b.length;
  return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2;
}

// Robust 1-D fit of coord = origin + scale * feature.
function theilSen(pairs: Array<[number, number]>): { scale: number; origin: number } | null {
  const slopes: number[] = [];
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const df = pairs[i][0] - pairs[j][0];
      // Points too close together on this axis turn a small coordinate error
      // into a huge slope, so they do not get a vote.
      if (Math.abs(df) < 0.12) continue;
      slopes.push((pairs[i][1] - pairs[j][1]) / df);
    }
  }
  if (slopes.length < 4) return null;
  const scale = median(slopes);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  return { scale, origin: median(pairs.map(([f, c]) => c - scale * f)) };
}

// How far a point may sit from its fitted position before it is treated as a
// mis-seed. Deliberately loose: real faces differ, and this is here to catch
// points that are wrong by a head, not points that are wrong by a nostril.
const MAX_DX = 0.5; // head-widths
const MAX_DY = 0.25; // head-heights

function sanitizeSeed(
  seed: { points: SidePoints; faceDir: number },
  w: number,
  h: number,
): { points: SidePoints; faceDir: number } {
  const { points, faceDir } = seed;
  const ids = SIDE_POINTS.map((s) => s.id);
  const fitY = theilSen(ids.map((id) => [TEMPLATE[id][1], points[id].y]));
  const fitX = theilSen(ids.map((id) => [faceDir * TEMPLATE[id][0], points[id].x]));
  if (!fitY || !fitX) return seed;

  const out = { ...points } as SidePoints;
  for (const id of ids) {
    const ex = fitX.origin + fitX.scale * faceDir * TEMPLATE[id][0];
    const ey = fitY.origin + fitY.scale * TEMPLATE[id][1];
    const offFrame =
      points[id].x < 0 || points[id].x > w || points[id].y < 0 || points[id].y > h;
    if (
      offFrame ||
      Math.abs(points[id].x - ex) > fitX.scale * MAX_DX ||
      Math.abs(points[id].y - ey) > fitY.scale * MAX_DY
    ) {
      out[id] = {
        x: Math.max(2, Math.min(w - 2, ex)),
        y: Math.max(2, Math.min(h - 2, ey)),
      };
    }
  }
  return { points: out, faceDir };
}

// Every seeded point must end up grabbable, unconditionally.
//
// sanitizeSeed is ALLOWED to decline: its robust fit needs points that agree
// with each other, and a misread facing hands it a negative slope, which it
// rightly refuses to fit rather than mirror the template onto. But its clamp
// was inside that fit, so declining also meant not clamping — and the photo
// frame is overflow: hidden, so a point seeded past the border was drawn
// nowhere and could not be touched. The operator could see Confirm name the
// point as "outside the photo" and had no way to reach it; the only exit was
// retaking a perfectly good picture.
//
// The margin keeps the whole ring inside the frame rather than just its
// centre — a handle bisected by the border is half a tap target. This bounds
// only where a point STARTS; dragging can still place one wherever the
// operator says it belongs, right up to the edge.
export function keepSeedReachable(points: SidePoints, w: number, h: number): SidePoints {
  const mx = Math.max(10, w * 0.02);
  const my = Math.max(10, h * 0.02);
  const out = {} as SidePoints;
  for (const id of Object.keys(points) as SidePointId[]) {
    out[id] = {
      x: Math.min(w - mx, Math.max(mx, points[id].x)),
      y: Math.min(h - my, Math.max(my, points[id].y)),
    };
  }
  return out;
}

// Entry point. Real landmarks when the detector can still see the face, the
// silhouette trace when it cannot — and either way, the template pass above
// catches any single point that came back somewhere impossible.
export function seedSidePoints(
  canvas: HTMLCanvasElement,
): SideSeed {
  // Both paths, then the better one — rather than "mesh if it returned
  // anything". A mesh that latched onto a doorway and a silhouette that traced
  // a bright wall both return a full, confident-looking set of thirteen points,
  // and the only difference visible from here is whether those points are on a
  // head. So ask that question directly instead of trusting the source.
  const mesh = seedFromLandmarks(canvas);
  const silhouette = seedFromSilhouette(canvas);
  const meshScore = mesh ? onHeadFraction(mesh.points, canvas) : -1;
  const silhouetteScore = onHeadFraction(silhouette.points, canvas);

  // Ties go to the mesh: where both are equally plausible the mesh is measuring
  // named anatomy and the trace is measuring an outline.
  const useMesh = mesh !== null && meshScore >= silhouetteScore;
  const seed = useMesh ? mesh! : silhouette;
  const cleaned = sanitizeSeed(seed, canvas.width, canvas.height);
  return {
    points: keepSeedReachable(cleaned.points, canvas.width, canvas.height),
    faceDir: cleaned.faceDir,
    method: useMesh ? "mesh" : "silhouette",
    confidence: Math.max(0, useMesh ? meshScore : silhouetteScore),
  };
}

// How much of a seed actually sits on the person.
//
// The failure this exists for is the one in the screenshots: thirteen points in
// a tidy vertical line down the empty left of the frame, a body-length away
// from the face. Every individual point looked reasonable, the set looked
// deliberate, and not one of them was on the head.
//
// Scored against the foreground mask rather than against the face, because the
// mask is the one thing available on a true profile — where MediaPipe's mesh is
// least trustworthy and the template is doing most of the work. Returns 0 when
// there is no usable mask, which makes it a tie-breaker that abstains rather
// than one that guesses.
export function onHeadFraction(points: SidePoints, canvas: HTMLCanvasElement): number {
  const g = silhouetteGeometry(canvas);
  if (!g) return 0;
  const ids = Object.keys(points) as SidePointId[];
  let on = 0;
  for (const id of ids) {
    const p = points[id];
    const span = g.rowSpan(Math.round(p.y));
    // A small tolerance either side: several of the thirteen are meant to sit
    // just off the traced edge — the ear canal is inside the head, the neck
    // point is on its boundary — so demanding a strict interior hit would
    // punish a correct seed.
    const pad = canvas.width * 0.02;
    if (span && p.x >= span[0] - pad && p.x <= span[1] + pad) on++;
  }
  return on / ids.length;
}

// Fallback: trace the profile edge against the background, then place points at
// anatomically-proportional heights along it. Rough by design — the user drags
// them into place.
export function seedFromSilhouette(
  canvas: HTMLCanvasElement,
): { points: SidePoints; faceDir: number } {
  const w = canvas.width;
  const h = canvas.height;
  const g = silhouetteGeometry(canvas);
  if (!g) return centredSeed(w, h);
  const { mask: m, top, headH, faceDir, rowSpan } = g;

  // The background model assumes the top corners of the frame ARE background,
  // which holds for a portrait and fails for a tight crop where those corners
  // are hair. The tell is that the "head" then swallows the frame. There is no
  // way to trace an edge that is off-picture, so rather than return a confident
  // wrong answer, fall back to a plain centred head box: still only a starting
  // point for dragging, but one that is on the face instead of on the wall.
  if (top <= m.h * 0.02 && headH >= m.h * 0.85) {
    return centredSeed(w, h);
  }

  // Profile edge at a given fraction of head height, in source pixels.
  const edgeAt = (f: number): number => {
    const y = Math.max(0, Math.min(m.h - 1, Math.round(top + headH * f)));
    const sp = rowSpan(y);
    if (!sp) return (faceDir === 1 ? 0.7 : 0.3) * w;
    return ((faceDir === 1 ? sp[1] : sp[0]) / m.w) * w;
  };

  const headPx = (headH / m.h) * h;
  const points = {} as SidePoints;
  for (const [id, f, inset] of ANCHORS) {
    points[id] = {
      x: edgeAt(f) - faceDir * inset * headPx,
      y: (top / m.h) * h + f * headPx,
    };
  }

  // The back of the skull is the one thing here that scales with head DEPTH, and
  // unlike the ear it really is on the outline. Taken as the furthest the
  // silhouette reaches away from the face across the cranial band — below the
  // crown, above the neck — so a shoulder or a collar cannot claim it.
  let back = faceDir === 1 ? m.w : 0;
  for (let y = top + Math.round(headH * 0.15); y < top + Math.round(headH * 0.75); y++) {
    const sp = rowSpan(y);
    if (!sp) continue;
    back = faceDir === 1 ? Math.min(back, sp[0]) : Math.max(back, sp[1]);
  }
  const backX = (back / m.w) * w;
  const frame = headFrame(points);
  if (frame) {
    // This path lays its points out on image axes, so the frame it produces is
    // upright and the horizontal distance to the back of the skull IS the depth.
    placeBackPoints(
      points,
      frame,
      headWidthFrom(Math.abs(points.pronasale.x - backX) * EAR_OVER_SKULL_DEPTH, frame.vlen),
    );
  }
  return { points, faceDir };
}

// Nose tip to ear canal, over nose tip to back of skull. Unlike
// OVAL_DEPTH_FRACTION this one is not measured off a fixture — it comes from
// published head depths (nose-to-tragion around 14cm against a nose-to-occiput
// around 22cm) and is rounded down because hair adds to the back of the head and
// nothing adds to the front. It only runs on the fallback path, which exists to
// put the points somewhere sane for dragging rather than to be right.
const EAR_OVER_SKULL_DEPTH = 0.6;

export function mountVerifier(
  host: HTMLElement,
  photo: HTMLCanvasElement,
  seed: { points: SidePoints; faceDir: number },
  onChange: (p: SidePoints) => void,
): VerifyHandle {
  const points = cloneSidePoints(seed.points);
  host.innerHTML = "";
  host.classList.add("verify-layer");

  const labelEl = document.createElement("div");
  labelEl.className = "verify-hint";
  host.appendChild(labelEl);

  const magnifier = document.createElement("div");
  magnifier.className = "verify-magnifier";
  magnifier.setAttribute("aria-hidden", "true");
  const magnifierCanvas = document.createElement("canvas");
  magnifierCanvas.width = 180;
  magnifierCanvas.height = 180;
  const magnifierLabel = document.createElement("span");
  magnifier.append(magnifierCanvas, magnifierLabel);
  host.appendChild(magnifier);

  const handles = new Map<SidePointId, HTMLElement>();
  for (const spec of SIDE_POINTS) {
    const el = document.createElement("button");
    el.className = "vpoint";
    el.type = "button";
    el.dataset.id = spec.id;
    el.setAttribute("aria-label", spec.label);
    el.innerHTML = `<i></i><span>${spec.label}</span>`;
    host.appendChild(el);
    handles.set(spec.id, el);
  }

  const place = () => {
    for (const [id, el] of handles) {
      el.style.left = `${(points[id].x / photo.width) * 100}%`;
      el.style.top = `${(points[id].y / photo.height) * 100}%`;
    }
  };
  place();

  // Ground truth, exportable.
  //
  // The automatic placement has now failed three times on real photographs and
  // been "fixed" three times against synthetic tests that could not see the
  // failure. What is missing is not another idea, it is a set of profiles with
  // the thirteen points KNOWN to be in the right place, to test against.
  //
  // Nobody should have to hand over photographs to produce that, and reading
  // coordinates off a screenshot is worth about two percent of the frame. So
  // the verifier can emit what it currently holds: drag the points until they
  // are right, press this, and what lands on the clipboard is numbers. The
  // photograph stays where it is. Normalised 0..1 so the fixture survives a
  // re-crop or a different capture size.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("dev")) {
    const dump = document.createElement("button");
    dump.type = "button";
    dump.className = "vdump";
    dump.textContent = "Copy points";
    dump.onclick = () => {
      const out: Record<string, [number, number]> = {};
      for (const spec of SIDE_POINTS) {
        out[spec.id] = [
          +(points[spec.id].x / photo.width).toFixed(4),
          +(points[spec.id].y / photo.height).toFixed(4),
        ];
      }
      const json = JSON.stringify(out, null, 1);
      void navigator.clipboard?.writeText(json).then(
        () => { dump.textContent = "Copied"; setTimeout(() => (dump.textContent = "Copy points"), 1400); },
        () => { dump.textContent = "Copy unavailable"; },
      );
    };
    host.appendChild(dump);
  }

  let editable = false;
  let dragging: SidePointId | null = null;
  let guided: { index: number; onStep: (index: number, total: number) => void; onFinish: () => void } | null = null;
  const toPhoto = (clientX: number, clientY: number): Pt => {
    const r = host.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * photo.width,
      y: ((clientY - r.top) / r.height) * photo.height,
    };
  };

  // The visual state of a walkthrough: every ring but the current one fades and
  // stops taking pointer events, so a tap lands on the PHOTO and places the
  // current point instead of accidentally grabbing a neighbour.
  const paintGuided = () => {
    host.classList.toggle("is-guided", Boolean(guided));
    for (const [id, handle] of handles) {
      handle.classList.toggle("gdim", Boolean(guided) && SIDE_POINTS[guided!.index].id !== id);
      handle.classList.toggle("gfocus", Boolean(guided) && SIDE_POINTS[guided!.index].id === id);
    }
    if (guided) {
      const spec = SIDE_POINTS[guided.index];
      labelEl.textContent = `${spec.label} — ${spec.hint}`;
      labelEl.classList.add("show");
    } else {
      labelEl.classList.remove("show");
    }
  };

  const paintMagnifier = (id: SidePointId) => {
    const r = host.getBoundingClientRect();
    const point = points[id];
    const ctx = magnifierCanvas.getContext("2d")!;
    const displayPatch = Math.max(34, Math.min(54, r.width * 0.12));
    const sourceSize = displayPatch * (photo.width / Math.max(1, r.width));
    // The patch is centred on the POINT, unconditionally. It used to be clamped
    // to stay inside the photo, which broke the lens exactly where it is needed
    // most: canonicalisation turns every profile to face image-right, so on a
    // tight crop the nose and lips sit near the frame edge — there the clamped
    // patch stopped following the point, and the crosshair, fixed at the lens
    // centre, showed a pixel up to half a patch away from where the dot really
    // was. Off-photo area now just renders as the lens background instead.
    const sx = point.x - sourceSize / 2;
    const sy = point.y - sourceSize / 2;
    ctx.clearRect(0, 0, 180, 180);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    // Clipped by hand rather than handing drawImage an out-of-bounds source
    // rect, whose handling is the kind of thing engines have disagreed on.
    const cx0 = Math.max(0, sx);
    const cy0 = Math.max(0, sy);
    const cx1 = Math.min(photo.width, sx + sourceSize);
    const cy1 = Math.min(photo.height, sy + sourceSize);
    if (cx1 > cx0 && cy1 > cy0) {
      const k = 180 / sourceSize;
      ctx.drawImage(
        photo,
        cx0, cy0, cx1 - cx0, cy1 - cy0,
        (cx0 - sx) * k, (cy0 - sy) * k, (cx1 - cx0) * k, (cy1 - cy0) * k,
      );
    }
    ctx.strokeStyle = "rgba(143, 243, 224, 0.98)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(90, 72); ctx.lineTo(90, 108);
    ctx.moveTo(72, 90); ctx.lineTo(108, 90);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(90, 90, 7, 0, Math.PI * 2);
    ctx.stroke();
    magnifierLabel.textContent = SIDE_POINTS.find((s) => s.id === id)?.label ?? "Landmark";
    // Put the lens opposite the selected point so the finger and lens do not
    // hide the same part of the profile.
    magnifier.classList.toggle("at-left", point.x > photo.width / 2);
    magnifier.classList.toggle("at-right", point.x <= photo.width / 2);
  };

  const down = (e: PointerEvent) => {
    if (!editable) return;
    const target = (e.target as HTMLElement).closest<HTMLElement>(".vpoint");
    if (guided) {
      // Tap-to-place. The whole point of the walkthrough is that nobody has to
      // catch a mis-seeded dot: wherever the finger lands IS the new position
      // of the current point, and holding drags it from there with the lens up.
      // A tap that starts on the current ring itself keeps its position and
      // just begins a drag, so a nudge is still a nudge.
      const id = SIDE_POINTS[guided.index].id;
      dragging = id;
      if (!target || target.dataset.id !== id) {
        const p = toPhoto(e.clientX, e.clientY);
        points[id] = {
          x: Math.max(0, Math.min(photo.width, p.x)),
          y: Math.max(0, Math.min(photo.height, p.y)),
        };
        place();
        onChange(points);
      }
      handles.get(id)?.classList.add("grabbing");
      paintMagnifier(id);
      magnifier.classList.add("show");
      host.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (!target) return;
    dragging = target.dataset.id as SidePointId;
    target.classList.add("grabbing");
    labelEl.textContent = SIDE_POINTS.find((s) => s.id === dragging)?.hint ?? "";
    labelEl.classList.add("show");
    paintMagnifier(dragging);
    magnifier.classList.add("show");
    host.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    const p = toPhoto(e.clientX, e.clientY);
    points[dragging] = {
      x: Math.max(0, Math.min(photo.width, p.x)),
      y: Math.max(0, Math.min(photo.height, p.y)),
    };
    place();
    paintMagnifier(dragging);
    onChange(points);
  };
  const up = () => {
    if (!dragging) return;
    handles.get(dragging)?.classList.remove("grabbing");
    dragging = null;
    labelEl.classList.remove("show");
    magnifier.classList.remove("show");
    // In a walkthrough the step's name stays on screen between touches — it is
    // the instruction, not a drag tooltip.
    if (guided) paintGuided();
  };

  // Long-pressing a landmark is the drag gesture. Chrome on Android reads the
  // same press as "select this image" and raises its Search/Translate/Save
  // sheet directly over the point being moved; the CSS above suppresses the
  // selection, and this suppresses the menu for the cases where a browser
  // raises it anyway (a stylus, a right-click on desktop, or a long press that
  // lands on the frame rather than the canvas).
  const blockMenu = (e: Event) => e.preventDefault();

  host.addEventListener("pointerdown", down);
  host.addEventListener("pointermove", move);
  host.addEventListener("pointerup", up);
  host.addEventListener("pointercancel", up);
  host.addEventListener("contextmenu", blockMenu);

  const setEditable = (next: boolean) => {
    editable = next;
    host.classList.toggle("is-editing", next);
    for (const handle of handles.values()) {
      handle.classList.toggle("locked", !next);
      handle.setAttribute("aria-disabled", next ? "false" : "true");
      handle.tabIndex = next ? 0 : -1;
    }
    if (!next) up();
  };
  setEditable(false);

  return {
    points,
    faceDir: seed.faceDir,
    setEditable,
    reset(next) {
      const copy = cloneSidePoints(next);
      for (const { id } of SIDE_POINTS) points[id] = copy[id];
      place();
      onChange(points);
    },
    startGuided(onStep, onFinish) {
      guided = { index: 0, onStep, onFinish };
      paintGuided();
      onStep(0, SIDE_POINTS.length);
    },
    guidedNext() {
      if (!guided) return;
      if (guided.index >= SIDE_POINTS.length - 1) {
        const finish = guided.onFinish;
        guided = null;
        paintGuided();
        finish();
        return;
      }
      guided.index += 1;
      paintGuided();
      guided.onStep(guided.index, SIDE_POINTS.length);
    },
    guidedBack() {
      if (!guided || guided.index === 0) return;
      guided.index -= 1;
      paintGuided();
      guided.onStep(guided.index, SIDE_POINTS.length);
    },
    guidedCurrent() {
      const spec = SIDE_POINTS[guided?.index ?? 0];
      return { label: spec.label, hint: spec.hint };
    },
    endGuided() {
      guided = null;
      paintGuided();
    },
    destroy() {
      host.removeEventListener("contextmenu", blockMenu);
      host.removeEventListener("pointerdown", down);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerup", up);
      host.removeEventListener("pointercancel", up);
      host.innerHTML = "";
      host.classList.remove("verify-layer");
    },
  };
}
