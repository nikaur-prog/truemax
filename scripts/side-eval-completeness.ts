export interface EvaluationFace<Point extends string, Reader extends string> {
  id: string;
  moved: ReadonlySet<Point>;
  err: Record<Reader, Partial<Record<Point, number>>>;
}

function usableError(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Missing evidence is a hold, never a successful comparison or a clean face. */
export function evaluationCompletenessHolds<Point extends string, Reader extends string>(
  expectedIds: readonly string[],
  faces: readonly EvaluationFace<Point, Reader>[],
  requiredPoints: readonly Point[],
  readers: readonly Reader[],
): string[] {
  const holds: string[] = [];
  const seen = new Set(faces.map((face) => face.id));
  if (!expectedIds.length || !faces.length) holds.push("no complete evaluation sample");
  const missing = expectedIds.filter((id) => !seen.has(id));
  if (missing.length) holds.push(`${missing.length} expected profile(s) were not scored`);
  if (seen.size !== faces.length) holds.push("duplicate profiles in the evaluation sample");
  for (const point of requiredPoints) {
    if (!faces.some((face) => face.moved.has(point))) holds.push(`${point}: no hand-moved evidence`);
    for (const reader of readers) {
      const absent = faces.filter((face) => !usableError(face.err[reader]?.[point])).length;
      if (absent) holds.push(`${point}: ${absent} profile(s) missing valid ${reader} error`);
    }
  }
  return holds;
}

export function cleanProfileRate<Point extends string, Reader extends string>(
  faces: readonly EvaluationFace<Point, Reader>[],
  requiredPoints: readonly Point[],
  reader: Reader,
  within: number,
): number {
  if (!requiredPoints.length) return 0;
  return faces.filter((face) => requiredPoints.every((point) => {
    const error = face.err[reader]?.[point];
    return usableError(error) && error <= within;
  })).length / Math.max(1, faces.length);
}
