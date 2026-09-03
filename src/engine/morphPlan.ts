import { chosenGoals, GOALS, isQuiet } from "./goals.js";
import type { GoalDef, Profile } from "./goals.js";
import { evidenceFor } from "./goalEvidence.js";
import type { Report, ScoredMetric, View } from "./types.js";

// ---------------------------------------------------------------------------
// The measurable blueprint behind a goal preview.
//
// This module does not edit pixels. It decides what a member's selected goals
// are allowed to change, which measurements can honestly track that change,
// and when the change is large enough to count. Keeping that decision outside
// an image prompt is load-bearing: a renderer may improve, change provider, or
// fail, while the product's promise must stay the same.
//
// Every target is limited by the metric's existing non-surgical fixability and
// filtered through goalEvidence, so a noisy or skeletal measurement cannot be
// turned into a progress promise just because an image model can draw it.
// ---------------------------------------------------------------------------

export type MorphEffectId =
  | "facialFullness"
  | "underEyePuffiness"
  | "jawDefinition"
  | "underChinFullness"
  | "skinEvenness"
  | "blemishVisibility"
  | "browDefinition"
  | "hairFinish"
  | "smileFinish"
  | "posture"
  | "lighting";

export type MorphEffectVector = Record<MorphEffectId, number>;

export interface MorphGoalRule {
  id: string;
  /** Plain expectation shown beside this goal, never a promised deadline. */
  timeframe: string;
  /** Plan points reward consistency and difficulty, not attractiveness. */
  effortPoints: number;
  views: View[];
  effects: Partial<MorphEffectVector>;
  visualSummary: string;
}

export interface MorphMetricTarget {
  id: string;
  name: string;
  view: View;
  current: number;
  target: number;
  decimals: number;
  unit: string;
  /** The minimum move toward target that must repeat before it counts. */
  completionDelta: number;
  goalIds: string[];
}

export interface MorphGoalPreview {
  id: string;
  label: string;
  timeframe: string;
  effortPoints: number;
  views: View[];
  visualSummary: string;
  targetIds: string[];
  measurable: boolean;
}

export interface MorphBlueprint {
  version: 1;
  variant: "selected" | "max_vision";
  sex: Report["sex"];
  goals: MorphGoalPreview[];
  effects: MorphEffectVector;
  targets: MorphMetricTarget[];
  totalPoints: number;
  hasFront: boolean;
  hasSide: boolean;
}

const EMPTY_EFFECTS = (): MorphEffectVector => ({
  facialFullness: 0,
  underEyePuffiness: 0,
  jawDefinition: 0,
  underChinFullness: 0,
  skinEvenness: 0,
  blemishVisibility: 0,
  browDefinition: 0,
  hairFinish: 0,
  smileFinish: 0,
  posture: 0,
  lighting: 0,
});

/**
 * Visual changes a natural goal may ask a renderer to make.
 *
 * There are deliberately no bone, eye-size, nose-size, lip-size, age or skin-
 * tone controls. A generated face is allowed to show soft tissue, grooming,
 * surface care and presentation. It is not allowed to redesign the person.
 */
export const MORPH_GOAL_RULES: Readonly<Record<string, MorphGoalRule>> = {
  bodyfat: {
    id: "bodyfat",
    timeframe: "Review after 8 to 16 weeks",
    effortPoints: 90,
    views: ["front", "side"],
    effects: { facialFullness: -0.55, jawDefinition: 0.42, underChinFullness: -0.42 },
    visualSummary: "A leaner soft-tissue outline while bone structure and identity stay unchanged.",
  },
  jaw: {
    id: "jaw",
    timeframe: "Review posture and definition after 6 to 10 weeks",
    effortPoints: 55,
    views: ["front", "side"],
    effects: { jawDefinition: 0.24, underChinFullness: -0.16, posture: 0.3 },
    visualSummary: "Cleaner posture and under-chin presentation, with no invented jaw growth.",
  },
  eyes: {
    id: "eyes",
    timeframe: "Review after 3 to 6 weeks",
    effortPoints: 35,
    views: ["front"],
    effects: { underEyePuffiness: -0.28, browDefinition: 0.2 },
    visualSummary: "A more rested eye area and tidier brow presentation without changing eye shape.",
  },
  debloat: {
    id: "debloat",
    timeframe: "Review after 1 to 3 consistent weeks",
    effortPoints: 30,
    views: ["front", "side"],
    effects: { facialFullness: -0.22, underEyePuffiness: -0.3, jawDefinition: 0.12 },
    visualSummary: "A less puffy presentation, shown as a modest soft-tissue change.",
  },
  symmetry: {
    id: "symmetry",
    timeframe: "Review capture and posture after 8 to 12 weeks",
    effortPoints: 50,
    views: ["front"],
    effects: { posture: 0.25 },
    visualSummary: "A straighter presentation only. Natural asymmetry remains part of the face.",
  },
  grooming: {
    id: "grooming",
    timeframe: "Visible as soon as the routine is applied",
    effortPoints: 15,
    views: ["front", "side"],
    effects: { browDefinition: 0.3, hairFinish: 0.2 },
    visualSummary: "Cleaner brows, facial-hair edges and styling with the same underlying face.",
  },
  photos: {
    id: "photos",
    timeframe: "Visible on the next controlled photograph",
    effortPoints: 10,
    views: ["front", "side"],
    effects: { posture: 0.22, lighting: 0.42 },
    visualSummary: "More controlled posture and light, labelled as presentation rather than anatomy.",
  },
  hair: {
    id: "hair",
    timeframe: "A cut is immediate; growth goals take longer",
    effortPoints: 25,
    views: ["front", "side"],
    effects: { hairFinish: 0.55 },
    visualSummary: "A more intentional haircut and finish, without inventing density or a new hairline.",
  },
  skin: {
    id: "skin",
    timeframe: "Review a consistent routine after 8 to 12 weeks",
    effortPoints: 60,
    views: ["front", "side"],
    effects: { skinEvenness: 0.48, blemishVisibility: -0.4 },
    visualSummary: "A calmer, more even surface while pores, texture and normal skin detail remain.",
  },
  teeth: {
    id: "teeth",
    timeframe: "Depends on the option chosen with a qualified professional",
    effortPoints: 45,
    views: ["front"],
    effects: { smileFinish: 0.35 },
    visualSummary: "A tidier smile presentation only, never a promised treatment result.",
  },
  muscle: {
    id: "muscle",
    timeframe: "Review frame changes after 8 to 16 weeks",
    effortPoints: 80,
    views: ["front", "side"],
    effects: { posture: 0.36 },
    visualSummary: "A stronger neck, shoulder and posture presentation outside the facial score.",
  },
};

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

function round(n: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(n * scale) / scale;
}

function metricTarget(metric: ScoredMetric, goalId: string): MorphMetricTarget | null {
  if (metric.implausible || !Number.isFinite(metric.value)) return null;
  const [lo, hi] = metric.idealRange;
  let edge = metric.value;
  if (Number.isFinite(lo) && metric.value < lo) edge = lo;
  else if (Number.isFinite(hi) && metric.value > hi) edge = hi;
  else return null;

  const gap = edge - metric.value;
  // Close only the share the existing scoring definition says can move without
  // surgery. The 0.85 ceiling leaves the preview on the attainable side of an
  // already uncertain estimate rather than drawing the exact edge as a fact.
  const movableShare = clamp(metric.def.fixability * 0.85, 0, 0.85);
  const target = metric.value + gap * movableShare;
  if (Math.abs(target - metric.value) < 10 ** -(metric.def.decimals + 1)) return null;
  const smallestVisibleStep = 10 ** -metric.def.decimals;
  return {
    id: metric.def.id,
    name: metric.def.name,
    view: metric.def.view,
    current: round(metric.value, metric.def.decimals),
    target: round(target, metric.def.decimals),
    decimals: metric.def.decimals,
    unit: metric.def.unit,
    // A single scan can wander. Progress has to cover most of the modelled
    // move and repeat, so the UI never marks a one-photo swing complete.
    completionDelta: Math.max(
      smallestVisibleStep,
      round(Math.abs(target - metric.value) * 0.6, metric.def.decimals),
    ),
    goalIds: [goalId],
  };
}

function selectedDefs(profile: Profile): GoalDef[] {
  return chosenGoals(profile).filter((goal) => MORPH_GOAL_RULES[goal.id]);
}

function suggestedDefs(report: Report, profile: Profile): GoalDef[] {
  const selected = new Set(profile.goals);
  const ranked = GOALS
    .filter((goal) => !selected.has(goal.id) && MORPH_GOAL_RULES[goal.id])
    .filter((goal) => goal.regions.every((region) => !isQuiet(region, profile)))
    .map((goal) => {
      const readings = evidenceFor(goal.id)
        .map((def) => report.metrics.find((metric) => metric.def.id === def.id))
        .filter((metric): metric is ScoredMetric => Boolean(metric));
      const deficits = readings.filter((metric) => !metric.implausible && metric.conformance < 0.9);
      const need = deficits.reduce((sum, metric) => sum + (1 - metric.conformance), 0);
      return { goal, need };
    })
    // Never infer an unmeasured skin, hair, teeth or body goal. Suggestions are
    // earned by a reliable measurement already present in the report.
    .filter((entry) => entry.need > 0)
    .sort((a, b) => b.need - a.need)
    .slice(0, 3)
    .map((entry) => entry.goal);
  return [...selectedDefs(profile), ...ranked];
}

function mergeTargets(report: Report, goals: GoalDef[]): MorphMetricTarget[] {
  const byId = new Map<string, MorphMetricTarget>();
  for (const goal of goals) {
    for (const def of evidenceFor(goal.id)) {
      const metric = report.metrics.find((candidate) => candidate.def.id === def.id);
      if (!metric) continue;
      const next = metricTarget(metric, goal.id);
      if (!next) continue;
      const previous = byId.get(next.id);
      if (!previous) {
        byId.set(next.id, next);
        continue;
      }
      previous.goalIds.push(goal.id);
      // Shared goals do not stack into an impossible target. Keep the more
      // ambitious of the same two evidence-based moves, once.
      if (Math.abs(next.target - next.current) > Math.abs(previous.target - previous.current)) {
        previous.target = next.target;
        previous.completionDelta = next.completionDelta;
      }
    }
  }
  return [...byId.values()].sort((a, b) => Math.abs(b.target - b.current) - Math.abs(a.target - a.current));
}

function mergeEffects(goals: GoalDef[]): MorphEffectVector {
  const effects = EMPTY_EFFECTS();
  for (const goal of goals) {
    const rule = MORPH_GOAL_RULES[goal.id];
    if (!rule) continue;
    for (const [id, amount] of Object.entries(rule.effects) as Array<[MorphEffectId, number]>) {
      effects[id] = clamp(effects[id] + amount, -1, 1);
    }
  }
  return effects;
}

export function buildMorphBlueprint(
  report: Report,
  profile: Profile,
  variant: MorphBlueprint["variant"],
  hasSide: boolean,
): MorphBlueprint {
  const defs = variant === "selected" ? selectedDefs(profile) : suggestedDefs(report, profile);
  const targets = mergeTargets(report, defs);
  const goals = defs.map((goal): MorphGoalPreview => {
    const rule = MORPH_GOAL_RULES[goal.id];
    const targetIds = targets.filter((target) => target.goalIds.includes(goal.id)).map((target) => target.id);
    return {
      id: goal.id,
      label: goal.label,
      timeframe: rule.timeframe,
      effortPoints: rule.effortPoints,
      views: rule.views.filter((view) => view === "front" || hasSide),
      visualSummary: rule.visualSummary,
      targetIds,
      measurable: targetIds.length > 0,
    };
  });
  return {
    version: 1,
    variant,
    sex: report.sex,
    goals,
    effects: mergeEffects(defs),
    targets,
    totalPoints: goals.reduce((sum, goal) => sum + goal.effortPoints, 0),
    hasFront: true,
    hasSide,
  };
}

export function morphBlueprints(report: Report, profile: Profile, hasSide: boolean): {
  selected: MorphBlueprint;
  maxVision: MorphBlueprint;
} {
  return {
    selected: buildMorphBlueprint(report, profile, "selected", hasSide),
    maxVision: buildMorphBlueprint(report, profile, "max_vision", hasSide),
  };
}
