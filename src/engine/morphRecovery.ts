import { GOAL_CATALOGUE_VERSION } from "./goalCatalogue.js";
import { MORPH_EFFECT_LAYERS } from "./morphEffects.js";
import type { MorphBlueprint } from "./morphPlan.js";

export interface SavedMorphPreview {
  jobId: string;
  status: "processing" | "ready" | "failed";
  createdAt: string;
  expiresAt: string;
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** The exact numerical recipe, not display labels, identifies recoverable work. */
export async function storedMorphRecipeKey(value: unknown): Promise<string | null> {
  if (!record(value) || value.contract !== "morph-preview-1" || value.catalogueVersion !== GOAL_CATALOGUE_VERSION
    || !["selected", "max_vision"].includes(String(value.variant)) || typeof value.hasSide !== "boolean"
    || !Array.isArray(value.goalIds) || !value.goalIds.length || value.goalIds.length > 40
    || !value.goalIds.every((id) => typeof id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(id)) || !record(value.recipe)) return null;
  const recipe = value.recipe;
  if (recipe.version !== 1 || recipe.status !== "illustrative" || !Array.isArray(recipe.effects) || recipe.effects.length > 20
    || !Array.isArray(recipe.targets) || recipe.targets.length > 60) return null;
  const effects: Array<[string, number]> = [];
  const targets: Array<[string, string, number, number]> = [];
  for (const effect of recipe.effects) {
    if (!record(effect) || typeof effect.id !== "string" || !Object.prototype.hasOwnProperty.call(MORPH_EFFECT_LAYERS, effect.id)
      || typeof effect.amount !== "number" || !Number.isFinite(effect.amount) || Math.abs(effect.amount) > 1) return null;
    if (effect.amount) effects.push([effect.id, effect.amount]);
  }
  for (const target of recipe.targets) {
    if (!record(target) || typeof target.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(target.id)
      || (target.view !== "front" && target.view !== "side") || (target.view === "side" && !value.hasSide)
      || typeof target.baseline !== "number" || typeof target.target !== "number"
      || ![target.baseline, target.target].every((number) => Number.isFinite(number) && Math.abs(number) <= 1_000_000)) return null;
    targets.push([target.id, target.view, target.baseline, target.target]);
  }
  if (new Set(effects.map(([id]) => id)).size !== effects.length || new Set(targets.map(([id]) => id)).size !== targets.length) return null;
  const byId = ([a]: [string, ...unknown[]], [b]: [string, ...unknown[]]) => a < b ? -1 : a > b ? 1 : 0;
  effects.sort(byId);
  targets.sort(byId);
  const canonical = JSON.stringify([1, value.catalogueVersion, value.variant, value.hasSide, [...new Set(value.goalIds)].sort(), effects, targets]);
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function blueprintRecoveryKey(blueprint: MorphBlueprint): Promise<string> {
  const key = await storedMorphRecipeKey({ contract: "morph-preview-1", catalogueVersion: GOAL_CATALOGUE_VERSION,
    variant: blueprint.variant, hasSide: blueprint.hasSide, goalIds: blueprint.goals.map((goal) => goal.id),
    recipe: { version: 1, status: "illustrative", effects: Object.entries(blueprint.effects).map(([id, amount]) => ({ id, amount })),
      targets: blueprint.targets.map((target) => ({ id: target.id, view: target.view, baseline: target.current, target: target.target })) } });
  if (!key) throw new Error("The preview recipe could not be matched safely.");
  return key;
}

export interface MorphRecoveryMatch { scanId: string; recipeKey: string; requestId?: string }

// This marker records an uncertain upload, never pixels, tokens or a verdict.
// The server remains the authority on ownership, expiry and recipe matching.
export interface MorphRequestMarker { startedAt: number; requestId: string }
type MarkerStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
function markerKey(owner: string, match: MorphRecoveryMatch): string {
  return `truemax:morph-request:v1:${encodeURIComponent(owner)}:${match.scanId}:${match.recipeKey}`;
}
function browserStorage(): MarkerStorage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}
export function readMorphRequestMarker(owner: string, match: MorphRecoveryMatch, storage = browserStorage()): MorphRequestMarker | null {
  try {
    const value = JSON.parse(storage?.getItem(markerKey(owner, match)) ?? "null");
    return record(value) && typeof value.startedAt === "number" && Number.isFinite(value.startedAt) && value.startedAt > 0
      && typeof value.requestId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.requestId)
      ? { startedAt: value.startedAt, requestId: value.requestId } : null;
  } catch { return null; }
}
export function writeMorphRequestMarker(owner: string, match: MorphRecoveryMatch, value: MorphRequestMarker | null, storage = browserStorage()): void {
  try {
    if (value) storage?.setItem(markerKey(owner, match), JSON.stringify({ startedAt: value.startedAt, requestId: value.requestId }));
    else storage?.removeItem(markerKey(owner, match));
  } catch { /* A read-only server lookup still protects recovery when storage is unavailable. */ }
}
