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
export const LANDMARK_VERSION = "vision-2";

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
// Grid pitch in pixels of the image the model sees.
export const LANDMARK_GRID_STEP = 100;
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
  menton: "Chin bottom: the lowest point of the chin's underside.",
  cervicale: "Neck point: where the underside of the chin turns into the front of the neck, the deepest point of that angle.",
  gonion: "Jaw corner: the point on the skin over the angle of the mandible, where the lower border of the jaw turns upward into the vertical ramus.",
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

/** The prompt for a second look at one cluster, on its enlarged crop. */
export function zoomPrompt(cluster: "ear" | "chin", ids: readonly SideLandmarkId[], frame: GridFrame, faceDir: 1 | -1): string {
  const lines = ids.map((id) => `- ${id}: ${DEFINITIONS[id]}`);
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
export function landmarkTool(ids: readonly SideLandmarkId[], frame: { width: number; height: number }): Anthropic.Messages.Tool {
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
export function parsePixelToolInput(
  input: unknown,
  ids: readonly SideLandmarkId[],
  frame: { width: number; height: number },
): Partial<Record<SideLandmarkId, PixelPlacement>> {
  if (!input || typeof input !== "object") throw new Error("Landmark result is not an object");
  const raw = input as Record<string, unknown>;
  const out: Partial<Record<SideLandmarkId, PixelPlacement>> = {};
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

/** A crop of the plain frame, enlarged to `side` pixels, with its own grid. */
export async function zoomCrop(
  image: Buffer,
  window: ZoomWindow,
  side = LANDMARK_ZOOM_SIDE,
): Promise<{ data: string; frame: GridFrame; scale: number }> {
  const scale = side / window.size;
  const crop = await sharp(image)
    .extract({ left: window.left, top: window.top, width: window.size, height: window.size })
    .resize({ width: side, height: side, kernel: "lanczos3" })
    .jpeg({ quality: 92 })
    .toBuffer();
  const frame = { width: side, height: side, step: LANDMARK_GRID_STEP };
  return { data: await withGrid(crop, frame), frame, scale };
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

export interface LandmarkPass {
  result: SideLandmarkResult;
  model: string;
  version: string;
  usage: LandmarkPassUsage;
  /** Model calls made: one for the frame plus one per cluster that zoomed. */
  calls: number;
  /** The points whose final position came from an enlarged second look. */
  zoomed: SideLandmarkId[];
  /** Wall-clock milliseconds for the whole pass, image preparation excluded. */
  ms: number;
}

async function callTool(
  client: Anthropic,
  model: string,
  data: string,
  prompt: string,
  tool: Anthropic.Messages.Tool,
): Promise<{ input: unknown; usage: LandmarkPassUsage }> {
  const response = await client.messages.create({
    model,
    max_tokens: 900,
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data } },
          { type: "text", text: prompt },
        ],
      },
    ],
  });
  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("The model returned no landmark tool call");
  return {
    input: block.input,
    usage: { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 },
  };
}

/**
 * One photograph, one to three model calls. The photograph goes to the
 * provider as part of these requests and nowhere else: this function keeps
 * no copy, writes no file and logs no bytes.
 *
 * A zoom pass that fails, or that answers with a point outside its crop,
 * leaves the first pass's placement for that cluster in place; it never
 * fails the photograph.
 */
export interface PlaceOptions {
  model?: string;
  zoom?: boolean;
  /** The device seed as fractions, when the client sent one. Advisory; see parseSeedHint. */
  hint?: Record<SideLandmarkId, LandmarkPoint> | null;
  onZoomError?: (cluster: string, error: unknown) => void;
}

export async function placeSideLandmarks(
  client: Anthropic,
  image: PreparedImage,
  options: PlaceOptions = {},
): Promise<LandmarkPass> {
  const model = options.model || process.env.SIDE_LANDMARK_MODEL || LANDMARK_MODEL_DEFAULT;
  const zoom = options.zoom ?? true;
  const frame: GridFrame = { width: image.width, height: image.height, step: LANDMARK_GRID_STEP };
  const usage: LandmarkPassUsage = { inputTokens: 0, outputTokens: 0 };
  let calls = 0;
  const started = Date.now();

  const first = await callTool(client, model, await withGrid(image.plain, frame), landmarkPrompt(frame), landmarkTool(SIDE_LANDMARK_IDS, frame));
  calls += 1;
  usage.inputTokens += first.usage.inputTokens;
  usage.outputTokens += first.usage.outputTokens;
  const placed = parsePixelToolInput(first.input, SIDE_LANDMARK_IDS, frame) as Record<SideLandmarkId, PixelPlacement>;
  // Facing and the profile check on the first pass, before any crop is cut
  // from its points.
  const faceDir = resultFromPixels(placed, frame).faceDir;

  const zoomed: SideLandmarkId[] = [];
  if (zoom) {
    // The two crops depend only on the first pass, so they go to the model
    // together: the client waits a few seconds, not a few seconds per cluster.
    // Each cluster's window is cut from the first pass's points before either
    // result lands, so the parallel writes touch disjoint ids.
    const windows = ZOOM_CLUSTERS.map((cluster) => zoomWindow(placed, cluster.ids, frame));
    await Promise.all(
      ZOOM_CLUSTERS.map(async (cluster, i) => {
        try {
          const window = windows[i];
          const crop = await zoomCrop(image.plain, window);
          const second = await callTool(
            client,
            model,
            crop.data,
            zoomPrompt(cluster.name, cluster.ids, crop.frame, faceDir),
            landmarkTool(cluster.ids, crop.frame),
          );
          calls += 1;
          usage.inputTokens += second.usage.inputTokens;
          usage.outputTokens += second.usage.outputTokens;
          const read = parsePixelToolInput(second.input, cluster.ids, crop.frame);
          for (const id of cluster.ids) {
            placed[id] = fromZoom(read[id]!, window, crop.scale);
            zoomed.push(id);
          }
        } catch (error) {
          options.onZoomError?.(cluster.name, error);
        }
      }),
    );
  }

  return { result: resultFromPixels(placed, frame), model, version: LANDMARK_VERSION, usage, calls, zoomed, ms: Date.now() - started };
}
