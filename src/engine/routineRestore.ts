import { mergeCoachingRoutine, sanitiseCoachingRoutine } from "./coachingSnapshot.js";
import type { CoachingRoutine } from "./coachingSnapshot.js";
import { RECS } from "./recommendations.js";
import { startKindFor } from "./protocol.js";
import type { Protocol } from "./protocol.js";

function fromRemote(routine: CoachingRoutine): Protocol | null {
  // Earlier snapshots used the catalogue id plus offered timestamp as their
  // stable identity. Only that exact known format may supply missing metadata.
  const legacy = routine.id.match(/^(.+)-(\d{10,16})$/);
  const recId = routine.restore?.recId ?? legacy?.[1];
  const rec = RECS.find((item) => item.id === recId);
  const offeredAt = routine.restore?.offeredAt ?? (legacy ? Number(legacy[2]) : NaN);
  if (!rec || !Number.isFinite(offeredAt) || offeredAt <= 0 || offeredAt > Date.now()) return null;
  if (routine.status === "running" && !routine.startedAt) return null;
  return {
    id: routine.id, recId: rec.id, title: routine.title, channel: rec.channel,
    metricId: routine.restore?.metricId ?? "", weeksToJudge: routine.weeksToReview,
    start: routine.restore?.start ?? startKindFor(rec), offeredAt,
    startBy: routine.restore?.startBy ?? null, startedAt: routine.startedAt,
    checkIns: routine.checkIns, ticks: routine.tickDays, status: routine.status,
    historyPartial: true,
  };
}

function snapshot(protocol: Protocol): CoachingRoutine {
  return sanitiseCoachingRoutine({ ...protocol, weeksToReview: protocol.weeksToJudge, tickDays: protocol.ticks,
    restore: { recId: protocol.recId, offeredAt: protocol.offeredAt, startBy: protocol.startBy,
      metricId: protocol.metricId, start: protocol.start ?? "acquire" } })!;
}

function mergeProtocol(previous: Protocol, next: Protocol): Protocol {
  const merged = mergeCoachingRoutine(snapshot(previous), { ...snapshot(next), id: previous.id });
  return { ...previous, title: merged.title, status: merged.status, startedAt: merged.startedAt,
    startBy: merged.restore?.startBy ?? (Math.max(previous.startBy ?? 0, next.startBy ?? 0) || null),
    ticks: [...new Set([...(previous.ticks ?? []), ...(next.ticks ?? [])])].sort(),
    checkIns: [...new Map([...previous.checkIns, ...next.checkIns].map((item) => [item.at, item])).values()].sort((a, b) => a.at - b.at),
    historyPartial: Boolean(previous.historyPartial && next.historyPartial) };
}

/** No writes, notifications, starts, completions or points occur in this merge. */
export function reconcileRoutineSnapshots(local: readonly Protocol[], remote: readonly unknown[]): Protocol[] {
  const restored = remote.map(sanitiseCoachingRoutine).filter((item): item is CoachingRoutine => item !== null)
    .map((routine) => {
      const existing = local.find((protocol) => protocol.id === routine.id);
      return existing ? { ...existing, title: routine.title, status: routine.status, startedAt: routine.startedAt,
        startBy: routine.restore?.startBy ?? existing.startBy, ticks: routine.tickDays,
        checkIns: routine.checkIns, historyPartial: true } : fromRemote(routine);
    }).filter((item): item is Protocol => item !== null);
  const byRecommendation = new Map<string, Protocol>();
  // Server identities come first. Terminal states are monotonic, including
  // duplicates created on two offline devices before either could sync.
  for (const protocol of [...restored, ...local]) {
    const previous = byRecommendation.get(protocol.recId);
    byRecommendation.set(protocol.recId, previous ? mergeProtocol(previous, protocol) : protocol);
  }
  const result = [...byRecommendation.values()];
  if (result.length > 40) throw new Error("More routines are saved than this device can restore safely. Your existing routine data has not been replaced.");
  return result;
}
