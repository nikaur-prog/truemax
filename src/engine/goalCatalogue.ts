import { GOALS } from "./goals.js";
import { canShowProgress } from "./goalEvidence.js";

// ---------------------------------------------------------------------------
// The goal-effect catalogue.
//
// A goal is not a prompt. It is a bounded set of things a person can change
// without surgery, the measurements that would show it, the time it usually
// takes, how sure anybody can be, and the rule that says it is done. This
// file is the only thing the target engine, the plan cards, the render
// route and the points ledger may read about a goal, and it never accepts
// free text. A layer that is not listed here is forbidden for that goal; a
// measurement that is not listed here is never promised.
//
// Versioned, because the movement fractions and the week ranges are the
// part that repeat scans will recalibrate. catalogue-1 is conservative by
// construction: every range is the low end of what the evidence supports,
// and where the evidence is thin the entry says so rather than rounding up.
// The evidence grades and the sources behind them are listed in
// docs/FACIAL_MORPH_PLAN.md section 4 and are for review before the beta.
//
// Two rules from CLAUDE.md that shape this file: no rarity or verdict about
// a person, and no inference of ethnicity, age or sex from a photograph. A
// catalogue entry describes a goal, never a person.
// ---------------------------------------------------------------------------

export const GOAL_CATALOGUE_VERSION = "catalogue-1";

/** The presentation layers a render may touch, from the owner's may-change list. */
export const RENDER_LAYERS = [
  "hair",
  "facialHair",
  "brows",
  "skinSurface",
  "leanerPresentation",
  "posture",
  "expression",
  "lighting",
  "wardrobe",
] as const;
export type RenderLayer = (typeof RENDER_LAYERS)[number];

/** Layers only an adult may have rendered, and only on an explicit choice. */
export const ADULT_ONLY_LAYERS: readonly RenderLayer[] = ["leanerPresentation"];

export type EvidenceGrade = "A" | "B" | "C" | "none";

export interface GoalEffect {
  id: string;
  /** Metric ids the goal may move. Filtered through canShowProgress at load. */
  measures: readonly string[];
  layers: readonly RenderLayer[];
  /** Fraction of (fixability times the gap to band) the render targets and the tracker celebrates from. */
  movement: { low: number; high: number };
  /** Weeks to a visible change, typical range. */
  weeks: { low: number; high: number };
  evidence: EvidenceGrade;
  /** Things that move the measurement for a reason other than the goal. */
  confounders: readonly string[];
  combinesWith: readonly string[];
  excludes: readonly string[];
  /** The completion rule, in the tracker's own terms. */
  completion: {
    /** Minimum movement, in the metric's standard-deviation units, before it counts. */
    minDeltaSd: number;
    /** Held in this many of the next three standardised scans. */
    holdOf3: number;
  };
  points: {
    /** Effort tier 1 to 3: how long the goal takes to show, not how much it changes. */
    effort: 1 | 2 | 3;
  };
  minors: {
    /** Offered under 18 at all. */
    offered: boolean;
    /** Layers a minor may have rendered; empty means no render for this goal under 18. */
    layers: readonly RenderLayer[];
  };
  /** Plain, factual; what the card says under the goal. */
  note: string;
}

// Consistency points per completed week by effort tier. The slow goals earn
// more for showing up, never for changing more.
export const CONSISTENCY_POINTS_PER_WEEK: Record<1 | 2 | 3, number> = { 1: 10, 2: 12, 3: 15 };
// One flat award when a goal's completion rule is met, the same for every goal.
export const VERIFIED_PROGRESS_POINTS = 100;

const RAW: readonly GoalEffect[] = [
  {
    id: "bodyfat",
    measures: ["gonialProxy", "jawCheekRatio", "cheekboneHeight", "chinWidthRatio", "cheekFullness", "submentalCervical"],
    layers: ["leanerPresentation", "posture"],
    movement: { low: 0.2, high: 0.5 },
    weeks: { low: 8, high: 24 },
    evidence: "B",
    confounders: ["water retention", "sodium and alcohol in the last two days", "camera distance", "expression", "growth under 18"],
    combinesWith: ["jaw", "debloat", "posture"],
    excludes: [],
    completion: { minDeltaSd: 0.6, holdOf3: 2 },
    points: { effort: 3 },
    minors: { offered: false, layers: [] },
    note: "Lower body fat shows in the lower face, but how much and where varies person to person, so the target is a range and the tracker reads the scan, not the scale.",
  },
  {
    id: "jaw",
    measures: ["gonialProxy", "jawFrontalAngle", "jawCheekRatio", "submentalCervical"],
    layers: ["posture", "facialHair", "leanerPresentation"],
    movement: { low: 0.15, high: 0.4 },
    weeks: { low: 8, high: 20 },
    evidence: "C",
    confounders: ["head tilt", "chin position", "water retention", "beard line"],
    combinesWith: ["bodyfat", "debloat", "grooming"],
    excludes: [],
    completion: { minDeltaSd: 0.6, holdOf3: 2 },
    points: { effort: 3 },
    minors: { offered: true, layers: ["posture"] },
    note: "Posture and head carriage change what the camera sees under the jaw; the bone does not move, and the preview never pretends it does.",
  },
  {
    id: "eyes",
    measures: ["eyeAspectRatio", "canthalTilt", "browPosition", "browTilt"],
    layers: ["brows", "skinSurface", "expression", "lighting"],
    movement: { low: 0.15, high: 0.35 },
    weeks: { low: 2, high: 8 },
    evidence: "C",
    confounders: ["sleep in the last two nights", "expression", "lighting from above", "allergies"],
    combinesWith: ["grooming", "debloat", "photos"],
    excludes: [],
    completion: { minDeltaSd: 0.6, holdOf3: 2 },
    points: { effort: 1 },
    minors: { offered: true, layers: ["brows", "expression", "lighting"] },
    note: "Brow shape, sleep and lighting move what the eye area reads as; the aperture itself is mostly fixed.",
  },
  {
    id: "debloat",
    measures: ["eyeAspectRatio", "jawCheekRatio", "cheekFullness", "submentalCervical"],
    layers: ["leanerPresentation"],
    movement: { low: 0.1, high: 0.3 },
    weeks: { low: 1, high: 4 },
    evidence: "B",
    confounders: ["time of day", "sodium", "alcohol", "sleep", "menstrual cycle", "camera distance"],
    combinesWith: ["bodyfat", "jaw", "eyes"],
    excludes: [],
    completion: { minDeltaSd: 0.6, holdOf3: 2 },
    points: { effort: 1 },
    minors: { offered: true, layers: [] },
    note: "Puffiness is the fastest-moving thing the scan measures and the easiest to mistake for fat loss; the rule asks for it to hold across three scans.",
  },
  {
    id: "symmetry",
    measures: ["mirrorDeviation", "canthalAsymmetry", "eyeMouthParallel", "midlineDeviation"],
    layers: ["posture", "expression"],
    movement: { low: 0.1, high: 0.25 },
    weeks: { low: 12, high: 36 },
    evidence: "C",
    confounders: ["head roll in the photo", "expression", "which side you chew on this week", "lens distortion"],
    combinesWith: ["photos", "jaw"],
    excludes: [],
    completion: { minDeltaSd: 0.6, holdOf3: 2 },
    points: { effort: 3 },
    minors: { offered: true, layers: ["posture", "expression"] },
    note: "Most of what reads as asymmetry in a photo is posture and roll, and that is the part that moves.",
  },
  {
    id: "grooming",
    measures: ["browPosition", "browTilt", "lipHeightLowerThird"],
    layers: ["hair", "facialHair", "brows"],
    movement: { low: 0.3, high: 0.6 },
    weeks: { low: 1, high: 4 },
    evidence: "A",
    confounders: ["a fresh cut versus grown out", "product in the hair"],
    combinesWith: ["eyes", "jaw", "photos", "hair"],
    excludes: [],
    completion: { minDeltaSd: 0.6, holdOf3: 2 },
    points: { effort: 1 },
    minors: { offered: true, layers: ["hair", "brows"] },
    note: "The fastest lever there is: a brow shape or a beard line changes a measurement in a week.",
  },
  {
    id: "photos",
    measures: ["mouthCornerTilt", "eyeMouthParallel"],
    layers: ["posture", "expression", "lighting"],
    movement: { low: 0.2, high: 0.5 },
    weeks: { low: 1, high: 2 },
    evidence: "A",
    confounders: ["camera height", "distance", "lens"],
    combinesWith: ["eyes", "symmetry", "grooming"],
    excludes: [],
    completion: { minDeltaSd: 0.6, holdOf3: 2 },
    points: { effort: 1 },
    minors: { offered: true, layers: ["posture", "expression", "lighting"] },
    note: "Nothing about the face changes; what the camera is shown does, and it shows in the numbers.",
  },
  {
    id: "hair",
    measures: [],
    layers: ["hair"],
    movement: { low: 0, high: 0 },
    weeks: { low: 12, high: 52 },
    evidence: "B",
    confounders: ["cut", "product", "wet or dry", "lighting"],
    combinesWith: ["grooming"],
    excludes: [],
    completion: { minDeltaSd: 0, holdOf3: 0 },
    points: { effort: 3 },
    minors: { offered: true, layers: ["hair"] },
    note: "The scan does not measure hair. A preview may show a style, never growth, and progress is a same-light photo comparison, not a number.",
  },
  {
    id: "skin",
    measures: [],
    layers: ["skinSurface", "lighting"],
    movement: { low: 0, high: 0 },
    weeks: { low: 6, high: 16 },
    evidence: "B",
    confounders: ["lighting", "camera processing", "a flare this week", "sun"],
    combinesWith: ["eyes", "photos"],
    excludes: [],
    completion: { minDeltaSd: 0, holdOf3: 0 },
    points: { effort: 2 },
    minors: { offered: true, layers: ["skinSurface", "lighting"] },
    note: "Skin concerns are what you tell us, never what the scan guesses. The preview shows a cosmetic surface direction only; it does not diagnose or promise clear skin.",
  },
  {
    id: "teeth",
    measures: [],
    layers: ["expression"],
    movement: { low: 0, high: 0 },
    weeks: { low: 2, high: 12 },
    evidence: "B",
    confounders: ["lighting", "lip position"],
    combinesWith: ["photos"],
    excludes: [],
    completion: { minDeltaSd: 0, holdOf3: 0 },
    points: { effort: 2 },
    minors: { offered: true, layers: ["expression"] },
    note: "Not measured by the scan. A preview may show a smile line; alignment is a dentist's work and is not rendered.",
  },
  {
    id: "muscle",
    measures: [],
    layers: ["posture", "wardrobe"],
    movement: { low: 0, high: 0 },
    weeks: { low: 12, high: 36 },
    evidence: "A",
    confounders: ["posture", "wardrobe", "lighting"],
    combinesWith: ["bodyfat", "jaw"],
    excludes: [],
    completion: { minDeltaSd: 0, holdOf3: 0 },
    points: { effort: 3 },
    minors: { offered: true, layers: ["posture"] },
    note: "Neck and shoulders sit outside the face scan. The preview may show posture and fit; it never renders a different body.",
  },
];

/**
 * The catalogue as the product reads it: every measurement filtered through
 * what can honestly show progress, so a goal never promises a number that
 * cannot move or cannot be seen to move.
 */
export const GOAL_CATALOGUE: readonly GoalEffect[] = RAW.map((g) => ({
  ...g,
  measures: g.measures.filter(canShowProgress),
}));

export function goalEffect(id: string): GoalEffect | null {
  return GOAL_CATALOGUE.find((g) => g.id === id) ?? null;
}

/** The layers a set of goals may render, for an adult or a minor. */
export function allowedLayers(goalIds: readonly string[], adult: boolean): RenderLayer[] {
  const out = new Set<RenderLayer>();
  for (const id of goalIds) {
    const g = goalEffect(id);
    if (!g) continue;
    if (!adult && !g.minors.offered) continue;
    for (const layer of adult ? g.layers : g.minors.layers) out.add(layer);
  }
  if (!adult) for (const layer of ADULT_ONLY_LAYERS) out.delete(layer);
  return [...out];
}

/** Goal pairs in the set that the catalogue says not to render together. */
export function excludedPairs(goalIds: readonly string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const a of goalIds) {
    const g = goalEffect(a);
    if (!g) continue;
    for (const b of goalIds) if (a < b && g.excludes.includes(b)) pairs.push([a, b]);
  }
  return pairs;
}

/**
 * Is this spec something the catalogue permits? Unknown goal ids, goals not
 * offered to a minor, and any layer the goals do not allow all fail closed.
 * The route calls this before a photograph goes anywhere.
 */
export function specAllowed(
  spec: { goalIds: readonly string[]; layers: readonly string[]; catalogueVersion: string },
  adult: boolean,
): { ok: true } | { ok: false; reason: string } {
  if (spec.catalogueVersion !== GOAL_CATALOGUE_VERSION) return { ok: false, reason: "The preview recipe is from a different catalogue version." };
  if (!spec.goalIds.length) return { ok: false, reason: "Choose at least one goal." };
  for (const id of spec.goalIds) {
    const g = goalEffect(id);
    if (!g) return { ok: false, reason: `Unknown goal ${id}.` };
    if (!adult && !g.minors.offered) return { ok: false, reason: `${g.id} is not offered under 18.` };
  }
  const allowed = new Set(allowedLayers(spec.goalIds, adult));
  for (const layer of spec.layers) {
    if (!allowed.has(layer as RenderLayer)) return { ok: false, reason: `Layer ${layer} is not allowed for these goals.` };
  }
  const clash = excludedPairs(spec.goalIds);
  if (clash.length) return { ok: false, reason: `${clash[0][0]} and ${clash[0][1]} are not previewed together.` };
  return { ok: true };
}

/** The plain wording an evidence grade permits. */
export const EVIDENCE_WORDING: Record<EvidenceGrade, string> = {
  A: "usually",
  B: "often",
  C: "some people find",
  none: "not measured",
};

/** Every catalogue id is a goal id, and every goal has an entry. */
export function catalogueCoversGoals(): boolean {
  const ids = new Set(GOALS.map((g) => g.id));
  return GOAL_CATALOGUE.every((g) => ids.has(g.id)) && GOALS.every((g) => GOAL_CATALOGUE.some((c) => c.id === g.id));
}
