/**
 * Decide whether an out-of-bounds side reading proves the placement is bad or
 * merely sits on the edge of a deliberately conservative plausibility guard.
 *
 * The scoring engine already excludes every implausible reading. This helper
 * only decides whether the whole placement must be stopped as well. A single
 * reading just outside its range is marginal: rejecting the entire photograph
 * can be worse than omitting that one reading. Multiple misses, non-finite
 * values and material overruns remain hard failures.
 */

export interface PlausibilityReading {
  value: number;
  implausible?: boolean;
  def: { plausible?: [number, number] };
}

export interface PlacementQuality<T extends PlausibilityReading> {
  hard: T[];
  marginal: T[];
}

const MARGINAL_OVERRUN_FRACTION = 0.05;

export function classifySidePlacement<T extends PlausibilityReading>(
  readings: readonly T[],
): PlacementQuality<T> {
  const flagged = readings.filter((reading) => reading.implausible);
  if (flagged.length !== 1) return { hard: flagged, marginal: [] };

  const [reading] = flagged;
  const bound = reading.def.plausible;
  if (!bound || !Number.isFinite(reading.value)) return { hard: flagged, marginal: [] };
  const [lo, hi] = bound;
  const span = hi - lo;
  if (!Number.isFinite(span) || span <= 0) return { hard: flagged, marginal: [] };
  const overrun = reading.value < lo
    ? lo - reading.value
    : reading.value > hi
      ? reading.value - hi
      : 0;
  if (overrun / span <= MARGINAL_OVERRUN_FRACTION) {
    return { hard: [], marginal: flagged };
  }
  return { hard: flagged, marginal: [] };
}
