import { sanitiseCoachingRoutine, sanitiseCoachingSnapshot, routineMemoryState, dedupeCoachingRoutines, mergeCoachingRoutine as mergeRoutineEvidence } from "../src/engine/coachingSnapshot.js";
import type { getSupabaseAdmin } from "./_shared.js";
import { normalisePlanTitle } from "./_maxConversation.js";
import type { CoachingRoutine, CoachingSnapshot } from "../src/engine/coachingSnapshot.js";

export { mergeRoutineEvidence };

/** Server memory replaces stale device plan labels, including for older clients. */
export async function hydrateRoutineContext(context: { coaching?: CoachingSnapshot; activePlan: string[] }, admin: ReturnType<typeof getSupabaseAdmin>, userId: string, now: string): Promise<void> {
  if (context.coaching) await syncRoutineMemory(admin, userId, context.coaching.routines, now);
  const routines = await loadRoutineMemory(admin, userId);
  context.coaching = { ...(context.coaching ?? sanitiseCoachingSnapshot({})!), routines };
  context.activePlan = [];
}

/** Read action records separately from chat-authored plan notes, including tombstones. */
export async function loadRoutineMemory(admin: ReturnType<typeof getSupabaseAdmin>, userId: string): Promise<CoachingRoutine[]> {
  const saved = await admin.from("max_plan_items").select("normalized_title,status,notes")
    .eq("user_id", userId).like("normalized_title", "protocol:%")
    .is("source_conversation_id", null).order("normalized_title", { ascending: true }).limit(201);
  if (saved.error) throw new Error(`Routine memory could not be restored: ${saved.error.message}`);
  // Do not silently drop older completed/declined states and resurrect a duplicate.
  if ((saved.data?.length ?? 0) > 200) throw new Error("Routine memory is too large to restore safely in one request.");
  return dedupeCoachingRoutines((saved.data ?? []).flatMap((row) => {
    try {
      const routine = sanitiseCoachingRoutine(JSON.parse(row.notes).protocol);
      if (!routine || row.normalized_title !== `protocol:${routine.id}`) return [];
      if (row.status === "completed") routine.status = "judged";
      if (row.status === "replaced") routine.status = "declined";
      return [routine];
    } catch { return []; }
  }));
}

/** Only explicit local routine identities may update a synced routine's lifecycle. */
export function routineSyncRows(value: unknown, userId: string, now: string) {
  const byId = new Map<string, NonNullable<ReturnType<typeof sanitiseCoachingRoutine>>>();
  for (const item of (Array.isArray(value) ? value : []).slice(-40)) {
    const routine = sanitiseCoachingRoutine(item);
    if (routine) byId.set(routine.id, routine);
  }
  return [...byId.values()].map((routine) => ({
    user_id: userId, title: routine.title, normalized_title: `protocol:${routine.id}`,
    category: "other", status: routineMemoryState(routine.status),
    notes: JSON.stringify({ protocol: routine }), updated_at: now,
  }));
}

export async function syncRoutineMemory(admin: ReturnType<typeof getSupabaseAdmin>, userId: string, value: unknown, now = new Date().toISOString()): Promise<CoachingRoutine[]> {
  const rows = routineSyncRows(value, userId, now);
  if (!rows.length) return [];
  const existing = await admin.from("max_plan_items").select("id,title,normalized_title,status,notes")
    .eq("user_id", userId).in("normalized_title", rows.map((row) => row.normalized_title));
  if (existing.error) throw new Error(`Routine memory could not be read: ${existing.error.message}`);
  const synced = await Promise.all(rows.map(async (row) => {
    const next = JSON.parse(row.notes).protocol as CoachingRoutine;
    let prior = existing.data?.find((item) => item.normalized_title === row.normalized_title);
    // Compare-and-set prevents a request which read "running" from overwriting
    // a concurrently completed routine. An insert race follows the same merge.
    for (let attempt = 0; attempt < 3; attempt++) {
      let merged = next;
      if (prior) {
        try {
          const previous = sanitiseCoachingRoutine(JSON.parse(prior.notes).protocol);
          if (previous) merged = mergeRoutineEvidence(previous, next);
        } catch { /* Legacy free text cannot establish the detailed lifecycle. */ }
        if (prior.status === "completed") merged = { ...merged, status: "judged" };
        if (prior.status === "replaced") merged = { ...merged, status: "declined" };
      }
      const update = { title: merged.title, status: routineMemoryState(merged.status),
        notes: JSON.stringify({ protocol: merged }), updated_at: now };
      if (prior?.notes === update.notes && prior.status === update.status && prior.title === update.title) return merged;
      if (prior) {
        let query = admin.from("max_plan_items").update(update)
          .eq("user_id", userId).eq("id", prior.id).eq("status", prior.status);
        query = prior.notes === null ? query.is("notes", null) : query.eq("notes", prior.notes);
        const saved = await query.select("id");
        if (saved.error) throw new Error(`Routine memory could not be saved: ${saved.error.message}`);
        if (saved.data?.length) return merged;
      } else {
        const saved = await admin.from("max_plan_items").insert({ ...row, ...update }).select("id");
        if (!saved.error && saved.data?.length) return merged;
        if (saved.error && saved.error.code !== "23505") throw new Error(`Routine memory could not be saved: ${saved.error.message}`);
      }
      const latest = await admin.from("max_plan_items").select("id,title,normalized_title,status,notes")
        .eq("user_id", userId).eq("normalized_title", row.normalized_title).maybeSingle();
      if (latest.error) throw new Error(`Routine memory could not be refreshed: ${latest.error.message}`);
      prior = latest.data ?? undefined;
    }
    throw new Error("This routine changed on another device. Reopen Coach to sync the latest state, then try again.");
  }));
  // Retire only the exact title-only rows created by the old device sync.
  // Chat-authored memory has a source conversation and is deliberately retained.
  const retired = await admin.from("max_plan_items")
    .update({ status: "replaced", updated_at: now })
    .eq("user_id", userId)
    .in("normalized_title", rows.map((row) => normalisePlanTitle(row.title)))
    .eq("notes", "")
    .is("source_conversation_id", null);
  if (retired.error) throw new Error(`Old routine memory could not be reconciled: ${retired.error.message}`);
  return synced;
}
