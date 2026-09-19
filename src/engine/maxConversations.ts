import { currentAccessToken } from "./auth.js";
import { activeScanOwner } from "./scanScope.js";
import type { CoachingRoutine } from "./coachingSnapshot.js";
import { sanitiseCoachingRoutine } from "./coachingSnapshot.js";
import { readProtocols, writeProtocols } from "./protocol.js";
import { reconcileRoutineSnapshots } from "./routineRestore.js";
import { queueRoutineSync, acknowledgeRoutineSync, readPendingRoutineSync, routineSnapshots } from "./routineSyncQueue.js";

export interface MaxConversationSummary {
  id: string;
  title: string;
  source: "dashboard" | "post_analysis";
  created_at: string;
  updated_at: string;
  last_message_at: string;
}

export interface MaxConversationMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface MaxPlanItem {
  id: string;
  title: string;
  category: string;
  status: "active" | "paused" | "not_working" | "completed" | "replaced";
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface RoutineRestoration {
  restored: number;
  historyPartial: boolean;
  error?: string;
}

interface ConversationListResponse {
  conversations: MaxConversationSummary[];
  planItems: MaxPlanItem[];
  routines?: CoachingRoutine[];
  routineRestoration?: RoutineRestoration;
}

export interface MaxConversationDetail {
  conversation: MaxConversationSummary;
  messages: MaxConversationMessage[];
  planItems: MaxPlanItem[];
  routines?: CoachingRoutine[];
  routineRestoration?: RoutineRestoration;
}

async function request<T>(path: string): Promise<T> {
  const owner = activeScanOwner();
  const token = await currentAccessToken();
  if (!token || !owner?.startsWith("user:") || activeScanOwner() !== owner) throw new Error("Sign in to see your Max chats.");
  const response = await fetch(path, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (activeScanOwner() !== owner) throw new Error("The signed-in account changed. Reopen Coach to load its chats.");
  if (!response.ok || !body) throw new Error(body?.error || "Your Max chats are not available right now.");
  return body;
}

function restoreRoutines(routines: unknown, owner: string | null): RoutineRestoration {
  if (!owner?.startsWith("user:") || activeScanOwner() !== owner || !Array.isArray(routines)) return { restored: 0, historyPartial: false };
  const current = readProtocols();
  try {
    const reconciled = reconcileRoutineSnapshots(current, routines);
    const changed = JSON.stringify(current) !== JSON.stringify(reconciled);
    if (changed) {
      writeProtocols(reconciled, { sync: false });
      if (JSON.stringify(readProtocols()) !== JSON.stringify(reconciled)) throw new Error("Routines could not be restored on this device. Check available storage and reopen Coach to retry.");
    }
    return { restored: reconciled.filter((item) => !current.some((local) => local.recId === item.recId)).length,
      historyPartial: reconciled.some((item) => item.historyPartial === true) };
  } catch (error) {
    return { restored: 0, historyPartial: current.some((item) => item.historyPartial === true),
      error: error instanceof Error ? error.message : "Routine restoration failed. Reopen Coach to retry." };
  }
}

export async function listMaxConversations(): Promise<ConversationListResponse> {
  const owner = activeScanOwner();
  const result = await request<ConversationListResponse>("/api/max-conversations");
  return { ...result, routineRestoration: restoreRoutines(result.routines, owner) };
}

export async function loadMaxConversation(id: string): Promise<MaxConversationDetail> {
  const owner = activeScanOwner();
  const result = await request<MaxConversationDetail>(`/api/max-conversations?id=${encodeURIComponent(id)}`);
  return { ...result, routineRestoration: restoreRoutines(result.routines, owner) };
}

export async function syncMaxPlanItems(items: readonly CoachingRoutine[]): Promise<void> {
  const owner = activeScanOwner();
  if (!owner?.startsWith("user:")) return;
  // Read the latest device state, not just the snapshot captured by a caller
  // before another tick or check-in. The persisted queue also keeps retries.
  const pending = queueRoutineSync([...items, ...routineSnapshots(readProtocols())], owner);
  if (!pending) return;
  const controller = new AbortController();
  const timeoutError = new Error("Routine sync timed out. Your changes remain on this device and will be retried.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(timeoutError); }, 15_000);
  });
  const run = async (): Promise<void> => {
    const token = await currentAccessToken();
    if (controller.signal.aborted) throw timeoutError;
    if (!token || owner !== activeScanOwner()) throw new Error("Sign in to sync your pending routine changes.");
    const response = await fetch("/api/max-conversations", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ items: pending.items }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null) as { error?: string; routines?: unknown[] } | null;
    if (controller.signal.aborted) throw timeoutError;
    if (!response.ok) {
      throw new Error(body?.error || "Your Max plan could not be synced right now.");
    }
    if (owner !== activeScanOwner()) return;
    if (!Array.isArray(body?.routines)) throw new Error("Routine sync did not return a saved snapshot. Your changes remain pending.");
    const savedIds = new Set(body.routines.map(sanitiseCoachingRoutine).filter((item) => item !== null).map((item) => item.id));
    if (pending.items.some((item) => !savedIds.has(item.id))) throw new Error("Some routine changes were not acknowledged. Your changes remain pending.");
    const restoration = restoreRoutines(body.routines, owner);
    if (restoration.error) throw new Error(restoration.error);
    acknowledgeRoutineSync(pending.revision, owner);
  };
  try { await Promise.race([run(), deadline]); }
  finally { clearTimeout(timer); }
}

/** Retries only the active account's durable queue; never generates a chat or rewards. */
export async function retryPendingRoutineSync(): Promise<boolean> {
  const owner = activeScanOwner();
  if (!owner?.startsWith("user:") || !readPendingRoutineSync(owner)) return false;
  await syncMaxPlanItems([]);
  return true;
}

export function mostRecentCoachConversation(conversations: readonly MaxConversationSummary[]): MaxConversationSummary | undefined {
  return conversations.filter((item) => item.source === "dashboard" && Number.isFinite(Date.parse(item.last_message_at)))
    .sort((a, b) => Date.parse(b.last_message_at) - Date.parse(a.last_message_at))[0];
}

export const MAX_CONVERSATIONS_CHANGED = "truemax:max-conversations-changed";

export function announceMaxConversationChanged(): void {
  window.dispatchEvent(new Event(MAX_CONVERSATIONS_CHANGED));
}
