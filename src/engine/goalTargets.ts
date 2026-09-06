import { GOAL_CATALOGUE_VERSION, goalEffect } from "./goalCatalogue.js";
import { evidenceFor } from "./goalEvidence.js";
import { CURRENT_SCORE_VERSION } from "./history.js";
import { activeScanOwner, scopedStorageKey } from "./scanScope.js";
import { isScanId } from "./scanSession.js";
import type { MorphBlueprint, MorphMetricTarget } from "./morphPlan.js";
import type { Report } from "./types.js";

/** A deliberately illustrative target, not a clinically validated outcome. */
export interface GoalTargetDraft {
  version: 1;
  status: "illustrative";
  catalogueVersion: string;
  scoreVersion: number;
  scanId: string;
  createdAt: string;
  sex: MorphBlueprint["sex"];
  goalIds: string[];
  targets: MorphMetricTarget[];
}

const KEY = "truemax:goal-target-draft:v1";
const signature = (ids: readonly string[]) => [...new Set(ids)].sort().join(",");
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function createGoalTargetDraft(plan: MorphBlueprint, scanId: string, now = new Date()): GoalTargetDraft | null {
  if (plan.variant !== "selected" || !isScanId(scanId) || !plan.targets.length || plan.targets.length > 48) return null;
  const draft: GoalTargetDraft = {
    version: 1,
    status: "illustrative",
    catalogueVersion: GOAL_CATALOGUE_VERSION,
    scoreVersion: CURRENT_SCORE_VERSION,
    scanId,
    createdAt: now.toISOString(),
    sex: plan.sex,
    goalIds: plan.goals.map((goal) => goal.id).sort(),
    targets: clone(plan.targets),
  };
  return parseGoalTargetDraft(draft);
}

export function parseGoalTargetDraft(value: unknown): GoalTargetDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const d = value as GoalTargetDraft;
  if (d.version !== 1 || d.status !== "illustrative" || d.catalogueVersion !== GOAL_CATALOGUE_VERSION
    || d.scoreVersion !== CURRENT_SCORE_VERSION || !isScanId(d.scanId)
    || typeof d.createdAt !== "string" || !Number.isFinite(Date.parse(d.createdAt))
    || (d.sex !== "male" && d.sex !== "female")
    || !Array.isArray(d.goalIds) || !d.goalIds.length || d.goalIds.length > 20
    || new Set(d.goalIds).size !== d.goalIds.length
    || !d.goalIds.every((id) => typeof id === "string" && goalEffect(id))
    || !Array.isArray(d.targets) || !d.targets.length || d.targets.length > 48) return null;
  const ids = new Set<string>();
  for (const t of d.targets) {
    if (!t || typeof t.id !== "string" || !/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(t.id)
      || ids.has(t.id) || typeof t.name !== "string" || t.name.length > 160
      || !["front", "side"].includes(t.view) || !Number.isFinite(t.current) || !Number.isFinite(t.target)
      || Math.abs(t.current) > 10000 || Math.abs(t.target) > 10000
      || !Number.isFinite(t.completionDelta) || t.completionDelta < 0
      || !Number.isInteger(t.decimals) || t.decimals < 0 || t.decimals > 6
      || typeof t.unit !== "string" || t.unit.length > 20
      || !Array.isArray(t.goalIds) || !t.goalIds.length || t.goalIds.length > 20
      || !t.goalIds.every((id) => d.goalIds.includes(id) && goalEffect(id)?.measures.includes(t.id))) return null;
    const def = evidenceFor(t.goalIds[0]).find((metric) => metric.id === t.id);
    if (!def || def.view !== t.view || def.unit !== t.unit || def.decimals !== t.decimals || t.current === t.target
      || (def.plausible && [t.current, t.target].some((number) => number < def.plausible![0] || number > def.plausible![1]))) return null;
    ids.add(t.id);
  }
  const safe = clone(d);
  for (const target of safe.targets) target.name = evidenceFor(target.goalIds[0]).find((metric) => metric.id === target.id)!.name;
  return safe;
}

/** Changed goals/units/method never silently move an accepted target. */
export function draftMatchesPlan(draft: GoalTargetDraft, plan: MorphBlueprint): boolean {
  if (!parseGoalTargetDraft(draft) || draft.sex !== plan.sex || draft.catalogueVersion !== GOAL_CATALOGUE_VERSION
    || draft.scoreVersion !== CURRENT_SCORE_VERSION || plan.variant !== "selected"
    || signature(draft.goalIds) !== signature(plan.goals.map((goal) => goal.id))) return false;
  return draft.targets.every((target) => {
    const metric = plan.targets.find((item) => item.id === target.id);
    // A metric can disappear after entering its reference band or a side skip.
    // Its saved target remains intact, but is not rendered without that view.
    return !metric || (target.unit === metric.unit && target.decimals === metric.decimals && target.view === metric.view);
  });
}

/** Keep markers fixed, but never force an old illustration onto an incompatible current photo. */
export function heldTargetRenderState(draft: GoalTargetDraft, plan: MorphBlueprint, report: Report, sideVerified: boolean): {
  targets: MorphMetricTarget[];
  reachedIds: string[];
  heldIds: string[];
  renderHoldReason?: string;
} {
  const targets: MorphMetricTarget[] = [], reachedIds: string[] = [], heldIds: string[] = [];
  if (!draftMatchesPlan(draft, plan)) return { targets, reachedIds, heldIds: draft.targets.map((target) => target.id), renderHoldReason: "The saved draft no longer matches these goals or measurement definitions. Review it before creating another preview." };
  for (const target of draft.targets) {
    const measured = report.metrics.find((metric) => metric.def.id === target.id);
    if (!measured || measured.implausible || !Number.isFinite(measured.value)
      || measured.def.view !== target.view || measured.def.unit !== target.unit || measured.def.decimals !== target.decimals
      || (target.view === "side" && (!plan.hasSide || !sideVerified))) {
      heldIds.push(target.id);
      continue;
    }
    const direction = Math.sign(target.target - target.current);
    if ((target.target - measured.value) * direction <= 0) {
      reachedIds.push(target.id);
      continue;
    }
    const allowed = plan.targets.find((metric) => metric.id === target.id);
    if (!allowed || Math.sign(allowed.target - measured.value) !== direction
      || Math.abs(target.target - measured.value) > Math.abs(allowed.target - measured.value) + 10 ** -target.decimals) {
      heldIds.push(target.id);
      continue;
    }
    targets.push({ ...clone(target), current: measured.value });
  }
  const renderHoldReason = heldIds.length
    ? "Your saved markers stay fixed. A target is outside this photo's permitted illustration budget or needs a comparable verified view, so the combined preview is paused. Review your draft or take a comparable scan."
    : reachedIds.length
      ? "This reading already meets or passes a draft marker. That does not confirm biological progress or earn points. No further edit is requested for it; review your goals before creating another combined preview."
      : undefined;
  return { targets, reachedIds, heldIds, ...(renderHoldReason ? { renderHoldReason } : {}) };
}

/** Read/write only the current signed-in owner's device-local draft. */
export function readGoalTargetDraft(): GoalTargetDraft | null {
  if (!activeScanOwner()?.startsWith("user:")) return null;
  const key = scopedStorageKey(KEY);
  if (!key) return null;
  try { return parseGoalTargetDraft(JSON.parse(localStorage.getItem(key) ?? "null")); }
  catch { return null; }
}

export function saveGoalTargetDraft(draft: GoalTargetDraft, expectedOwner: string | null): boolean {
  if (!expectedOwner?.startsWith("user:") || activeScanOwner() !== expectedOwner) return false;
  const safe = parseGoalTargetDraft(draft);
  const key = scopedStorageKey(KEY);
  if (!safe || !key) return false;
  try { localStorage.setItem(key, JSON.stringify(safe)); return true; }
  catch { return false; }
}

export function clearGoalTargetDraft(expectedOwner: string | null): boolean {
  if (!expectedOwner?.startsWith("user:") || activeScanOwner() !== expectedOwner) return false;
  const key = scopedStorageKey(KEY);
  if (!key) return false;
  try { localStorage.removeItem(key); return true; }
  catch { return false; }
}

/** Pure evaluator for a future reviewed evidence rule. It never awards points. */
export function assessTargetProgress(input: {
  baseline: number;
  target: readonly [number, number];
  readings: readonly number[];
  noiseFloor: number | null;
  comparable: boolean;
}): { status: "unable_to_assess" | "needs_repeat" | "confirmed"; progress: number | null } {
  const { baseline, target: [lo, hi], readings, noiseFloor, comparable } = input;
  if (!comparable || noiseFloor === null || !Number.isFinite(noiseFloor) || noiseFloor <= 0
    || ![baseline, lo, hi, ...readings].every(Number.isFinite) || lo > hi) return { status: "unable_to_assess", progress: null };
  const distance = (value: number) => Math.max(lo - value, 0, value - hi);
  const start = distance(baseline);
  if (start <= noiseFloor || !readings.length) return { status: "unable_to_assess", progress: null };
  const recent = readings.slice(-3);
  const progress = recent.map((value) => start - distance(value) > noiseFloor
    ? Math.max(0, Math.min(1, 1 - distance(value) / start)) : 0).sort((a, b) => b - a);
  // The second-best of three requires repeated improvement, not one lucky shot.
  if (progress.length < 2 || progress[1] <= 0) return { status: "needs_repeat", progress: null };
  return { status: "confirmed", progress: progress[1] };
}
