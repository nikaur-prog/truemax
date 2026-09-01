import { authenticatedUser, getSupabaseAdmin, json, requestOrigin, safeMessage } from "./_shared.js";
import { maxAccessForUser } from "./_maxAccess.js";
import { normalisePlanTitle } from "./_maxConversation.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request): Promise<Response> {
  if (!requestOrigin(request)) return json({ error: "Cross-origin chat access is not allowed." }, 403);
  try {
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in to see your Max chats." }, 401);
    const access = await maxAccessForUser(user.id);
    if (!access.ok) return json({ error: access.error, upgrade: access.upgrade }, access.status);

    const admin = getSupabaseAdmin();
    const id = new URL(request.url).searchParams.get("id");
    const { data: planItems, error: planError } = await admin
      .from("max_plan_items")
      .select("id,title,category,status,notes,created_at,updated_at")
      .eq("user_id", user.id)
      .in("status", ["active", "paused", "not_working"])
      .order("updated_at", { ascending: false })
      .limit(40);
    if (planError) throw new Error(`Max plan memory is unavailable: ${planError.message}`);

    if (id) {
      if (!UUID.test(id)) return json({ error: "That Max chat could not be found." }, 404);
      const { data: conversation, error: conversationError } = await admin
        .from("max_conversations")
        .select("id,title,source,created_at,updated_at,last_message_at")
        .eq("id", id)
        .eq("user_id", user.id)
        .is("archived_at", null)
        .maybeSingle();
      if (conversationError) throw new Error(`Max chat is unavailable: ${conversationError.message}`);
      if (!conversation) return json({ error: "That Max chat could not be found." }, 404);
      const { data: newestMessages, error: messagesError } = await admin
        .from("max_messages")
        .select("id,role,content,created_at")
        .eq("conversation_id", id)
        .eq("user_id", user.id)
        .order("id", { ascending: false })
        .limit(80);
      if (messagesError) throw new Error(`Max messages are unavailable: ${messagesError.message}`);
      return json({ conversation, messages: [...(newestMessages ?? [])].reverse(), planItems: planItems ?? [] });
    }

    const { data: conversations, error: conversationsError } = await admin
      .from("max_conversations")
      .select("id,title,source,created_at,updated_at,last_message_at")
      .eq("user_id", user.id)
      .is("archived_at", null)
      .order("last_message_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(50);
    if (conversationsError) throw new Error(`Max chats are unavailable: ${conversationsError.message}`);
    return json({ conversations: conversations ?? [], planItems: planItems ?? [] });
  } catch (error) {
    console.error("max-conversations", safeMessage(error));
    return json({ error: "Your Max chats are not available right now." }, 503);
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!requestOrigin(request)) return json({ error: "Cross-origin plan updates are not allowed." }, 403);
  try {
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in to update your Max plan." }, 401);
    const access = await maxAccessForUser(user.id);
    if (!access.ok) return json({ error: access.error, upgrade: access.upgrade }, access.status);
    const body = await request.json().catch(() => null) as { items?: unknown } | null;
    const raw = Array.isArray(body?.items) ? body.items.slice(0, 40) : [];
    const now = new Date().toISOString();
    const items = raw.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const item = value as Record<string, unknown>;
      const title = typeof item.title === "string"
        ? item.title.replace(/[<>\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120).trim()
        : "";
      const normalizedTitle = normalisePlanTitle(title);
      if (title.length < 2 || !normalizedTitle) return [];
      return [{
        user_id: user.id,
        title,
        normalized_title: normalizedTitle,
        category: "other",
        status: "active",
        updated_at: now,
      }];
    });
    if (items.length) {
      const { error } = await getSupabaseAdmin().from("max_plan_items")
        .upsert(items, { onConflict: "user_id,normalized_title", ignoreDuplicates: true });
      if (error) throw new Error(`Max plan sync failed: ${error.message}`);
    }
    return json({ synced: items.length });
  } catch (error) {
    console.error("max-conversations sync", safeMessage(error));
    return json({ error: "Your Max plan could not be synced right now." }, 503);
  }
}
