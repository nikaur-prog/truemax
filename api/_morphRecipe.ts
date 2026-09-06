import { evidenceFor } from "../src/engine/goalEvidence.js";
import { goalEffect, type RenderLayer } from "../src/engine/goalCatalogue.js";
import { directionFor, distFor } from "../src/engine/metrics.js";
import { toleranceOf } from "../src/engine/scoring.js";
import { MORPH_EFFECT_LAYERS } from "../src/engine/morphEffects.js";
import type { MorphEffectId } from "../src/engine/morphPlan.js";

export interface MorphNumericRecipe {
  version: 1;
  status: "illustrative";
  effects: Array<{ id: MorphEffectId; amount: number }>;
  targets: Array<{
    id: string;
    label: string;
    view: "front" | "side";
    unit: string;
    baseline: number;
    target: number;
    allowedRange: [number, number];
  }>;
}

/** Discard display copy. Only catalogue IDs, bounded numbers and server labels reach the provider. */
export function parseMorphNumericRecipe(
  blueprint: Record<string, unknown>, goalIds: string[], layers: RenderLayer[], hasSide: boolean,
): MorphNumericRecipe | { error: string } {
  const rawTargets = blueprint.targets ?? [];
  if (!Array.isArray(rawTargets) || rawTargets.length > 60) return { error: "The measurement recipe is malformed." };
  if (rawTargets.length && blueprint.sex !== "male" && blueprint.sex !== "female") return { error: "The measurement recipe needs its reference selection." };
  const sex = blueprint.sex === "female" ? "female" : "male";
  const effects: MorphNumericRecipe["effects"] = [];
  for (const [id, amount] of Object.entries((blueprint.effects ?? {}) as Record<string, unknown>)) {
    if (!Object.prototype.hasOwnProperty.call(MORPH_EFFECT_LAYERS, id)) return { error: "The effect recipe is invalid." };
    const layer = MORPH_EFFECT_LAYERS[id as MorphEffectId];
    if (!layer || typeof amount !== "number" || !Number.isFinite(amount) || Math.abs(amount) > 1) return { error: "The effect recipe is invalid." };
    if (amount && layers.includes(layer)) effects.push({ id: id as MorphEffectId, amount });
  }
  const targets: MorphNumericRecipe["targets"] = [];
  const seen = new Set<string>();
  for (const value of rawTargets) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "A measurement target is malformed." };
    const raw = value as Record<string, unknown>;
    const eligible = goalIds.flatMap((id) => {
      const goal = goalEffect(id);
      if (!goal?.measures.includes(String(raw.id))) return [];
      return evidenceFor(id).filter((metric) => metric.id === raw.id).map((def) => ({ goal, def }));
    });
    const def = eligible[0]?.def;
    if (!def || seen.has(def.id) || raw.view !== def.view || (!hasSide && def.view === "side")) return { error: "A measurement is not allowed for these goals and supplied views." };
    seen.add(def.id);
    const baseline = raw.current, target = raw.target;
    if (typeof baseline !== "number" || typeof target !== "number" || ![baseline, target].every(Number.isFinite)
      || Math.abs(baseline) > 1_000_000 || Math.abs(target) > 1_000_000) return { error: "A measurement value is invalid." };
    if (def.plausible && [baseline, target].some((number) => number < def.plausible![0] || number > def.plausible![1])) return { error: "A measurement falls outside its geometry bounds." };
    const dist = distFor(def, sex), direction = directionFor(def, sex);
    const centre = dist.ideal ?? dist.mean, tolerance = toleranceOf(def) * dist.sd;
    // Reproduce the existing display reference, not a new scientific ideal.
    // The catalogue's movement ceiling is a conservative illustration budget.
    const band: [number, number] = direction === "higher" ? [dist.mean + 0.3 * dist.sd, dist.mean + 1.5 * dist.sd]
      : direction === "lower" ? [Math.max(0, dist.mean - 1.5 * dist.sd), dist.mean - 0.3 * dist.sd]
      : [centre - tolerance, centre + tolerance];
    const edge = baseline < band[0] ? band[0] : baseline > band[1] ? band[1] : baseline;
    const share = Math.min(0.85, def.fixability * Math.max(...eligible.map(({ goal }) => goal.movement.high)));
    const limit = baseline + (edge - baseline) * share;
    const step = 10 ** -def.decimals;
    const delta = target - baseline;
    if (!delta || !share || Math.sign(delta) !== Math.sign(edge - baseline)
      || Math.abs(delta) > Math.abs(limit - baseline) + step) return { error: "A target exceeds the catalogue's illustrative movement budget." };
    targets.push({ id: def.id, label: def.name, view: def.view, unit: def.unit, baseline, target, allowedRange: [Math.min(baseline, target), Math.max(baseline, target)] });
  }
  return { version: 1, status: "illustrative", effects, targets };
}
