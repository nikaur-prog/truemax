/** Bounded, photo-free coaching context. This is self-reported data, not instructions. */
export type CoachingRoutineStatus = "offered" | "declined" | "committed" | "running" | "judged";

export interface CoachingRoutine {
  id: string;
  title: string;
  status: CoachingRoutineStatus;
  startedAt: number | null;
  weeksToReview: number;
  tickDays: string[];
  checkIns: Array<{ at: number; using: boolean; noticing: boolean | null }>;
  /** Enough to restore an existing catalogue action, not to invent a new one. */
  restore?: { recId: string; offeredAt: number; startBy: number | null; metricId: string; start: "acquire" | "book" | "commit" | "instant" };
}

export interface CoachingSnapshot {
  goals: string[];
  endGoal: string;
  quietRegions: string[];
  excludedAdvice: string[];
  dietaryExclusions: string[];
  skinConcerns: string[];
  routines: CoachingRoutine[];
}

const STATUSES: CoachingRoutineStatus[] = ["offered", "declined", "committed", "running", "judged"];
const clean = (value: unknown, cap = 120): string => typeof value === "string"
  ? value.replace(/[<>\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim().slice(0, cap) : "";
const strings = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.slice(0, 12).map((item) => clean(item, 80)).filter(Boolean))] : [];
const stamp = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 8.64e15 ? value : null;

function sanitiseRestore(value: unknown): CoachingRoutine["restore"] {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const offeredAt = stamp(raw.offeredAt);
  if (typeof raw.recId !== "string" || !/^[a-zA-Z0-9_-]{1,40}$/.test(raw.recId) || !offeredAt) return undefined;
  if (!["acquire", "book", "commit", "instant"].includes(String(raw.start))) return undefined;
  const metricId = typeof raw.metricId === "string" && /^[a-zA-Z0-9_-]{0,40}$/.test(raw.metricId) ? raw.metricId : "";
  return { recId: raw.recId, offeredAt, startBy: stamp(raw.startBy), metricId, start: raw.start as NonNullable<CoachingRoutine["restore"]>["start"] };
}

export function sanitiseCoachingRoutine(value: unknown): CoachingRoutine | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(raw.id)) return null;
  const title = clean(raw.title);
  const status = STATUSES.find((state) => state === raw.status);
  if (!title || !status) return null;
  const tickDays = Array.isArray(raw.tickDays) ? [...new Set(raw.tickDays.filter((day): day is string => {
    if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
    const at = new Date(`${day}T12:00:00Z`);
    return Number.isFinite(at.getTime()) && at.toISOString().slice(0, 10) === day;
  }))].sort().slice(-7) : [];
  const checkIns = (Array.isArray(raw.checkIns) ? raw.checkIns : []).slice(-3).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const at = stamp(item.at);
    if (!at || typeof item.using !== "boolean") return [];
    return [{ at, using: item.using, noticing: typeof item.noticing === "boolean" ? item.noticing : null }];
  });
  return { id: raw.id, title, status, startedAt: stamp(raw.startedAt),
    weeksToReview: typeof raw.weeksToReview === "number" && Number.isFinite(raw.weeksToReview) ? Math.max(0, Math.min(104, raw.weeksToReview)) : 0,
    tickDays, checkIns, ...(sanitiseRestore(raw.restore) ? { restore: sanitiseRestore(raw.restore) } : {}) };
}

export function sanitiseCoachingSnapshot(value: unknown, adult = true): CoachingSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  return {
    goals: strings(raw.goals), endGoal: clean(raw.endGoal, 200), quietRegions: strings(raw.quietRegions),
    excludedAdvice: strings(raw.excludedAdvice), dietaryExclusions: adult ? strings(raw.dietaryExclusions) : [],
    skinConcerns: strings(raw.skinConcerns),
    routines: (Array.isArray(raw.routines) ? raw.routines : []).slice(-40)
      .map(sanitiseCoachingRoutine).filter((routine): routine is CoachingRoutine => routine !== null),
  };
}

export function routineMemoryState(status: CoachingRoutineStatus): "active" | "paused" | "completed" | "replaced" {
  return status === "running" ? "active" : status === "judged" ? "completed" : status === "declined" ? "replaced" : "paused";
}

export function mergeCoachingRoutine(previous: CoachingRoutine, next: CoachingRoutine): CoachingRoutine {
  if (previous.id !== next.id) return next;
  const stage = { offered: 0, committed: 1, running: 2, declined: 3, judged: 3 };
  const status = stage[previous.status] >= 3 || stage[previous.status] > stage[next.status] ? previous.status : next.status;
  const checkIns = new Map([...previous.checkIns, ...next.checkIns].map((check) => [check.at, check]));
  // The current tracker only postpones an already-due start. A stale cache
  // must not undo that decision or change a persisted action's definition.
  const restore = previous.restore && next.restore
    ? { ...previous.restore, startBy: Math.max(previous.restore.startBy ?? 0, next.restore.startBy ?? 0) || null }
    : previous.restore ?? next.restore;
  return { ...next, status, startedAt: previous.startedAt ?? next.startedAt,
    ...(restore ? { restore } : {}),
    tickDays: [...new Set([...previous.tickDays, ...next.tickDays])].sort().slice(-7),
    checkIns: [...checkIns.values()].sort((a, b) => a.at - b.at).slice(-3) };
}

/** One tracker per catalogue action, even when two devices first added it offline. */
export function dedupeCoachingRoutines(routines: readonly CoachingRoutine[]): CoachingRoutine[] {
  const byAction = new Map<string, CoachingRoutine>();
  for (const routine of [...routines].sort((a, b) => a.id.localeCompare(b.id))) {
    const legacyId = routine.id.match(/^(.+)-\d{10,16}$/)?.[1];
    const key = routine.restore?.recId ?? legacyId ?? `id:${routine.id}`;
    const previous = byAction.get(key);
    byAction.set(key, previous ? mergeCoachingRoutine(previous, { ...routine, id: previous.id }) : routine);
  }
  return [...byAction.values()];
}

export function routineEvidence(routine: CoachingRoutine): string {
  const start = routine.startedAt ? new Date(routine.startedAt).toISOString().slice(0, 10) : "not started";
  const check = routine.checkIns[routine.checkIns.length - 1];
  return `${routine.title}: ${routine.status}; start ${start}; review after ${routine.weeksToReview} weeks; recorded tick dates ${routine.tickDays.join(", ") || "none"}${check ? `; last check-in ${new Date(check.at).toISOString().slice(0, 10)}, using ${check.using}, noticed change ${check.noticing ?? "not answered"}` : ""}`;
}
