import { currentAccessToken } from "./auth.js";

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

interface ConversationListResponse {
  conversations: MaxConversationSummary[];
  planItems: MaxPlanItem[];
}

export interface MaxConversationDetail {
  conversation: MaxConversationSummary;
  messages: MaxConversationMessage[];
  planItems: MaxPlanItem[];
}

async function request<T>(path: string): Promise<T> {
  const token = await currentAccessToken();
  if (!token) throw new Error("Sign in to see your Max chats.");
  const response = await fetch(path, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error || "Your Max chats are not available right now.");
  return body;
}

export function listMaxConversations(): Promise<ConversationListResponse> {
  return request<ConversationListResponse>("/api/max-conversations");
}

export function loadMaxConversation(id: string): Promise<MaxConversationDetail> {
  return request<MaxConversationDetail>(`/api/max-conversations?id=${encodeURIComponent(id)}`);
}

export async function syncMaxPlanItems(items: readonly { title: string }[]): Promise<void> {
  if (!items.length) return;
  const token = await currentAccessToken();
  if (!token) return;
  const response = await fetch("/api/max-conversations", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || "Your Max plan could not be synced right now.");
  }
}

export const MAX_CONVERSATIONS_CHANGED = "truemax:max-conversations-changed";

export function announceMaxConversationChanged(): void {
  window.dispatchEvent(new Event(MAX_CONVERSATIONS_CHANGED));
}
