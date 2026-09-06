import type { RenderLayer } from "./goalCatalogue.js";
import type { MorphEffectId } from "./morphPlan.js";

/** Shared client/server mapping. The goal catalogue still grants each layer. */
export const MORPH_EFFECT_LAYERS: Record<MorphEffectId, RenderLayer> = {
  facialFullness: "leanerPresentation",
  underEyePuffiness: "skinSurface",
  jawDefinition: "leanerPresentation",
  underChinFullness: "leanerPresentation",
  skinEvenness: "skinSurface",
  blemishVisibility: "skinSurface",
  browDefinition: "brows",
  hairFinish: "hair",
  smileFinish: "expression",
  posture: "posture",
  lighting: "lighting",
};
