// ---------------------------------------------------------------------------
// Height and weight: one canonical representation, two ways to type it.
//
// Canonical is centimetres and kilograms to one decimal place, on the device
// and on the server alike, so a value never drifts through a conversion
// twice. Imperial is a way of entering and displaying, never a way of
// storing. The bounds are the calculator's plausibility bounds
// (src/engine/macros.ts) and the database check constraint, so the three
// can never disagree about what a usable body is.
// ---------------------------------------------------------------------------

export const BODY_BOUNDS = {
  heightCm: { min: 120, max: 230 },
  weightKg: { min: 35, max: 300 },
} as const;

export const CM_PER_INCH = 2.54;
export const KG_PER_POUND = 0.45359237;

export type UnitSystem = "metric" | "imperial";

export interface BodyEntry {
  unit: UnitSystem;
  heightCm?: number;
  weightKg?: number;
  feet?: number;
  inches?: number;
  pounds?: number;
}

export interface BodyMetric {
  heightCm: number;
  weightKg: number;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Either entry system to canonical units, or null when a field is not a number. */
export function toMetric(entry: BodyEntry): BodyMetric | null {
  const heightCm = entry.unit === "metric"
    ? Number(entry.heightCm)
    : (Number(entry.feet) * 12 + Number(entry.inches ?? 0)) * CM_PER_INCH;
  const weightKg = entry.unit === "metric" ? Number(entry.weightKg) : Number(entry.pounds) * KG_PER_POUND;
  if (!Number.isFinite(heightCm) || !Number.isFinite(weightKg)) return null;
  return { heightCm: round1(heightCm), weightKg: round1(weightKg) };
}

/** Canonical units as feet, inches and pounds for display. */
export function toImperial(metric: BodyMetric): { feet: number; inches: number; pounds: number } {
  const totalInches = metric.heightCm / CM_PER_INCH;
  const feet = Math.floor(totalInches / 12);
  return { feet, inches: round1(totalInches - feet * 12), pounds: round1(metric.weightKg / KG_PER_POUND) };
}

/** Inside the bounds the calculator, the dialog and the database share. */
export function bodyMetricUsable(metric: Partial<BodyMetric> | null | undefined): metric is BodyMetric {
  if (!metric) return false;
  const { heightCm, weightKg } = metric;
  return (
    typeof heightCm === "number" && Number.isFinite(heightCm) && heightCm >= BODY_BOUNDS.heightCm.min && heightCm <= BODY_BOUNDS.heightCm.max &&
    typeof weightKg === "number" && Number.isFinite(weightKg) && weightKg >= BODY_BOUNDS.weightKg.min && weightKg <= BODY_BOUNDS.weightKg.max
  );
}

/** The one sentence that says what is accepted, in the units on screen. */
export function boundsSentence(unit: UnitSystem): string {
  if (unit === "metric") {
    return `Enter a height from ${BODY_BOUNDS.heightCm.min} to ${BODY_BOUNDS.heightCm.max} cm and a weight from ${BODY_BOUNDS.weightKg.min} to ${BODY_BOUNDS.weightKg.max} kg.`;
  }
  const lo = toImperial({ heightCm: BODY_BOUNDS.heightCm.min, weightKg: BODY_BOUNDS.weightKg.min });
  const hi = toImperial({ heightCm: BODY_BOUNDS.heightCm.max, weightKg: BODY_BOUNDS.weightKg.max });
  return `Enter a height from ${lo.feet} ft ${Math.round(lo.inches)} in to ${hi.feet} ft ${Math.round(hi.inches)} in and a weight from ${Math.round(lo.pounds)} to ${Math.round(hi.pounds)} lb.`;
}
