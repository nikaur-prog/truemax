import type Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// The vision pass that places the thirteen side-profile points.
//
// The on-device seeder places the eight points on the face outline from the
// face mesh and infers the five behind the face (chin bottom, neck point, jaw
// corner, jaw hinge, ear notch) from the silhouette and a population template.
// Those five drift, and on every real profile the owner has put through it at
// least one of them has been wrong. This module asks a vision model to place
// all thirteen from the photograph instead, as the FIRST pass, and hands the
// answer to the same plausibility check and the same review screen the seeder
// feeds. The person's confirm or correction is the label; the model's answer
// is only the seed.
//
// Two rules the endpoint and the evaluation harness both go through here, so
// production and the benchmark cannot drift apart:
//
//   1. Coordinates come back as fractions of the image width and height. The
//      model is never told a pixel size, so a resized copy and the original
//      give the same answer, and the caller converts to pixels itself.
//   2. Nothing is inferred beyond position. No age, no sex, no ethnicity, no
//      attractiveness: the tool schema has no field for any of them, so the
//      model has nowhere to put an opinion.
//
// The version stamp travels with every result. A feedback row that records
// which pass placed the seed can then be split by version when the template
// or the prompt changes, which is what makes the calibration loop's numbers
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

// Bumped whenever the prompt, the schema or the default model changes. Stored
// beside every seed the pass produces so later analysis can tell them apart.
export const LANDMARK_VERSION = "vision-1";

// Same margin call as Coach Max: the mid-size model, overridable from the
// environment so a week on the larger one can be measured rather than argued.
export const LANDMARK_MODEL_DEFAULT = "claude-sonnet-5";

// A side photo at phone resolution, JPEG. The client already downsizes the
// capture before the seeder runs; two megabytes is generous.
export const MAX_LANDMARK_IMAGE_BYTES = 2_000_000;

// Passes an account may spend in a UTC day. Two scans a week is the allowance;
// twelve leaves room for retakes and guest scans without making the endpoint
// a free image API.
export const LANDMARK_PASSES_PER_DAY = 12;

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

export function landmarkPrompt(): string {
  const lines = SIDE_LANDMARK_IDS.map((id) => `- ${id}: ${DEFINITIONS[id]}`);
  return [
    "This is a side-profile photograph of one person's head. Place the thirteen anatomical landmarks listed below and return them with the tool.",
    "",
    "Coordinates are fractions of the image: x is the distance from the left edge divided by the image width, y is the distance from the top edge divided by the image height, both between 0 and 1, to four decimal places. Look at the actual pixels; do not assume the head is upright or centred.",
    "",
    "Give each point a confidence between 0 and 1. A landmark hidden by hair, a hand or a collar still gets your best anatomical estimate, with a low confidence. Do not omit a point.",
    "",
    "Place only positions. Do not describe the person.",
    "",
    "Landmarks:",
    ...lines,
  ].join("\n");
}

const POINT_SCHEMA = {
  type: "object",
  properties: {
    x: { type: "number", minimum: 0, maximum: 1 },
    y: { type: "number", minimum: 0, maximum: 1 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["x", "y", "confidence"],
  additionalProperties: false,
} as const;

export const LANDMARK_TOOL: Anthropic.Messages.Tool = {
  name: "place_side_landmarks",
  description: "Record the thirteen side-profile landmarks as fractions of the image width and height.",
  input_schema: {
    type: "object",
    properties: Object.fromEntries(SIDE_LANDMARK_IDS.map((id) => [id, POINT_SCHEMA])),
    required: [...SIDE_LANDMARK_IDS],
    additionalProperties: false,
  },
};

function finite01(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > 1) return null;
  return value;
}

/**
 * Turn the tool call's input into a result, or throw with a reason a log can
 * carry. Strict on purpose: a missing point or one outside the image is a
 * refusal, never a guess filled in here, because the caller's fallback is
 * the seeder and a half-answer would be worse than either.
 */
export function parseLandmarkToolInput(input: unknown): SideLandmarkResult {
  if (!input || typeof input !== "object") throw new Error("Landmark result is not an object");
  const raw = input as Record<string, unknown>;
  const points = {} as Record<SideLandmarkId, LandmarkPoint>;
  const confidence = {} as Record<SideLandmarkId, number>;
  for (const id of SIDE_LANDMARK_IDS) {
    const entry = raw[id];
    if (!entry || typeof entry !== "object") throw new Error(`Landmark ${id} is missing`);
    const e = entry as Record<string, unknown>;
    const x = finite01(e.x);
    const y = finite01(e.y);
    if (x === null || y === null) throw new Error(`Landmark ${id} is outside the image`);
    points[id] = { x, y };
    confidence[id] = finite01(e.confidence) ?? 0.5;
  }
  // The nose is in front of the ear: that is what facing means. A result
  // where they sit on top of each other is not a profile, whatever the model
  // says it saw.
  const spread = points.pronasale.x - points.tragion.x;
  if (Math.abs(spread) < 0.05) throw new Error("Nose tip and ear notch are too close together to be a profile");
  return { points, confidence, faceDir: spread > 0 ? 1 : -1 };
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

export interface LandmarkPassUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LandmarkPass {
  result: SideLandmarkResult;
  model: string;
  version: string;
  usage: LandmarkPassUsage;
}

/**
 * One call, one image, one tool use. The photograph goes to the provider as
 * part of this request and nowhere else: this function keeps no copy, writes
 * no file and logs no bytes.
 */
export async function placeSideLandmarks(
  client: Anthropic,
  image: { data: string; mediaType: LandmarkMediaType },
  options: { model?: string } = {},
): Promise<LandmarkPass> {
  const model = options.model || process.env.SIDE_LANDMARK_MODEL || LANDMARK_MODEL_DEFAULT;
  const response = await client.messages.create({
    model,
    max_tokens: 900,
    tools: [LANDMARK_TOOL],
    tool_choice: { type: "tool", name: LANDMARK_TOOL.name },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
          { type: "text", text: landmarkPrompt() },
        ],
      },
    ],
  });
  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("The model returned no landmark tool call");
  const result = parseLandmarkToolInput(block.input);
  return {
    result,
    model,
    version: LANDMARK_VERSION,
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    },
  };
}
