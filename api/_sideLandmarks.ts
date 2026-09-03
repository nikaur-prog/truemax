import type Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";

// ---------------------------------------------------------------------------
// The vision pass that places the thirteen side-profile points.
//
// The on-device seeder places the eight points on the face outline from the
// face mesh and infers the five behind the face (chin bottom, neck point, jaw
// corner, jaw hinge, ear notch) from the silhouette and a population template.
// Those five drift, and on every real profile the owner has put through it at
// least one of them has been wrong. This module asks a vision model to place
// all thirteen from the photograph instead, and hands the answer to the same
// plausibility check and the same review screen the seeder feeds. The
// person's confirm or correction is the label; the model's answer is only the
// seed.
//
// vision-1 asked for fractions of an unlabelled image and lost: the model
// read the outline well but stretched every y by a constant and could not
// find the ear (docs/SIDE_LANDMARKS_AI_FIRST.md, section 2a). vision-2 is the
// answer to both findings:
//
//   1. The image goes up with a labelled pixel grid drawn on it and the
//      prompt states its width and height. The model answers in whole pixels
//      it can read off the grid, not in a fraction of a frame it has to
//      imagine. This is what removes the constant stretch.
//   2. The ear cluster (ear notch, jaw hinge, jaw corner) and the chin
//      cluster (chin front, chin bottom, neck point) each get a second pass
//      on an enlarged crop around where the first pass put them, with its
//      own grid. A landmark that is a dozen pixels wide in the full frame is
//      a hundred wide in the crop.
//
// vision-3 answers what vision-2 left (section 2b of the doc): the ear pair
// was scatter at the limit of a 1.4x crop, and the jaw corner and chin
// bottom were the model naming a different point. So:
//
//   3. Two zoom stages instead of one. A coarse crop of 0.8 head widths finds
//      the cluster; a fine crop of 0.35 to 0.5 head widths, five times the
//      frame's resolution with a 50 px grid, places it. The fine call also
//      sees the coarse crop with the fine window outlined, so a close crop
//      of an ear cannot be mistaken for a close crop of a lobe.
//   4. When the client sends the device seed, the whole-frame pass is
//      skipped: the front eight come from the mesh, and the crops are cut
//      around the seed's clusters. One fewer call, and the front is exact.
//   5. The jaw corner is CONSTRUCTED, as a cephalometric tracing does it:
//      the model marks two points on the jaw outline it reads well, and the
//      corner is where the lower-border line meets the back-edge line. The
//      model's own corner is kept only when it agrees with the construction.
//   6. The chin bottom is defined as the chin's own curve, never the
//      underside of the jaw or the neck, and a placement below the neck
//      point is refused and asked again with the placement drawn.
//
// Two rules the endpoint and the evaluation harness both go through here, so
// production and the benchmark cannot drift apart:
//
//   - The result is returned as fractions of the photograph, whatever size
//     it was sent at, so the caller converts to its own frame.
//   - Nothing is inferred beyond position. No age, no sex, no ethnicity, no
//     attractiveness: the tool schema has no field for any of them, so the
//     model has nowhere to put an opinion.
//
// The version stamp travels with every result. A feedback row that records
// which pass placed the seed can then be split by version when the prompt or
// the passes change, which is what makes the calibration loop's numbers
// comparable across weeks.
// ---------------------------------------------------------------------------

export const SIDE_LANDMARK_IDS = [
  "trichion",
  "glabella",
  "nasion",
  "pronasale",
  "subnasale",
  "labialeSuperius",
  "labialeInferius",
  "pogonion",
  "menton",
  "cervicale",
  "gonion",
  "condylion",
  "tragion",
] as const;

export type SideLandmarkId = (typeof SIDE_LANDMARK_IDS)[number];

/** The five the seeder infers rather than sees. The harness reports them on their own. */
export const BACK_LANDMARK_IDS: readonly SideLandmarkId[] = ["menton", "cervicale", "gonion", "condylion", "tragion"];

/** The two clusters that get an enlarged second look. */
export const ZOOM_CLUSTERS: ReadonlyArray<{ name: "ear" | "chin"; ids: readonly SideLandmarkId[] }> = [
  { name: "ear", ids: ["tragion", "condylion", "gonion"] },
  { name: "chin", ids: ["pogonion", "menton", "cervicale"] },
];

// Bumped whenever the prompt, the schema, the passes or the default model
// change. Stored beside every seed the pass produces so later analysis can
// tell them apart.
export const LANDMARK_VERSION = "vision-3";

// Same margin call as Coach Max: the mid-size model, overridable from the
// environment so a week on the larger one can be measured rather than argued.
export const LANDMARK_MODEL_DEFAULT = "claude-sonnet-5";

// A side photo at phone resolution, JPEG. The client already downsizes the
// capture before the seeder runs; two megabytes is generous.
export const MAX_LANDMARK_IMAGE_BYTES = 2_000_000;

// Passes an account may spend in a UTC day. Two scans a week is the allowance;
// twelve leaves room for retakes and guest scans without making the endpoint
// a free image API. One "pass" is one photograph, however many model calls
// it takes.
export const LANDMARK_PASSES_PER_DAY = 12;

// The longest side the provider keeps before downsizing anyway; sending more
// only costs upload time. The grid is drawn at this size, so the model reads
// the same pixels the label names.
export const LANDMARK_MAX_SIDE = 1568;
// A crop is enlarged to this before its grid goes on.
export const LANDMARK_ZOOM_SIDE = 1024;
// Grid pitch in pixels of the image the model sees; the fine crops use half.
export const LANDMARK_GRID_STEP = 100;
export const LANDMARK_FINE_GRID_STEP = 50;
// Crop sizes in head widths (nose tip to ear notch), per stage.
export const ZOOM_SIZES = {
  coarse: 0.8,
  fineEar: 0.35,
  fineJaw: 0.45,
  fineChin: 0.5,
} as const;
/** The extra outline points the jaw-corner construction asks for. */
export const JAW_OUTLINE_IDS = ["jawLower", "jawBack"] as const;
export type JawOutlineId = (typeof JAW_OUTLINE_IDS)[number];
/** Any id a tool call may return: a landmark, or one of the construction points. */
export type PlacedId = SideLandmarkId | JawOutlineId;
// Decoding guard, same figure as the carousel slide.
const MAX_INPUT_PIXELS = 40_000_000;

export type LandmarkMediaType = "image/jpeg" | "image/png" | "image/webp";

export interface LandmarkPoint {
  x: number;
  y: number;
}

export interface SideLandmarkResult {
  /** Fractions of image width and height, origin top-left. */
  points: Record<SideLandmarkId, LandmarkPoint>;
  /** 0 to 1 per point, the model's own estimate. */
  confidence: Record<SideLandmarkId, number>;
  /** +1 when the subject faces image-right, -1 when image-left. Derived from the points. */
  faceDir: 1 | -1;
}

// The anatomy, written for a reader who has never seen the app. The labels
// match SIDE_POINTS in src/engine/sideMetrics.ts so a correction made in the
// walkthrough and a placement made here mean the same thing.
const DEFINITIONS: Record<SideLandmarkId, string> = {
  trichion: "Hairline: the point on the forehead's profile line where the hair begins. If a fringe covers the forehead, the point where hair meets skin on the profile edge.",
  glabella: "Brow ridge: the most forward point of the forehead between the brows, on the profile edge.",
  nasion: "Nose bridge: the deepest point of the dip between the brow ridge and the nose, on the profile edge.",
  pronasale: "Nose tip: the most forward point of the nose.",
  subnasale: "Nose base: where the underside of the nose meets the upper lip, on the profile edge.",
  labialeSuperius: "Upper lip: the most forward point of the upper lip's vermilion.",
  labialeInferius: "Lower lip: the most forward point of the lower lip's vermilion.",
  pogonion: "Chin front: the most forward point of the soft-tissue chin.",
  menton: "Chin bottom: the lowest point of the chin itself, roughly straight below the chin front, on the chin's own curve before the underside turns back toward the neck. Not the lowest point of the underside of the jaw, and not on the neck.",
  cervicale: "Neck point: where the underside of the chin turns into the front of the neck, the deepest point of that angle.",
  gonion: "Jaw corner: the corner of the jaw's skin outline, where the lower border of the jaw, running back from the chin, turns upward into the back edge of the jaw. It sits below and in front of the ear lobe by at least a finger width, on the jaw outline, never on the ear.",
  condylion: "Jaw hinge: the joint the jaw pivots on, on the skin immediately in front of the ear canal and level with it. Not on the temple.",
  tragion: "Ear notch: the notch at the front of the ear, just above the tragus, at the opening of the ear canal.",
};

// What the enlarged crop shows and how the three points sit in it. Written
// so the model looks for the ear before it looks for the numbers.
const ZOOM_CONTEXT: Record<"ear" | "chin", string> = {
  ear:
    "This is an enlarged crop of the ear region of that photograph. The ear should be the largest feature in it. Find the ear first. " +
    "The ear notch (tragion) is the small notch on the FRONT edge of the ear, just above the tragus flap, at the opening of the ear canal. " +
    "The jaw hinge (condylion) is on the skin directly in front of that notch, about one finger-width toward the face and level with it. " +
    "The jaw corner (gonion) is below, where the lower border of the jaw turns the corner from running forward to running up toward the ear.",
  chin:
    "This is an enlarged crop of the chin and upper neck of that photograph. Find the underside of the chin first. " +
    "The chin front (pogonion) is the most forward point of the soft chin. The chin bottom (menton) is its lowest point. " +
    "The neck point (cervicale) is where the underside of the chin turns into the front of the neck, at the deepest point of that angle.",
};

const OUTLINE_DEFINITIONS: Record<JawOutlineId, string> = {
  jawLower: "A point on the lower border of the jaw's skin outline, forward of the corner toward the chin, as far forward as this crop shows.",
  jawBack: "A point on the back edge of the jaw's skin outline, above the corner toward the ear lobe, as far up as this crop shows but below the lobe.",
};

const FINE_CONTEXT: Record<"ear" | "jaw" | "chin", string> = {
  ear:
    "This is a close crop around the ear notch of that photograph; the first image shows the wider ear region with this crop outlined. " +
    "The tragus is the small flap of skin in front of the ear canal opening. The ear notch (tragion) is the notch on the FRONT edge of the ear just above that flap. " +
    "The jaw hinge (condylion) is on the cheek skin directly in front of the notch, about one finger-width toward the face, level with it.",
  jaw:
    "This is a close crop around the corner of the jaw below the ear; the first image shows the wider region with this crop outlined. " +
    "Follow the skin outline of the jaw: it runs back from the chin along the lower border, turns the corner, and rises up the back edge toward the ear lobe. " +
    "The corner is on that skin outline, below and in front of the ear lobe, never on the ear itself.",
  chin:
    "This is a close crop of the chin and the start of the neck; the first image shows the wider region with this crop outlined. " +
    "Follow the outline from the chin front down around the chin's own curve to its lowest point, then back along the underside to where it meets the neck.",
};

export interface GridFrame {
  width: number;
  height: number;
  step: number;
}

function gridSentence(frame: GridFrame): string {
  return (
    `The image is ${frame.width} pixels wide and ${frame.height} pixels high. A grid is drawn over it every ${frame.step} pixels: ` +
    "the number at the top of each vertical line is that line's x coordinate, and the number at the left of each horizontal line is its y coordinate. " +
    "Read positions off the grid and interpolate inside a cell. x is pixels from the left edge, y is pixels from the top edge. Answer in whole pixels."
  );
}

/** The prompt for the first pass, over the whole photograph. */
export function landmarkPrompt(frame: GridFrame): string {
  const lines = SIDE_LANDMARK_IDS.map((id) => `- ${id}: ${DEFINITIONS[id]}`);
  return [
    "This is a side-profile photograph of one person's head. Place the thirteen anatomical landmarks listed below and return them with the tool.",
    "",
    gridSentence(frame),
    "",
    "Look at the actual pixels; do not assume the head is upright or centred. The grid lines are drawn on top of the photograph and are not part of the face.",
    "",
    "Give each point a confidence between 0 and 1. A landmark hidden by hair, a hand or a collar still gets your best anatomical estimate, with a low confidence. Do not omit a point.",
    "",
    "Place only positions. Do not describe the person.",
    "",
    "Landmarks:",
    ...lines,
  ].join("\n");
}

function definitionOf(id: PlacedId): string {
  return (DEFINITIONS as Record<string, string>)[id] ?? OUTLINE_DEFINITIONS[id as JawOutlineId];
}

/** The prompt for a coarse second look at one cluster, on its enlarged crop. */
export function zoomPrompt(cluster: "ear" | "chin", ids: readonly PlacedId[], frame: GridFrame, faceDir: 1 | -1): string {
  const lines = ids.map((id) => `- ${id}: ${definitionOf(id)}`);
  return [
    `A side-profile photograph of one person's head was taken with the face pointing to the ${faceDir > 0 ? "right" : "left"} of the frame.`,
    ZOOM_CONTEXT[cluster],
    "",
    gridSentence(frame),
    "",
    "Give each point a confidence between 0 and 1. Do not omit a point. Place only positions. Do not describe the person.",
    "",
    "Landmarks:",
    ...lines,
  ].join("\n");
}

/** The tool for a given set of points in a frame of a given pixel size. */
/** The prompt for the fine look: a close crop, with the coarse crop shown first for context. */
export function finePrompt(region: "ear" | "jaw" | "chin", ids: readonly PlacedId[], frame: GridFrame, faceDir: 1 | -1, redo?: string): string {
  const lines = ids.map((id) => `- ${id}: ${definitionOf(id)}`);
  return [
    `A side-profile photograph of one person's head was taken with the face pointing to the ${faceDir > 0 ? "right" : "left"} of the frame.`,
    FINE_CONTEXT[region],
    "",
    `Read coordinates from the SECOND image only. ${gridSentence(frame)}`,
    ...(redo ? ["", redo] : []),
    "",
    "Give each point a confidence between 0 and 1. Do not omit a point. Place only positions. Do not describe the person.",
    "",
    "Points:",
    ...lines,
  ].join("\n");
}

export function landmarkTool(ids: readonly PlacedId[], frame: { width: number; height: number }): Anthropic.Messages.Tool {
  const pointSchema = {
    type: "object",
    properties: {
      x: { type: "number", minimum: 0, maximum: frame.width, description: "pixels from the left edge" },
      y: { type: "number", minimum: 0, maximum: frame.height, description: "pixels from the top edge" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["x", "y", "confidence"],
    additionalProperties: false,
  } as const;
  return {
    name: "place_side_landmarks",
    description: `Record side-profile landmarks as whole-pixel coordinates in a ${frame.width} by ${frame.height} pixel image.`,
    input_schema: {
      type: "object",
      properties: Object.fromEntries(ids.map((id) => [id, pointSchema])),
      required: [...ids],
      additionalProperties: false,
    },
  };
}

/** The full-pass tool, for callers that only want the schema. */
export const LANDMARK_TOOL: Anthropic.Messages.Tool = landmarkTool(SIDE_LANDMARK_IDS, { width: 1000, height: 1000 });

function finiteIn(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > max) return null;
  return value;
}

export interface PixelPlacement {
  x: number;
  y: number;
  confidence: number;
}

/**
 * Turn one tool call's input into pixel placements for the points asked for,
 * or throw with a reason a log can carry. Strict on purpose: a missing point
 * or one outside the image is a refusal, never a guess filled in here,
 * because the caller's fallback is the seeder and a half-answer would be
 * worse than either.
 */
export function parsePixelToolInput<Id extends string>(
  input: unknown,
  ids: readonly Id[],
  frame: { width: number; height: number },
): Partial<Record<Id, PixelPlacement>> {
  if (!input || typeof input !== "object") throw new Error("Landmark result is not an object");
  const raw = input as Record<string, unknown>;
  const out: Partial<Record<Id, PixelPlacement>> = {};
  for (const id of ids) {
    const entry = raw[id];
    if (!entry || typeof entry !== "object") throw new Error(`Landmark ${id} is missing`);
    const e = entry as Record<string, unknown>;
    const x = finiteIn(e.x, frame.width);
    const y = finiteIn(e.y, frame.height);
    if (x === null || y === null) throw new Error(`Landmark ${id} is outside the image`);
    out[id] = { x, y, confidence: finiteIn(e.confidence, 1) ?? 0.5 };
  }
  return out;
}

/**
 * Thirteen pixel placements in a frame, as the result: fractions plus the
 * facing. The nose is in front of the ear: that is what facing means. A
 * result where they sit on top of each other is not a profile, whatever the
 * model says it saw.
 */
export function resultFromPixels(
  placed: Record<SideLandmarkId, PixelPlacement>,
  frame: { width: number; height: number },
): SideLandmarkResult {
  const points = {} as Record<SideLandmarkId, LandmarkPoint>;
  const confidence = {} as Record<SideLandmarkId, number>;
  for (const id of SIDE_LANDMARK_IDS) {
    const p = placed[id];
    if (!p) throw new Error(`Landmark ${id} is missing`);
    points[id] = { x: p.x / frame.width, y: p.y / frame.height };
    confidence[id] = p.confidence;
  }
  const spread = points.pronasale.x - points.tragion.x;
  if (Math.abs(spread) < 0.05) throw new Error("Nose tip and ear notch are too close together to be a profile");
  return { points, confidence, faceDir: spread > 0 ? 1 : -1 };
}

/** One tool call over the whole frame, parsed into the result. */
export function parseLandmarkToolInput(input: unknown, frame: { width: number; height: number }): SideLandmarkResult {
  const placed = parsePixelToolInput(input, SIDE_LANDMARK_IDS, frame) as Record<SideLandmarkId, PixelPlacement>;
  return resultFromPixels(placed, frame);
}

/**
 * The device seed, sent by the client as fractions of the same photograph.
 * Optional and advisory: a hint is never returned as an answer, and a
 * malformed hint is dropped rather than failing the pass. Returns null unless
 * all thirteen points are present and inside the image.
 */
export function parseSeedHint(value: unknown): Record<SideLandmarkId, LandmarkPoint> | null {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const out = {} as Record<SideLandmarkId, LandmarkPoint>;
  for (const id of SIDE_LANDMARK_IDS) {
    const entry = raw[id];
    if (!entry || typeof entry !== "object") return null;
    const e = entry as Record<string, unknown>;
    const x = finiteIn(e.x, 1);
    const y = finiteIn(e.y, 1);
    if (x === null || y === null) return null;
    out[id] = { x, y };
  }
  return out;
}

/** The same result in pixels of a given frame, for callers that draw. */
export function landmarksToPixels(
  result: SideLandmarkResult,
  width: number,
  height: number,
): Record<SideLandmarkId, LandmarkPoint> {
  const out = {} as Record<SideLandmarkId, LandmarkPoint>;
  for (const id of SIDE_LANDMARK_IDS) {
    out[id] = { x: result.points[id].x * width, y: result.points[id].y * height };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Anchoring. The seeder's eight front points come from the face mesh and are
// right to within a few pixels. Fitting only the VERTICAL scale and offset of
// the model's answer onto them, and leaving x alone, removed most of
// vision-1's error (ear cluster 0.378 to 0.191 head widths, all points to
// 0.137). A similarity fit was worse, because the front points are close to
// a vertical line and pin the horizontal scale badly. Exported so the client
// can apply the same correction to a live pass with the seeder's points.
// ---------------------------------------------------------------------------

/**
 * Least-squares y' = a*y + b over the anchor ids, applied to every point.
 * Points and anchors must be in the same frame. Returns the input untouched
 * when fewer than two anchors are shared or the anchors have no vertical
 * spread.
 */
export function anchorVertical<T extends Partial<Record<SideLandmarkId, LandmarkPoint>>>(
  points: T,
  anchors: Partial<Record<SideLandmarkId, LandmarkPoint>>,
  anchorIds: readonly SideLandmarkId[] = SIDE_LANDMARK_IDS.filter((id) => !BACK_LANDMARK_IDS.includes(id)),
): T {
  const pairs: Array<[number, number]> = [];
  for (const id of anchorIds) {
    const p = points[id];
    const a = anchors[id];
    if (p && a) pairs.push([p.y, a.y]);
  }
  if (pairs.length < 2) return points;
  const n = pairs.length;
  const mp = pairs.reduce((t, [p]) => t + p, 0) / n;
  const ma = pairs.reduce((t, [, a]) => t + a, 0) / n;
  let num = 0;
  let den = 0;
  for (const [p, a] of pairs) {
    num += (p - mp) * (a - ma);
    den += (p - mp) ** 2;
  }
  if (!(den > 0)) return points;
  const scale = num / den;
  const offset = ma - scale * mp;
  const out = { ...points } as T;
  for (const id of Object.keys(points) as SideLandmarkId[]) {
    const p = points[id];
    if (p) (out as Partial<Record<SideLandmarkId, LandmarkPoint>>)[id] = { x: p.x, y: scale * p.y + offset };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Image preparation. Everything here is in memory; no file is written.
// ---------------------------------------------------------------------------

export interface PreparedImage {
  /** Upright, at most LANDMARK_MAX_SIDE on the long side, JPEG, no grid. */
  plain: Buffer;
  width: number;
  height: number;
}

/**
 * Upright the photograph from its EXIF tag and bring it to the size the
 * model will see. The grid is drawn later, per pass, on this buffer or on a
 * crop of it, so every coordinate the model reads is a pixel of this frame.
 */
export async function prepareLandmarkImage(bytes: Buffer, maxSide = LANDMARK_MAX_SIDE): Promise<PreparedImage> {
  const plain = await sharp(bytes, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toBuffer();
  const meta = await sharp(plain).metadata();
  if (!meta.width || !meta.height) throw new Error("The photograph could not be decoded");
  return { plain, width: meta.width, height: meta.height };
}

/**
 * The grid, as SVG the size of the frame. Thin lines in a colour skin never
 * has, labelled with their pixel coordinate along the top and left edges,
 * each label on a dark pill so it survives a bright background.
 */
export function gridOverlaySvg(frame: GridFrame): string {
  const { width, height, step } = frame;
  const font = Math.max(12, Math.round(Math.min(width, height) / 60));
  const parts: string[] = [];
  const label = (x: number, y: number, text: string) => {
    const w = Math.round(text.length * font * 0.62 + 6);
    parts.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${font + 4}" rx="2" fill="rgba(0,0,0,0.65)"/>` +
        `<text x="${x + 3}" y="${y + font}" font-family="Arial, Helvetica, sans-serif" font-size="${font}" font-weight="bold" fill="#33e0ff">${text}</text>`,
    );
  };
  for (let x = step; x < width; x += step) {
    parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="#33e0ff" stroke-opacity="0.55" stroke-width="1"/>`);
    label(x + 2, 2, String(x));
  }
  for (let y = step; y < height; y += step) {
    parts.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#33e0ff" stroke-opacity="0.55" stroke-width="1"/>`);
    label(2, y + 2, String(y));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;
}

/** The frame with the grid composited on, as base64 JPEG for the request. */
export async function withGrid(image: Buffer, frame: GridFrame): Promise<string> {
  const out = await sharp(image)
    .composite([{ input: Buffer.from(gridOverlaySvg(frame)), top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toBuffer();
  return out.toString("base64");
}

/** A rectangle outlined on a frame: the fine window drawn on the coarse crop. */
export function outlineOverlaySvg(frame: { width: number; height: number }, box: { left: number; top: number; size: number }): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}">` +
    `<rect x="${box.left}" y="${box.top}" width="${box.size}" height="${box.size}" fill="none" stroke="#ff3366" stroke-width="4"/>` +
    `</svg>`
  );
}

/** Labelled markers drawn on a frame: a placement shown back to the model. */
export function markerOverlaySvg(frame: { width: number; height: number }, marks: ReadonlyArray<{ x: number; y: number; label: string }>): string {
  const font = Math.max(14, Math.round(Math.min(frame.width, frame.height) / 50));
  const parts = marks.map((m) => {
    const w = Math.round(m.label.length * font * 0.62 + 8);
    return (
      `<circle cx="${m.x}" cy="${m.y}" r="9" fill="none" stroke="#ff3366" stroke-width="3"/>` +
      `<line x1="${m.x}" y1="${m.y}" x2="${m.x + 14}" y2="${m.y - 14}" stroke="#ff3366" stroke-width="2"/>` +
      `<rect x="${m.x + 14}" y="${m.y - 14 - font - 4}" width="${w}" height="${font + 4}" rx="2" fill="rgba(0,0,0,0.7)"/>` +
      `<text x="${m.x + 18}" y="${m.y - 18}" font-family="Arial, Helvetica, sans-serif" font-size="${font}" font-weight="bold" fill="#ff3366">${m.label}</text>`
    );
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}">${parts.join("")}</svg>`;
}

export interface ZoomWindow {
  left: number;
  top: number;
  size: number;
}

/**
 * The square of the full frame to enlarge for a cluster: the cluster's own
 * bounding box from the first pass, padded to at least `factor` head widths
 * so a first pass that was a whole ear out still has the ear inside the
 * crop. Shifted, not shrunk, to stay inside the image.
 */
export function zoomWindow(
  placed: Record<SideLandmarkId, PixelPlacement>,
  ids: readonly SideLandmarkId[],
  frame: { width: number; height: number },
  factor = 1.2,
): ZoomWindow {
  const unit = Math.hypot(placed.pronasale.x - placed.tragion.x, placed.pronasale.y - placed.tragion.y);
  const xs = ids.map((id) => placed[id].x);
  const ys = ids.map((id) => placed[id].y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  let size = Math.round(Math.max(span * 1.5, unit * factor, 64));
  size = Math.min(size, frame.width, frame.height);
  let left = Math.round(cx - size / 2);
  let top = Math.round(cy - size / 2);
  left = Math.max(0, Math.min(left, frame.width - size));
  top = Math.max(0, Math.min(top, frame.height - size));
  return { left, top, size };
}

/** A square of a given side, in frame pixels, centred on a point and kept inside the image. */
export function squareWindow(
  centre: { x: number; y: number },
  size: number,
  frame: { width: number; height: number },
): ZoomWindow {
  let s = Math.round(Math.max(64, size));
  s = Math.min(s, frame.width, frame.height);
  const left = Math.max(0, Math.min(Math.round(centre.x - s / 2), frame.width - s));
  const top = Math.max(0, Math.min(Math.round(centre.y - s / 2), frame.height - s));
  return { left, top, size: s };
}

/** A crop of the plain frame, enlarged to `side` pixels, with its own grid. */
export async function zoomCrop(
  image: Buffer,
  window: ZoomWindow,
  side = LANDMARK_ZOOM_SIDE,
  step = LANDMARK_GRID_STEP,
  overlay?: string,
): Promise<{ data: string; frame: GridFrame; scale: number; plain: Buffer }> {
  const scale = side / window.size;
  const plain = await sharp(image)
    .extract({ left: window.left, top: window.top, width: window.size, height: window.size })
    .resize({ width: side, height: side, kernel: "lanczos3" })
    .jpeg({ quality: 92 })
    .toBuffer();
  const frame = { width: side, height: side, step };
  const layers = [{ input: Buffer.from(gridOverlaySvg(frame)), top: 0, left: 0 }];
  if (overlay) layers.push({ input: Buffer.from(overlay), top: 0, left: 0 });
  const data = (await sharp(plain).composite(layers).jpeg({ quality: 92 }).toBuffer()).toString("base64");
  return { data, frame, scale, plain };
}

/** A crop drawn with an overlay and no grid: context for a fine call, or a placement shown back. */
export async function annotatedCrop(plainCrop: Buffer, overlay: string): Promise<string> {
  return (await sharp(plainCrop).composite([{ input: Buffer.from(overlay), top: 0, left: 0 }]).jpeg({ quality: 88 }).toBuffer()).toString("base64");
}

/** A point of the full frame, in the pixels of an enlarged crop. */
export function toZoom(p: { x: number; y: number }, window: ZoomWindow, scale: number): { x: number; y: number } {
  return { x: (p.x - window.left) * scale, y: (p.y - window.top) * scale };
}

// ---------------------------------------------------------------------------
// The constructed jaw corner. Orthodontic tracings do not read gonion off the
// skin by eye: they draw the mandibular-plane tangent (here menton through a
// point on the lower border) and the ramus tangent (here condylion through a
// point on the back edge) and take the intersection. The model reads
// outline points far better than it names the corner, so it supplies the
// two tangent points and the corner is arithmetic.
// ---------------------------------------------------------------------------

function intersect(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
): { x: number; y: number } | null {
  const d = (a1.x - a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x - b2.x);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((a1.x - b1.x) * (b1.y - b2.y) - (a1.y - b1.y) * (b1.x - b2.x)) / d;
  return { x: a1.x + t * (a2.x - a1.x), y: a1.y + t * (a2.y - a1.y) };
}

export interface ConstructedGonion {
  point: PixelPlacement;
  /** How the final point was chosen. */
  method: "construction" | "snapped" | "guess";
  /** Distance between the construction and the model's own corner, in head widths. */
  disagreement: number | null;
}

/**
 * The jaw corner from the two tangents, checked against the rest of the
 * jaw. The construction is taken whenever it is a corner a jaw can have:
 * the tangents meet at a real angle, the point sits below the hinge, no
 * lower than a little under the chin bottom, and between the hinge and the
 * chin horizontally. Otherwise (a very round jaw, a tangent point the model
 * put somewhere odd) the model's own corner is kept and marked doubtful.
 * The model's guess never vetoes a sound construction: the guess is the
 * thing that was systematically wrong.
 */
export function constructGonion(
  guess: PixelPlacement,
  menton: { x: number; y: number },
  jawLower: { x: number; y: number },
  condylion: { x: number; y: number },
  jawBack: { x: number; y: number },
  unit: number,
): ConstructedGonion {
  const built = intersect(menton, jawLower, condylion, jawBack);
  if (!built || !(unit > 0)) return { point: guess, method: "guess", disagreement: null };
  const disagreement = Math.hypot(built.x - guess.x, built.y - guess.y) / unit;
  // The angle between the two tangents.
  const a = Math.atan2(jawLower.y - menton.y, jawLower.x - menton.x);
  const b = Math.atan2(jawBack.y - condylion.y, jawBack.x - condylion.x);
  let angle = Math.abs(a - b) % Math.PI;
  if (angle > Math.PI / 2) angle = Math.PI - angle;
  const sound =
    angle >= (35 * Math.PI) / 180 &&
    built.y > condylion.y + 0.1 * unit &&
    built.y <= menton.y + 0.15 * unit &&
    built.x >= Math.min(condylion.x, menton.x) - 0.15 * unit &&
    built.x <= Math.max(condylion.x, menton.x) + 0.15 * unit;
  if (!sound) return { point: { ...guess, confidence: Math.min(guess.confidence, 0.3) }, method: "guess", disagreement };
  const confidence = disagreement <= 0.05 ? Math.max(guess.confidence, 0.8) : 0.6;
  return { point: { x: built.x, y: built.y, confidence }, method: disagreement <= 0.05 ? "snapped" : "construction", disagreement };
}

/**
 * A chin bottom that is not on the chin: below the neck point, or behind the
 * midpoint of chin front and neck point. Either means the model marked the
 * underside of the jaw or the neck, and the fine call is asked again with
 * its placement drawn.
 */
export function mentonLooksWrong(
  menton: { x: number; y: number },
  pogonion: { x: number; y: number },
  cervicale: { x: number; y: number },
  faceDir: 1 | -1,
): boolean {
  if (menton.y > cervicale.y) return true;
  const midX = (pogonion.x + cervicale.x) / 2;
  return faceDir > 0 ? menton.x < midX : menton.x > midX;
}

/** A placement read in an enlarged crop, back in the full frame. */
export function fromZoom(p: PixelPlacement, window: ZoomWindow, scale: number): PixelPlacement {
  return { x: window.left + p.x / scale, y: window.top + p.y / scale, confidence: p.confidence };
}

// ---------------------------------------------------------------------------
// The pass.
// ---------------------------------------------------------------------------

export interface LandmarkPassUsage {
  inputTokens: number;
  outputTokens: number;
}

export type StageName = "first" | "coarse" | "fine";

export interface LandmarkPass {
  result: SideLandmarkResult;
  model: string;
  version: string;
  usage: LandmarkPassUsage;
  /** Model calls made. */
  calls: number;
  /** The points whose final position came from an enlarged look. */
  zoomed: SideLandmarkId[];
  /** Wall-clock milliseconds for the whole pass, image preparation excluded. */
  ms: number;
  /** Where the back points stood after each stage, as fractions, so the harness can score each. */
  stages: Partial<Record<StageName, Partial<Record<SideLandmarkId, LandmarkPoint>>>>;
  /** How the jaw corner was settled, and how far the construction sat from the model's guess. */
  gonion: ConstructedGonion["method"] | null;
  gonionDisagreement: number | null;
  /** Whether the chin bottom had to be asked again. */
  mentonRetried: boolean;
  /** Whether the front eight came from the device seed rather than a model call. */
  seeded: boolean;
}

interface ImageBlock {
  data: string;
}

async function callTool(
  client: Anthropic,
  model: string,
  images: ImageBlock[],
  prompt: string,
  tool: Anthropic.Messages.Tool,
): Promise<{ input: unknown; usage: LandmarkPassUsage }> {
  const content: Anthropic.Messages.ContentBlockParam[] = [];
  images.forEach((image, i) => {
    if (images.length > 1) content.push({ type: "text", text: `Image ${i + 1}:` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: image.data } });
  });
  content.push({ type: "text", text: prompt });
  const response = await client.messages.create({
    model,
    max_tokens: 900,
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name },
    messages: [{ role: "user", content }],
  });
  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("The model returned no landmark tool call");
  return {
    input: block.input,
    usage: { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 },
  };
}

export interface PlaceOptions {
  model?: string;
  /** False runs the whole-frame pass only. */
  zoom?: boolean;
  /** The device seed as fractions, when the client sent one. Advisory; see parseSeedHint. */
  hint?: Record<SideLandmarkId, LandmarkPoint> | null;
  /** Cut the crops around the hint and skip the whole-frame pass. Needs a hint. Default true. */
  seeded?: boolean;
  onZoomError?: (stage: string, error: unknown) => void;
}

const EAR_IDS: readonly SideLandmarkId[] = ["tragion", "condylion", "gonion"];
const CHIN_IDS: readonly SideLandmarkId[] = ["pogonion", "menton", "cervicale"];

function centroid(placed: Record<string, { x: number; y: number }>, ids: readonly string[]): { x: number; y: number } {
  const n = ids.length;
  return {
    x: ids.reduce((t, id) => t + placed[id].x, 0) / n,
    y: ids.reduce((t, id) => t + placed[id].y, 0) / n,
  };
}

function snapshot(placed: Record<SideLandmarkId, PixelPlacement>, ids: readonly SideLandmarkId[], frame: { width: number; height: number }) {
  const out: Partial<Record<SideLandmarkId, LandmarkPoint>> = {};
  for (const id of ids) out[id] = { x: placed[id].x / frame.width, y: placed[id].y / frame.height };
  return out;
}

/**
 * One photograph, up to six model calls in three rounds. The photograph
 * goes to the provider as part of these requests and nowhere else: this
 * function keeps no copy, writes no file and logs no bytes.
 *
 *   first   the whole frame with its grid, all thirteen points; skipped
 *           when the device seed is given, which then supplies the front
 *           eight and the facing
 *   coarse  the ear region and the chin region, 0.8 head widths each, in
 *           parallel
 *   fine    the ear notch pair, the jaw corner with its two tangent points,
 *           and the chin, in parallel, each on a close crop with the coarse
 *           crop shown first for context
 *
 * A crop pass that fails leaves the previous stage's placement for its
 * points; it never fails the photograph.
 */
export async function placeSideLandmarks(
  client: Anthropic,
  image: PreparedImage,
  options: PlaceOptions = {},
): Promise<LandmarkPass> {
  const model = options.model || process.env.SIDE_LANDMARK_MODEL || LANDMARK_MODEL_DEFAULT;
  const zoom = options.zoom ?? true;
  const frame: GridFrame = { width: image.width, height: image.height, step: LANDMARK_GRID_STEP };
  const usage: LandmarkPassUsage = { inputTokens: 0, outputTokens: 0 };
  const stages: LandmarkPass["stages"] = {};
  let calls = 0;
  const started = Date.now();
  const spend = (u: LandmarkPassUsage) => {
    calls += 1;
    usage.inputTokens += u.inputTokens;
    usage.outputTokens += u.outputTokens;
  };

  // ---- first: the whole frame, or the seed.
  const seeded = !!options.hint && (options.seeded ?? true) && zoom;
  let placed: Record<SideLandmarkId, PixelPlacement>;
  if (seeded) {
    placed = {} as Record<SideLandmarkId, PixelPlacement>;
    for (const id of SIDE_LANDMARK_IDS) {
      placed[id] = { x: options.hint![id].x * frame.width, y: options.hint![id].y * frame.height, confidence: 0.5 };
    }
  } else {
    const first = await callTool(client, model, [{ data: await withGrid(image.plain, frame) }], landmarkPrompt(frame), landmarkTool(SIDE_LANDMARK_IDS, frame));
    spend(first.usage);
    placed = parsePixelToolInput(first.input, SIDE_LANDMARK_IDS, frame) as Record<SideLandmarkId, PixelPlacement>;
    stages.first = snapshot(placed, SIDE_LANDMARK_IDS, frame);
  }
  // Facing and the profile check before any crop is cut from these points.
  const faceDir = resultFromPixels(placed, frame).faceDir;
  const unit = Math.hypot(placed.pronasale.x - placed.tragion.x, placed.pronasale.y - placed.tragion.y);

  const zoomed: SideLandmarkId[] = [];
  let gonion: ConstructedGonion["method"] | null = null;
  let gonionDisagreement: number | null = null;
  let mentonRetried = false;

  if (zoom) {
    // ---- coarse: the two clusters, in parallel.
    const coarseWindows = {
      ear: squareWindow(centroid(placed, EAR_IDS), unit * ZOOM_SIZES.coarse, frame),
      chin: squareWindow(centroid(placed, CHIN_IDS), unit * ZOOM_SIZES.coarse, frame),
    };
    const coarseCrops: Partial<Record<"ear" | "chin", Awaited<ReturnType<typeof zoomCrop>>>> = {};
    await Promise.all(
      (["ear", "chin"] as const).map(async (cluster) => {
        const ids = cluster === "ear" ? EAR_IDS : CHIN_IDS;
        try {
          const window = coarseWindows[cluster];
          const crop = await zoomCrop(image.plain, window);
          coarseCrops[cluster] = crop;
          const answer = await callTool(client, model, [{ data: crop.data }], zoomPrompt(cluster, ids, crop.frame, faceDir), landmarkTool(ids, crop.frame));
          spend(answer.usage);
          const read = parsePixelToolInput(answer.input, ids, crop.frame);
          for (const id of ids) {
            placed[id] = fromZoom(read[id]!, window, crop.scale);
            if (!zoomed.includes(id)) zoomed.push(id);
          }
        } catch (error) {
          options.onZoomError?.(`coarse ${cluster}`, error);
        }
      }),
    );
    stages.coarse = snapshot(placed, [...EAR_IDS, ...CHIN_IDS], frame);

    // ---- fine: three close crops, in parallel, each with its coarse crop for context.
    const fineWindows = {
      ear: squareWindow(centroid(placed, ["tragion", "condylion"]), unit * ZOOM_SIZES.fineEar, frame),
      jaw: squareWindow(placed.gonion, unit * ZOOM_SIZES.fineJaw, frame),
      chin: squareWindow(centroid(placed, CHIN_IDS), unit * ZOOM_SIZES.fineChin, frame),
    };
    const contextFor = async (region: "ear" | "jaw" | "chin"): Promise<ImageBlock | null> => {
      const coarse = coarseCrops[region === "chin" ? "chin" : "ear"];
      if (!coarse) return null;
      const cw = coarseWindows[region === "chin" ? "chin" : "ear"];
      const box = toZoom({ x: fineWindows[region].left, y: fineWindows[region].top }, cw, coarse.scale);
      const size = fineWindows[region].size * coarse.scale;
      return { data: await annotatedCrop(coarse.plain, outlineOverlaySvg(coarse.frame, { left: box.x, top: box.y, size })) };
    };
    const fineCall = async <Id extends PlacedId>(
      region: "ear" | "jaw" | "chin",
      ids: readonly Id[],
      redo?: { marks: ReadonlyArray<{ x: number; y: number; label: string }>; instruction: string },
    ): Promise<Partial<Record<Id, PixelPlacement>>> => {
      const window = fineWindows[region];
      const crop = await zoomCrop(
        image.plain,
        window,
        LANDMARK_ZOOM_SIDE,
        LANDMARK_FINE_GRID_STEP,
        redo ? markerOverlaySvg({ width: LANDMARK_ZOOM_SIDE, height: LANDMARK_ZOOM_SIDE }, redo.marks.map((m) => ({ ...toZoom(m, window, LANDMARK_ZOOM_SIDE / window.size), label: m.label }))) : undefined,
      );
      const context = await contextFor(region);
      const images = context ? [context, { data: crop.data }] : [{ data: crop.data }];
      const answer = await callTool(client, model, images, finePrompt(region, ids, crop.frame, faceDir, redo?.instruction), landmarkTool(ids, crop.frame));
      spend(answer.usage);
      const read = parsePixelToolInput(answer.input, ids, crop.frame);
      const out: Partial<Record<Id, PixelPlacement>> = {};
      for (const id of ids) out[id] = fromZoom(read[id]!, window, crop.scale);
      return out;
    };

    let jawRead: Partial<Record<"gonion" | JawOutlineId, PixelPlacement>> | null = null;
    await Promise.all([
      (async () => {
        try {
          const read = await fineCall("ear", ["tragion", "condylion"] as const);
          placed.tragion = read.tragion!;
          placed.condylion = read.condylion!;
        } catch (error) {
          options.onZoomError?.("fine ear", error);
        }
      })(),
      (async () => {
        try {
          jawRead = await fineCall("jaw", ["gonion", ...JAW_OUTLINE_IDS] as const);
        } catch (error) {
          options.onZoomError?.("fine jaw", error);
        }
      })(),
      (async () => {
        try {
          let read = await fineCall("chin", CHIN_IDS);
          if (mentonLooksWrong(read.menton!, read.pogonion!, read.cervicale!, faceDir)) {
            mentonRetried = true;
            read = await fineCall("chin", CHIN_IDS, {
              marks: [
                { ...read.pogonion!, label: "chin front" },
                { ...read.menton!, label: "chin bottom?" },
                { ...read.cervicale!, label: "neck point" },
              ],
              instruction:
                "The markers show a previous placement. The chin bottom marked there is not on the chin: it is below the neck point or behind the chin's curve. " +
                "Place the chin bottom on the chin's own curve, above and forward of the neck point, and place the other two afresh.",
            });
          }
          for (const id of CHIN_IDS) placed[id] = read[id]!;
        } catch (error) {
          options.onZoomError?.("fine chin", error);
        }
      })(),
    ]);
    if (jawRead) {
      const jr = jawRead as Partial<Record<"gonion" | JawOutlineId, PixelPlacement>>;
      const built = constructGonion(jr.gonion!, placed.menton, jr.jawLower!, placed.condylion, jr.jawBack!, unit);
      placed.gonion = built.point;
      gonion = built.method;
      gonionDisagreement = built.disagreement;
    }
    stages.fine = snapshot(placed, [...EAR_IDS, ...CHIN_IDS], frame);
  }

  return {
    result: resultFromPixels(placed, frame),
    model,
    version: LANDMARK_VERSION,
    usage,
    calls,
    zoomed,
    ms: Date.now() - started,
    stages,
    gonion,
    gonionDisagreement,
    mentonRetried,
    seeded,
  };
}
