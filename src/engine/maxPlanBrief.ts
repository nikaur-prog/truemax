import { GOALS, loadProfile, saveProfile } from "./goals.js";
import type { Profile } from "./goals.js";
import { activeScanOwner } from "./scanScope.js";

export interface CoachPlanBrief {
  goals: string[];
  endGoal: string;
  currentRoutine: string;
}

const text = (value: unknown, cap: number): string => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, cap) : "";

export function cleanCoachPlanBrief(value: unknown): CoachPlanBrief {
  const brief = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  return {
    goals: [...new Set(Array.isArray(brief.goals) ? brief.goals : [])]
      .filter((id): id is string => typeof id === "string" && GOALS.some((goal) => goal.id === id)).slice(0, 3),
    endGoal: text(brief.endGoal, 140),
    currentRoutine: text(brief.currentRoutine, 170),
  };
}

/** User-authored request, not a system instruction or an automatically saved routine. */
export function coachPlanQuestion(brief: CoachPlanBrief): string {
  const clean = cleanCoachPlanBrief(brief);
  const labels = clean.goals.map((id) => GOALS.find((goal) => goal.id === id)!.label);
  return [
    "Build a practical plan with up to three priorities.",
    labels.length ? `My focus: ${labels.join(", ")}.` : "Help me choose a focus first.",
    clean.endGoal ? `What I want: ${clean.endGoal}` : "",
    clean.currentRoutine ? `What I already use or need you to work around: ${clean.currentRoutine}` : "",
    "Use my existing routines where relevant. Explain what to do and why. Do not save new routines yet.",
  ].filter(Boolean).join("\n").slice(0, 600);
}

/** Save only the fields reviewed here, never a stale copy of the entire profile. */
export function saveCoachPlanBrief(brief: CoachPlanBrief, owner: string): boolean {
  if (!owner.startsWith("user:") || activeScanOwner() !== owner) return false;
  const clean = cleanCoachPlanBrief(brief);
  const current: Profile = loadProfile();
  saveProfile({ ...current, goals: clean.goals, endGoal: clean.endGoal });
  const saved = loadProfile();
  return activeScanOwner() === owner && saved.endGoal === clean.endGoal
    && JSON.stringify(saved.goals) === JSON.stringify(clean.goals);
}
