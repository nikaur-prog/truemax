import { activeScanOwner, scopedStorageKey } from "./scanScope.js";
import { sanitiseCoachingRoutine, mergeCoachingRoutine } from "./coachingSnapshot.js";
import type { CoachingRoutine } from "./coachingSnapshot.js";
import type { Protocol } from "./protocol.js";

const KEY = "truemax:routine-sync-pending:v1";
export interface PendingRoutineSync { v: 1; revision: string; items: CoachingRoutine[] }

export function routineSnapshots(protocols: readonly Protocol[]): CoachingRoutine[] {
  return protocols.map((p) => sanitiseCoachingRoutine({ id: p.id, title: p.title, status: p.status, startedAt: p.startedAt,
    weeksToReview: p.weeksToJudge, tickDays: p.ticks ?? [], checkIns: p.checkIns,
    restore: { recId: p.recId, offeredAt: p.offeredAt, startBy: p.startBy, metricId: p.metricId, start: p.start ?? "acquire" },
  })).filter((p): p is CoachingRoutine => p !== null);
}

function keyFor(owner: string): string {
  if (!owner.startsWith("user:") || owner !== activeScanOwner()) throw new Error("The signed-in account changed. Reopen Coach to sync its routines.");
  return scopedStorageKey(KEY)!;
}

export function readPendingRoutineSync(owner: string): PendingRoutineSync | null {
  const raw = localStorage.getItem(keyFor(owner));
  if (!raw) return null;
  if (raw.length > 100_000) throw new Error("The pending routine sync record is too large to read safely.");
  const queue = JSON.parse(raw) as PendingRoutineSync;
  if (queue?.v !== 1 || typeof queue.revision !== "string" || queue.revision.length > 100 || !Array.isArray(queue.items) || queue.items.length > 40) {
    throw new Error("The pending routine sync record could not be read. Export a private backup before clearing device data.");
  }
  const items = queue.items.map(sanitiseCoachingRoutine);
  if (items.some((item) => item === null)) throw new Error("The pending routine sync record contains an invalid item.");
  return { v: 1, revision: queue.revision, items: items as CoachingRoutine[] };
}

/** This is only the bounded account snapshot. The device store retains full local history. */
export function queueRoutineSync(items: readonly CoachingRoutine[], owner: string): PendingRoutineSync | null {
  const key = keyFor(owner);
  const prior = readPendingRoutineSync(owner);
  const byId = new Map((prior?.items ?? []).map((item) => [item.id, item]));
  for (const value of items) {
    const next = sanitiseCoachingRoutine(value);
    if (!next) throw new Error("A routine could not be prepared for account sync.");
    const previous = byId.get(next.id);
    byId.set(next.id, previous ? mergeCoachingRoutine(previous, next) : next);
  }
  if (byId.size > 40) throw new Error("Too many pending routines to sync safely. Export a private backup first.");
  if (!byId.size) return null;
  const merged = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (prior && JSON.stringify(prior.items) === JSON.stringify(merged)) return prior;
  const queue: PendingRoutineSync = { v: 1, revision: crypto.randomUUID(), items: merged };
  const encoded = JSON.stringify(queue);
  localStorage.setItem(key, encoded);
  if (localStorage.getItem(key) !== encoded) throw new Error("Pending routine sync could not be saved on this device.");
  return queue;
}

/** A late success cannot acknowledge newer local work or another account. */
export function acknowledgeRoutineSync(revision: string, owner: string): void {
  const key = keyFor(owner);
  if (readPendingRoutineSync(owner)?.revision === revision) localStorage.removeItem(key);
}

export function routineSyncStatus(): "pending" | "no-pending" | "unavailable" | "signed-out" {
  const owner = activeScanOwner();
  if (!owner?.startsWith("user:")) return "signed-out";
  try { return readPendingRoutineSync(owner) ? "pending" : "no-pending"; }
  catch { return "unavailable"; }
}
