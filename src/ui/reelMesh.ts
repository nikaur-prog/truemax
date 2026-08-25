import { FaceLandmarker } from "@mediapipe/tasks-vision";
import { shapeSubset } from "../engine/shape.js";

// ---------------------------------------------------------------------------
// The reel's landmark cloud, joined up.
//
// demoReelData stores each face as a flat list of points in `shapeSubset()`
// order, and the reel drew them as loose dots — which reads as static, or as
// glitter, rather than as a mesh being fitted to a face. The points are not
// loose: they are the vertices of the face oval, both eyes, both brows and the
// lips, and MediaPipe publishes exactly which vertex joins which.
//
// So the contours are rebuilt here, at runtime, from the SAME connection sets
// shapeSubset() is built from. That is the whole reason this is not baked into
// the generated data file: the two would drift the moment the subset changed,
// and a mesh drawn from a stale index table joins a brow to a lip. Derived from
// one source, they cannot disagree.
//
// Indices returned are positions in a face's `points` array, not mesh indices.
// ---------------------------------------------------------------------------

// The FEATURES, and deliberately not the face oval.
//
// The oval was here and it was the wrong idea twice over. Traced around the
// silhouette it reads as a cut-out sticker laid over the photograph rather
// than as a model fitted to a face, and it is the one contour whose vertices
// sit on the boundary between a person and their background — so it lands on
// hair, on a jaw edge softened by depth of field, on nothing at all — and it
// looked like the software could not find the edge of the head. Faded out
// after the sweep it was still wrong for the whole sweep.
//
// What a measurement of a face actually looks like is the features: eyes,
// brows, lips. Those are unambiguous, they are what the metrics are built
// from, and a contour closing around an eye is the moment worth showing.
const SETS = () => [
  FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
  FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
  FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
  FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
  FaceLandmarker.FACE_LANDMARKS_LIPS,
];

/**
 * Order one connection set into a path.
 *
 * The sets are edge lists, not ordered rings — they arrive in whatever order
 * the model's authors wrote them — so a path is walked by following start→end.
 * Closed loops (the oval, an eye) come back to where they began and stop; an
 * open chain simply runs out. Both terminate, which is what the `seen` guard is
 * for: a malformed set that cycles through a subset of its own vertices would
 * otherwise spin forever on the landing page.
 */
export function orderRing(edges: ReadonlyArray<{ start: number; end: number }>): number[] {
  const next = new Map<number, number>();
  for (const e of edges) if (!next.has(e.start)) next.set(e.start, e.end);
  const first = edges[0]?.start;
  if (first === undefined) return [];
  const out: number[] = [first];
  const seen = new Set<number>([first]);
  let cur = first;
  for (;;) {
    const n = next.get(cur);
    if (n === undefined || n === first || seen.has(n)) break;
    out.push(n);
    seen.add(n);
    cur = n;
  }
  return out;
}

let cached: number[][] | null = null;
let cachedOval: Set<number> | null = null;

/**
 * The points that belong ONLY to the face oval.
 *
 * Dropping the oval from the contour list stops the outline being drawn, and
 * leaves its vertices sitting on the photograph as a ring of loose dots —
 * which is the same goofy cut-out shape with the lines taken out, and reads
 * worse rather than better. The reel skips these when scattering points.
 *
 * Vertices shared with a feature ring are NOT included: a point that an eye
 * or a lip also uses is doing a second job, and removing it would leave a gap
 * in a contour that is staying.
 */
export function reelOvalPoints(): Set<number> {
  if (cachedOval) return cachedOval;
  const subset = shapeSubset();
  const at = new Map<number, number>();
  subset.forEach((mesh, i) => at.set(mesh, i));

  const keep = new Set<number>();
  for (const ring of reelContours()) for (const i of ring) keep.add(i);

  const oval = new Set<number>();
  for (const edge of FaceLandmarker.FACE_LANDMARKS_FACE_OVAL) {
    for (const mesh of [edge.start, edge.end]) {
      const i = at.get(mesh);
      if (i !== undefined && !keep.has(i)) oval.add(i);
    }
  }
  cachedOval = oval;
  return oval;
}

/**
 * Each facial contour, as indices into a reel face's `points` array.
 *
 * A vertex the subset does not carry is dropped rather than faked — the subset
 * takes only `connection.start` from each set, so in practice every ring is
 * complete, and dropping is the safe behaviour if that ever changes.
 */
export function reelContours(): number[][] {
  if (cached) return cached;
  const subset = shapeSubset();
  const at = new Map<number, number>();
  subset.forEach((mesh, i) => at.set(mesh, i));

  const out: number[][] = [];
  for (const set of SETS()) {
    const ring = orderRing(set)
      .map((mesh) => at.get(mesh))
      .filter((i): i is number => i !== undefined);
    // Two points is a line, not a contour worth drawing.
    if (ring.length >= 3) out.push(ring);
  }
  cached = out;
  return out;
}
