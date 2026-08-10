import type { RegionId } from "./types.ts";

// ---------------------------------------------------------------------------
// The pre-quiz: what someone wants out of this, and what they want left alone.
//
// Two jobs, and the second one matters more than the first.
//
// 1. Goals reorder the plan. Four levers out of thirty-one is already a
//    filtered view; filtering it toward what the person actually came for
//    turns a generic list into their list.
//
// 2. Consent. The measurements are never hidden or softened — a suboptimal
//    number is reported as the 3 or the 4 it is, because a scanner that
//    flatters you is worth nothing. What consent controls is the COACHING:
//    whether we write paragraphs about a region someone told us they are
//    self-conscious about, and whether we hand out food or lifestyle advice at
//    all. Nobody gets talked at about their nose because they mentioned it.
//
// Stored on the device, never sent anywhere — same as everything else here.
// ---------------------------------------------------------------------------

export type AdviceChannel = "diet" | "lifestyle" | "grooming" | "capture";

export interface GoalDef {
  id: string;
  label: string;
  blurb: string;
  // Metric ids this goal genuinely moves — used to reorder the plan
  metrics: string[];
  regions: RegionId[];
  // False when the goal is real but nothing in a 478-point face mesh reads it.
  // These still belong in the plan; they just get told the truth about it.
  measurable: boolean;
}

export const GOALS: GoalDef[] = [
  {
    id: "bodyfat",
    label: "Lean out",
    blurb: "Lower body fat — the single largest non-surgical lever on the face",
    metrics: ["gonialProxy", "jawCheekRatio", "cheekboneHeight", "fwhr", "chinWidthRatio"],
    regions: ["jaw", "midface", "chin"],
    measurable: true,
  },
  {
    id: "jaw",
    label: "Sharper jawline",
    blurb: "Definition through the gonial angle and jaw base",
    metrics: ["gonialProxy", "jawFrontalAngle", "jawCheekRatio", "chinHeightRatio"],
    regions: ["jaw", "chin"],
    measurable: true,
  },
  {
    id: "eyes",
    label: "Eye area",
    blurb: "Aperture, tilt and the brow above it",
    metrics: ["eyeAspectRatio", "canthalTilt", "browPosition", "browTilt"],
    regions: ["eyes"],
    measurable: true,
  },
  {
    id: "debloat",
    label: "Less puffiness",
    blurb: "Sleep, sodium and alcohol show up in measurable water retention",
    metrics: ["eyeAspectRatio", "jawCheekRatio", "fwhr"],
    regions: ["eyes", "jaw"],
    measurable: true,
  },
  {
    id: "symmetry",
    label: "Symmetry",
    blurb: "Posture and chewing balance move mirror deviation over months",
    metrics: ["mirrorDeviation", "canthalAsymmetry", "eyeMouthParallel", "midlineDeviation"],
    regions: ["symmetry"],
    measurable: true,
  },
  {
    id: "grooming",
    label: "Grooming",
    blurb: "Brow shape, beard line, hair — the fastest-moving numbers here",
    metrics: ["browPosition", "browTilt", "lipHeightLowerThird"],
    regions: ["eyes", "lips"],
    measurable: true,
  },
  {
    id: "photos",
    label: "Photograph better",
    blurb: "Angle, expression and lighting discipline",
    metrics: ["mouthCornerTilt", "eyeMouthParallel"],
    regions: ["lips"],
    measurable: true,
  },
  {
    id: "skin",
    label: "Skin quality",
    blurb: "Texture and tone",
    metrics: [],
    regions: [],
    measurable: false,
  },
  {
    id: "teeth",
    label: "Teeth",
    blurb: "Colour, alignment, smile line",
    metrics: [],
    regions: [],
    measurable: false,
  },
  {
    id: "muscle",
    label: "Build muscle",
    blurb: "Neck, shoulders and frame",
    metrics: [],
    regions: [],
    measurable: false,
  },
];

// Regions someone can ask us to stay quiet about. Kept to the areas people
// actually name; the wording is neutral on purpose — this is a preference, not
// a diagnosis, and nothing here implies anything is wrong.
export const QUIET_TOPICS: Array<{ region: RegionId; label: string }> = [
  { region: "nose", label: "Nose" },
  { region: "lips", label: "Lips and mouth" },
  { region: "eyes", label: "Eyes and brows" },
  { region: "jaw", label: "Jaw" },
  { region: "chin", label: "Chin" },
  { region: "midface", label: "Cheeks and midface" },
  { region: "symmetry", label: "Symmetry" },
];

export interface Profile {
  v: 1;
  // Answered each half at least once. Distinct from "chose nothing", which is
  // a valid answer we must not keep re-asking about.
  preDone: boolean;
  postDone: boolean;
  goals: string[];
  quiet: RegionId[];
  advice: Record<AdviceChannel, boolean>;
  // Dietary exclusions, so food suggestions never name something someone
  // does not eat. Not a health field and never used as one.
  diet: string[];
  endGoal: string;
}

// Sleep hours used to live here. It was collected and never read by anything,
// and asking for data we do not use is the same trust problem as a score with
// a hidden component. It comes back when something consumes it.
export const EMPTY_PROFILE: Profile = {
  v: 1,
  preDone: false,
  postDone: false,
  goals: [],
  quiet: [],
  advice: { diet: true, lifestyle: true, grooming: true, capture: true },
  diet: [],
  endGoal: "",
};

const KEY = "truemax:profile";

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY_PROFILE };
    const p = JSON.parse(raw) as Partial<Profile>;
    if (p.v !== 1) return { ...EMPTY_PROFILE };
    return {
      ...EMPTY_PROFILE,
      ...p,
      advice: { ...EMPTY_PROFILE.advice, ...(p.advice ?? {}) },
    };
  } catch {
    return { ...EMPTY_PROFILE };
  }
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode — the quiz just won't persist between visits */
  }
}

// How strongly the plan should favour a metric, given the chosen goals. Used as
// a ranking nudge, not an override: a metric nobody asked about that is
// genuinely the weakest number still deserves to surface.
export function goalBoost(metricId: string, p: Profile): number {
  let boost = 0;
  for (const g of GOALS) {
    if (!p.goals.includes(g.id)) continue;
    if (g.metrics.includes(metricId)) boost += 0.6;
  }
  return Math.min(1.2, boost);
}

export function goalsTouching(metricId: string, p: Profile): GoalDef[] {
  return GOALS.filter((g) => p.goals.includes(g.id) && g.metrics.includes(metricId));
}

export function chosenGoals(p: Profile): GoalDef[] {
  return GOALS.filter((g) => p.goals.includes(g.id));
}

// Regions we will not write coaching copy about. The numbers still show
// everywhere — this only silences the prose.
export function isQuiet(region: RegionId, p: Profile): boolean {
  return p.quiet.includes(region);
}
