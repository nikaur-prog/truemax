import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { detectStable } from "../engine/consensus.js";
import { initLandmarker, setRunningMode } from "../engine/landmarker.js";
import type { MorphBlueprint, MorphMetricTarget } from "../engine/morphPlan.js";
import { analyze, analyzeSide } from "../engine/scoring.js";
import { sidePointIntegrityIssues } from "../engine/sideMetrics.js";
import type { Report } from "../engine/types.js";
import { seedSidePointsSmart } from "./sideVerify.js";
import type { MorphRenderSource } from "../engine/morphContract.js";

export interface MorphValidationInput {
  blueprint: MorphBlueprint;
  originalFrontLandmarks: NormalizedLandmark[];
  images: MorphRenderSource;
}

export interface MorphValidationResult {
  passed: boolean;
  identityPreserved: boolean;
  targetAligned: boolean;
  reason?: string;
}

// Stable interior points only. Jaw outline, brows, hair and under-eye tissue
// are deliberately absent because those are allowed presentation layers. The
// selected points anchor the identity check to eye shape, nose placement and
// the mouth, which the render contract never permits a goal to redesign.
const IDENTITY_POINTS = [
  33, 133, 159, 145, 362, 263, 386, 374,
  168, 6, 197, 195, 1, 2, 61, 291, 13, 14,
] as const;

function quantile(values: number[], p: number): number {
  const ordered = [...values].sort((a, b) => a - b);
  if (!ordered.length) return Infinity;
  return ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * p))];
}

interface Frame {
  cx: number;
  cy: number;
  scale: number;
  angle: number;
}

function eyeFrame(points: NormalizedLandmark[]): Frame | null {
  const right = points[33];
  const left = points[263];
  if (!right || !left) return null;
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const scale = Math.hypot(dx, dy);
  if (!(scale > 0.02)) return null;
  return {
    cx: (left.x + right.x) / 2,
    cy: (left.y + right.y) / 2,
    scale,
    angle: Math.atan2(dy, dx),
  };
}

function inFrame(point: NormalizedLandmark, frame: Frame): { x: number; y: number } {
  const dx = point.x - frame.cx;
  const dy = point.y - frame.cy;
  const c = Math.cos(-frame.angle);
  const s = Math.sin(-frame.angle);
  return {
    x: (dx * c - dy * s) / frame.scale,
    y: (dx * s + dy * c) / frame.scale,
  };
}

export function identityLandmarkDistance(
  original: NormalizedLandmark[],
  rendered: NormalizedLandmark[],
): { median: number; p90: number } | null {
  const a = eyeFrame(original);
  const b = eyeFrame(rendered);
  if (!a || !b) return null;
  const distances: number[] = [];
  for (const index of IDENTITY_POINTS) {
    const source = original[index];
    const target = rendered[index];
    if (!source || !target) return null;
    const x = inFrame(source, a);
    const y = inFrame(target, b);
    distances.push(Math.hypot(x.x - y.x, x.y - y.y));
  }
  return { median: quantile(distances, 0.5), p90: quantile(distances, 0.9) };
}

export function targetsMoveAsSpecified(targets: MorphMetricTarget[], report: Report): boolean {
  for (const target of targets) {
    const measured = report.metrics.find((metric) => metric.def.id === target.id);
    if (!measured || measured.implausible || !Number.isFinite(measured.value)) return false;
    const expected = target.target - target.current;
    if (Math.abs(expected) < Number.EPSILON) continue;
    const progress = (measured.value - target.current) / expected;
    // A render must make a visible move toward the bounded target. Small
    // detector noise in the opposite direction is tolerated, while a reversal
    // or an overshoot that invents a new face is not.
    if (progress < 0.12 || progress > 1.45) return false;
  }
  return true;
}

function imageCanvas(data: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const g = canvas.getContext("2d");
      if (!g || !canvas.width || !canvas.height) {
        reject(new Error("The generated image could not be read."));
        return;
      }
      g.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas);
    };
    image.onerror = () => reject(new Error("The generated image could not be read."));
    image.src = data;
  });
}

export async function validateMorphImages(input: MorphValidationInput): Promise<MorphValidationResult> {
  try {
    await initLandmarker();
    await setRunningMode("IMAGE");
    const front = await imageCanvas(input.images.front);
    const frontDetection = detectStable(front);
    const frontLandmarks = frontDetection.faceLandmarks?.[0];
    if (!frontLandmarks) {
      return { passed: false, identityPreserved: false, targetAligned: false, reason: "No face was found in the generated front view." };
    }
    const identity = identityLandmarkDistance(input.originalFrontLandmarks, frontLandmarks);
    const identityPreserved = Boolean(identity && identity.median <= 0.045 && identity.p90 <= 0.09);
    if (!identityPreserved) {
      return { passed: false, identityPreserved: false, targetAligned: false, reason: "The generated front view changed identity-stable facial geometry." };
    }

    const frontReport = analyze(frontLandmarks, front.width, front.height, input.blueprint.sex, front);
    const frontTargets = input.blueprint.targets.filter((target) => target.view === "front");
    let targetAligned = targetsMoveAsSpecified(frontTargets, frontReport);

    const sideTargets = input.blueprint.targets.filter((target) => target.view === "side");
    if (targetAligned && sideTargets.length) {
      if (!input.images.side) {
        targetAligned = false;
      } else {
        const side = await imageCanvas(input.images.side);
        const seed = await seedSidePointsSmart(side, (points, faceDir) =>
          sidePointIntegrityIssues(points, side.width, side.height, faceDir).length === 0);
        const sideReport = analyzeSide(seed.points, seed.faceDir, input.blueprint.sex);
        targetAligned = targetsMoveAsSpecified(sideTargets, sideReport);
      }
    }

    return {
      passed: identityPreserved && targetAligned,
      identityPreserved,
      targetAligned,
      ...(!targetAligned ? { reason: "The generated face did not reach the bounded measurement target." } : {}),
    };
  } catch (error) {
    return {
      passed: false,
      identityPreserved: false,
      targetAligned: false,
      reason: error instanceof Error ? error.message : "The generated preview could not be validated.",
    };
  }
}
