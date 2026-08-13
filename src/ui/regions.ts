import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { RegionId } from "../engine/types.js";

// Landmarks that light up (and drive the zoom target) per region tab.
export const REGION_LANDMARKS: Record<RegionId, number[]> = {
  eyes: [33, 133, 159, 145, 362, 263, 386, 374, 468, 473, 52, 282, 55, 285, 46, 276, 105, 334, 70, 300],
  midface: [234, 454, 116, 345, 50, 280, 168, 6, 197, 195],
  jaw: [58, 288, 172, 397, 136, 365, 150, 379, 149, 378, 176, 400, 148, 377, 152],
  chin: [152, 148, 377, 176, 400, 149, 378, 17, 18, 200],
  nose: [1, 2, 4, 5, 6, 168, 98, 327, 48, 278, 64, 294, 49, 279],
  lips: [61, 291, 0, 13, 14, 17, 78, 308, 80, 310, 88, 318],
  proportions: [10, 9, 2, 152, 234, 454, 33, 263],
  symmetry: [10, 168, 1, 2, 152, 33, 263, 61, 291, 234, 454],
};

export interface ZoomSpec {
  scale: number;
  originX: number; // % of frame width
  originY: number; // % of frame height
}

// Zoom derived from the region's landmark bounding box — no hand-tuned
// percentages, works for any face position in frame.
export function zoomFor(region: RegionId, landmarks: NormalizedLandmark[]): ZoomSpec {
  const ids = REGION_LANDMARKS[region];
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const i of ids) {
    const l = landmarks[i];
    minX = Math.min(minX, l.x);
    maxX = Math.max(maxX, l.x);
    minY = Math.min(minY, l.y);
    maxY = Math.max(maxY, l.y);
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const scale = Math.min(2.4, Math.max(1.25, 0.62 / Math.max(spanX, spanY, 0.01)));
  return {
    scale,
    originX: ((minX + maxX) / 2) * 100,
    originY: ((minY + maxY) / 2) * 100,
  };
}
